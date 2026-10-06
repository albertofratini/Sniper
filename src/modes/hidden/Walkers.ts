import * as THREE from 'three';
import { CollisionWorld, NavGrid } from '../../game/Collision';
import { Ladder, LadderState, climbStep, ladderTick, mountLadder, tryGrab } from '../../game/Ladders';

/**
 * The unarmed NPC crowd of Hidden Troopers.
 *
 * Walkers are simulated only by the room leader, with exactly the player's
 * physics (speed, acceleration, gravity, jump, step height, ladders), so a real
 * player moving at hidden-mode speed is indistinguishable from them. Everybody
 * (leader included) sees them through `Puppet`s fed by 15 Hz snapshots, using
 * the same interpolation as remote players, so NPCs and players also LOOK
 * identical on screen: same update rate, same smoothing.
 */

/** hidden-mode walking speed (the player's 9.5 * 0.6), and the "hurry" speed (= sprint * 0.6) */
export const WALK = 5.7;
export const HURRY = 8.7;
export const NPC_RADIUS = 0.42;
export const NPC_HEIGHT = 1.8;

const v1 = new THREE.Vector3();

/** Interpolated view of a soldier from snapshots (same math as RemoteAvatar). */
export class Puppet {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  target = new THREE.Vector3();
  yaw = 0;
  reach = 0;
  reachWant = 0;
  lastAt = 0;
  apply(x: number, y: number, z: number, vx: number, vy: number, vz: number, yaw: number, reach: number, now: number) {
    this.target.set(x, y, z);
    this.vel.set(vx, vy, vz);
    if (this.lastAt === 0 || this.pos.distanceTo(this.target) > 12) this.pos.copy(this.target);
    this.lastAt = now;
    this.yaw = yaw;
    this.reachWant = reach;
  }
  update(dt: number, now: number) {
    const age = Math.min(0.2, (now - this.lastAt) / 1000);
    v1.copy(this.target).addScaledVector(this.vel, age);
    this.pos.lerp(v1, Math.min(1, dt * 14));
    this.reach += (this.reachWant - this.reach) * Math.min(1, dt * 10);
  }
  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
}

type Mood = 'walk' | 'idle' | 'loiter' | 'look';

export class Walker {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  radius = NPC_RADIUS;
  height = NPC_HEIGHT;
  climb = new LadderState();
  yaw = Math.random() * Math.PI * 2;
  grounded = true;
  /** current goal (index into the POI list) */
  goal = 0;
  mood: Mood = 'idle';
  moodT = Math.random() * 2;
  speed = WALK;
  /** 0..1 arm reaching out (a brief gesture, never a full 2 s steal), sent with the snapshot */
  reach = 0;
  private gestureT = 0;
  private lookYaw = 0;
  private ladderDir = 1;
  private stuckT = 0;
  private stuckPos = new THREE.Vector3();
  private stuckCount = 0;
  private jumpWant = false;
  private hurryT = 0;
  private dir = new THREE.Vector3();

  constructor(readonly id: number) {}

