import * as THREE from 'three';
import type { Ladder } from './Ladders';

export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  id: number;
  /** thin wall: never stepped or stood on (things slide off its top) */
  wall?: boolean;
}

export interface RayHit {
  dist: number;
  normal: THREE.Vector3;
  point: THREE.Vector3;
  box: Box | null;
}

// Interior of the bedroom in world units (see Bedroom.ts: 268.8 x 240 x 240 cm at 1.6 cm/unit).
export const ROOM = { minX: -84, maxX: 84, minZ: -75, maxZ: 75, height: 150 };

/** Sloped walkable plank (e.g. the race-track ramp). Height varies linearly along one axis. */
export interface Ramp {
  minX: number; maxX: number; minZ: number; maxZ: number;
  axis: 'x' | 'z';
  u0: number; u1: number; h0: number; h1: number;
  thick: number;
  /** solid wedge: the body goes down to this height (instead of a constant thickness) */
  base?: number;
}

/** Underside of a ramp's body below the surface height s. */
export function rampBottom(r: Ramp, s: number) {
  return r.base !== undefined ? r.base : s - r.thick;
}

export function rampSurface(r: Ramp, x: number, z: number) {
  const u = r.axis === 'x' ? x : z;
  const t = Math.max(0, Math.min(1, (u - r.u0) / (r.u1 - r.u0)));
  return r.h0 + (r.h1 - r.h0) * t;
}

/** Axis-aligned collision world + tiny cylinder character controller. */
export class CollisionWorld {
  boxes: Box[] = [];
  ramps: Ramp[] = [];
  ladders: Ladder[] = [];
  private cell = 8;
  private hash = new Map<number, Box[]>();

  add(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
    const b: Box = { minX, minY, minZ, maxX, maxY, maxZ, id: this.boxes.length };
    this.boxes.push(b);
    const c = this.cell;
    for (let x = Math.floor(minX / c); x <= Math.floor(maxX / c); x++)
      for (let z = Math.floor(minZ / c); z <= Math.floor(maxZ / c); z++) {
        const k = this.key(x, z);
        let l = this.hash.get(k);
        if (!l) this.hash.set(k, (l = []));
        l.push(b);
      }
    return b;
  }

