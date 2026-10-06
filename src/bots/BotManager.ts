import * as THREE from 'three';
import { LoopbackTransport } from '../net/Net';
import type { Session } from '../net/Session';
import type { Game } from '../game/Game';
import { MODES, ModeId } from '../game/Modes';
import { WEAPONS, SNIPER } from '../game/Weapons';
import { audio } from '../game/Audio';
import { Bot, BotSkill, BotTarget, BotWorld, SKILLS } from './Bot';

const NAMES = ['Sgt Rivet', 'Cpl Gizmo', 'Pvt Pebble', 'Cpt Tinker', 'Maj Bonbon', 'Sgt Widget', 'Pvt Noodle', 'Cpt Buttons', 'Cpl Jellybean', 'Sgt Pogo'];
type V3 = [number, number, number];
const arr = (v: THREE.Vector3): V3 => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];

export type Difficulty = keyof typeof SKILLS;

/**
 * Runs computer opponents as virtual peers of an offline Session. They speak the
 * same protocol as remote players over a loopback transport, so the session's
 * scoring, kill feed, teams, respawns and match end all work unchanged.
 */
export class BotManager {
  bots: Bot[] = [];
  private t: LoopbackTransport;
  private stateT = 0;
  private mode: ModeId = 'ffa';
  private skill: BotSkill;
  private pois: THREE.Vector3[];

