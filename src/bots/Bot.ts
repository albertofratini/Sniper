import * as THREE from 'three';
import { CollisionWorld, NavGrid } from '../game/Collision';
import { Ladder, LadderState, climbStep, ladderTick, mountLadder, tryGrab } from '../game/Ladders';
import { WEAPONS, SNIPER } from '../game/Weapons';

/** How good a bot is. All the "human" limits live here. */
export interface BotSkill {
  /** seconds before reacting to a newly seen enemy */
  reaction: number;
  /** aim error (radians) right after acquiring a target, and what it settles to */
  aimErrStart: number;
  aimErrSettled: number;
  /** seconds for the aim error to settle */
  settle: number;
  /** max turn speed (rad/s) */
  turn: number;
  /** half field of view (radians) for spotting enemies */
  fov: number;
  /** how far they notice gunfire (world units) */
  hearing: number;
  /** 0..1: how readily they push in vs hold range / retreat */
  aggression: number;
  /** 0..1: strafing / jumping / cover use */
  movement: number;
}

export const SKILLS: Record<'easy' | 'normal' | 'hard', BotSkill> = {
  easy: { reaction: 0.55, aimErrStart: 0.14, aimErrSettled: 0.05, settle: 1.0, turn: 3.6, fov: 0.95, hearing: 30, aggression: 0.35, movement: 0.35 },
  normal: { reaction: 0.34, aimErrStart: 0.1, aimErrSettled: 0.03, settle: 0.7, turn: 5.5, fov: 1.1, hearing: 45, aggression: 0.55, movement: 0.65 },
  hard: { reaction: 0.2, aimErrStart: 0.07, aimErrSettled: 0.018, settle: 0.45, turn: 8, fov: 1.25, hearing: 60, aggression: 0.75, movement: 0.9 },
};

/** Something a bot can see and shoot: the human player or another bot. */
export interface BotTarget {
  id: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  height: number;
  alive: boolean;
  team: number;
  /** the real player: bots give them a fair share of attention instead of only fighting each other */
  human?: boolean;
}

