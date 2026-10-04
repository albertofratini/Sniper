import * as THREE from 'three';

export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  /** solid boxes block bullets; soft boxes (fabric etc.) still do */
  id: number;
}

export interface RayHit {
  dist: number;
  normal: THREE.Vector3;
  point: THREE.Vector3;
  box: Box | null;
}

export const ROOM = { minX: -64, maxX: 64, minZ: -56, maxZ: 56, height: 84 };

/** Axis-aligned collision world + tiny cylinder character controller. */
export class CollisionWorld {
  boxes: Box[] = [];
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
  moveCylinder(pos: THREE.Vector3, vel: THREE.Vector3, dt: number, radius: number, height: number, step = 0.6): boolean {
    let grounded = false;
    const prevY = pos.y;

    // ---- horizontal ----
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    const cand = this.query(pos.x - radius - 1, pos.z - radius - 1, pos.x + radius + 1, pos.z + radius + 1).slice();
    for (let iter = 0; iter < 2; iter++) {
      for (const b of cand) {
        if (b.maxY <= pos.y + step || b.minY >= pos.y + height) continue;
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          dx /= d; dz /= d;
          pos.x += dx * push;
          pos.z += dz * push;
          const vn = vel.x * dx + vel.z * dz;
          if (vn < 0) { vel.x -= vn * dx; vel.z -= vn * dz; }
        } else {
          // centre inside: push out along smallest axis
          const pl = pos.x - b.minX + radius, pr = b.maxX - pos.x + radius;
          const pb = pos.z - b.minZ + radius, pf = b.maxZ - pos.z + radius;
          const m = Math.min(pl, pr, pb, pf);
          if (m === pl) { pos.x -= pl; vel.x = Math.min(vel.x, 0); }
          else if (m === pr) { pos.x += pr; vel.x = Math.max(vel.x, 0); }
          else if (m === pb) { pos.z -= pb; vel.z = Math.min(vel.z, 0); }
          else { pos.z += pf; vel.z = Math.max(vel.z, 0); }
        }
      }
    }
    // room walls
    pos.x = Math.max(ROOM.minX + radius, Math.min(ROOM.maxX - radius, pos.x));
    pos.z = Math.max(ROOM.minZ + radius, Math.min(ROOM.maxZ - radius, pos.z));

    // ---- vertical ----
    pos.y += vel.y * dt;
    const r2 = radius * 0.85;
    let support = 0;
    for (const b of cand) {
      if (pos.x + r2 <= b.minX || pos.x - r2 >= b.maxX || pos.z + r2 <= b.minZ || pos.z - r2 >= b.maxZ) continue;
      // landing / stepping onto
      if (b.maxY <= prevY + step + 0.001 && pos.y <= b.maxY + 0.02 && vel.y <= 0.01) {
        if (b.maxY > support) support = b.maxY;
        continue;
      }
      // head bonk
      if (vel.y > 0 && prevY + height <= b.minY + 0.01 && pos.y + height > b.minY) {
        pos.y = b.minY - height;
        vel.y = 0;
      }
    }
    if (pos.y <= support + 0.02 && vel.y <= 0.01) {
      if (support > 0 || pos.y <= 0.02) {
        pos.y = Math.max(support, 0);
        vel.y = 0;
        grounded = true;
      }
    }
    if (pos.y <= 0) {
      pos.y = 0;
      if (vel.y < 0) vel.y = 0;
      grounded = true;
    }
    if (pos.y + height > ROOM.height) {
      pos.y = ROOM.height - height;
      vel.y = Math.min(vel.y, 0);
    }
    return grounded;
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
    let g = 0;
    for (const b of this.query(x, z, x, z)) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= y + 0.01 && b.maxY > g) g = b.maxY;
    }
    return g;
  }
}

/** Floor-level flow field toward the player for ground enemies. */
export class NavGrid {
  readonly cs = 2;
  readonly w: number;
  readonly h: number;
  blocked: Uint8Array;
  dist: Int32Array;
  private queue: Int32Array;