  constructor(private game: Game, private session: Session, count: number, difficulty: Difficulty) {
    this.t = session.t as LoopbackTransport;
    this.skill = SKILLS[difficulty];
    this.pois = [...game.room.pickupSpots.map((p) => p.pos.clone()), ...game.room.playerSpawns.map((p) => p.clone())];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const b = new Bot('bot' + i, NAMES[i % NAMES.length], this.skill, game.nav.nodeH.length);
      this.bots.push(b);
      this.t.join(b.id);
      // joined after the human, so the human is the room leader
      this.t.deliver('info', { name: b.name, joined: now + 1000 + i, inMatch: false, mode: session.mode, size: session.teamSize, ts: 0 }, b.id);
    }
    this.t.outbound = (type, data, to) => this.onMessage(type, data, to);
  }

  private bot(id: string) {
    return this.bots.find((b) => b.id === id);
  }

  private onMessage(type: string, data: unknown, to?: string) {
    switch (type) {
      case 'start': {
        const w = data as { mode: ModeId; teams: Record<string, number> };
        this.mode = w.mode;
        for (const b of this.bots) {
          b.team = w.teams[b.id] ?? 0;
          this.t.deliver('info', { name: b.name, joined: Date.now() + 1000, inMatch: true, mode: w.mode, size: this.session.teamSize, ts: 0 }, b.id);
          this.respawn(b);
        }
        break;
      }
      case 'hit': {
        // the human (or their explosion) hit a bot
        const b = to ? this.bot(to) : null;
        const d = data as { dmg: number; w: number; f?: V3 };
        if (b && d.dmg > 0) this.hurt(b, d.dmg, this.session.self.id, d.w, d.f ? new THREE.Vector3(...d.f) : undefined);
        break;
      }
      case 'shot': {
        // the human fired: bots that are close enough hear it
        for (const b of this.bots) b.hear(this.game.player.pos);
        break;
      }
    }
  }

  private hurt(b: Bot, dmg: number, from: string, w: number, fromPos?: THREE.Vector3) {
    if (b.damage(dmg, from, w, fromPos)) {
      this.t.deliver('died', { v: b.id, k: from, w }, b.id);
      b.respawnT = 3;
    }
  }

  private respawn(b: Bot) {
    const pts = this.game.room.playerSpawns;
    const foes = this.enemiesOf(b).filter((t) => t.alive);
    let best = pts[0], bd = -1;
    for (const p of pts) {
      const d = foes.length ? Math.min(...foes.map((f) => f.pos.distanceTo(p))) : Math.random() * 50;
      const s = d + Math.random() * 10;
      if (s > bd) { bd = s; best = p; }
    }
    b.spawn(best.clone(), Math.random() * Math.PI * 2);
  }

  /** enemies of a bot: the human and the other bots (minus team-mates in team modes) */
  private enemiesOf(b: Bot): BotTarget[] {
    const teams = MODES[this.mode].teams;
    const pl = this.game.player;
    const list: BotTarget[] = [];
    const me = this.session.self;
    if (!teams || me.team !== b.team) list.push({ id: me.id, pos: pl.pos, vel: pl.vel, height: pl.height, alive: pl.alive && this.game.inMatch, team: me.team });
    for (const o of this.bots) if (o !== b && (!teams || o.team !== b.team)) list.push(o as unknown as BotTarget);
    return list;
  }

  private worldFor(): BotWorld {
    const g = this.game;
    const weapons = MODES[this.mode].loadout.filter((i) => i !== 2); // bots skip the rocket launcher
    return {
      world: g.world,
      nav: g.nav,
      pois: this.pois,
      weapons: weapons.length ? weapons : [SNIPER],
      enemiesOf: (b) => this.enemiesOf(b),
      shoot: (bot, o, d, weapon, pellet) => this.shoot(bot, o, d, weapon, pellet),
    };
  }

  /** hitscan for a bot shot: the world, the human, the other bots */
  private shoot(bot: Bot, o: THREE.Vector3, d: THREE.Vector3, weapon: number, pellet: number) {
    const def = WEAPONS[weapon];
    const wh = this.game.world.raycast(o, d, def.range);
    let maxD = wh ? wh.dist : def.range;
    let hit: string | null = null, mult = 1;
    const test = (id: string, pos: THREE.Vector3, h: number) => {
      const s = h / 1.8;
      for (const [y, r, m] of [[1.1, 0.42, 1], [0.45, 0.3, 0.8], [1.6, 0.26, 2]] as const) {
        const cx = pos.x, cy = pos.y + y * s, cz = pos.z;
        const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
        const b = ox * d.x + oy * d.y + oz * d.z;
        const c = ox * ox + oy * oy + oz * oz - r * r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t > 0 && t < maxD) { maxD = t; hit = id; mult = m; }
      }
    };
    for (const t of this.enemiesOf(bot)) if (t.alive) test(t.id, t.pos, t.height);
    const end = o.clone().addScaledVector(d, maxD);
    if (hit) {
      const dmg = def.damage * mult;
      if (hit === this.session.self.id) {
        if (pellet === 0 || def.pellets > 1) this.t.deliver('hit', { dmg: Math.round(dmg), w: weapon, f: arr(o) }, bot.id);
      } else {
        const victim = this.bot(hit);
        if (victim) this.hurt(victim, dmg, bot.id, weapon, o);
      }
    } else if (wh && pellet < 2) this.game.fx.impact(wh.point, wh.normal, 0xfff0c0);
    return { hit, end, mult };
  }

  update(dt: number) {
    if (!this.session.self.inMatch || this.session.ended) return;
    const w = this.worldFor();
    for (const b of this.bots) {
      if (!b.alive) {
        b.respawnT -= dt;
        if (b.respawnT <= 0) this.respawn(b);
        continue;
      }
      b.update(dt, w);
      if (b.firedWeapon >= 0) {
        this.t.deliver('shot', { w: b.firedWeapon, e: b.shots.flatMap((p) => arr(p)) }, b.id);
        for (const o of this.bots) if (o !== b) o.hear(b.pos);
        void audio;
      }
    }
    this.stateT -= dt;
    if (this.stateT <= 0) {
      this.stateT = 1 / 15;
      for (const b of this.bots)
        this.t.deliver('st', { p: arr(b.pos), v: arr(b.vel), y: +b.yaw.toFixed(3), pi: +b.pitch.toFixed(3), w: b.weapon, a: b.alive ? 1 : 0, c: 0, h: Math.round(b.health), r: b.reloadT > 0 ? 1 : 0 }, b.id);
    }
  }
}
