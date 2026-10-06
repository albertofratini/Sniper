import * as THREE from 'three';
import { LoopbackTransport } from '../../net/Net';
import type { Session } from '../../net/Session';
import type { Game } from '../../game/Game';
import { SKILLS, BotSkill } from '../../bots/Bot';
import type { Difficulty } from '../../bots/BotManager';
import { Walker, WalkerSim, HURRY, WALK, angDiff } from './Walkers';
import { STEAL_TIME } from './Loot';
import { PISTOL_COOLDOWN, rayBody, lowestOf } from './HiddenMode';

const NAMES = ['Sgt Rivet', 'Cpl Gizmo', 'Pvt Pebble', 'Cpt Tinker', 'Maj Bonbon', 'Sgt Widget', 'Pvt Noodle', 'Cpt Buttons'];
type V3 = [number, number, number];
const arr = (v: THREE.Vector3): V3 => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];

/** One computer player in Hidden Troopers: an NPC body with a thief's (and a hunter's) mind. */
class HBot {
  body: Walker;
  out = false;
  /** stealing item id (arm out) */
  stealing = -1;
  stealT = 0;
  /** blending in until this runs out, then go for loot */
  blendT = 4 + Math.random() * 8;
  target = -1;
  /** time left to reach the target toy before trying another */
  targetT = 0;
  thinkT = Math.random() * 0.3;
  pistolT = 0;
  cooldown = 0;
  /** someone we think is a real player, and when we'll act on it */
  hunt: { id: string; t: number; tries: number } | null = null;
  /** how long each soldier we can see has had their arm out */
  watched = new Map<string, number>();
  constructor(readonly id: string, readonly name: string, i: number) {
    this.body = new Walker(1000 + i);
  }
}

/**
 * Offline Hidden Troopers opponents. Like BotManager they are virtual peers on
 * a loopback transport: they send player states and 'h:req' requests, and the
 * human (the room leader) validates everything exactly as it would for people.
 * Bots only use what a player could see: arms reaching out for too long, a
 * pistol being fired. They never peek at who is real.
 */
export class HiddenBots {
  bots: HBot[] = [];
  private t: LoopbackTransport;
  private sim: WalkerSim | null = null;
  private stateT = 0;
  private skill: BotSkill;

