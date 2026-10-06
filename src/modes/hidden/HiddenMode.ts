import * as THREE from 'three';
import type { Game } from '../../game/Game';
import type { Session } from '../../net/Session';
import { audio } from '../../game/Audio';
import { SoldierCrowd, SoldierPose } from './Soldiers';
import { Loot, LootItem, STEAL_TIME, LOOT_RESPAWN } from './Loot';
import { WalkerSim, Puppet, unpack } from './Walkers';

/**
 * HIDDEN TROOPERS: last one standing among a crowd of identical toy soldiers.
 *
 * Authority: the room leader (the same peer that simulates co-op enemies) owns
 * all the rules. It simulates the NPC crowd, grants steal locks and completes
 * steals, keeps the scores and the elimination clock, validates pistol shots
 * and declares eliminations and the winner. Other peers only send requests
 * ('h:req') and render what the leader replicates, so a client can't award
 * itself points, steal twice, fake a kill or run its own timer. If the leader
 * leaves, the next leader picks up from the replicated state.
 *
 * Messages (all on the existing transport):
 *  h:npc    leader -> all   crowd snapshot, 15 Hz
 *  h:tick   leader -> all   round, clock, scores, who's out, loot availability (2 Hz + on change)
 *  h:req    peer -> leader  {k:'steal',i} | {k:'cancel'} | {k:'shoot',o,d,t?}
 *  h:lock / h:deny          leader -> requester: steal accepted / refused
 *  h:stolen leader -> all   {i,id,v}: item gone, points to id
 *  h:fx     leader -> all   a validated pistol shot (tracer)
 *  h:out    leader -> all   {id,why,by?}: someone is eliminated
 *  h:win    leader -> all   {id}: last one standing
 */

export const ROUND_TIME = 120;
export const PISTOL_COOLDOWN = 1.2;
const PISTOL_SHOW = 0.9;
const PISTOL_RANGE = 90;
/** how close the leader requires you to be to an item (a little looser than the client prompt, for lag) */
const STEAL_RANGE = 3.6;
const WARN_AT = 15;
export const HIDDEN_MSGS = ['h:npc', 'h:tick', 'h:req', 'h:lock', 'h:deny', 'h:stolen', 'h:fx', 'h:out', 'h:win'];

type V3 = [number, number, number];
const arr = (v: THREE.Vector3): V3 => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
const vec = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

export interface HPlayer {
  id: string;
  /** points this round (decides the elimination) */
  score: number;
  /** points all game (first tie-break) */
  total: number;
  /** leader clock when they last scored (second tie-break: whoever got there first is safer) */
  last: number;
  out: boolean;
}

/** Who goes out at the end of a round: lowest round score, then lowest total, then latest to score, then id. */
export function lowestOf(list: HPlayer[]): HPlayer | null {
  const alive = list.filter((p) => !p.out);
  alive.sort((a, b) => a.score - b.score || a.total - b.total || b.last - a.last || (a.id < b.id ? -1 : 1));
  return alive[0] ?? null;
}