  /**
   * Merge colliders stacked exactly on top of each other (block towers, castle
   * walls) into single columns, so nothing mistakes a tall stack for a low step.
   */
  mergeStacks() {
    const eps = 0.06;
    const list = this.boxes.slice();
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < list.length && !merged; i++) {
        const a = list[i];
        if (a.wall) continue;
        for (let j = 0; j < list.length; j++) {
          if (i === j) continue;
          const b = list[j];
          if (b.wall) continue;
          if (Math.abs(a.minX - b.minX) > eps || Math.abs(a.maxX - b.maxX) > eps || Math.abs(a.minZ - b.minZ) > eps || Math.abs(a.maxZ - b.maxZ) > eps) continue;
          if (b.minY > a.maxY + eps || a.minY > b.maxY + eps) continue;
          a.minY = Math.min(a.minY, b.minY);
          a.maxY = Math.max(a.maxY, b.maxY);
          list.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
    const old = list;
    this.boxes = [];
    this.hash.clear();
    for (const b of old) {
      const nb = this.add(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
      if (b.wall) nb.wall = true;
    }
  }

  addRamp(r: Ramp) {
    this.ramps.push(r);
  }

  /** Highest ramp surface under (x,z) that is at or below y (+tolerance), or -1. */
  private rampSupport(x: number, z: number, r: number, maxY: number) {
    let best = -1;
    for (const rp of this.ramps) {
      if (x + r * 0.5 < rp.minX || x - r * 0.5 > rp.maxX || z + r * 0.5 < rp.minZ || z - r * 0.5 > rp.maxZ) continue;
      const s = rampSurface(rp, Math.max(rp.minX, Math.min(rp.maxX, x)), Math.max(rp.minZ, Math.min(rp.maxZ, z)));
      if (s <= maxY && s > best) best = s;
    }
    return best;
  }

  addFromObject(o: THREE.Object3D, pad = 0) {
    const bb = new THREE.Box3().setFromObject(o);
    return this.add(bb.min.x - pad, bb.min.y, bb.min.z - pad, bb.max.x + pad, bb.max.y, bb.max.z + pad);
  }

  private key(x: number, z: number) {
    return (x + 512) * 4096 + (z + 512);
  }

  private stamp = 0;
  private marks = new Uint32Array(4096);
  private out: Box[] = [];
  /** Boxes whose XZ footprint might touch the given rect. */
  query(minX: number, minZ: number, maxX: number, maxZ: number): Box[] {
    const out = this.out;
    out.length = 0;
    this.stamp++;
    if (this.marks.length < this.boxes.length) this.marks = new Uint32Array(this.boxes.length * 2);
    const c = this.cell;
    for (let x = Math.floor(minX / c); x <= Math.floor(maxX / c); x++)
      for (let z = Math.floor(minZ / c); z <= Math.floor(maxZ / c); z++) {
        const l = this.hash.get(this.key(x, z));
        if (!l) continue;
        for (const b of l) {
          if (this.marks[b.id] === this.stamp) continue;
          this.marks[b.id] = this.stamp;
          out.push(b);
        }
      }
    return out;
  }

  /**
   * Move a vertical cylinder (feet at pos) by vel*dt, resolving collisions.
   * Returns true if grounded after the move.
   */
  moveCylinder(pos: THREE.Vector3, vel: THREE.Vector3, dt: number, radius: number, height: number, step = 0.6, snap = 0.02): boolean {
    let grounded = false;
    const prevY = pos.y;
    const prevX = pos.x, prevZ = pos.z;

    // ---- horizontal ----
    // Sub-step fast moves so nothing can tunnel through thin walls (each step < half the thinnest collider).
    const mx = vel.x * dt, mz = vel.z * dt;
    const steps = Math.min(16, Math.max(1, Math.ceil(Math.hypot(mx, mz) / 0.2)));
    const cand = this.query(
      Math.min(pos.x, pos.x + mx) - radius - 1, Math.min(pos.z, pos.z + mz) - radius - 1,
      Math.max(pos.x, pos.x + mx) + radius + 1, Math.max(pos.z, pos.z + mz) + radius + 1,
    ).slice();
    for (let st = 0; st < steps; st++) {
    pos.x += (vel.x * dt) / steps;
    pos.z += (vel.z * dt) / steps;
    for (let iter = 0; iter < (radius > 1 ? 4 : 2); iter++) {
      for (const b of cand) {
        if (b.minY >= pos.y + height) continue;
        if (b.maxY <= pos.y + (b.wall ? 0.02 : step)) {
          // a ledge only counts as a step if its top is clear (nothing stacked on it in our way)
          if (b.maxY <= pos.y + 0.6 || !this.ledgeCovered(b, pos, radius, height, cand)) continue;
        }
        this.pushOut(pos, vel, radius, b.minX, b.maxX, b.minZ, b.maxZ);
      }
      // ramps block from the sides / underneath where the surface is too high to step onto
      for (const rp of this.ramps) {
        if (pos.x + radius <= rp.minX || pos.x - radius >= rp.maxX || pos.z + radius <= rp.minZ || pos.z - radius >= rp.maxZ) continue;
        const s = rampSurface(rp, Math.max(rp.minX, Math.min(rp.maxX, pos.x)), Math.max(rp.minZ, Math.min(rp.maxZ, pos.z)));
        if (s <= pos.y + step || rampBottom(rp, s) >= pos.y + height) continue;
        // inside the footprint a ramp lifts you onto it (vertical pass) unless you're well underneath a plank
        const inside = pos.x > rp.minX && pos.x < rp.maxX && pos.z > rp.minZ && pos.z < rp.maxZ;
        if (inside && pos.y >= rampBottom(rp, s) - 0.4) continue;
        this.pushOut(pos, vel, radius, rp.minX, rp.maxX, rp.minZ, rp.maxZ);
      }
    }
    pos.x = Math.max(ROOM.minX + radius, Math.min(ROOM.maxX - radius, pos.x));
    pos.z = Math.max(ROOM.minZ + radius, Math.min(ROOM.maxZ - radius, pos.z));
    }

    // ---- vertical ----
    pos.y += vel.y * dt;
    const r2 = radius * 0.97;
    let support = 0;
    const reach = Math.max(prevY, pos.y) + step + 0.001;
    for (const b of cand) {
      if (pos.x + r2 <= b.minX || pos.x - r2 >= b.maxX || pos.z + r2 <= b.minZ || pos.z - r2 >= b.maxZ) continue;
      if (b.wall) continue;
      if (b.maxY <= reach && vel.y <= 0.01) {
        if (b.maxY > support) support = b.maxY;
        continue;
      }
      // head bonk
      if (vel.y > 0 && prevY + height <= b.minY + 0.01 && pos.y + height > b.minY) {
        pos.y = b.minY - height;
        vel.y = 0;
      }
    }
    if (vel.y <= 0.01) {
      const rs = this.rampSupport(pos.x, pos.z, radius, reach);
      if (rs > support) support = rs;
    }
    if (vel.y <= 0.01 && pos.y <= support + snap) {
      pos.y = support;
      vel.y = 0;
      grounded = true;
    }
    if (pos.y <= 0) {
      pos.y = 0;
      if (vel.y < 0) vel.y = 0;
      grounded = true;
    }
    // nothing can sit inside a ramp (wedge) or plank (bridge): lift onto its surface
    for (const rp of this.ramps) {
      if (pos.x <= rp.minX || pos.x >= rp.maxX || pos.z <= rp.minZ || pos.z >= rp.maxZ) continue;
      const s = rampSurface(rp, pos.x, pos.z);
      if (pos.y < s && pos.y >= rampBottom(rp, s) - 0.4) {
        pos.y = s;
        if (vel.y < 0) vel.y = 0;
        grounded = true;
      }
    }
    // never step up into a low ceiling (e.g. under the bed): undo the move instead
    if (grounded && pos.y > prevY + 0.001) {
      for (const b of cand) {
        if (pos.x + r2 <= b.minX || pos.x - r2 >= b.maxX || pos.z + r2 <= b.minZ || pos.z - r2 >= b.maxZ) continue;
        // anything (other than what we stand on) intersecting the body after the step-up
        if (b.minY < pos.y + height - 0.01 && b.maxY > pos.y + 0.05) {
          pos.set(prevX, prevY, prevZ);
          vel.x = 0;
          vel.z = 0;
          break;
        }
      }
    }
    if (pos.y + height > ROOM.height) {
      pos.y = ROOM.height - height;
      vel.y = Math.min(vel.y, 0);
    }
    return grounded;
  }

  private ledgeCovered(b: Box, pos: THREE.Vector3, radius: number, height: number, cand: Box[]) {
    for (const c of cand) {
      if (c === b || c.maxY <= b.maxY + 0.05 || c.minY >= b.maxY + height) continue;
      if (c.maxX <= b.minX || c.minX >= b.maxX || c.maxZ <= b.minZ || c.minZ >= b.maxZ) continue;
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX)), cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      if (Math.hypot(pos.x - cx, pos.z - cz) < radius + 0.6) return true;
    }
    return false;
  }