  constructor(private game: Game, private session: Session, count: number, difficulty: Difficulty) {
    this.t = session.t as LoopbackTransport;
    this.skill = SKILLS[difficulty];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const b = new HBot('bot' + i, NAMES[i % NAMES.length], i);
      this.bots.push(b);
      this.t.join(b.id);
      this.t.deliver('info', { name: b.name, joined: now + 1000 + i, inMatch: false, mode: session.mode, size: session.teamSize, ts: 0 }, b.id);
    }
    this.t.outbound = (type, data, to) => this.onMessage(type, data, to);
  }

  private get hidden() {
    return this.game.hidden;
  }

  private bot(id?: string) {
    return this.bots.find((b) => b.id === id);
  }

  private onMessage(type: string, data: unknown, to?: string) {
    switch (type) {
      case 'start':
        for (const b of this.bots) this.t.deliver('info', { name: b.name, joined: Date.now() + 1000, inMatch: true, mode: 'hidden', size: 2, ts: 0 }, b.id);
        this.sim = null;
        break;
      case 'h:lock':
        break;
      case 'h:deny': {
        const b = this.bot(to);
        if (b) this.endSteal(b);
        break;
      }
      case 'h:stolen': {
        const d = data as { i: number; id: string };
        for (const b of this.bots) if (b.stealing === d.i || b.target === d.i) this.endSteal(b);
        break;
      }
      case 'h:out': {
        const b = this.bot((data as { id: string }).id);
        if (b) b.out = true;
        break;
      }
      case 'h:fx': {
        // a pistol went off: anyone who saw where it came from knows that soldier is real
        const d = data as { s: string; o: V3 };
        const o = new THREE.Vector3(...d.o);
        for (const b of this.bots) {
          if (b.out || b.id === d.s || b.hunt) continue;
          const eye = b.body.pos.clone().setY(b.body.pos.y + 1.6);
          if (eye.distanceTo(o) < 45 && this.game.world.lineOfSight(eye, o) && Math.random() < 0.4 + this.skill.aggression * 0.5)
            b.hunt = { id: d.s, t: this.skill.reaction * 2.5 + Math.random() * 0.6, tries: 0 };
        }
        break;
      }
    }
  }

  private endSteal(b: HBot) {
    b.stealing = -1;
    b.stealT = 0;
    b.target = -1;
    b.blendT = 5 + Math.random() * 12;
    b.body.pickGoal(this.sim!);
  }

  private ensureSim() {
    if (this.sim) return this.sim;
    const g = this.game;
    const pois = [...g.room.pickupSpots.map((p) => p.pos.clone()), ...g.room.playerSpawns.map((p) => p.clone())];
    this.sim = new WalkerSim(g.world, g.nav, pois, this.hidden!.loot.items.map((i) => i.pos));
    this.sim.spawn(this.bots.length);
    this.bots.forEach((b, i) => {
      b.body.pos.copy(this.sim!.walkers[i].pos);
      b.body.goal = this.sim!.walkers[i].goal;
    });
    this.sim.walkers = this.bots.map((b) => b.body);
    return this.sim;
  }

  update(dt: number) {
    const h = this.hidden;
    if (!h || !this.session.self.inMatch || this.session.ended || h.ended) return;
    const sim = this.ensureSim();
    // flow fields for the bots' goals (one per frame)
    sim.computeQueued();
    for (const b of this.bots) {
      if (b.out) continue;
      b.cooldown = Math.max(0, b.cooldown - dt);
      b.pistolT = Math.max(0, b.pistolT - dt);
      b.thinkT -= dt;
      if (b.thinkT <= 0) {
        b.thinkT = 0.3;
        this.think(b, 0.3);
      }
      if (b.stealing >= 0) {
        // standing still with the arm out for the full 2 s (the leader decides when it's done)
        b.stealT += dt;
        const it = h.loot.items[b.stealing];
        b.body.yaw += angDiff(b.body.yaw, Math.atan2(-(it.pos.x - b.body.pos.x), -(it.pos.z - b.body.pos.z))) * Math.min(1, dt * 8);
        b.body.vel.x *= 0.8;
        b.body.vel.z *= 0.8;
        if (b.stealT > STEAL_TIME + 2) this.endSteal(b);
      } else if (b.hunt && b.hunt.t <= 0.5) {
        // stop and line up the shot
        const tp = this.posOf(b.hunt.id);
        if (tp) b.body.yaw += angDiff(b.body.yaw, Math.atan2(-(tp.x - b.body.pos.x), -(tp.z - b.body.pos.z))) * Math.min(1, dt * this.skill.turn);
      } else {
        b.body.update(dt, sim);
      }
    }
    this.stateT -= dt;
    if (this.stateT <= 0) {
      this.stateT = 1 / 15;
      for (const b of this.bots) {
        const w = b.body;
        this.t.deliver('st', {
          p: arr(w.pos), v: arr(w.vel), y: +w.yaw.toFixed(3), pi: 0, w: 0, a: 1, c: 0, h: 100,
          hs: b.stealing >= 0 ? 1 : 0, hg: b.pistolT > 0 ? 1 : 0, ho: b.out ? 1 : 0,
        }, b.id);
      }
    }
  }

  private posOf(id: string) {
    if (id === this.session.self.id) return this.game.player.pos;
    return this.bot(id)?.body.pos ?? null;
  }

  /** is this player visibly reaching out right now? (what anyone could see) */
  private reaching(id: string) {
    if (id === this.session.self.id) return !!this.hidden!.steal;
    const o = this.bot(id);
    return !!o && o.stealing >= 0;
  }

  private think(b: HBot, step: number) {
    const h = this.hidden!;
    const sk = this.skill;
    const eye = b.body.pos.clone().setY(b.body.pos.y + 1.6);
    const fx = -Math.sin(b.body.yaw), fz = -Math.cos(b.body.yaw);
    // ---- watch the crowd for tells: an arm out for longer than any NPC gesture
    for (const p of h.roster.values()) {
      if (p.out || p.id === b.id) continue;
      const pos = this.posOf(p.id);
      if (!pos) continue;
      const to = pos.clone().setY(pos.y + 1.2).sub(eye);
      const d = to.length();
      const seen = d < 32 && (to.x * fx + to.z * fz) / d > Math.cos(sk.fov) && this.game.world.lineOfSight(eye, pos.clone().setY(pos.y + 1.2));
      const t = seen && this.reaching(p.id) ? (b.watched.get(p.id) ?? 0) + step : 0;
      b.watched.set(p.id, t);
      if (t > 1.2 && !b.hunt && Math.random() < 0.35 + sk.aggression * 0.5) b.hunt = { id: p.id, t: sk.reaction * 2 + Math.random() * 0.5, tries: 0 };
    }
    // ---- act on a suspicion: draw, aim (with a human error), fire
    if (b.hunt) {
      const hn = b.hunt;
      hn.t -= step;
      const tp = this.posOf(hn.id);
      const target = h.roster.get(hn.id);
      if (!tp || !target || target.out || hn.tries >= 2 || tp.distanceTo(b.body.pos) > 50) b.hunt = null;
      else if (hn.t <= 0 && b.cooldown <= 0 && b.stealing < 0) {
        const aim = tp.clone().setY(tp.y + 1.1).sub(eye);
        const dist = aim.length();
        if (this.game.world.lineOfSight(eye, tp.clone().setY(tp.y + 1.1))) {
          aim.normalize();
          // aim error grows with distance; harder bots settle tighter
          const err = sk.aimErrSettled * 1.6 + dist * 0.0015;
          aim.x += (Math.random() - 0.5) * 2 * err;
          aim.y += (Math.random() - 0.5) * err;
          aim.z += (Math.random() - 0.5) * 2 * err;
          aim.normalize();
          const hit = rayBody(eye, aim, tp, 0) >= 0;
          b.pistolT = 0.9;
          b.cooldown = PISTOL_COOLDOWN + 0.4;
          hn.tries++;
          hn.t = 0.8;
          this.t.deliver('h:req', { k: 'shoot', o: arr(eye), d: arr(aim), t: hit ? hn.id : undefined }, b.id);
        } else hn.t = 0.6;
      }
      if (b.hunt) return;
    }
    if (b.stealing >= 0) return;
    // ---- thief: blend in for a while, then go for a toy (sooner when in danger)
    const me = h.roster.get(b.id);
    const danger = !!me && lowestOf([...h.roster.values()])?.id === b.id;
    const urgency = danger && h.elimIn < 50 ? 3 : h.elimIn < 30 ? 2 : 1;
    b.blendT -= step * urgency;
    if (b.target < 0 && b.blendT <= 0) {
      // best value for the walk, among toys still there
      let best = -1, bs = -Infinity;
      for (const it of h.loot.items) {
        if (!it.available) continue;
        const s = it.value * 6 - it.pos.distanceTo(b.body.pos) * (urgency > 1 ? 0.8 : 0.4) + Math.random() * 10;
        if (s > bs) { bs = s; best = it.id; }
      }
      if (best >= 0) {
        b.target = best;
        b.targetT = 35;
        b.body.goal = this.sim!.poiOfLoot(best);
        b.body.mood = 'walk';
        b.body.speed = urgency > 1 ? HURRY : WALK;
      }
    }
    if (b.target >= 0) {
      const it = h.loot.items[b.target];
      b.targetT -= step;
      if (!it.available || h.resolving || b.targetT <= 0) {
        this.endSteal(b);
        return;
      }
      b.body.goal = this.sim!.poiOfLoot(b.target);
      if (b.body.mood !== 'walk') b.body.mood = 'walk';
      const d = Math.hypot(it.pos.x - b.body.pos.x, it.pos.z - b.body.pos.z);
      if (d < 2.2 && Math.abs(it.pos.y - b.body.pos.y) < 2) {
        // careful: don't do it right under someone's nose (unless desperate)
        b.stealing = it.id;
        b.stealT = 0;
        b.body.mood = 'idle';
        b.body.moodT = 99;
        this.t.deliver('h:req', { k: 'steal', i: it.id }, b.id);
      }
    }
  }
}