/** ray vs a standing soldier (three spheres, like every other hit test in the game); returns distance or -1 */
export function rayBody(o: THREE.Vector3, d: THREE.Vector3, feet: THREE.Vector3, pad: number) {
  let best = -1;
  for (const [y, r] of [[0.45, 0.3], [1.1, 0.42], [1.6, 0.26]] as const) {
    const cx = feet.x, cy = feet.y + y, cz = feet.z;
    const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const c = ox * ox + oy * oy + oz * oz - (r + pad) * (r + pad);
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

interface Lock { id: string; t: number }
interface ReqSteal { k: 'steal'; i: number }
interface ReqShoot { k: 'shoot'; o: V3; d: V3; t?: string }
type Req = ReqSteal | { k: 'cancel' } | ReqShoot;

/** per-player look state for drawing them in the crowd */
interface Look { reach: number; pistol: number }

export class HiddenMode {
  readonly crowd: SoldierCrowd;
  readonly loot = new Loot();
  roster = new Map<string, HPlayer>();
  round = 1;
  elimIn = ROUND_TIME;
  /** waiting for steals in progress before an elimination */
  resolving = false;
  clock = 0;
  ended = false;
  /** not playing: joined late, or eliminated */
  spectator = false;
  readonly npcCount: number;
  puppets: Puppet[] = [];
  sim: WalkerSim | null = null;

  // local player
  steal: { item: LootItem; t: number; ok: boolean; lostT: number } | null = null;
  pistolT = 0;
  pistolCd = 0;
  private fireWas = false;
  private prompt: LootItem | null = null;
  private recoil = 0;

  // leader
  private locks = new Map<number, Lock>();
  private lastShot = new Map<string, number>();
  private npcT = 0;
  private tickT = 0;
  private dirty = true;
  private resolveT = 0;

  // presentation
  private outAt = new Map<string, number>();
  /** names survive people leaving the room (for the results screen) */
  private names = new Map<string, string>();
  private outOrder: string[] = [];
  private looks = new Map<string, Look>();
  private pose: SoldierPose = { pos: new THREE.Vector3(), yaw: 0, speed: 0, reach: 0, pistol: 0, fallen: 0, pitch: 0, visible: true };
  private ui: HTMLElement;
  private uiCache = new Map<string, string>();
  private lastBeep = -1;
  private warned = false;
  private fp = new THREE.Group();
  private fpArm = new THREE.Group();
  private fpGun = new THREE.Group();
  private fpReach = 0;
  private fpAim = 0;

  constructor(private game: Game, private session: Session) {
    this.npcCount = game.lowEnd ? 30 : 44;
    this.crowd = new SoldierCrowd(this.npcCount + 16);
    game.scene.add(this.crowd.group);
    game.scene.add(this.loot.group);
    const m = session.match!;
    // everyone in the room when the match starts plays; late joiners watch
    const late = m.elapsed > 1.5;
    if (!late) for (const id of Object.keys(m.teams)) this.roster.set(id, { id, score: 0, total: 0, last: 0, out: false });
    this.spectator = late || !this.roster.has(session.self.id);
    this.ui = this.buildUi();
    this.buildFirstPerson();
    document.body.classList.add('hidden-mode');
    if (session.isLeader) this.becomeLeader();
    game.hud.banner('HIDDEN TROOPERS', this.spectator ? 'match in progress: you are watching' : 'blend in · steal toys · don’t come last', 3.2);
    audio.waveStart();
  }

  dispose() {
    this.game.scene.remove(this.crowd.group);
    this.game.scene.remove(this.loot.group);
    this.crowd.dispose();
    this.ui.remove();
    this.fp.removeFromParent();
    document.body.classList.remove('hidden-mode');
  }

  get selfId() {
    return this.session.self.id;
  }
  get me() {
    return this.roster.get(this.selfId);
  }
  get survivors() {
    return [...this.roster.values()].filter((p) => !p.out);
  }
  get isLeader() {
    return this.session.isLeader;
  }

  // ------------------------------------------------------------------ authority (leader)

  /** start simulating: at match start, or taking over from a leader who left */
  becomeLeader() {
    const lootSpots = this.loot.items.map((i) => i.pos);
    const g = this.game;
    const pois = [...g.room.pickupSpots.map((p) => p.pos.clone()), ...g.room.playerSpawns.map((p) => p.clone())];
    for (const l of g.world.ladders) {
      pois.push(new THREE.Vector3(l.x - l.nx * 1.2, l.y0, l.z - l.nz * 1.2));
      pois.push(new THREE.Vector3(l.x + l.nx * 1.5, l.y1, l.z + l.nz * 1.5));
    }
    this.sim = new WalkerSim(g.world, g.nav, pois, lootSpots);
    // carry on with the crowd where everyone last saw it
    this.sim.spawn(this.npcCount, this.puppets.length ? this.puppets.map((p) => p.pos.clone()) : undefined);
    this.locks.clear();
    for (const it of this.loot.items) if (!it.available && it.respawn <= 0) it.respawn = LOOT_RESPAWN * 0.5;
    this.dirty = true;
  }

  private send(type: string, data: unknown, to?: string) {
    if (to === this.selfId) {
      this.onNet(type, data, this.selfId);
      return;
    }
    this.session.t.send(type, data, to);
  }
  private broadcast(type: string, data: unknown) {
    this.session.t.send(type, data);
    this.onNet(type, data, this.selfId);
  }
  /** a request from a player (or from ourselves) to the leader */
  request(r: Req) {
    if (this.isLeader) this.handleReq(this.selfId, r);
    else this.session.t.send('h:req', r, this.session.leaderId);
  }

  private posOf(id: string): THREE.Vector3 | null {
    if (id === this.selfId) return this.game.player.pos;
    return this.session.avatars.get(id)?.pos ?? null;
  }

  private handleReq(from: string, r: Req) {
    const p = this.roster.get(from);
    if (!p || p.out || this.ended) return;
    if (r.k === 'steal') {
      const it = this.loot.items[r.i];
      const deny = (why: string) => this.send('h:deny', { i: r.i, why }, from);
      if (!it || !it.available) return deny('gone');
      if (this.locks.has(it.id)) return deny('busy');
      for (const l of this.locks.values()) if (l.id === from) return deny('busy');
      if (this.resolving) return deny('locked');
      const pos = this.posOf(from);
      if (!pos || Math.hypot(pos.x - it.pos.x, pos.z - it.pos.z) > STEAL_RANGE || Math.abs(pos.y - it.pos.y) > 2.6) return deny('far');
      this.locks.set(it.id, { id: from, t: this.clock });
      this.send('h:lock', { i: it.id }, from);
    } else if (r.k === 'cancel') {
      for (const [i, l] of this.locks) if (l.id === from) this.locks.delete(i);
    } else if (r.k === 'shoot') this.validateShot(from, r);
  }

  private validateShot(from: string, r: ReqShoot) {
    // the leader keeps the fire rate, not the shooter
    if (this.clock - (this.lastShot.get(from) ?? -99) < PISTOL_COOLDOWN * 0.8) return;
    this.lastShot.set(from, this.clock);
    const sp = this.posOf(from);
    if (!sp) return;
    const o = vec(r.o), d = vec(r.d);
    if (d.lengthSq() < 0.5) return;
    d.normalize();
    // the shot must come from where the shooter actually is
    if (o.distanceTo(new THREE.Vector3(sp.x, sp.y + 1.5, sp.z)) > 3) return;
    let maxD = PISTOL_RANGE;
    const wh = this.game.world.raycast(o, d, maxD);
    if (wh) maxD = wh.dist;
    let hit: string | null = null;
    if (r.t && r.t !== from) {
      const tp = this.roster.get(r.t), pos = this.posOf(r.t);
      if (tp && !tp.out && pos) {
        // generous by the target's lag, never through walls
        const t = rayBody(o, d, pos, 0.55);
        if (t >= 0 && t < maxD) {
          maxD = t;
          hit = r.t;
        }
      }
    }
    // the crowd soaks up bullets: an NPC in the way saves the target
    if (this.sim) for (const w of this.sim.walkers) {
      const t = rayBody(o, d, w.pos, 0);
      if (t >= 0 && t < maxD - 0.4) {
        maxD = t;
        hit = null;
      }
    }
    this.broadcast('h:fx', { s: from, o: arr(o), e: arr(o.clone().addScaledVector(d, maxD)) });
    if (hit) this.eliminate(hit, 'shot', from);
  }

  private eliminate(id: string, why: 'shot' | 'round' | 'left', by?: string) {
    const p = this.roster.get(id);
    if (!p || p.out) return;
    this.broadcast('h:out', { id, why, by });
    this.dirty = true;
  }

  private leaderUpdate(dt: number) {
    const sim = this.sim!;
    sim.update(dt);
    this.npcT -= dt;
    if (this.npcT <= 0) {
      this.npcT = 1 / 15;
      const n = sim.pack();
      this.session.t.send('h:npc', { n });
      unpack(n, this.puppets, performance.now());
    }
    if (this.ended) return;
    // steals: complete after exactly STEAL_TIME of leader time, if they're still there
    for (const [i, l] of this.locks) {
      const p = this.roster.get(l.id);
      if (!p || p.out) {
        this.locks.delete(i);
        continue;
      }
      if (this.clock - l.t < STEAL_TIME - 1e-6) continue;
      this.locks.delete(i);
      const it = this.loot.items[i];
      const pos = this.posOf(l.id);
      if (!it.available || !pos || Math.hypot(pos.x - it.pos.x, pos.z - it.pos.z) > STEAL_RANGE + 0.6) {
        this.send('h:deny', { i, why: 'far' }, l.id);
        continue;
      }
      p.score += it.value;
      p.total += it.value;
      p.last = this.clock;
      it.respawn = LOOT_RESPAWN;
      this.broadcast('h:stolen', { i, id: l.id, v: it.value });
      this.dirty = true;
    }
    for (const it of this.loot.items) {
      if (it.available || it.respawn <= 0) continue;
      it.respawn -= dt;
      if (it.respawn <= 0) {
        this.loot.setAvailable(it.id, true);
        this.dirty = true;
      }
    }
    // the elimination clock
    this.elimIn -= dt;
    if (this.elimIn <= 0) {
      if (!this.resolving) {
        this.resolving = true;
        this.resolveT = 0;
        this.dirty = true;
      }
      this.resolveT += dt;
      // never knock someone out mid-steal: let running steals finish first (they take at most 2 s)
      if (this.locks.size === 0 || this.resolveT > STEAL_TIME + 1) {
        this.locks.clear();
        const lo = lowestOf([...this.roster.values()]);
        if (lo && this.survivors.length > 1) this.eliminate(lo.id, 'round');
        for (const p of this.roster.values()) p.score = 0;
        this.round++;
        this.elimIn = ROUND_TIME;
        this.resolving = false;
        this.dirty = true;
      }
    }
    // last one standing
    const alive = this.survivors;
    if (alive.length <= 1 && this.roster.size > 0) {
      this.broadcast('h:win', { id: alive[0]?.id ?? '' });
      return;
    }
    this.tickT -= dt;
    if (this.dirty || this.tickT <= 0) {
      this.tickT = 0.5;
      this.dirty = false;
      this.session.t.send('h:tick', this.tickWire());
    }
  }

  private tickWire() {
    return {
      r: this.round,
      e: +this.elimIn.toFixed(2),
      z: this.resolving ? 1 : 0,
      p: [...this.roster.values()].map((p) => [p.id, p.score, p.total, +p.last.toFixed(2), p.out ? 1 : 0]),
      a: this.loot.items.map((i) => (i.available ? '1' : '0')).join(''),
    };
  }

  /** a player dropped out of the room */
  onLeave(id: string) {
    if (this.isLeader && this.roster.get(id) && !this.roster.get(id)!.out) this.eliminate(id, 'left');
  }

  // ------------------------------------------------------------------ network (everyone)

  onNet(type: string, data: unknown, from: string) {
    const fromLeader = from === this.session.leaderId;
    switch (type) {
      case 'h:npc':
        if (!this.isLeader && fromLeader) unpack((data as { n: number[] }).n, this.puppets, performance.now());
        break;
      case 'h:tick':
        if (!this.isLeader && fromLeader) this.applyTick(data as ReturnType<HiddenMode['tickWire']>);
        break;
      case 'h:req':
        if (this.isLeader) this.handleReq(from, data as Req);
        break;
      case 'h:lock': {
        const d = data as { i: number };
        if (fromLeader && this.steal && this.steal.item.id === d.i) this.steal.ok = true;
        break;
      }
      case 'h:deny': {
        const d = data as { i: number; why: string };
        if (fromLeader && this.steal && this.steal.item.id === d.i) {
          this.steal = null;
          this.game.hud.toast(d.why === 'busy' ? 'SOMEONE ELSE IS ON IT' : d.why === 'locked' ? 'TOO LATE: ELIMINATION!' : d.why === 'far' ? 'TOO FAR AWAY' : 'ALREADY GONE', 1.2);
          audio.empty();
        }
        break;
      }
      case 'h:stolen': {
        if (!fromLeader) break;
        const d = data as { i: number; id: string; v: number };
        const it = this.loot.items[d.i];
        if (!it) break;
        this.loot.setAvailable(d.i, false);
        this.game.fx.glow(it.pos.clone().setY(it.pos.y + 0.4), 0xfff2a0, 0.6, 0.05, 0.3);
        if (d.id === this.selfId) {
          this.steal = null;
          this.game.hud.banner(`+${d.v}`, `you stole the ${it.name}`, 1.4);
          audio.steal();
        } else {
          if (this.steal?.item.id === d.i) this.steal = null;
          // who did it stays a secret
          this.feed(`Someone stole the ${it.name} (+${d.v})`);
        }
        break;
      }
      case 'h:fx': {
        if (!fromLeader) break;
        const d = data as { s: string; o: V3; e: V3 };
        if (d.s === this.selfId) break; // we drew our own shot already
        const o = vec(d.o), e = vec(d.e);
        const gun = o.clone().setY(o.y - 0.3);
        this.game.fx.tracer(gun, e, 0xffe080, 0.04, 0.09);
        this.game.fx.glow(gun, 0xffd080, 0.8, 0.15, 0.07);
        audio.pistol(gun.distanceTo(this.game.player.pos));
        this.looks.get(d.s) && (this.looks.get(d.s)!.pistol = 1);
        break;
      }
      case 'h:out': {
        if (!fromLeader) break;
        this.applyOut(data as { id: string; why: 'shot' | 'round' | 'left'; by?: string });
        break;
      }
      case 'h:win': {
        if (!fromLeader) break;
        this.finish((data as { id: string }).id);
        break;
      }
    }
  }

  private applyTick(d: ReturnType<HiddenMode['tickWire']>) {
    this.round = d.r;
    this.elimIn = d.e;
    this.resolving = d.z === 1;
    for (const [id, score, total, last, out] of d.p as [string, number, number, number, number][]) {
      let p = this.roster.get(id);
      if (!p) this.roster.set(id, (p = { id, score, total, last, out: false }));
      p.score = score;
      p.total = total;
      p.last = last;
      if (out && !p.out) {
        p.out = true;
        if (!this.outAt.has(id)) this.outAt.set(id, this.clock - 5);
      }
    }
    if (!this.roster.has(this.selfId)) this.spectator = true;
    for (let i = 0; i < d.a.length; i++) {
      const on = d.a[i] === '1';
      const it = this.loot.items[i];
      if (it && it.available !== on) {
        this.loot.setAvailable(i, on);
        if (!on && this.steal?.item.id === i) this.steal = null;
      }
    }
  }

  private applyOut(d: { id: string; why: 'shot' | 'round' | 'left'; by?: string }) {
    const p = this.roster.get(d.id);
    if (!p || p.out) return;
    p.out = true;
    this.outAt.set(d.id, this.clock);
    this.outOrder.push(d.id);
    for (const [i, l] of this.locks) if (l.id === d.id) this.locks.delete(i);
    const name = this.nameOf(d.id);
    if (d.id === this.selfId) {
      this.spectator = true;
      this.steal = null;
      this.game.hud.banner("YOU'RE OUT!", d.why === 'shot' ? 'a hidden trooper picked you out of the crowd' : 'lowest score this round — now spectating', 3.5);
      audio.eliminated();
    } else if (d.why === 'left') {
      this.feed(`${name} left the game`);
    } else {
      this.game.hud.banner(`${name} ELIMINATED`, d.why === 'shot' ? 'shot by a hidden trooper' : 'lowest score this round', 2.6);
      audio.eliminated();
      if (d.by === this.selfId) this.feed(`You took out ${name}!`);
    }
    this.feed(d.why === 'shot' ? `${name} was shot` : d.why === 'round' ? `${name} was eliminated (lowest score)` : `${name} is out`);
  }

  private finish(winner: string) {
    if (this.ended) return;
    this.ended = true;
    this.steal = null;
    const order = [winner, ...[...this.outOrder].reverse()].filter((id, i, a) => id && a.indexOf(id) === i);
    for (const id of this.roster.keys()) if (!order.includes(id)) order.push(id);
    const lines = order.map((id, i) => {
      const p = this.roster.get(id)!;
      return `${i + 1}. ${this.nameOf(id)}${id === this.selfId ? ' (you)' : ''} — ${p?.total ?? 0} pts${i === 0 && winner ? ' · LAST ONE STANDING' : ''}`;
    });
    const won = winner === this.selfId;
    const title = won ? 'YOU WIN!' : winner ? `${this.nameOf(winner)} WINS!` : 'NOBODY WINS';
    this.session.finishCustom(title, lines, won);
  }

  // ------------------------------------------------------------------ local player

  /** what we add to our 15 Hz player state: stealing (arm out), pistol out, out of the game */
  stateExtra() {
    return { hs: this.steal ? 1 : 0, hg: this.pistolT > 0 ? 1 : 0, ho: this.spectator ? 1 : 0 } as const;
  }

  private nameOf(id: string) {
    return this.names.get(id) ?? this.session.nameOf(id);
  }

  update(dt: number) {
    this.clock += dt;
    for (const p of this.session.all) if (p.id) this.names.set(p.id, p.name);
    if (this.isLeader && !this.sim) this.becomeLeader();
    if (this.isLeader) this.leaderUpdate(dt);
    else if (!this.ended) this.elimIn = Math.max(0, this.elimIn - dt);
    const now = performance.now();
    for (const p of this.puppets) p.update(dt, now);
    this.loot.update(dt);
    if (!this.spectator && !this.ended) this.updateLocal(dt);
    else {
      this.steal = null;
      this.prompt = null;
    }
    this.renderCrowd(dt);
    this.updateFirstPerson(dt);
    this.updateUi();
  }

  private updateLocal(dt: number) {
    const g = this.game, pl = g.player, input = g.input;
    const eye = pl.eyePos, fwd = pl.forward();
    // ---- stealing: look at a toy, hold E / STEAL for 2 s
    const looked = this.loot.lookedAt(eye, fwd, pl.pos);
    this.prompt = looked;
    if (this.steal) {
      const s = this.steal;
      if (!input.steal) {
        this.request({ k: 'cancel' });
        this.steal = null;
        g.hud.toast('STEAL CANCELLED', 0.9);
      } else {
        s.lostT = looked === s.item ? 0 : s.lostT + dt;
        if (s.lostT > 0.25 || !s.item.available) {
          this.request({ k: 'cancel' });
          this.steal = null;
        } else {
          s.t += dt;
          if (s.t < STEAL_TIME) audio.stealTick(s.t / STEAL_TIME);
          // no answer from the leader long after the 2 s: give up
          if (s.t > STEAL_TIME + 2.5) {
            this.request({ k: 'cancel' });
            this.steal = null;
          }
        }
      }
    } else if (input.steal && looked && !this.resolving) {
      this.steal = { item: looked, t: 0, ok: false, lostT: 0 };
      this.request({ k: 'steal', i: looked.id });
    }
    // ---- the hidden pistol: out for a moment, one shot, back in the pocket
    this.pistolCd = Math.max(0, this.pistolCd - dt);
    this.pistolT = Math.max(0, this.pistolT - dt);
    const pressed = input.fire && !this.fireWas;
    this.fireWas = input.fire;
    if (pressed) {
      if (this.pistolCd > 0) audio.empty();
      else this.fire();
    }
  }

  private fire() {
    const g = this.game, pl = g.player;
    this.pistolCd = PISTOL_COOLDOWN;
    this.pistolT = PISTOL_SHOW;
    this.recoil = 1;
    const o = pl.eyePos.clone(), d = pl.forward().clone().normalize();
    // what's under the crosshair: a wall, an NPC, or (hopefully) a player
    let maxD = PISTOL_RANGE;
    const wh = g.world.raycast(o, d, maxD);
    if (wh) maxD = wh.dist;
    let target: string | undefined;
    const pad = g.input.isTouch ? 0.12 : 0.02;
    for (const p of this.puppets) {
      const t = rayBody(o, d, p.pos, pad);
      if (t >= 0 && t < maxD) { maxD = t; target = undefined; }
    }
    for (const [id, av] of this.session.avatars) {
      const rp = this.roster.get(id);
      if (!rp || rp.out) continue;
      const t = rayBody(o, d, av.pos, pad);
      if (t >= 0 && t < maxD) { maxD = t; target = id; }
    }
    this.request({ k: 'shoot', o: arr(o), d: arr(d), t: target });
    const end = o.clone().addScaledVector(d, maxD);
    const muzzle = o.clone().addScaledVector(d, 0.6).add(new THREE.Vector3(Math.cos(pl.yaw), 0, -Math.sin(pl.yaw)).multiplyScalar(0.18)).setY(o.y - 0.18);
    g.fx.tracer(muzzle, end, 0xffe080, 0.04, 0.09);
    g.fx.glow(muzzle, 0xffd080, 0.7, 0.12, 0.06);
    if (wh && maxD >= wh.dist - 0.01) g.fx.impact(wh.point, wh.normal, 0xfff0c0);
    pl.addRecoil(0.03, 0.01);
    audio.pistol(0);
  }

  // ------------------------------------------------------------------ spectating

  /** free camera for spectators (late joiners and the eliminated): fly, no body */
  spectate(dt: number) {
    const g = this.game, pl = g.player, input = g.input;
    pl.yaw -= input.lookDX;
    pl.pitch = Math.max(-1.5, Math.min(1.5, pl.pitch - input.lookDY));
    const fwd = pl.forward();
    const right = new THREE.Vector3(Math.cos(pl.yaw), 0, -Math.sin(pl.yaw));
    const sp = input.sprint ? 30 : 15;
    pl.pos.addScaledVector(fwd, input.moveY * sp * dt).addScaledVector(right, input.moveX * sp * dt);
    if (input.jump) pl.pos.y += 4;
    pl.pos.x = Math.max(-120, Math.min(120, pl.pos.x));
    pl.pos.z = Math.max(-110, Math.min(110, pl.pos.z));
    pl.pos.y = Math.max(0.2, Math.min(220, pl.pos.y));
    pl.vel.set(0, 0, 0);
    pl.updateCamera(dt);
  }

  // ------------------------------------------------------------------ drawing

  /** NPCs and every real player still in the game, all drawn by the same instanced soldier */
  private renderCrowd(dt: number) {
    const pose = this.pose;
    let i = 0;
    for (const p of this.puppets) {
      if (i >= this.npcCount) break;
      pose.pos = p.pos;
      pose.yaw = p.yaw;
      pose.speed = p.speed;
      pose.reach = p.reach;
      pose.pistol = 0;
      pose.fallen = 0;
      pose.pitch = 0;
      pose.visible = true;
      this.crowd.set(i++, pose, dt);
    }
    this.crowd.hideFrom(i);
    // players get fixed slots after the NPCs (by sorted id), so their hop phase never jumps
    const ids = [...this.roster.keys()].sort();
    ids.forEach((id, k) => {
      const slot = this.npcCount + k;
      if (slot >= this.crowd.capacity) return;
      const av = this.session.avatars.get(id);
      const outT = this.outAt.get(id);
      if (id === this.selfId || !av || !av.last) {
        pose.visible = false;
        this.crowd.set(slot, pose, dt);
        return;
      }
      const st = av.last;
      let look = this.looks.get(id);
      if (!look) this.looks.set(id, (look = { reach: 0, pistol: 0 }));
      look.reach += ((st.hs ? 1 : 0) - look.reach) * Math.min(1, dt * 10);
      look.pistol += ((st.hg ? 1 : 0) - look.pistol) * Math.min(1, dt * (st.hg ? 18 : 6));
      pose.pos = av.pos;
      pose.yaw = av.yaw;
      pose.speed = Math.hypot(av.vel.x, av.vel.z);
      pose.reach = look.reach;
      pose.pistol = look.pistol;
      pose.pitch = av.pitch;
      pose.fallen = outT !== undefined ? Math.min(1, (this.clock - outT) / 0.5) : 0;
      // knocked over for a few seconds, then gone; spectators never show up
      pose.visible = outT !== undefined ? this.clock - outT < 3 : !st.ho;
      this.crowd.set(slot, pose, dt);
    });
    this.crowd.commit();
  }

  private buildFirstPerson() {
    const red = new THREE.MeshStandardMaterial({ color: 0xd8352a, roughness: 0.38 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.5 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.4 });
    // a slim toy-soldier forearm reaching in from the bottom right; the hand sits at the group origin
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.3, 4, 10), red);
    arm.rotation.x = -Math.PI / 2;
    arm.position.z = 0.17;
    this.fpArm.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), red);
    this.fpArm.add(hand);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.05, 0.13), grey);
    body.position.set(0, 0.035, -0.045);
    this.fpGun.add(body);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.065, 0.032), grey);
    grip.position.set(0, -0.005, 0.0);
    grip.rotation.x = 0.3;
    this.fpGun.add(grip);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.016, 10), orange);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(0, 0.04, -0.115);
    this.fpGun.add(tip);
    this.fpArm.add(this.fpGun);
    this.fp.add(this.fpArm);
    this.fp.visible = false;
    this.game.weapons.camera.add(this.fp);
  }

  private updateFirstPerson(dt: number) {
    const reach = this.steal ? 1 : 0;
    const aim = this.pistolT > 0 ? 1 : 0;
    this.fpReach += (reach - this.fpReach) * Math.min(1, dt * 9);
    this.fpAim += (aim - this.fpAim) * Math.min(1, dt * (aim ? 22 : 7));
    this.recoil = Math.max(0, this.recoil - dt * 6);
    const k = Math.max(this.fpReach, this.fpAim);
    this.fp.visible = k > 0.02 && !this.spectator;
    if (!this.fp.visible) return;
    // rest (below the screen) -> reaching for the toy / pistol held out
    const rx = 0.24, ry = -0.42, rz = -0.3;
    const reachP = [0.05, -0.1, -0.46], aimP = [0.1, -0.1, -0.36];
    const w = this.fpAim > this.fpReach ? aimP : reachP;
    this.fpArm.position.set(rx + (w[0] - rx) * k, ry + (w[1] - ry) * k, rz + (w[2] - rz) * k);
    // grabbing hand wiggles as the steal progresses; the forearm angles in from the corner
    const t = this.steal ? this.steal.t : 0;
    const grab = this.fpReach > this.fpAim ? Math.sin(t * 9) * 0.05 + 0.1 : 0;
    this.fpArm.rotation.set(this.recoil * 0.45 + grab, 0.22, 0);
    this.fpGun.visible = this.fpAim > 0.05;
  }

  // ------------------------------------------------------------------ HUD

  private buildUi() {
    const el = document.createElement('div');
    el.id = 'hid-hud';
    el.innerHTML = `
      <div class="hid-top">
        <div class="hid-chip"><small>NEXT ELIMINATION</small><b data-k="clock">2:00</b></div>
        <div class="hid-chip"><small>SURVIVORS</small><b data-k="surv">0</b></div>
        <div class="hid-chip"><small>ROUND · TOTAL</small><b data-k="score">0 · 0</b></div>
      </div>
      <div class="hid-danger" data-k="danger"></div>
      <div class="hid-board" data-k="board"></div>
      <div class="hid-warn" data-k="warn"></div>
      <div class="hid-prompt" data-k="prompt">
        <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" class="bg"/><circle cx="22" cy="22" r="19" class="fg" data-k="ring"/></svg>
        <span data-k="ptext"></span>
      </div>
      <div class="hid-feed" data-k="feed"></div>
      <div class="hid-cd" data-k="cd"></div>`;
    document.getElementById('hud')!.appendChild(el);
    return el;
  }

  private q(k: string) {
    return this.ui.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  }
  private setText(k: string, v: string, html = false) {
    if (this.uiCache.get(k) === v) return;
    this.uiCache.set(k, v);
    if (html) this.q(k).innerHTML = v;
    else this.q(k).textContent = v;
  }
  private setShown(k: string, on: boolean) {
    if (this.uiCache.get('__' + k) === String(on)) return;
    this.uiCache.set('__' + k, String(on));
    this.q(k).classList.toggle('on', on);
  }

  feed(text: string) {
    const f = this.q('feed');
    const row = document.createElement('div');
    row.textContent = text;
    f.appendChild(row);
    while (f.children.length > 4) f.firstElementChild!.remove();
    setTimeout(() => row.remove(), 6000);
  }

  private updateUi() {
    const t = Math.max(0, Math.ceil(this.elimIn));
    this.setText('clock', this.resolving ? '0:00' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    const alive = this.survivors;
    this.setText('surv', String(alive.length));
    const me = this.me;
    this.setText('score', me ? `${me.score} · ${me.total}` : '—');
    // am I the one going out?
    const lo = lowestOf([...this.roster.values()]);
    const danger = !!me && !me.out && lo?.id === me.id && alive.length > 1 && !this.ended;
    this.setText('danger', danger ? '⚠ LOWEST SCORE THIS ROUND — STEAL SOMETHING!' : '');
    this.setShown('danger', danger);
    // scoreboard: names and round scores (names never point at a body)
    const rows = [...this.roster.values()].sort((a, b) => Number(a.out) - Number(b.out) || b.score - a.score || b.total - a.total);
    this.setText('board', rows.map((p) => `<div class="${p.out ? 'out' : ''}${p.id === this.selfId ? ' me' : ''}"><span>${esc(this.nameOf(p.id))}</span><b>${p.out ? 'OUT' : p.score}</b></div>`).join(''), true);
    // last seconds before an elimination: big countdown + beeps
    const warn = !this.ended && alive.length > 1 && (this.elimIn <= WARN_AT || this.resolving);
    this.setShown('warn', warn);
    if (warn) this.setText('warn', this.resolving ? 'ELIMINATING…' : `ELIMINATION IN ${t}`);
    if (!this.ended && this.elimIn <= WARN_AT && this.elimIn > WARN_AT - 1 && !this.warned) {
      this.warned = true;
      audio.waveStart();
    }
    if (this.elimIn > WARN_AT + 1) this.warned = false;
    if (warn && !this.resolving && t <= 10 && t !== this.lastBeep && t > 0) {
      this.lastBeep = t;
      audio.beep(t <= 3);
    }
    // steal prompt + progress ring
    const s = this.steal;
    const item = s ? s.item : this.prompt;
    this.setShown('prompt', !!item && !this.spectator);
    if (item) {
      const key = this.game.input.isTouch ? 'HOLD STEAL' : 'HOLD E';
      this.setText('ptext', s ? (s.t >= STEAL_TIME ? 'STEALING…' : `STEALING ${item.name}`) : `${key} · STEAL ${item.name} (+${item.value})`);
      const k = s ? Math.min(1, s.t / STEAL_TIME) : 0;
      this.setText('ring', String(Math.round(k * 100)));
      this.q('ring').style.strokeDashoffset = String(119.4 * (1 - k));
    }
    this.setText('cd', this.spectator ? (this.me?.out ? 'SPECTATING — WASD to fly' : 'WATCHING — you joined mid-match') : this.pistolCd > 0 ? 'PISTOL RELOADING' : 'PISTOL READY · FIRE');
    document.getElementById('btn-steal')?.classList.toggle('ready', !!this.prompt && !this.steal);
  }
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