export interface BotWorld {
  world: CollisionWorld;
  nav: NavGrid;
  /** roam goals all over the map, every level */
  pois: THREE.Vector3[];
  /** shooting: returns the id hit (or null) and the end point */
  shoot(bot: Bot, origin: THREE.Vector3, dir: THREE.Vector3, weapon: number, pellet: number): { hit: string | null; end: THREE.Vector3; mult: number };
  enemiesOf(bot: Bot): BotTarget[];
  weapons: number[];
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

/**
 * A computer opponent that plays like a person: same body, speed, jump, step
 * height and ladders as the player, same weapons and damage. It navigates the
 * whole map with a flow field (ramps, stairs, ladders), hunts or roams, aims
 * with a human reaction time and settling error, strafes, and backs off to cover
 * when hurt.
 */
export class Bot {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius = 0.42;
  height = 1.8;
  climb = new LadderState();
  yaw = 0;
  pitch = 0;
  grounded = true;
  alive = false;
  health = 100;
  team = 0;
  weapon = 0;
  ammo = WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve === 0 ? w.mag * 2 : w.reserve }));
  reloadT = 0;
  cooldown = 0;
  sinceHurt = 99;
  respawnT = 0;
  lastHitBy = '';
  lastHitWeapon = 0;
  /** shot this frame (for tracers) */
  shots: THREE.Vector3[] = [];
  firedWeapon = -1;

  // brain
  private field: Int32Array;
  private fieldT = 0;
  /** how long to keep heading for the current roam goal */
  private roamT = 0;
  private goal = new THREE.Vector3();
  private goalKind: 'roam' | 'hunt' | 'cover' = 'roam';
  private target: BotTarget | null = null;
  private seenT = 0;
  private lostT = 0;
  private lastSeen = new THREE.Vector3();
  private errYaw = 0;
  private errPitch = 0;
  private trackT = 0;
  private thinkT = Math.random() * 0.2;
  private strafeDir = 1;
  private strafeT = 0;
  private stuckT = 0;
  private stuckPos = new THREE.Vector3();
  private stuckCount = 0;
  private jumpWant = false;
  private wish = new THREE.Vector3();
  private noticedFrom: THREE.Vector3 | null = null;
  /** +1 climbing up, -1 going down (fixed when getting on) */
  private ladderDir = 1;

  constructor(readonly id: string, public name: string, private skill: BotSkill, nodes: number) {
    this.field = new Int32Array(nodes).fill(-1);
  }

  get eye() {
    return v1.set(this.pos.x, this.pos.y + this.height - 0.18, this.pos.z);
  }

  spawn(p: THREE.Vector3, yaw: number) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.alive = true;
    this.health = 100;
    this.sinceHurt = 99;
    this.target = null;
    this.reloadT = 0;
    this.climb.ladder = null;
    this.climb.exitT = -1;
    this.ammo = WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve === 0 ? w.mag * 2 : w.reserve }));
    this.goalKind = 'roam';
    this.fieldT = 0;
  }

  /** returns true if this killed the bot */
  damage(amount: number, from: string, weapon: number, fromPos?: THREE.Vector3) {
    if (!this.alive) return false;
    this.health -= amount;
    this.sinceHurt = 0;
    this.lastHitBy = from;
    this.lastHitWeapon = weapon;
    if (fromPos) this.noticedFrom = fromPos.clone();
    if (this.health <= 0) {
      this.alive = false;
      this.health = 0;
      this.climb.ladder = null;
      return true;
    }
    return false;
  }

  /** gunfire heard at p */
  hear(p: THREE.Vector3) {
    if (!this.alive || this.target) return;
    if (p.distanceTo(this.pos) < this.skill.hearing) this.noticedFrom = p.clone();
  }

  update(dt: number, w: BotWorld) {
    this.shots.length = 0;
    this.firedWeapon = -1;
    if (!this.alive) return;
    ladderTick(this, dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceHurt += dt;
    if (this.sinceHurt > 4 && this.health < 100) this.health = Math.min(100, this.health + 20 * dt);
    // reloading
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const def = WEAPONS[this.weapon], am = this.ammo[this.weapon];
        const take = Math.min(def.mag - am.mag, am.reserve);
        am.mag += take;
        if (am.reserve !== Infinity) am.reserve -= take;
      }
    }

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.15;
      this.think(w);
    }
    this.combat(dt, w);
    this.move(dt, w);
  }

  // ------------------------------------------------------------------ decisions (a few times a second)

  private think(w: BotWorld) {
    const sk = this.skill;
    // look for enemies: in view cone, in line of sight
    const eye = this.eye.clone();
    let best: BotTarget | null = null, bd = Infinity;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    // targets are compared by id: the human's entry is rebuilt every frame
    const cur = this.target?.id;
    let curSeen: BotTarget | null = null;
    for (const t of w.enemiesOf(this)) {
      if (!t.alive) continue;
      v2.set(t.pos.x, t.pos.y + t.height * 0.75, t.pos.z);
      const d = v2.distanceTo(eye);
      if (d > 140) continue;
      const dx = (v2.x - eye.x) / d, dz = (v2.z - eye.z) / d;
      const inCone = dx * fx + dz * fz > Math.cos(sk.fov) || d < 4 || t.id === cur;
      if (!inCone) continue;
      if (!w.world.lineOfSight(eye, v2)) continue;
      if (t.id === cur) curSeen = t;
      // pick like a person would: whoever is closest, whoever is shooting at me, and never forget the human
      const score = d - (t.human ? 14 : 0) - (t.id === this.lastHitBy && this.sinceHurt < 3 ? 12 : 0);
      if (score < bd) { bd = score; best = t; }
    }
    // stay on one fight at a time: keep the current target while it's alive and only briefly out of sight
    if (this.target && this.target.alive) {
      if (curSeen) best = curSeen;
      else if (this.lostT < 1.2) best = null; // just ducked out of view: keep chasing them, don't switch
    }
    if (best) {
      if (best.id !== cur) {
        // new contact: reaction delay and a fresh, larger aim error
        this.target = best;
        this.seenT = -sk.reaction * (0.75 + Math.random() * 0.5);
        this.trackT = 0;
        const e = sk.aimErrStart;
        this.errYaw = (Math.random() - 0.5) * 2 * e;
        this.errPitch = (Math.random() - 0.5) * e;
      }
      this.target = best; // same target, fresh entry
      this.lostT = 0;
      this.lastSeen.copy(best.pos);
    } else if (this.target) {
      this.lostT += 0.15;
      if (this.lostT > 3 || !this.target.alive) this.target = null;
    }
    // where to go
    const lowHealth = this.health < 35 && this.target !== null;
    if (lowHealth && Math.random() < 0.6 * sk.movement + 0.2) this.pickCover(w);
    else if (this.target) this.setGoal(this.lastSeen, 'hunt', w);
    else if (this.noticedFrom) {
      this.setGoal(this.noticedFrom, 'hunt', w);
      // turn toward the noise
      this.yaw = Math.atan2(-(this.noticedFrom.x - this.pos.x), -(this.noticedFrom.z - this.pos.z));
      this.noticedFrom = null;
    } else if (this.goalKind !== 'roam' || this.pos.distanceTo(this.goal) < 3 || this.roamT <= 0) {
      // roam: a random spot anywhere on the map (high and low), or toward the nearest enemy
      this.roamT = 30;
      const enemies = w.enemiesOf(this).filter((t) => t.alive);
      const human = enemies.find((t) => t.human);
      // like players drawn to the fight, idle bots often go looking for you (re-checked every few seconds)
      if (human && Math.random() < 0.3 + 0.3 * sk.aggression) {
        this.setGoal(human.pos, 'roam', w);
        this.roamT = 6 + Math.random() * 4;
      }
      else if (enemies.length && Math.random() < 0.2 + 0.3 * sk.aggression) {
        const e = enemies.sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos))[0];
        this.setGoal(e.pos, 'roam', w);
      } else this.setGoal(w.pois[Math.floor(Math.random() * w.pois.length)], 'roam', w);
    }
    this.roamT -= 0.15;
    // refresh the path
    this.fieldT -= 0.15;
    if (this.fieldT <= 0) {
      w.nav.bfs([{ x: this.goal.x, z: this.goal.z, y: this.goal.y }], this.field, true);
      this.fieldT = this.goalKind === 'hunt' ? 0.6 : 2.5;
    }
    // weapon for the range
    if (this.reloadT <= 0) {
      const d = this.target ? this.target.pos.distanceTo(this.pos) : 20;
      const have = (i: number) => w.weapons.includes(i) && this.ammo[i].mag + this.ammo[i].reserve > 0;
      let want = have(0) ? 0 : w.weapons[0];
      if (d < 9 && have(1)) want = 1;
      else if (d > 38 && have(SNIPER)) want = SNIPER;
      else if (!have(0) && have(SNIPER)) want = SNIPER;
      if (want !== this.weapon) {
        this.weapon = want;
        this.cooldown = Math.max(this.cooldown, 0.4);
      }
    }
  }

  private setGoal(p: THREE.Vector3, kind: 'roam' | 'hunt' | 'cover', w: BotWorld) {
    const changed = kind !== this.goalKind || p.distanceTo(this.goal) > 2;
    this.goal.copy(p);
    this.goalKind = kind;
    if (changed && this.fieldT > 0.3) this.fieldT = 0;
    void w;
  }

  /** a nearby spot the current target can't see */
  private pickCover(w: BotWorld) {
    const t = this.target!;
    const from = v2.set(t.pos.x, t.pos.y + t.height * 0.8, t.pos.z).clone();
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 8;
      const p = new THREE.Vector3(this.pos.x + Math.cos(a) * r, this.pos.y + 1, this.pos.z + Math.sin(a) * r);
      p.y = w.world.groundAt(p.x, p.z, p.y + 2);
      if (Math.abs(p.y - this.pos.y) > 4) continue;
      if (w.nav.nodeAt(p.x, p.y + 0.2, p.z, 0) < 0) continue;
      if (w.world.lineOfSight(from, p.clone().setY(p.y + 1.5))) continue;
      this.setGoal(p, 'cover', w);
      return;
    }
    this.setGoal(this.lastSeen, 'hunt', w);
  }

  // ------------------------------------------------------------------ aiming and shooting (every frame)

  private combat(dt: number, w: BotWorld) {
    const t = this.target;
    if (!t || !t.alive) {
      // relax the gaze along the walking direction
      if (this.wish.lengthSq() > 0.01) this.turnTo(Math.atan2(-this.wish.x, -this.wish.z), 0, dt * 0.6);
      return;
    }
    this.seenT += dt;
    if (this.seenT < 0) return; // still reacting
    this.trackT += dt;
    const sk = this.skill;
    // error settles while you track the target, plus a little hand wobble
    const k = Math.min(1, this.trackT / sk.settle);
    const e = sk.aimErrStart + (sk.aimErrSettled - sk.aimErrStart) * k;
    const scale = e / Math.max(1e-4, Math.hypot(this.errYaw, this.errPitch * 2));
    if (scale < 1) { this.errYaw *= scale; this.errPitch *= scale; }
    this.errYaw += (Math.random() - 0.5) * sk.aimErrSettled * dt * 6;
    this.errPitch += (Math.random() - 0.5) * sk.aimErrSettled * dt * 3;
    // lead moving targets a bit
    const eye = this.eye.clone();
    const aimAt = v2.set(t.pos.x, t.pos.y + t.height * (Math.random() < 0.2 ? 0.88 : 0.6), t.pos.z).addScaledVector(t.vel, 0.08);
    const d = aimAt.clone().sub(eye);
    const dist = d.length();
    const wantYaw = Math.atan2(-d.x, -d.z) + this.errYaw;
    const wantPitch = Math.asin(Math.max(-1, Math.min(1, d.y / dist))) + this.errPitch;
    this.turnTo(wantYaw, wantPitch, dt);
    // fire when the crosshair is roughly on them
    const off = Math.abs(angDiff(this.yaw, wantYaw)) + Math.abs(this.pitch - wantPitch);
    const def = WEAPONS[this.weapon];
    const am = this.ammo[this.weapon];
    if (this.reloadT > 0) return;
    if (am.mag <= 0) {
      if (am.reserve > 0) this.reloadT = def.reload;
      return;
    }
    const tol = 0.06 + Math.atan2(0.5, dist);
    if (off < tol && this.cooldown <= 0 && dist < def.range * 0.8 && this.lostT === 0) {
      // semi-auto weapons and the sniper take a moment between shots
      this.cooldown = def.rate * (def.sniper ? 1.25 : def.auto ? 1.05 : 1.15) + (def.pellets > 1 ? 0.1 : 0);
      am.mag--;
      this.firedWeapon = this.weapon;
      const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const up = right.clone().cross(fwd).normalize();
      const spread = def.sniper ? 0 : def.spread * (1 + Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 14) * (def.pellets > 1 ? 0.2 : 1.2));
      for (let i = 0; i < def.pellets; i++) {
        const a = Math.random() * Math.PI * 2, r = (def.pellets > 1 ? Math.sqrt(Math.random()) : Math.random()) * spread;
        const dir = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
        const res = w.shoot(this, eye, dir, this.weapon, i);
        if (i < 3) this.shots.push(res.end);
      }
      if (am.mag <= 0 && am.reserve > 0) this.reloadT = def.reload;
    }
  }

  private turnTo(yaw: number, pitch: number, dt: number) {
    const max = this.skill.turn * dt;
    const dy = angDiff(this.yaw, yaw);
    this.yaw += Math.max(-max, Math.min(max, dy));
    this.pitch += Math.max(-max, Math.min(max, pitch - this.pitch));
  }

  // ------------------------------------------------------------------ movement (every frame)

  private move(dt: number, w: BotWorld) {
    const sk = this.skill;
    // on a ladder: climb toward the goal side, then carry on
    if (this.climb.active) {
      climbStep(w.world, this, dt, this.ladderDir, 0, false);
      this.grounded = !this.climb.active;
      return;
    }
    const dir = v2.set(0, 0, 0);
    const res = w.nav.steerIn(this.field, this.pos.x, this.pos.z, this.pos.y, dir, true);
    let speed = 9.5;
    if (res && typeof res === 'object') {
      // a ladder is the way: walk to it and get on
      const lad = res as Ladder;
      const atTop = Math.abs(this.pos.y - lad.y1) < 1;
      const spotX = lad.x - lad.nx * (this.radius + 0.2), spotZ = lad.z - lad.nz * (this.radius + 0.2);
      const d = Math.hypot(spotX - this.pos.x, spotZ - this.pos.z);
      if (atTop ? d < 1.6 : d < 1.2) {
        mountLadder(this, lad, atTop);
        this.ladderDir = atTop ? -1 : 1;
        return;
      }
      if (atTop) dir.set(lad.x + lad.nx * 0.2 - this.pos.x, 0, lad.z + lad.nz * 0.2 - this.pos.z).normalize();
      else dir.set(spotX - this.pos.x, 0, spotZ - this.pos.z).normalize();
    } else if (!res) {
      // no path info: head straight for the goal
      dir.set(this.goal.x - this.pos.x, 0, this.goal.z - this.pos.z);
      if (dir.lengthSq() < 1) dir.set(0, 0, 0);
      else dir.normalize();
    }
    // combat footwork: hold a sensible range and strafe
    const t = this.target;
    if (t && t.alive && this.seenT > 0) {
      const def = WEAPONS[this.weapon];
      const dist = t.pos.distanceTo(this.pos);
      const ideal = def.pellets > 1 ? 7 : def.sniper ? 45 : 20 - 8 * sk.aggression;
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = 0.9 + Math.random() * (1.6 - sk.movement * 0.5);
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.jumpWant = Math.random() < 0.08 * sk.movement;
      }
      const to = v1.set(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z).normalize();
      const side = new THREE.Vector3(to.z * this.strafeDir, 0, -to.x * this.strafeDir);
      const push = dist > ideal * 1.3 ? 1 : dist < ideal * 0.7 ? -0.8 : 0;
      if (this.goalKind !== 'cover' && Math.abs(t.pos.y - this.pos.y) < 3) {
        dir.copy(side.multiplyScalar(0.6 + sk.movement * 0.4)).addScaledVector(to, push);
        if (push > 0 && res && typeof res !== 'object') dir.addScaledVector(v2.clone(), 0.5);
        if (dir.lengthSq() > 1e-4) dir.normalize();
        speed = 8;
      }
    }
    this.wish.copy(dir);
    // stuck? hop, then pick something else to do
    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      if (dir.lengthSq() > 0.1 && this.pos.distanceTo(this.stuckPos) < 1.2) {
        this.jumpWant = true;
        if (++this.stuckCount > 2) {
          this.stuckCount = 0;
          this.goalKind = 'roam';
          this.setGoal(w.pois[Math.floor(Math.random() * w.pois.length)], 'roam', w);
          this.roamT = 30;
          this.fieldT = 0;
        }
      } else this.stuckCount = 0;
      this.stuckT = 0;
      this.stuckPos.copy(this.pos);
    }
    // player-identical physics
    const accel = this.grounded ? 80 : 26;
    const tx = dir.x * speed, tz = dir.z * speed;
    const dx = tx - this.vel.x, dz = tz - this.vel.z;
    const dl = Math.hypot(dx, dz), step = accel * dt;
    if (dl > step) { this.vel.x += (dx / dl) * step; this.vel.z += (dz / dl) * step; } else { this.vel.x = tx; this.vel.z = tz; }
    if (this.jumpWant && this.grounded) {
      this.vel.y = 14;
      this.grounded = false;
      this.jumpWant = false;
    }
    this.vel.y = Math.max(-60, this.vel.y - 32 * dt);
    const was = this.grounded;
    this.grounded = w.world.moveCylinder(this.pos, this.vel, dt, this.radius, this.height, 1.0, was ? 1.0 : 0.02);
    // walking into a ladder grabs it, same as the player
    if (dir.lengthSq() > 0.1 && tryGrab(w.world, this, 1, dir.x, dir.z, this.grounded)) this.ladderDir = 1;
  }
}

function angDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