  private pushOut(pos: THREE.Vector3, vel: THREE.Vector3, radius: number, minX: number, maxX: number, minZ: number, maxZ: number) {
    const cx = Math.max(minX, Math.min(pos.x, maxX));
    const cz = Math.max(minZ, Math.min(pos.z, maxZ));
    let dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) return;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = radius - d;
      dx /= d; dz /= d;
      pos.x += dx * push;
      pos.z += dz * push;
      const vn = vel.x * dx + vel.z * dz;
      if (vn < 0) { vel.x -= vn * dx; vel.z -= vn * dz; }
    } else {
      const pl = pos.x - minX + radius, pr = maxX - pos.x + radius;
      const pb = pos.z - minZ + radius, pf = maxZ - pos.z + radius;
      const m = Math.min(pl, pr, pb, pf);
      if (m === pl) { pos.x -= pl; vel.x = Math.min(vel.x, 0); }
      else if (m === pr) { pos.x += pr; vel.x = Math.max(vel.x, 0); }
      else if (m === pb) { pos.z -= pb; vel.z = Math.min(vel.z, 0); }
      else { pos.z += pf; vel.z = Math.max(vel.z, 0); }
    }
  }

  private tmpN = new THREE.Vector3();
  /** Ray vs all boxes + floor/walls/ceiling. dir must be normalised. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, out?: RayHit): RayHit | null {
    let best = maxDist;
    let bestBox: Box | null = null;
    const n = this.tmpN.set(0, 0, 0);
    let found = false;
    const ex = o.x + d.x * maxDist, ez = o.z + d.z * maxDist;
    const cands = this.query(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez));
    const ix = 1 / d.x, iy = 1 / d.y, iz = 1 / d.z;
    for (const b of cands) {
      let t1 = (b.minX - o.x) * ix, t2 = (b.maxX - o.x) * ix;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
      let axis = 0;
      t1 = (b.minY - o.y) * iy; t2 = (b.maxY - o.y) * iy;
      let a = Math.min(t1, t2);
      if (a > tmin) { tmin = a; axis = 1; }
      tmax = Math.min(tmax, Math.max(t1, t2));
      t1 = (b.minZ - o.z) * iz; t2 = (b.maxZ - o.z) * iz;
      a = Math.min(t1, t2);
      if (a > tmin) { tmin = a; axis = 2; }
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmax < Math.max(tmin, 0) || tmin > best) continue;
      if (tmin < 0) continue; // inside box: ignore
      best = tmin;
      bestBox = b;
      found = true;
      n.set(0, 0, 0);
      if (axis === 0) n.x = -Math.sign(d.x);
      else if (axis === 1) n.y = -Math.sign(d.y);
      else n.z = -Math.sign(d.z);
    }
    // ramps (thin sloped planks)
    for (const rp of this.ramps) {
      const t = rayRamp(rp, o, d, best);
      if (t >= 0) {
        best = t;
        bestBox = null;
        found = true;
        const slope = (rp.h1 - rp.h0) / (rp.u1 - rp.u0);
        if (rp.axis === 'x') n.set(-slope, 1, 0).normalize(); else n.set(0, 1, -slope).normalize();
        if (d.dot(n) > 0) n.negate();
      }
    }
    // floor / ceiling / walls
    const planes: [number, number, number][] = [];
    if (d.y < 0) planes.push([-o.y / d.y, 1, 1]);
    if (d.y > 0) planes.push([(ROOM.height - o.y) / d.y, 1, -1]);
    if (d.x < 0) planes.push([(ROOM.minX - o.x) / d.x, 0, 1]);
    if (d.x > 0) planes.push([(ROOM.maxX - o.x) / d.x, 0, -1]);
    if (d.z < 0) planes.push([(ROOM.minZ - o.z) / d.z, 2, 1]);
    if (d.z > 0) planes.push([(ROOM.maxZ - o.z) / d.z, 2, -1]);
    for (const [t, axis, s] of planes) {
      if (t >= 0 && t < best) {
        best = t;
        bestBox = null;
        found = true;
        n.set(axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0);
      }
    }
    if (!found) return null;
    const hit = out ?? { dist: 0, normal: new THREE.Vector3(), point: new THREE.Vector3(), box: null };
    hit.dist = best;
    hit.normal.copy(n);
    hit.point.copy(o).addScaledVector(d, best);
    hit.box = bestBox;
    return hit;
  }

  private losHit: RayHit = { dist: 0, normal: new THREE.Vector3(), point: new THREE.Vector3(), box: null };
  private losDir = new THREE.Vector3();
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3) {
    const d = this.losDir.subVectors(b, a);
    const len = d.length();
    if (len < 0.001) return true;
    d.divideScalar(len);
    const h = this.raycast(a, d, len, this.losHit);
    return !h || h.dist >= len - 0.05;
  }

  /** Is a point inside any box? */
  pointBlocked(x: number, y: number, z: number) {
    for (const b of this.query(x, z, x, z)) {
      if (x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  }

  /** Highest surface under (x,z) below height y. */
  groundAt(x: number, z: number, y: number) {
    let g = Math.max(0, this.rampSupport(x, z, 0, y + 0.01));
    for (const b of this.query(x, z, x, z)) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= y + 0.01 && b.maxY > g) g = b.maxY;
    }
    return g;
  }
}

