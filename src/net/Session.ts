import * as THREE from 'three';
import { Transport, createTransport, LoopbackTransport } from './Net';
import { RemoteAvatar, PlayerState } from './RemotePlayers';
import { MODES, ModeId, GUN_LADDER, TEAM_COLORS, FFA_COLORS, TEAM_NAMES } from '../game/Modes';
import { WEAPONS } from '../game/Weapons';
import type { Game } from '../game/Game';
import type { Enemy, EnemyType } from '../game/Enemies';
import { audio } from '../game/Audio';
import { HIDDEN_MSGS } from '../modes/hidden/HiddenMode';
import type { HiddenMode } from '../modes/hidden/HiddenMode';

export interface PeerInfo {
  id: string;
  name: string;
  joined: number;
  team: number;
  kills: number;
  deaths: number;
  level: number;
  inMatch: boolean;
}

interface MatchWire {
  id: string;
  mode: ModeId;
  size: number;
  teams: Record<string, number>;
  scores: Record<string, [number, number, number]>;
  elapsed: number;
}

export interface KillFeedItem { killer: string; victim: string; weapon: string; t: number }

const ENEMY_TYPES: EnemyType[] = ['trooper', 'robot', 'chomper', 'bug', 'boss'];
type V3 = [number, number, number];
const arr = (v: THREE.Vector3): V3 => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
const vec = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

/** One multiplayer room: lobby, players, the running match and its networking. */
export class Session {
  readonly t: Transport;
  readonly self: PeerInfo;
  peers = new Map<string, PeerInfo>();
  avatars = new Map<string, RemoteAvatar>();
  mode: ModeId = 'ffa';
  teamSize = 2;
  private modeTs = 0;
  match: MatchWire | null = null;
  matchStart = 0;
  ended = false;
  endInfo: { title: string; lines: string[] } | null = null;
  feed: KillFeedItem[] = [];
  respawnT = 0;
  private stateT = 0;
  private snapT = 0;
  private lastHitBy = '';
  private lastHitWeapon = 0;
  private puppetSeen = new Map<number, number>();
  private wasLeader = false;
  /** extra per-frame simulation living in this room (offline bots) */
  bots: { update(dt: number): void } | null = null;
  /** the running Hidden Troopers rules, if that's the mode */
  hidden: HiddenMode | null = null;
  onChange: () => void = () => {};
  onEnd: () => void = () => {};
  /** last co-op snapshot info for non-leader HUD */
  coopInfo = { wave: 0, state: 'intro', remaining: 0, killed: 0, total: 0, boss: -1 };

  constructor(readonly room: string, private game: Game, name: string) {
    this.t = createTransport(room);
    this.self = { id: '', name, joined: Date.now(), team: 0, kills: 0, deaths: 0, level: 0, inMatch: false };
    this.t.whenReady(() => {
      this.self.id = this.t.selfId;
      this.onChange();
    });
    this.t.onJoin((id) => {
      this.sendInfo(id);
      if (this.match && this.self.inMatch) this.t.send('start', this.matchWire(), id);
    });
    this.t.onLeave((id) => this.removePeer(id));
    this.bind();
  }

  /** an offline room (just you and bots): no network, and it can be paused */
  get offline() {
    return this.t instanceof LoopbackTransport;
  }

  // ------------------------------------------------------------------ roster

  get playerCount() {
    return this.peers.size + 1;
  }

  get all(): PeerInfo[] {
    return [this.self, ...this.peers.values()];
  }

  get inMatchPlayers(): PeerInfo[] {
    return this.all.filter((p) => p.inMatch);
  }

