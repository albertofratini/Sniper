import * as THREE from 'three';
import { Builder, CM, scaleUV } from './Builder';
import { MatKind } from './Materials';
import { CollisionWorld } from '../game/Collision';

/**
 * Shared construction kit for the toy structures (authoring in centimetres):
 * brick walls, parapets, rails, decks, ramps/ladders/stairs, tubes, with
 * colliders that match what you see.
 */

export type Axis = 'x' | 'z';

/** Box whose top and bottom follow functions of u (plank, wedge, rail). u1 > u0, c1 > c0. */
export function slopedGeo(axis: Axis, u0: number, u1: number, c0: number, c1: number, top: (u: number) => number, bot: (u: number) => number) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const su = (axis === 'x' ? p.getX(i) : p.getZ(i)) + 0.5;
    const sc = (axis === 'x' ? p.getZ(i) : p.getX(i)) + 0.5;
    const u = u0 + (u1 - u0) * su, c = c0 + (c1 - c0) * sc;
    const y = p.getY(i) > 0 ? top(u) : bot(u);
    if (axis === 'x') p.setXYZ(i, u, y, c);
    else p.setXYZ(i, c, y, u);
  }
  g.computeVertexNormals();
  scaleUV(g, Math.max(u1 - u0, c1 - c0) / 40);
  return g;
}

export interface RampOpts {
  axis: Axis;
  /** along-axis range; h0 is the height at u0, h1 at u1 */
  u0: number; u1: number; h0: number; h1: number;
  /** cross-axis range (walkable width) */
  c0: number; c1: number;
  /** solid wedge down to `base` (default: a plank of this thickness) */
  solid?: boolean;
  base?: number;
  thick?: number;
  kind?: MatKind;
  cols: number[];
  segs?: number;
  ladder?: boolean;
  /** visible steps (over the smooth ramp collider), about this deep each */
  steps?: number;
  /** colour of the step nosing strips */
  nosing?: number;
  /** side rails on the c0 / c1 edge */
  rails?: [boolean, boolean];
  /** limit the rails to this stretch along u (leave an opening at an end) */
  railFrom?: number;
  railTo?: number;
  railH?: number;
  railCol?: number;
}