/**
 * Multi-level flow field toward the players. Every grid cell can hold several
 * standing levels (the floor, the top of a box, a ramp or bridge surface), and
 * agents can climb up to `climb` units between neighbouring cells or drop down
 * from ledges. Used by enemies to follow you onto ramps, stairs and furniture.
 */
export class NavGrid {
  readonly cs = 2;
  readonly w: number;
  readonly h: number;
  /** node heights, grouped per cell: nodes of cell c are [start[c], start[c+1]) */
  nodeH: Float32Array;
  start: Int32Array;
  dist: Int32Array;
  private queue: Int32Array;
  private nodeCell: Int32Array;

  constructor(private world: CollisionWorld, private clearance = 2.4, private inflate = 0.7, readonly climb = 3.3, private maxDrop = 32) {
    this.w = Math.ceil((ROOM.maxX - ROOM.minX) / this.cs);
    this.h = Math.ceil((ROOM.maxZ - ROOM.minZ) / this.cs);
    const levels: number[][] = [];
    for (let cz = 0; cz < this.h; cz++)
      for (let cx = 0; cx < this.w; cx++) levels.push(cx === 0 || cz === 0 || cx === this.w - 1 || cz === this.h - 1 ? [] : this.cellLevels(cx, cz));
    const total = levels.reduce((n, l) => n + l.length, 0);
    this.nodeH = new Float32Array(total);
    this.nodeCell = new Int32Array(total);
    this.start = new Int32Array(levels.length + 1);
    let k = 0;
    levels.forEach((l, c) => {
      this.start[c] = k;
      for (const hh of l) {
        this.nodeH[k] = hh;
        this.nodeCell[k] = c;
        k++;
      }
    });
    this.start[levels.length] = k;
    this.dist = new Int32Array(total).fill(-1);
    this.queue = new Int32Array(total);
  }

