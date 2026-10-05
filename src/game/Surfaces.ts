import * as THREE from 'three';

/**
 * Triangle index of the visible static scene (a uniform 3D grid), used to put
 * shot marks exactly on the rendered surface instead of on the simplified
 * collision boxes (which are square where the toys are round).
 */
export class SurfaceIndex {
  private tris: Float32Array;
  private grid = new Map<number, number[]>();
  private readonly cs = 3;
  private mark: Uint32Array;
  private stamp = 0;

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const all: number[] = [];
    const v = new THREE.Vector3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      // only solid, opaque surfaces take marks (no glass, sky, light shafts, cloth)
      if (mats.some((mt) => mt.transparent || mt.side === THREE.DoubleSide)) return;
      const g = m.geometry;
      const pos = g.attributes.position as THREE.BufferAttribute;
      const idx = g.index;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
        all.push(v.x, v.y, v.z);
      }
    });
    this.tris = new Float32Array(all);
    const count = this.tris.length / 9;
    this.mark = new Uint32Array(count);
    const t = this.tris, cs = this.cs;
    for (let i = 0; i < count; i++) {
      const o = i * 9;
      const x0 = Math.floor(Math.min(t[o], t[o + 3], t[o + 6]) / cs), x1 = Math.floor(Math.max(t[o], t[o + 3], t[o + 6]) / cs);
      const y0 = Math.floor(Math.min(t[o + 1], t[o + 4], t[o + 7]) / cs), y1 = Math.floor(Math.max(t[o + 1], t[o + 4], t[o + 7]) / cs);
      const z0 = Math.floor(Math.min(t[o + 2], t[o + 5], t[o + 8]) / cs), z1 = Math.floor(Math.max(t[o + 2], t[o + 5], t[o + 8]) / cs);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++) {
            const k = this.key(x, y, z);
            let l = this.grid.get(k);
            if (!l) this.grid.set(k, (l = []));
            l.push(i);
          }
    }
  }

  private key(x: number, y: number, z: number) {
    return ((x + 256) * 512 + (y + 256)) * 512 + (z + 256);
  }

  /**
   * Nearest visible surface along the ray within [t0, t1] (a short window around
   * a collision hit). Returns distance and the face normal (facing the ray).
   */
  raycast(o: THREE.Vector3, d: THREE.Vector3, t0: number, t1: number, outN: THREE.Vector3): number {
    const cs = this.cs;
    const ax = o.x + d.x * t0, ay = o.y + d.y * t0, az = o.z + d.z * t0;
    const bx = o.x + d.x * t1, by = o.y + d.y * t1, bz = o.z + d.z * t1;
    const x0 = Math.floor(Math.min(ax, bx) / cs), x1 = Math.floor(Math.max(ax, bx) / cs);
    const y0 = Math.floor(Math.min(ay, by) / cs), y1 = Math.floor(Math.max(ay, by) / cs);
    const z0 = Math.floor(Math.min(az, bz) / cs), z1 = Math.floor(Math.max(az, bz) / cs);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 64) return -1;
    this.stamp++;
    let best = t1;
    let found = false;
    const t = this.tris;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const l = this.grid.get(this.key(x, y, z));
          if (!l) continue;
          for (const i of l) {
            if (this.mark[i] === this.stamp) continue;
            this.mark[i] = this.stamp;
            const q = i * 9;
            // Möller–Trumbore
            const e1x = t[q + 3] - t[q], e1y = t[q + 4] - t[q + 1], e1z = t[q + 5] - t[q + 2];
            const e2x = t[q + 6] - t[q], e2y = t[q + 7] - t[q + 1], e2z = t[q + 8] - t[q + 2];
            const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            if (Math.abs(det) < 1e-9) continue;
            const inv = 1 / det;
            const sx = o.x - t[q], sy = o.y - t[q + 1], sz = o.z - t[q + 2];
            const u = (sx * px + sy * py + sz * pz) * inv;
            if (u < 0 || u > 1) continue;
            const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
            const w = (d.x * qx + d.y * qy + d.z * qz) * inv;
            if (w < 0 || u + w > 1) continue;
            const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
            if (tt < t0 || tt >= best) continue;
            best = tt;
            found = true;
            outN.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
          }
        }
    if (!found) return -1;
    outN.normalize();
    if (outN.dot(d) > 0) outN.negate();
    return best;
  }

  private tn = new THREE.Vector3();
  private to = new THREE.Vector3();
  private tu = new THREE.Vector3();
  private tv = new THREE.Vector3();
  private tdir = new THREE.Vector3();
  /**
   * Largest mark size (<= size) that lies flat on the surface at p (normal n):
   * all four corners must touch the same plane. 0 = doesn't fit anywhere.
   */
  fitDecal(p: THREE.Vector3, n: THREE.Vector3, size: number): number {
    const u = this.tu.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0).cross(n).normalize();
    const w = this.tv.crossVectors(n, u);
    const dir = this.tdir.copy(n).negate();
    for (let s = size; s >= size * 0.45; s *= 0.6) {
      const h = s * 0.42;
      let ok = true;
      for (let k = 0; k < 4 && ok; k++) {
        const a = k & 1 ? h : -h, b = k & 2 ? h : -h;
        this.to.copy(p).addScaledVector(u, a).addScaledVector(w, b).addScaledVector(n, 0.06);
        const t = this.raycast(this.to, dir, 0, 0.12, this.tn);
        if (t < 0 || Math.abs(t - 0.06) > 0.02 || this.tn.dot(n) < 0.97) ok = false;
      }
      if (ok) return s;
    }
    return 0;
  }
}