  constructor(world: CollisionWorld, clearance = 2.4, inflate = 0.7) {
    this.w = Math.ceil((ROOM.maxX - ROOM.minX) / this.cs);
    this.h = Math.ceil((ROOM.maxZ - ROOM.minZ) / this.cs);
    this.blocked = new Uint8Array(this.w * this.h);
    this.dist = new Int32Array(this.w * this.h).fill(-1);
    this.queue = new Int32Array(this.w * this.h);
    for (const b of world.boxes) {
      if (b.minY >= clearance || b.maxY <= 0.7) continue;
      const x0 = Math.floor((b.minX - inflate - ROOM.minX) / this.cs);
      const x1 = Math.floor((b.maxX + inflate - ROOM.minX) / this.cs);
      const z0 = Math.floor((b.minZ - inflate - ROOM.minZ) / this.cs);
      const z1 = Math.floor((b.maxZ + inflate - ROOM.minZ) / this.cs);
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++)
        for (let z = Math.max(0, z0); z <= Math.min(this.h - 1, z1); z++) {
          // only block if the cell centre is substantially covered
          const cx = ROOM.minX + (x + 0.5) * this.cs, cz = ROOM.minZ + (z + 0.5) * this.cs;
          if (cx > b.minX - inflate && cx < b.maxX + inflate && cz > b.minZ - inflate && cz < b.maxZ + inflate)
            this.blocked[z * this.w + x] = 1;
        }
    }
    // outer ring
    for (let x = 0; x < this.w; x++) { this.blocked[x] = 1; this.blocked[(this.h - 1) * this.w + x] = 1; }
    for (let z = 0; z < this.h; z++) { this.blocked[z * this.w] = 1; this.blocked[z * this.w + this.w - 1] = 1; }
  }

  cellOf(x: number, z: number) {
    const cx = Math.max(0, Math.min(this.w - 1, Math.floor((x - ROOM.minX) / this.cs)));
    const cz = Math.max(0, Math.min(this.h - 1, Math.floor((z - ROOM.minZ) / this.cs)));
    return cz * this.w + cx;
  }

  centre(i: number, out: THREE.Vector3) {
    const x = i % this.w, z = (i / this.w) | 0;
    return out.set(ROOM.minX + (x + 0.5) * this.cs, 0, ROOM.minZ + (z + 0.5) * this.cs);
  }

  /** BFS from target position. */
  update(tx: number, tz: number) {
    const { w, h, blocked, dist, queue } = this;
    dist.fill(-1);
    let head = 0, tail = 0;
    const tc = this.cellOf(tx, tz);
    const tcx = tc % w, tcz = (tc / w) | 0;
    // seed: target cell or nearest free cells around it
    for (let r = 0; r < 8 && tail === 0; r++) {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = tcx + dx, z = tcz + dz;
          if (x < 0 || z < 0 || x >= w || z >= h) continue;
          const i = z * w + x;
          if (!blocked[i]) { dist[i] = 0; queue[tail++] = i; }
        }
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, z = (i / w) | 0;
      const d = dist[i] + 1;
      if (x > 0 && !blocked[i - 1] && dist[i - 1] < 0) { dist[i - 1] = d; queue[tail++] = i - 1; }
      if (x < w - 1 && !blocked[i + 1] && dist[i + 1] < 0) { dist[i + 1] = d; queue[tail++] = i + 1; }
      if (z > 0 && !blocked[i - w] && dist[i - w] < 0) { dist[i - w] = d; queue[tail++] = i - w; }
      if (z < h - 1 && !blocked[i + w] && dist[i + w] < 0) { dist[i + w] = d; queue[tail++] = i + w; }
    }
  }

  private tv = new THREE.Vector3();
  /** Direction (xz) an agent at (x,z) should walk. Returns false if no path info. */
  steer(x: number, z: number, out: THREE.Vector3): boolean {
    const { w, h, dist, blocked } = this;
    const i = this.cellOf(x, z);
    const cx = i % w, cz = (i / w) | 0;
    let best = dist[i] >= 0 ? dist[i] : 1e9;
    let bi = -1;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const j = nz * w + nx;
        if (dist[j] < 0) continue;
        // no diagonal corner cutting
        if (dx && dz && (blocked[cz * w + nx] || blocked[nz * w + cx])) continue;
        const dd = dist[j] + (dx && dz ? 0.4 : 0);
        if (dd < best) { best = dd; bi = j; }
      }
    if (bi < 0) return false;
    this.centre(bi, this.tv);
    out.set(this.tv.x - x, 0, this.tv.z - z);
    const l = out.length();
    if (l < 1e-4) return false;
    out.divideScalar(l);
    return true;
  }

  distAt(x: number, z: number) {
    return this.dist[this.cellOf(x, z)];
  }
}