  /** Lowest join time among match players simulates co-op enemies. */
  get leaderId() {
    const list = this.inMatchPlayers.length ? this.inMatchPlayers : this.all;
    return [...list].sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1))[0]?.id;
  }

  get isLeader() {
    return this.leaderId === this.self.id;
  }

  colorOf(p: PeerInfo) {
    if (this.match && MODES[this.match.mode].teams) return TEAM_COLORS[p.team];
    const ids = this.all.map((x) => x.id).sort();
    return FFA_COLORS[Math.max(0, ids.indexOf(p.id)) % FFA_COLORS.length];
  }

  nameOf(id: string) {
    if (id === this.self.id) return this.self.name;
    return this.peers.get(id)?.name ?? 'Toy';
  }

  isEnemy(id: string) {
    if (!this.match) return true;
    if (this.match.mode === 'coop') return false;
    if (!MODES[this.match.mode].teams) return true;
    return (this.peers.get(id)?.team ?? -1) !== this.self.team;
  }

  setName(name: string) {
    this.self.name = name.slice(0, 14) || 'Trooper';
    this.sendInfo();
    this.onChange();
  }

  setMode(mode: ModeId, size = this.teamSize) {
    this.mode = mode;
    this.teamSize = size;
    this.modeTs = Date.now();
    this.t.send('mode', { mode, size, ts: this.modeTs });
    this.onChange();
  }

  private sendInfo(to?: string) {
    this.t.send('info', { name: this.self.name, joined: this.self.joined, inMatch: this.self.inMatch, mode: this.mode, size: this.teamSize, ts: this.modeTs }, to);
  }

  private removePeer(id: string) {
    const was = this.peers.get(id);
    this.peers.delete(id);
    const av = this.avatars.get(id);
    if (av) {
      av.dispose(this.game.scene);
      this.avatars.delete(id);
    }
    if (was) this.game.hud.toast(`${was.name} left the room`);
    this.hidden?.onLeave(id);
    // co-op: take over the enemies if the simulating player left
    if (this.match?.mode === 'coop' && this.self.inMatch && this.isLeader && !this.wasLeader) this.game.coopBecomeLeader(this.coopInfo);
    this.wasLeader = this.isLeader;
    this.onChange();
  }

  leave() {
    if (this.self.inMatch) this.game.stopMatch();
    this.t.leave();
    for (const av of this.avatars.values()) av.dispose(this.game.scene);
    this.avatars.clear();
    this.peers.clear();
  }

  // ------------------------------------------------------------------ match flow

  canStart() {
    return this.playerCount >= 2 && !this.self.inMatch;
  }

  startMatch() {
    if (!this.canStart()) return;
    const ids = this.all.map((p) => p.id).sort(() => Math.random() - 0.5);
    const teams: Record<string, number> = {};
    ids.forEach((id, i) => (teams[id] = i % 2));
    const wire: MatchWire = { id: Math.random().toString(36).slice(2, 8), mode: this.mode, size: this.teamSize, teams, scores: {}, elapsed: 0 };
    this.t.send('start', wire);
    this.beginMatch(wire);
  }

  private matchWire(): MatchWire {
    const m = this.match!;
    const scores: MatchWire['scores'] = {};
    for (const p of this.all) scores[p.id] = [p.kills, p.deaths, p.level];
    const teams: Record<string, number> = {};
    for (const p of this.all) teams[p.id] = p.team;
    return { ...m, teams, scores, elapsed: (performance.now() - this.matchStart) / 1000 };
  }

  private beginMatch(w: MatchWire) {
    if (this.self.inMatch && this.match?.id === w.id) return;
    this.match = w;
    this.mode = w.mode;
    this.teamSize = w.size;
    this.ended = false;
    this.endInfo = null;
    this.feed = [];
    this.matchStart = performance.now() - w.elapsed * 1000;
    for (const p of this.all) {
      const sc = w.scores[p.id];
      p.kills = sc?.[0] ?? 0;
      p.deaths = sc?.[1] ?? 0;
      p.level = sc?.[2] ?? 0;
      p.inMatch = true;
      if (w.teams[p.id] !== undefined) p.team = w.teams[p.id];
    }
    if (w.teams[this.self.id] === undefined) {
      // late joiner: join the smaller team
      const t0 = this.all.filter((p) => p.team === 0 && p !== this.self).length;
      const t1 = this.all.filter((p) => p.team === 1 && p !== this.self).length;
      this.self.team = t0 <= t1 ? 0 : 1;
    }
    this.self.inMatch = true;
    this.sendInfo();
    this.wasLeader = this.isLeader;
    this.game.startMatch(this);
    for (const av of this.avatars.values()) {
      const p = this.peers.get(av.id);
      if (p) av.setColor(this.colorOf(p));
    }
    this.onChange();
  }

  /** current gun-game / mode loadout for the local player */
  loadout(): number[] {
    if (!this.match) return [0];
    if (this.match.mode === 'hidden') return [0]; // no visible guns: the weapon system just idles
    if (this.match.mode === 'gungame') return [GUN_LADDER[Math.min(GUN_LADDER.length - 1, this.self.level)]];
    return MODES[this.match.mode].loadout;
  }

  timeLeft() {
    if (!this.match) return 0;
    const lim = MODES[this.match.mode].timeLimit;
    if (!lim) return 0;
    return Math.max(0, lim - (performance.now() - this.matchStart) / 1000);
  }

  teamScore(team: number) {
    return this.all.filter((p) => p.inMatch && p.team === team).reduce((s, p) => s + p.kills, 0);
  }

  private checkEnd() {
    if (!this.match || this.ended || this.match.mode === 'coop' || this.match.mode === 'hidden') return;
    const def = MODES[this.match.mode];
    const timeUp = def.timeLimit > 0 && this.timeLeft() <= 0;
    let winner: string | null = null;
    if (def.teams) {
      const a = this.teamScore(0), b = this.teamScore(1);
      if (a >= def.scoreLimit) winner = TEAM_NAMES[0];
      else if (b >= def.scoreLimit) winner = TEAM_NAMES[1];
      else if (timeUp) winner = a === b ? 'DRAW' : TEAM_NAMES[a > b ? 0 : 1];
    } else {
      const best = [...this.inMatchPlayers].sort((a, b) => b.kills - a.kills)[0];
      if (best && best.kills >= def.scoreLimit) winner = best.name;
      else if (timeUp) winner = best ? best.name : 'NOBODY';
    }
    if (winner) this.finish(winner);
  }

  /** end the match with a mode-specific result (Hidden Troopers) */
  finishCustom(title: string, lines: string[], won: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.endInfo = { title, lines };
    if (won) audio.victory();
    else audio.defeat();
    this.game.matchEnded();
    this.onEnd();
    setTimeout(() => this.backToLobby(), 9000);
  }

  private finish(winner: string, coopVictory?: boolean) {
    if (this.ended) return;
    this.ended = true;
    const m = this.match!;
    const def = MODES[m.mode];
    const rows = [...this.inMatchPlayers].sort((a, b) => b.kills - a.kills);
    const lines = rows.map((p) => `${p.name}${p === this.self ? ' (you)' : ''} — ${p.kills} KO · ${p.deaths} down${def.teams ? ' · ' + TEAM_NAMES[p.team] : ''}`);
    let title: string;
    if (m.mode === 'coop') title = coopVictory ? 'BEDROOM SAVED!' : 'THE TOYS WON…';
    else if (winner === 'DRAW') title = 'DRAW!';
    else if (def.teams) title = `${winner} WINS!`;
    else title = winner === this.self.name ? 'YOU WIN!' : `${winner} WINS!`;
    this.endInfo = { title, lines };
    if (title.includes('YOU WIN') || coopVictory || (def.teams && winner === TEAM_NAMES[this.self.team])) audio.victory();
    else audio.defeat();
    this.game.matchEnded();
    this.onEnd();
    setTimeout(() => this.backToLobby(), 9000);
  }

  backToLobby() {
    if (!this.self.inMatch) return;
    this.self.inMatch = false;
    this.match = null;
    this.ended = false;
    for (const p of this.peers.values()) p.inMatch = false;
    for (const av of this.avatars.values()) av.dispose(this.game.scene);
    this.avatars.clear();
    this.sendInfo();
    this.game.stopMatch();
    this.onChange();
  }

  // ------------------------------------------------------------------ messages

  private bind() {
    const t = this.t;
    t.on('info', (d: { name: string; joined: number; inMatch: boolean; mode: ModeId; size: number; ts: number }, from) => {
      let p = this.peers.get(from);
      const isNew = !p;
      if (!p) {
        p = { id: from, name: d.name, joined: d.joined, team: 0, kills: 0, deaths: 0, level: 0, inMatch: false };
        this.peers.set(from, p);
      }
      p.name = d.name;
      p.joined = d.joined;
      p.inMatch = d.inMatch;
      if (d.ts > this.modeTs) {
        this.mode = d.mode;
        this.teamSize = d.size;
        this.modeTs = d.ts;
      }
      const av = this.avatars.get(from);
      if (av) av.setName(p.name, this.colorOf(p));
      if (isNew) {
        this.game.hud.toast(`${p.name} joined the room`);
        audio.pickup();
        this.game.onPeerJoinedWhileSolo?.(p.name);
      }
      this.onChange();
    });
    t.on('mode', (d: { mode: ModeId; size: number; ts: number }) => {
      if (d.ts <= this.modeTs) return;
      this.mode = d.mode;
      this.teamSize = d.size;
      this.modeTs = d.ts;
      this.onChange();
    });
    t.on('start', (w: MatchWire) => this.beginMatch(w));
    t.on('want', (_d, from) => {
      if (this.match && this.self.inMatch && !this.ended) this.t.send('start', this.matchWire(), from);
    });
    t.on('st', (s: PlayerState, from) => {
      if (!this.self.inMatch) return;
      const p = this.peers.get(from);
      if (!p || !p.inMatch) return;
      let av = this.avatars.get(from);
      if (!av) {
        av = new RemoteAvatar(this.game.mats, from, p.name, this.colorOf(p), this.game.scene);
        av.sendDamage = (amount, fromPos, knock) => this.sendHit(from, amount, 99, fromPos, knock);
        this.avatars.set(from, av);
      }
      av.concealed = this.match?.mode === 'hidden';
      av.applyState(s, performance.now());
    });
    t.on('shot', (d: { w: number; e: number[] }, from) => {
      const av = this.avatars.get(from);
      if (!av) return;
      const m = av.muzzle;
      const def = WEAPONS[d.w] ?? WEAPONS[0];
      for (let i = 0; i + 2 < d.e.length; i += 3) this.game.fx.tracer(m, new THREE.Vector3(d.e[i], d.e[i + 1], d.e[i + 2]), def.tracer, 0.05, 0.08);
      this.game.fx.glow(m, 0xffd080, 0.9, 0.2, 0.06);
      const dist = m.distanceTo(this.game.player.pos);
      audio.enemyShot(0, dist * 0.6);
    });
    t.on('rk', (d: { o: V3; v: V3 }, from) => {
      this.game.proj.spawn('rocket', vec(d.o), vec(d.v), 0, false, from, true);
    });
    t.on('nade', (d: { k: 'frag' | 'flash'; p: V3; v: V3 }, from) => {
      this.game.proj.spawn(d.k, vec(d.p), vec(d.v), 0, false, from, true);
    });
    t.on('flash', (d: { p: V3 }, from) => this.game.flashAt(vec(d.p), from));
    t.on('boom', (d: { p: V3; r: number }) => this.game.explodeVisual(vec(d.p), d.r));
    t.on('hit', (d: { dmg: number; f?: V3; k?: V3; w: number }, from) => {
      if (!this.self.inMatch) return;
      const pl = this.game.player;
      if (!pl.alive) return;
      if (d.k) pl.knock(vec(d.k).normalize(), vec(d.k).length());
      if (d.dmg <= 0) return;
      if (pl.damage(d.dmg, d.f ? vec(d.f) : undefined)) {
        this.lastHitBy = from;
        this.lastHitWeapon = d.w;
      }
    });
    t.on('died', (d: { v: string; k: string; w: number }) => this.onDied(d.v, d.k, d.w));
    t.on('pick', (d: { i: number }) => this.game.pickups.takeSpot(d.i));
    t.on('end', (d: { mid: string; win: string; victory?: boolean }) => {
      if (this.match?.id === d.mid) this.finish(d.win, d.victory);
    });
    // ---- co-op
    t.on('es', (d: { w: number; s: string; r: number; k: number; tot: number; l: number[][] }, from) => {
      if (this.isLeader || from !== this.leaderId) return;
      this.coopInfo = { wave: d.w, state: d.s, remaining: d.r, killed: d.k, total: d.tot, boss: -1 };
      const now = performance.now();
      for (const e of d.l) {
        const [id, ti, x, y, z, yaw, hp] = e;
        let en = this.game.enemies.find((q) => q.netId === id);
        if (!en) en = this.game.spawnPuppet(ENEMY_TYPES[ti], id, new THREE.Vector3(x, y, z));
        if (!en) continue;
        en.netPos.set(x, y, z);
        en.netYaw = yaw;
        en.hp = hp;
        if (ti === 4) this.coopInfo.boss = hp / en.maxHp;
        this.puppetSeen.set(id, now);
      }
      // drop puppets that the leader no longer simulates
      for (const en of this.game.enemies) {
        if (!en.puppet) continue;
        const seen = this.puppetSeen.get(en.netId) ?? 0;
        if (now - seen > 1500) this.game.removeEnemySilently(en);
      }
    });
    t.on('eh', (d: { id: number; dmg: number; d: V3 }, from) => {
      if (!this.isLeader) return;
      const en = this.game.enemies.find((q) => q.netId === d.id && !q.dead);
      if (en) {
        en.lastHitBy = from;
        this.game.damageEnemy(en, d.dmg, vec(d.d));
      }
    });
    t.on('ed', (d: { id: number; k: string; d: V3 }) => {
      const en = this.game.enemies.find((q) => q.netId === d.id && !q.dead);
      if (en && en.puppet) this.game.killPuppet(en, vec(d.d));
      this.creditEnemyKill(d.k);
    });
    t.on('ep', (d: { k: 'dart' | 'bolt' | 'bomb'; p: V3; v: V3 }) => {
      this.game.proj.spawn(d.k, vec(d.p), vec(d.v), 0, true, 'ai', true);
    });
    t.on('shock', (d: { p: V3 }) => this.game.spawnShockwavePublic(vec(d.p)));
    t.on('banner', (d: { a: string; b: string }) => this.game.hud.banner(d.a, d.b, 2.8));
    // ---- Hidden Troopers (the mode owns its own protocol)
    for (const m of HIDDEN_MSGS) t.on(m, (d, from) => this.hidden?.onNet(m, d, from));
  }

  // ------------------------------------------------------------------ outgoing (called by Game)

  sendState() {
    const pl = this.game.player;
    const s: PlayerState = {
      p: arr(pl.pos), v: arr(pl.vel), y: +pl.yaw.toFixed(3), pi: +pl.pitch.toFixed(3),
      w: this.game.weapons.current, a: pl.alive ? 1 : 0, c: pl.crouching ? 1 : 0, h: Math.round(pl.health), r: this.game.weapons.state === 'reload' ? 1 : 0,
    };
    if (this.hidden) Object.assign(s, this.hidden.stateExtra());
    this.t.send('st', s);
  }

  sendShot(w: number, ends: THREE.Vector3[]) {
    const e: number[] = [];
    for (const v of ends.slice(0, 3)) e.push(+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2));
    this.t.send('shot', { w, e });
  }

  sendRocket(o: THREE.Vector3, v: THREE.Vector3) {
    this.t.send('rk', { o: arr(o), v: arr(v) });
  }

  sendNade(k: 'frag' | 'flash', p: THREE.Vector3, v: THREE.Vector3) {
    this.t.send('nade', { k, p: arr(p), v: arr(v) });
  }

  sendFlash(p: THREE.Vector3) {
    this.t.send('flash', { p: arr(p) });
  }

  sendBoom(p: THREE.Vector3, r: number) {
    this.t.send('boom', { p: arr(p), r });
  }

  sendHit(target: string, dmg: number, w: number, from?: THREE.Vector3, knock?: THREE.Vector3) {
    this.t.send('hit', { dmg: Math.round(dmg), w, f: from ? arr(from) : undefined, k: knock ? arr(knock) : undefined }, target);
  }

  sendPick(i: number) {
    this.t.send('pick', { i });
  }

  /** called by Game when the local player is knocked out */
  localDied() {
    const killer = this.lastHitBy || this.self.id;
    const w = this.lastHitWeapon;
    this.t.send('died', { v: this.self.id, k: killer, w });
    this.onDied(this.self.id, killer, w);
    this.lastHitBy = '';
    this.respawnT = this.match?.mode === 'coop' ? 7 : 3;
  }

  private onDied(victim: string, killer: string, w: number) {
    if (!this.match) return;
    const vp = victim === this.self.id ? this.self : this.peers.get(victim);
    const kp = killer === this.self.id ? this.self : this.peers.get(killer);
    if (vp) vp.deaths++;
    const weaponName = w === 99 ? 'TOY' : w === 98 ? 'BASH' : WEAPONS[w]?.name ?? 'BLAST';
    if (kp && kp !== vp) {
      const friendly = MODES[this.match.mode].teams && kp.team === vp?.team;
      if (!friendly && this.match.mode !== 'coop') kp.kills++;
      if (this.match.mode === 'gungame' && kp === this.self && !friendly) {
        this.self.level++;
        if (this.self.level < GUN_LADDER.length) {
          this.game.weapons.setLoadout(this.loadout());
          this.game.hud.toast(`NEXT GUN: ${WEAPONS[GUN_LADDER[this.self.level]].name}  (${this.self.level}/${GUN_LADDER.length})`, 2.2);
        }
      }
      if (kp === this.self) {
        this.game.hud.hitmarker(true);
        this.game.hud.banner('KNOCKOUT!', `you got ${vp?.name ?? 'someone'}`, 1.2);
      }
    }
    this.feed.push({ killer: kp?.name ?? '?', victim: vp?.name ?? '?', weapon: kp === vp ? 'OOPS' : weaponName, t: performance.now() });
    if (this.feed.length > 5) this.feed.shift();
    this.game.hud.killFeed(this.feed);
    this.checkEnd();
    this.onChange();
  }

  private creditEnemyKill(killer: string) {
    const kp = killer === this.self.id ? this.self : this.peers.get(killer);
    if (kp) kp.kills++;
  }

  // ------------------------------------------------------------------ co-op (leader side)

  coopKilled(e: Enemy, dir: THREE.Vector3 | null) {
    const k = e.lastHitBy || this.self.id;
    this.t.send('ed', { id: e.netId, k, d: dir ? arr(dir) : [0, 1, 0] });
    this.creditEnemyKill(k);
  }

  sendEnemyHit(e: Enemy, dmg: number, dir: THREE.Vector3) {
    this.t.send('eh', { id: e.netId, dmg: Math.round(dmg), d: arr(dir) }, this.leaderId);
  }

  sendEnemyProjectile(k: string, p: THREE.Vector3, v: THREE.Vector3) {
    this.t.send('ep', { k, p: arr(p), v: arr(v) });
  }

  sendShock(p: THREE.Vector3) {
    this.t.send('shock', { p: arr(p) });
  }

  sendBanner(a: string, b: string) {
    this.t.send('banner', { a, b });
  }

  coopEnd(victory: boolean) {
    if (!this.match) return;
    const win = victory ? 'TEAM' : 'TOYS';
    this.t.send('end', { mid: this.match.id, win, victory });
    this.finish(win, victory);
  }

  // ------------------------------------------------------------------ per-frame

  update(dt: number) {
    if (!this.self.inMatch) return;
    const now = performance.now();
    this.stateT -= dt;
    if (this.stateT <= 0) {
      this.stateT = 1 / 15;
      this.sendState();
    }
    for (const av of this.avatars.values()) av.update(dt, now);
    this.bots?.update(dt);
    if (this.match?.mode === 'coop' && this.isLeader) {
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 0.1;
        const g = this.game;
        const l = g.enemies.filter((e) => !e.dead).map((e) => [e.netId, ENEMY_TYPES.indexOf(e.type), +e.pos.x.toFixed(2), +e.pos.y.toFixed(2), +e.pos.z.toFixed(2), +e.yaw.toFixed(2), Math.round(e.hp)]);
        const w = g.waves;
        this.t.send('es', { w: w.wave, s: w.state, r: w.remaining, k: w.killed, tot: w.total + w.extraSpawned, l });
      }
      // everyone down?
      const anyAlive = this.game.player.alive || [...this.avatars.values()].some((a) => a.alive);
      if (!anyAlive && !this.ended) this.coopEnd(false);
    }
    if (this.match?.mode !== 'coop') this.checkEnd();
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.game.respawnLocal();
    }
  }
}