  /** the walker's brain + body, one frame */
  update(dt: number, sim: WalkerSim) {
    ladderTick(this, dt);
    // arm gesture (salute / point) fades
    this.gestureT -= dt;
    this.reach = this.gestureT > 0 ? Math.min(1, this.reach + dt * 6) : Math.max(0, this.reach - dt * 4);
    if (this.climb.active) {
      climbStep(sim.world, this, dt, this.ladderDir, 0, false);
      this.grounded = !this.climb.active;
      if (this.grounded) this.mood = 'walk';
      return;
    }
    this.moodT -= dt;
    const dir = this.dir.set(0, 0, 0);
    if (this.mood === 'walk') {
      const field = sim.field(this.goal);
      if (!field) {
        // path still being computed: stand and look around for a moment
      } else {
        const res = sim.nav.steerIn(field, this.pos.x, this.pos.z, this.pos.y, dir, true);
        if (res && typeof res === 'object') {
          const lad = res as Ladder;
          const atTop = Math.abs(this.pos.y - lad.y1) < 1;
          const sx = lad.x - lad.nx * (this.radius + 0.2), sz = lad.z - lad.nz * (this.radius + 0.2);
          const d = Math.hypot(sx - this.pos.x, sz - this.pos.z);
          if (atTop ? d < 1.6 : d < 1.2) {
            mountLadder(this, lad, atTop);
            this.ladderDir = atTop ? -1 : 1;
            return;
          }
          if (atTop) dir.set(lad.x + lad.nx * 0.2 - this.pos.x, 0, lad.z + lad.nz * 0.2 - this.pos.z).normalize();
          else dir.set(sx - this.pos.x, 0, sz - this.pos.z).normalize();
        } else if (!res) {
          const g = sim.pois[this.goal];
          dir.set(g.x - this.pos.x, 0, g.z - this.pos.z);
          if (dir.lengthSq() < 1) dir.set(0, 0, 0);
          else dir.normalize();
        }
        const g = sim.pois[this.goal];
        const arrived = Math.hypot(g.x - this.pos.x, g.z - this.pos.z) < 2.2 && Math.abs(g.y - this.pos.y) < 2;
        if (arrived || this.moodT < -45) this.arrive(sim);
      }
      // sometimes break into a hurry, like a player sprinting somewhere
      this.hurryT -= dt;
      if (this.hurryT <= 0) {
        this.hurryT = 3 + Math.random() * 6;
        this.speed = Math.random() < 0.18 ? HURRY : WALK;
      }
      // the odd hop over nothing (players do it all the time)
      if (this.grounded && Math.random() < dt * 0.05) this.jumpWant = true;
    } else {
      // standing: look around, gesture now and then
      if (this.mood === 'look' || this.mood === 'loiter') {
        if (Math.random() < dt * 0.8) this.lookYaw = this.yaw + (Math.random() - 0.5) * 2.6;
        this.yaw += angDiff(this.yaw, this.lookYaw) * Math.min(1, dt * 3);
      }
      if (this.mood === 'loiter' && this.gestureT <= -2 && Math.random() < dt * 0.5) this.gestureT = 0.4 + Math.random() * 0.7;
      if (this.moodT <= 0) this.pickGoal(sim);
    }
    // stuck? hop, then try somewhere else
    this.stuckT += dt;
    if (this.stuckT > 1.6) {
      if (dir.lengthSq() > 0.1 && this.pos.distanceTo(this.stuckPos) < 1.0) {
        this.jumpWant = true;
        if (++this.stuckCount > 2) {
          this.stuckCount = 0;
          this.pickGoal(sim);
        }
      } else this.stuckCount = 0;
      this.stuckT = 0;
      this.stuckPos.copy(this.pos);
    }
    this.physics(dt, sim.world, dir);
    if (dir.lengthSq() > 0.1) {
      this.yaw += angDiff(this.yaw, Math.atan2(-dir.x, -dir.z)) * Math.min(1, dt * 10);
      if (tryGrab(sim.world, this, 1, dir.x, dir.z, this.grounded)) this.ladderDir = 1;
    }
  }

  /** exactly the player's movement model */
  private physics(dt: number, world: CollisionWorld, dir: THREE.Vector3) {
    const accel = this.grounded ? 80 : 26;
    const tx = dir.x * this.speed, tz = dir.z * this.speed;
    const dx = tx - this.vel.x, dz = tz - this.vel.z;
    const dl = Math.hypot(dx, dz), step = accel * dt * (dir.lengthSq() < 0.01 && this.grounded ? 1.3 : 1);
    if (dl > step) { this.vel.x += (dx / dl) * step; this.vel.z += (dz / dl) * step; } else { this.vel.x = tx; this.vel.z = tz; }
    if (this.jumpWant && this.grounded) {
      this.vel.y = 14;
      this.grounded = false;
    }
    this.jumpWant = false;
    this.vel.y = Math.max(-60, this.vel.y - 32 * dt);
    const was = this.grounded;
    this.grounded = world.moveCylinder(this.pos, this.vel, dt, this.radius, this.height, 1.0, was ? 1.0 : 0.02);
  }

  private arrive(sim: WalkerSim) {
    const r = Math.random();
    // at loot: hang around it like someone casing the place (without taking it)
    if (sim.isLootPoi(this.goal) && r < 0.6) {
      this.mood = 'loiter';
      this.moodT = 2 + Math.random() * 5;
    } else if (r < 0.55) {
      this.mood = 'look';
      this.moodT = 1 + Math.random() * 5;
    } else {
      this.mood = 'idle';
      this.moodT = 0.3 + Math.random() * 2;
    }
    this.lookYaw = this.yaw;
  }

  pickGoal(sim: WalkerSim) {
    this.goal = sim.randomGoal(this);
    this.mood = 'walk';
    this.moodT = 0;
    this.stuckT = 0;
  }
}

/**
 * Leader-side crowd simulation: walkers, a shared cache of flow fields (one per
 * point of interest, computed lazily, at most one per frame), separation, and
 * snapshot packing.
 */
export class WalkerSim {
  walkers: Walker[] = [];
  pois: THREE.Vector3[];
  private lootPoi: number;
  private fields = new Map<number, Int32Array>();
  private queue: number[] = [];