export function makeKit(b: Builder, world: CollisionWorld) {
  const add = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
    world.add(x0 * CM, y0 * CM, z0 * CM, x1 * CM, y1 * CM, z1 * CM);
  /** collider you can't stand on (rails, parapets) */
  const wallC = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    add(x0, x1, y0, y1, z0, z1).wall = true;
  };
  /** builder box with cheap one-segment bevels (there are a lot of these up here) */
  const box: Builder['box'] = (kind, col, x0, x1, y0, y1, z0, z1, r = 0.6, opts = {}) => b.box(kind, col, x0, x1, y0, y1, z0, z1, r, { seg: 1, ...opts });
  const solid = (kind: MatKind, col: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r = 0.4) =>
    box(kind, col, x0, x1, y0, y1, z0, z1, r, { collide: true, ao: 0.15 });

  /** Staggered toy bricks filling a thin wall volume (visual only). */
  const bricks = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, pal: number[], seed: number) => {
    const alongX = x1 - x0 >= z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.round((y1 - y0) / 3.3));
    const ch = (y1 - y0) / n;
    for (let row = 0; row < n; row++) {
      const ya = y0 + row * ch, yb = ya + ch;
      let s = 0, k = 0;
      while (s < len - 0.01) {
        let e = Math.min(len, s + (k === 0 && row % 2 ? 6 : 12));
        if (len - e < 4) e = len;
        const col = pal[(seed * 7 + row * 3 + k * 2 + ((row + k) % 3)) % pal.length];
        if (alongX) box('glossy', col, x0 + s, x0 + e, ya, yb, z0, z1, 0.3, { ao: 0.1 });
        else box('glossy', col, x0, x1, ya, yb, z0 + s, z0 + e, 0.3, { ao: 0.1 });
        s = e;
        k++;
      }
    }
  };

  /** Brick wall segment (visual + collider). With slits: narrow gun slots at standing eye height. */
  const wall = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, pal: number[], seed: number, slits = false) => {
    const alongX = x1 - x0 >= z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const nS = slits ? Math.floor(len / 9) : 0;
    if (!nS) {
      bricks(x0, x1, y0, y1, z0, z1, pal, seed);
      add(x0, x1, y0, y1, z0, z1);
      return;
    }
    const s0 = y0 + 1.8, s1 = y0 + 3.8;
    bricks(x0, x1, y0, s0, z0, z1, pal, seed);
    add(x0, x1, y0, s0, z0, z1);
    bricks(x0, x1, s1, y1, z0, z1, pal, seed + 1);
    add(x0, x1, s1, y1, z0, z1);
    const pillar = (a: number, c: number) => {
      if (c - a < 0.05) return;
      if (alongX) {
        box('glossy', 0xf4f1ea, x0 + a, x0 + c, s0, s1, z0 + 0.15, z1 - 0.15, 0.25, { ao: 0 });
        add(x0 + a, x0 + c, s0, s1, z0, z1);
      } else {
        box('glossy', 0xf4f1ea, x0 + 0.15, x1 - 0.15, s0, s1, z0 + a, z0 + c, 0.25, { ao: 0 });
        add(x0, x1, s0, s1, z0 + a, z0 + c);
      }
    };
    let prev = 0;
    for (let i = 0; i < nS; i++) {
      const c = ((i + 0.5) * len) / nS;
      pillar(prev, c - 1.2);
      // dark slot back so the slit reads as an opening, not a missing brick
      prev = c + 1.2;
    }
    pillar(prev, len);
  };

  /** Low crenellated wall (cover you can shoot over when standing, hide behind when crouched). */
  const parapet = (x0: number, x1: number, z0: number, z1: number, y: number, pal: number[], gaps: [number, number][] = [], h = 2.6) => {
    const alongX = x1 - x0 >= z1 - z0;
    const a0 = alongX ? x0 : z0, a1 = alongX ? x1 : z1;
    let a = a0, k = 0;
    while (a < a1 - 0.01) {
      const merlon = k % 2 === 0;
      let e = Math.min(a1, a + (merlon ? 4 : 3));
      if (a1 - e < 1.5) e = a1;
      const g = gaps.find(([g0, g1]) => e > g0 && a < g1);
      if (g) {
        // clip around the opening
        if (a < g[0]) e = g[0];
        else { a = g[1]; continue; }
      }
      const hh = merlon ? h : h * 0.5;
      const col = pal[k % pal.length];
      if (alongX) {
        box('glossy', col, a, e, y, y + hh, z0, z1, 0.3, { ao: 0 });
        wallC(a, e, y, y + hh, z0, z1);
        if (merlon && e - a > 3) b.part(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 10), 'glossy', col, [(a + e) / 2, y + hh + 0.25, (z0 + z1) / 2]);
      } else {
        box('glossy', col, x0, x1, y, y + hh, a, e, 0.3, { ao: 0 });
        wallC(x0, x1, y, y + hh, a, e);
        if (merlon && e - a > 3) b.part(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 10), 'glossy', col, [(x0 + x1) / 2, y + hh + 0.25, (a + e) / 2]);
      }
      a = e;
      k++;
    }
  };

  /** Straight hand rail (visual + wall collider). */
  const rail = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: number) => {
    box('glossy', col, x0, x1, y0, y1, z0, z1, 0.35, { ao: 0 });
    wallC(x0, x1, y0, y1, z0, z1);
  };

  /** Flat walkway slab. */
  const deck = (x0: number, x1: number, z0: number, z1: number, y: number, col: number, kind: MatKind = 'wood', th = 1.5) =>
    solid(kind, col, x0, x1, y - th, y, z0, z1, 0.4);

  /**
   * Guard rail following a slope (height h0 at u0 -> h1 at u1), standing railH
   * above it, across [ca, cb]. Down to `base` if given, else `below` under the surface.
   * Optionally only over [from, to] along u.
   */
  const slopeRail = (axis: Axis, u0: number, u1: number, h0: number, h1: number, ca: number, cb: number, railH: number, col: number, base?: number, below = 1.8, from = u0, to = u1) => {
    const surf = (u: number) => h0 + ((h1 - h0) * (u - u0)) / (u1 - u0);
    const bot = (u: number) => (base !== undefined ? base : surf(u) - below);
    b.part(slopedGeo(axis, from, to, ca, cb, (u) => surf(u) + railH, bot), 'glossy', col, [0, 0, 0], [0, 0, 0], { ao: 0 });
    const n = Math.max(2, Math.ceil((to - from) / 2.5));
    for (let i = 0; i < n; i++) {
      const ua = from + ((to - from) * i) / n, ub = from + ((to - from) * (i + 1)) / n;
      const hi = Math.max(surf(ua), surf(ub)) + railH;
      const lo = base !== undefined ? base : Math.min(surf(ua), surf(ub)) - below;
      if (axis === 'x') wallC(ua, ub, lo, hi, ca, cb);
      else wallC(ca, cb, lo, hi, ua, ub);
    }
  };

  /** Ramp / plank / ladder: visual + smooth sloped collider + optional side rails. */
  const ramp = (o: RampOpts) => {
    const { axis, u0, u1, h0, h1, c0, c1 } = o;
    const surf = (u: number) => h0 + ((h1 - h0) * (u - u0)) / (u1 - u0);
    const th = o.thick ?? 1.5;
    const base = o.base ?? 0;
    const bot = (u: number) => (o.solid ? base : surf(u) - th);
    const kind = o.kind ?? 'glossy';
    if (o.ladder) {
      const rw = 0.9;
      const rc = o.railCol ?? 0xf4f1ea;
      b.part(slopedGeo(axis, u0, u1, c0, c0 + rw, (u) => surf(u) + 0.9, (u) => surf(u) - 1.6), kind, rc, [0, 0, 0], [0, 0, 0], { ao: 0 });
      b.part(slopedGeo(axis, u0, u1, c1 - rw, c1, (u) => surf(u) + 0.9, (u) => surf(u) - 1.6), kind, rc, [0, 0, 0], [0, 0, 0], { ao: 0 });
      const len = Math.hypot(u1 - u0, h1 - h0);
      const n = Math.max(2, Math.floor(len / 2.4));
      for (let i = 0; i < n; i++) {
        const ua = u0 + ((u1 - u0) * (i + 0.25)) / n;
        b.part(slopedGeo(axis, ua, ua + 0.9, c0 + rw, c1 - rw, surf, (u) => surf(u) - 0.9), kind, o.cols[i % o.cols.length], [0, 0, 0], [0, 0, 0], { ao: 0 });
      }
    } else if (o.steps) {
      // treads sit at the ramp height of their middle, so feet never sink or float more than half a step
      const n = Math.max(2, Math.round((u1 - u0) / o.steps));
      for (let i = 0; i < n; i++) {
        const ua = u0 + ((u1 - u0) * i) / n, ub = u0 + ((u1 - u0) * (i + 1)) / n;
        const top = surf((ua + ub) / 2);
        const lo = o.solid ? base : Math.min(surf(ua), surf(ub)) - th;
        b.part(slopedGeo(axis, ua, ub, c0, c1, () => top, () => lo), kind, o.cols[i % o.cols.length], [0, 0, 0], [0, 0, 0], { ao: 0.15 });
        if (o.nosing !== undefined) {
          // a lighter lip on the leading edge of each tread
          const up = h1 > h0;
          const na = up ? ua : ub - 0.5, nb = up ? ua + 0.5 : ub;
          b.part(slopedGeo(axis, na, nb, c0 + 0.3, c1 - 0.3, () => top + 0.06, () => top - 0.4), 'glossy', o.nosing, [0, 0, 0], [0, 0, 0], { ao: 0 });
        }
      }
    } else {
      const segs = o.segs ?? Math.max(1, Math.round((u1 - u0) / 7));
      for (let i = 0; i < segs; i++) {
        const ua = u0 + ((u1 - u0) * i) / segs, ub = u0 + ((u1 - u0) * (i + 1)) / segs;
        b.part(slopedGeo(axis, ua, ub, c0, c1, surf, bot), kind, o.cols[i % o.cols.length], [0, 0, 0], [0, 0, 0], { ao: 0.2 });
      }
    }
    const fp = axis === 'x' ? { minX: u0, maxX: u1, minZ: c0, maxZ: c1 } : { minX: c0, maxX: c1, minZ: u0, maxZ: u1 };
    world.addRamp({
      minX: fp.minX * CM, maxX: fp.maxX * CM, minZ: fp.minZ * CM, maxZ: fp.maxZ * CM,
      axis, u0: u0 * CM, u1: u1 * CM, h0: h0 * CM, h1: h1 * CM, thick: o.solid ? 1000 : th * CM,
      // a solid wedge stops at its base (the bed, the desk, the hub plate...), not at the floor
      base: o.solid && base > 0 ? base * CM : undefined,
    });
    const railH = o.railH ?? 3;
    const rc = o.railCol ?? 0xffcf33;
    (o.rails ?? [false, false]).forEach((on, side) => {
      if (!on) return;
      const ca = side === 0 ? c0 - 1.25 : c1 + 0.05;
      slopeRail(axis, u0, u1, h0, h1, ca, ca + 1.2, railH, rc, o.solid ? base : undefined, th + 0.3, o.railFrom, o.railTo);
    });
  };

  const glowDot = (x: number, y: number, z: number, col = 0xffd27a) =>
    b.part(new THREE.SphereGeometry(1.1, 10, 8), 'glow', col, [x, y, z], [0, 0, 0], { shadow: false });

  /** thin hanging string from (x,y,z) up to the ceiling (visual only) */
  const string = (x: number, y: number, z: number, top = 240) => {
    const g = new THREE.CylinderGeometry(0.22, 0.22, top - y, 5, 1, true);
    b.part(g, 'matte', 0xf4efe4, [x, (y + top) / 2, z], [0, 0, 0], { ao: 0, shadow: false });
  };

  /**
   * Walk-through toy tube (water-park slide style) along x or z, with a flat
   * walkway inside whose height goes h0 -> h1. Real thick walls: an outer skin
   * facing out and an inner skin facing in (each culls the other's view), end
   * rings, interior lights, and colliders for floor, sides and roof.
   */
  const tube = (o: { axis: Axis; u0: number; u1: number; h0: number; h1: number; c: number; cols: number[]; inner: number; R?: number; hang?: number[] }) => {
    const { axis, u0, u1, h0, h1, c } = o;
    const R = o.R ?? 6, lift = 1.2, Ro = R + 0.6;
    const halfW = Math.sqrt(R * R - (R - lift) * (R - lift));
    const floor = (u: number) => h0 + ((h1 - h0) * (u - u0)) / (u1 - u0);
    const cy = (u: number) => floor(u) - lift + R;
    const P = (u: number) => (axis === 'x' ? new THREE.Vector3(u, cy(u), c) : new THREE.Vector3(c, cy(u), u));
    const dir = P(u1).sub(P(u0)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const n = Math.max(1, Math.round((u1 - u0) / 6));
    const flip = (g: THREE.BufferGeometry) => {
      const idx = g.index!;
      for (let i = 0; i < idx.count; i += 3) {
        const t = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, t);
      }
      const nm = g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < nm.count; i++) nm.setXYZ(i, -nm.getX(i), -nm.getY(i), -nm.getZ(i));
      return g;
    };
    for (let i = 0; i < n; i++) {
      const ua = u0 + ((u1 - u0) * i) / n, ub = u0 + ((u1 - u0) * (i + 1)) / n;
      const pa = P(ua), pb = P(ub), mid = pa.clone().add(pb).multiplyScalar(0.5);
      const len = pa.distanceTo(pb);
      const outer = new THREE.CylinderGeometry(Ro, Ro, len, 28, 1, true).applyQuaternion(q).translate(mid.x, mid.y, mid.z);
      scaleUV(outer, 0.4);
      b.part(outer, 'glossy', o.cols[i % o.cols.length], [0, 0, 0], [0, 0, 0], { ao: 0 });
      const inner = flip(new THREE.CylinderGeometry(R, R, len, 28, 1, true)).applyQuaternion(q).translate(mid.x, mid.y, mid.z);
      scaleUV(inner, 0.4);
      b.part(inner, 'glossy', i % 2 ? o.inner : 0xffffff, [0, 0, 0], [0, 0, 0], { ao: 0 });
      // ring light along the ceiling of every other section
      if (i % 2 === 0) {
        const lp = mid.clone().add(new THREE.Vector3(0, R - 0.5, 0));
        b.part(new THREE.SphereGeometry(0.55, 8, 6), 'glow', 0xfff1c4, [lp.x, lp.y, lp.z], [0, 0, 0], { shadow: false });
      }
    }
    // end rings join the two skins
    for (const [u, s] of [[u0, -1], [u1, 1]] as const) {
      const ring = new THREE.RingGeometry(R, Ro, 28).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().multiplyScalar(s)));
      const p = P(u);
      ring.translate(p.x, p.y, p.z);
      b.part(ring, 'glossy', 0xf4f1ea, [0, 0, 0], [0, 0, 0], { ao: 0 });
    }
    // flat grippy walkway inside (this is what you stand on)
    b.part(slopedGeo(axis, u0, u1, c - halfW, c + halfW, floor, (u) => floor(u) - 0.35), 'rubber', 0x6f86a8, [0, 0, 0], [0, 0, 0], { ao: 0 });
    if (h0 === h1) add(axis === 'x' ? u0 : c - halfW, axis === 'x' ? u1 : c + halfW, h0 - 1.2, h0, axis === 'x' ? c - halfW : u0, axis === 'x' ? c + halfW : u1);
    else
      world.addRamp({
        minX: (axis === 'x' ? u0 : c - halfW) * CM, maxX: (axis === 'x' ? u1 : c + halfW) * CM,
        minZ: (axis === 'x' ? c - halfW : u0) * CM, maxZ: (axis === 'x' ? c + halfW : u1) * CM,
        axis, u0: u0 * CM, u1: u1 * CM, h0: h0 * CM, h1: h1 * CM, thick: 1.2 * CM,
      });
    // side walls and roof, in short sections so they follow the slope
    const m = Math.max(2, Math.ceil((u1 - u0) / 2.5));
    for (let i = 0; i < m; i++) {
      const ua = u0 + ((u1 - u0) * i) / m, ub = u0 + ((u1 - u0) * (i + 1)) / m;
      const fl = Math.min(floor(ua), floor(ub)), fh = Math.max(floor(ua), floor(ub));
      const lo = fl - lift - 0.6, top = fh - lift + 2 * R + 0.6;
      for (const [ca, cb] of [[c - Ro, c - halfW], [c + halfW, c + Ro]]) {
        if (axis === 'x') wallC(ua, ub, lo, top, ca, cb);
        else wallC(ca, cb, lo, top, ua, ub);
      }
      const r0 = fl - lift + 2 * R - 0.8;
      if (axis === 'x') add(ua, ub, r0, top, c - halfW, c + halfW);
      else add(c - halfW, c + halfW, r0, top, ua, ub);
    }
    for (const u of o.hang ?? []) {
      const p = P(u);
      string(p.x, p.y + Ro, p.z);
    }
  };

  return { slopeRail, string, tube, add, wallC, box, solid, bricks, wall, parapet, rail, deck, ramp, glowDot };
}

export type Kit = ReturnType<typeof makeKit>;