  /** Standing heights available at a cell centre for an agent of this size. */
  private cellLevels(cx: number, cz: number): number[] {
    const x = ROOM.minX + (cx + 0.5) * this.cs, z = ROOM.minZ + (cz + 0.5) * this.cs;
    const inf = this.inflate;
    const boxes = this.world.query(x - inf - 1, z - inf - 1, x + inf + 1, z + inf + 1).slice();
    const cands = [0];
    const keep = 0;
    for (const b of boxes) {
      if (b.wall || b.maxY > ROOM.height - 3) continue;
      if (x >= b.minX + keep && x <= b.maxX - keep && z >= b.minZ + keep && z <= b.maxZ - keep) cands.push(b.maxY);
    }
    for (const r of this.world.ramps) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ + 0.3 && z <= r.maxZ - 0.3) cands.push(rampSurface(r, x, z));
    }
    cands.sort((a, b) => a - b);
    const out: number[] = [];
    for (const hh of cands) {
      if (out.length && hh - out[out.length - 1] < 0.4) continue;
      // body space [hh, hh+clearance] must be free of solids (inflated by agent radius)
      let blocked = false;
      for (const b of boxes) {
        // a solid right here in the body space (not just a ledge beside us): no standing level
        // (e.g. the mattress top under the quilt)
        if (b.minY < hh + this.clearance && b.maxY > hh + 0.05 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) { blocked = true; break; }
        // ledges low enough to climb are a way up, not an obstacle
        if (b.maxY <= hh + (b.wall ? 0.35 : this.climb) || b.minY >= hh + this.clearance) continue;
        if (x > b.minX - inf && x < b.maxX + inf && z > b.minZ - inf && z < b.maxZ + inf) { blocked = true; break; }
      }
      if (!blocked)
        for (const r of this.world.ramps) {
          if (x < r.minX - inf || x > r.maxX + inf || z < r.minZ - inf || z > r.maxZ + inf) continue;
          const sx = Math.max(r.minX, Math.min(r.maxX, x)), sz = Math.max(r.minZ, Math.min(r.maxZ, z));
          const surf = rampSurface(r, sx, sz);
          const inside = x >= r.minX && x <= r.maxX && z >= r.minZ + 0.3 && z <= r.maxZ - 0.3;
          if (inside && Math.abs(surf - hh) < 0.4) continue; // this is the ramp level itself
          if (inside && surf > hh + 0.4 && rampBottom(r, surf) < hh - 0.05) { blocked = true; break; } // inside the ramp body
          if (surf > hh + this.climb && rampBottom(r, surf) < hh + this.clearance) { blocked = true; break; }
        }
      if (!blocked) out.push(hh);
    }
    return out;
  }

  cellOf(x: number, z: number) {
    const cx = Math.max(0, Math.min(this.w - 1, Math.floor((x - ROOM.minX) / this.cs)));
    const cz = Math.max(0, Math.min(this.h - 1, Math.floor((z - ROOM.minZ) / this.cs)));
    return cz * this.w + cx;
  }

  centre(c: number, out: THREE.Vector3) {
    const x = c % this.w, z = (c / this.w) | 0;
    return out.set(ROOM.minX + (x + 0.5) * this.cs, 0, ROOM.minZ + (z + 0.5) * this.cs);
  }

  /**
   * Node an agent standing at (x,y,z) occupies, or -1. Prefers the level you
   * are actually standing on: a node a little to the side at your height beats
   * the floor far below (e.g. next to a stair rail, the floor under a bridge).
   */
  nodeAt(x: number, y: number, z: number, searchR = 0) {
    const c0 = this.cellOf(x, z);
    const cx0 = c0 % this.w, cz0 = (c0 / this.w) | 0;
    let best = -1, bd = Infinity;
    for (let r = 0; r <= searchR; r++) {
      // nothing further out can beat what we have
      if (best >= 0 && r * 0.5 >= bd) break;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = cx0 + dx, cz = cz0 + dz;
          if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) continue;
          const c = cz * this.w + cx;
          for (let n = this.start[c]; n < this.start[c + 1]; n++) {
            const hh = this.nodeH[n];
            if (hh > y + 0.9) continue;
            const d = y - hh + Math.hypot(dx, dz) * 0.5;
            if (d < bd) { bd = d; best = n; }
          }
        }
    }
    return best;
  }

  private passable(from: number, to: number) {
    const dh = this.nodeH[to] - this.nodeH[from];
    return dh <= this.climb && -dh <= this.maxDrop;
  }

  /** Reverse BFS from the target positions (players) over walkable/climbable links. */
  update(tx: number, tz: number, extra: { x: number; z: number; y?: number }[] = [], ty = 0) {
    this.bfs([{ x: tx, z: tz, y: ty }, ...extra], this.dist, false);
  }

  /** ladder links between the node at a ladder's foot and the node where you step off at the top */
  links: { a: number; b: number; ladder: Ladder }[] = [];
  addLadderLinks(ladders: Ladder[], r = 0.42) {
    for (const l of ladders) {
      const fx = l.x - l.nx * (r + 0.4), fz = l.z - l.nz * (r + 0.4);
      const tx = l.x + l.nx * (r + 0.6), tz = l.z + l.nz * (r + 0.6);
      const a = this.nodeAt(fx, l.y0 + 0.2, fz, 1), b = this.nodeAt(tx, l.y1 + 0.2, tz, 1);
      if (a >= 0 && b >= 0 && Math.abs(this.nodeH[a] - l.y0) < 1.5 && Math.abs(this.nodeH[b] - l.y1) < 1.5) this.links.push({ a, b, ladder: l });
    }
  }

  /** Reverse BFS from the targets into `dist` (optionally through ladders). */
  bfs(targets: { x: number; z: number; y?: number }[], dist: Int32Array, useLinks: boolean) {
    const { w, h, queue } = this;
    dist.fill(-1);
    let head = 0, tail = 0;
    for (const t of targets) {
      const n = this.nodeAt(t.x, t.y ?? 0, t.z, 6);
      if (n >= 0 && dist[n] < 0) { dist[n] = 0; queue[tail++] = n; }
    }
    while (head < tail) {
      const v = queue[head++];
      const c = this.nodeCell[v];
      const cx = c % w, cz = (c / w) | 0;
      const d = dist[v] + 1;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dz) || (dx && dz)) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const nc = nz * w + nx;
          for (let u = this.start[nc]; u < this.start[nc + 1]; u++) {
            if (dist[u] >= 0 || !this.passable(u, v)) continue;
            dist[u] = d;
            queue[tail++] = u;
          }
        }
      if (useLinks)
        for (const k of this.links) {
          const u = k.a === v ? k.b : k.b === v ? k.a : -1;
          if (u >= 0 && dist[u] < 0) { dist[u] = d + 2; queue[tail++] = u; }
        }
    }
  }

  /**
   * Like steer() but over any distance field. Returns the ladder to climb (or
   * descend) when that's the way to go, true for a walking direction, false
   * when there is nothing better nearby.
   */
  steerIn(dist: Int32Array, x: number, z: number, y: number, out: THREE.Vector3, useLinks: boolean): boolean | Ladder {
    const { w, h } = this;
    const me = this.nodeAt(x, y, z, 1);
    if (me < 0) return false;
    const c = this.nodeCell[me];
    const cx = c % w, cz = (c / w) | 0;
    let best = dist[me] >= 0 ? dist[me] : 1e9;
    let bc = -1;
    let lad: Ladder | null = null;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const nc = nz * w + nx;
        for (let u = this.start[nc]; u < this.start[nc + 1]; u++) {
          if (dist[u] < 0 || !this.passable(me, u)) continue;
          if (dx && dz && (!this.hasNear(cz * w + nx, this.nodeH[me]) || !this.hasNear(nz * w + cx, this.nodeH[me]))) continue;
          const dd = dist[u] + (dx && dz ? 0.4 : 0);
          if (dd < best) { best = dd; bc = nc; }
        }
      }
    if (useLinks)
      for (const k of this.links) {
        const near = (n: number) => n === me || (this.nodeCell[n] !== undefined && Math.abs(this.nodeH[n] - this.nodeH[me]) < 0.6 && Math.abs((this.nodeCell[n] % w) - cx) <= 1 && Math.abs(((this.nodeCell[n] / w) | 0) - cz) <= 1);
        const other = near(k.a) ? k.b : near(k.b) ? k.a : -1;
        if (other >= 0 && dist[other] >= 0 && dist[other] + 1 < best) { best = dist[other] + 1; lad = k.ladder; bc = -2; }
      }
    if (lad) {
      out.set(lad.x - x, 0, lad.z - z);
      const l = out.length();
      if (l > 1e-4) out.divideScalar(l);
      return lad;
    }
    if (bc < 0) return false;
    this.centre(bc, this.tv);
    out.set(this.tv.x - x, 0, this.tv.z - z);
    const l = out.length();
    if (l < 1e-4) return false;
    out.divideScalar(l);
    return true;
  }

  private tv = new THREE.Vector3();
  /** Direction (xz) an agent at (x,y,z) should walk. Returns false if no path info. */
  steer(x: number, z: number, out: THREE.Vector3, y = 0): boolean {
    const { w, h, dist } = this;
    const me = this.nodeAt(x, y, z, 1);
    if (me < 0) return false;
    const c = this.nodeCell[me];
    const cx = c % w, cz = (c / w) | 0;
    let best = dist[me] >= 0 ? dist[me] : 1e9;
    let bc = -1;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const nc = nz * w + nx;
        for (let u = this.start[nc]; u < this.start[nc + 1]; u++) {
          if (dist[u] < 0 || !this.passable(me, u)) continue;
          if (dx && dz) {
            // no corner cutting: both side cells need a compatible level
            if (!this.hasNear(cz * w + nx, this.nodeH[me]) || !this.hasNear(nz * w + cx, this.nodeH[me])) continue;
          }
          const dd = dist[u] + (dx && dz ? 0.4 : 0);
          if (dd < best) { best = dd; bc = nc; }
        }
      }
    if (bc < 0) {
      // standing on our own goal node: head for the cell centre
      if (dist[me] === 0) return false;
      return false;
    }
    this.centre(bc, this.tv);
    out.set(this.tv.x - x, 0, this.tv.z - z);
    const l = out.length();
    if (l < 1e-4) return false;
    out.divideScalar(l);
    return true;
  }

  private hasNear(c: number, hh: number) {
    for (let n = this.start[c]; n < this.start[c + 1]; n++) if (Math.abs(this.nodeH[n] - hh) <= this.climb) return true;
    return false;
  }

  /** BFS distance of the floor-level (or y-level) node at x,z; -1 = unreachable. */
  distAt(x: number, z: number, y = 0) {
    const n = this.nodeAt(x, y, z, 0);
    return n < 0 ? -1 : this.dist[n];
  }
}

/** Ray vs ramp plank top surface within its footprint. Returns t or -1. */
function rayRamp(r: Ramp, o: THREE.Vector3, d: THREE.Vector3, maxT: number) {
  // surface: y = h0 + slope*(u-u0)  ->  f(t) = oy + dy t - h0 - slope*(ou + du t - u0) = 0
  const slope = (r.h1 - r.h0) / (r.u1 - r.u0);
  const ou = r.axis === 'x' ? o.x : o.z;
  const du = r.axis === 'x' ? d.x : d.z;
  const denom = d.y - slope * du;
  if (Math.abs(denom) < 1e-6) return -1;
  const t = (r.h0 + slope * (ou - r.u0) - o.y) / denom;
  if (t < 0 || t > maxT) return -1;
  const x = o.x + d.x * t, z = o.z + d.z * t;
  if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) return -1;
  return t;
}