  constructor(readonly world: CollisionWorld, readonly nav: NavGrid, pois: THREE.Vector3[], lootSpots: THREE.Vector3[]) {
    // only goals the crowd can actually reach on foot (or by ladder)
    const ok = (p: THREE.Vector3) => nav.nodeAt(p.x, p.y + 0.2, p.z, 1) >= 0;
    this.pois = pois.filter(ok);
    // loot spots stay in item order (poi lootPoi + item id); unreachable ones just get walked at directly
    this.lootPoi = this.pois.length;
    this.pois.push(...lootSpots);
  }

  poiOfLoot(item: number) {
    return this.lootPoi + item;
  }

  isLootPoi(i: number) {
    return i >= this.lootPoi;
  }

  /** flow field toward POI i, or null while it is queued */
  field(i: number) {
    const f = this.fields.get(i);
    if (f) return f;
    if (!this.queue.includes(i)) this.queue.push(i);
    return null;
  }

  randomGoal(w: Walker) {
    // mostly somewhere new and not too close; loot spots a quarter of the time
    for (let k = 0; k < 8; k++) {
      const i = Math.random() < 0.25 && this.pois.length > this.lootPoi
        ? this.lootPoi + Math.floor(Math.random() * (this.pois.length - this.lootPoi))
        : Math.floor(Math.random() * this.lootPoi);
      if (i !== w.goal && this.pois[i].distanceTo(w.pos) > 6) return i;
    }
    return Math.floor(Math.random() * this.pois.length);
  }

  /** place n walkers all over the map (or at given positions, after a leader change) */
  spawn(n: number, at?: THREE.Vector3[]) {
    this.walkers = [];
    for (let i = 0; i < n; i++) {
      const w = new Walker(i);
      if (at && at[i]) w.pos.copy(at[i]);
      else {
        const p = this.pois[(i * 7) % this.pois.length];
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 2.5;
        w.pos.set(p.x + Math.cos(a) * r, p.y + 0.5, p.z + Math.sin(a) * r);
        if (this.world.pointBlocked(w.pos.x, w.pos.y + 1, w.pos.z) || this.nav.nodeAt(w.pos.x, w.pos.y, w.pos.z, 0) < 0) w.pos.set(p.x, p.y + 0.3, p.z);
      }
      w.goal = this.randomGoal(w);
      w.moodT = Math.random() * 3;
      this.walkers.push(w);
    }
  }

  /** compute one queued flow field (at most one per frame keeps the cost flat) */
  computeQueued() {
    const i = this.queue.shift();
    if (i !== undefined && !this.fields.has(i)) {
      const p = this.pois[i];
      const f = new Int32Array(this.nav.nodeH.length);
      this.nav.bfs([{ x: p.x, z: p.z, y: p.y }], f, true);
      this.fields.set(i, f);
    }
  }

  update(dt: number) {
    this.computeQueued();
    for (const w of this.walkers) w.update(dt, this);
    // soft separation so the crowd doesn't stack up
    const ws = this.walkers;
    for (let a = 0; a < ws.length; a++) {
      const A = ws[a];
      if (A.climb.active) continue;
      for (let b = a + 1; b < ws.length; b++) {
        const B = ws[b];
        if (B.climb.active) continue;
        const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.8 * 0.8 || d2 < 1e-6 || Math.abs(A.pos.y - B.pos.y) > 1.5) continue;
        const d = Math.sqrt(d2), push = (0.8 - d) * 0.25;
        A.pos.x -= (dx / d) * push; A.pos.z -= (dz / d) * push;
        B.pos.x += (dx / d) * push; B.pos.z += (dz / d) * push;
      }
    }
  }

  /** compact snapshot: 8 numbers per walker (cm-ish precision) */
  pack(): number[] {
    const out: number[] = [];
    for (const w of this.walkers)
      out.push(Math.round(w.pos.x * 50), Math.round(w.pos.y * 50), Math.round(w.pos.z * 50), Math.round(w.vel.x * 20), Math.round(w.vel.y * 20), Math.round(w.vel.z * 20), Math.round(w.yaw * 100), Math.round(w.reach * 10));
    return out;
  }
}

export function unpack(n: number[], puppets: Puppet[], now: number) {
  const count = Math.floor(n.length / 8);
  while (puppets.length < count) puppets.push(new Puppet());
  puppets.length = count;
  for (let i = 0; i < count; i++) {
    const k = i * 8;
    puppets[i].apply(n[k] / 50, n[k + 1] / 50, n[k + 2] / 50, n[k + 3] / 20, n[k + 4] / 20, n[k + 5] / 20, n[k + 6] / 100, n[k + 7] / 10, now);
  }
}

export function angDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
