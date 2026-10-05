import * as THREE from 'three';
import { Builder, CM, scaleUV } from './Builder';
import { MatKind } from './Materials';
import { CollisionWorld } from '../game/Collision';

/**
 * The upper layers of the bedroom: a toy-brick keep on the bed with rooms, a
 * roof and a watch tower, a sky bridge to the desk, a bunker on the desk, the
 * bookshelf balcony and galleries up to a crow's nest, a block tower on the
 * toy chest and the window-sill sniper ledge. Everything is walkable, climbable
 * (ramps, ladders, stairs) and linked so you can circle the room without
 * touching the floor. All authoring is in centimetres.
 *
 * Height tiers:  floor 0 · crate 30 · bed / chest / chair 45-47 · keep roof 59 ·
 *                desk / tower / sky bridge 74 · balcony & shelf 83 · sill 90 ·
 *                upper shelf 123 · crow's nest 160
 */

type Axis = 'x' | 'z';
export type PickupKind = 'health' | 'ammo' | 'frag' | 'flash' | 'minigun';
export interface PickupSpot { pos: THREE.Vector3; kind: PickupKind; respawn: number }

const v = (x: number, y: number, z: number) => new THREE.Vector3(x * CM, y * CM, z * CM);

/** Box whose top and bottom follow functions of u (plank, wedge, rail). u1 > u0, c1 > c0. */
function slopedGeo(axis: Axis, u0: number, u1: number, c0: number, c1: number, top: (u: number) => number, bot: (u: number) => number) {
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

interface RampOpts {
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
  /** side rails on the c0 / c1 edge */
  rails?: [boolean, boolean];
  railH?: number;
  railCol?: number;
}

export function buildUpperLevels(b: Builder, world: CollisionWorld): PickupSpot[] {
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
    const s0 = y0 + 1.6, s1 = y0 + 3.6;
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
    });
    const railH = o.railH ?? 3;
    const rc = o.railCol ?? 0xffcf33;
    (o.rails ?? [false, false]).forEach((on, side) => {
      if (!on) return;
      const ca = side === 0 ? c0 - 1.25 : c1 + 0.05, cb = ca + 1.2;
      const rbot = (u: number) => (o.solid ? base : surf(u) - th - 0.3);
      b.part(slopedGeo(axis, u0, u1, ca, cb, (u) => surf(u) + railH, rbot), 'glossy', rc, [0, 0, 0], [0, 0, 0], { ao: 0 });
      const n = Math.max(2, Math.ceil((u1 - u0) / 2.5));
      for (let i = 0; i < n; i++) {
        const ua = u0 + ((u1 - u0) * i) / n, ub = u0 + ((u1 - u0) * (i + 1)) / n;
        const hi = Math.max(surf(ua), surf(ub)) + railH;
        const lo = o.solid ? base : Math.min(surf(ua), surf(ub)) - th - 0.3;
        if (axis === 'x') wallC(ua, ub, lo, hi, ca, cb);
        else wallC(ca, cb, lo, hi, ua, ub);
      }
    });
  };

  const glowDot = (x: number, y: number, z: number, col = 0xffd27a) =>
    b.part(new THREE.SphereGeometry(1.1, 10, 8), 'glow', col, [x, y, z], [0, 0, 0], { shadow: false });

  const KEEP = [0xe8453c, 0x3f7fd9, 0xffcf33, 0xf4f1ea, 0x5bbf6a];
  const INNER = [0xf4f1ea, 0xffcf33, 0x8fc6ef];
  const TOWER = [0xffcf33, 0xff8a1f, 0xf4f1ea, 0xe8453c];
  const BUNKER = [0x5bbf6a, 0x2fb3b3, 0xf4f1ea, 0xffcf33];
  const BOOKS = [0xe35d4f, 0x3f7fd9, 0xf2c84b, 0x5bbf6a, 0x9b59d0, 0xff8f3f];
  const WOOD = [0xe9c27a, 0xdcb075];

  // ======================================================================= BED KEEP (on the bed, 47 cm)
  // Three rooms behind brick walls with gun slits, a stairwell up to a
  // crenellated roof (59), a ladder down the back, and a watch tower (74).
  {
    const Y0 = 47, Y1 = 57, RT = 59;
    // outer walls (doors: west toward the race ramp, east, north, south)
    wall(60, 62.5, Y0, Y1, -60, -34, KEEP, 0, true);
    wall(60, 62.5, Y0, Y1, -26, 0, KEEP, 1, true);
    wall(117.5, 120, Y0, Y1, -60, -12, KEEP, 2, true);
    wall(117.5, 120, Y0, Y1, -4, 0, KEEP, 3);
    wall(62.5, 96, Y0, Y1, -60, -57.5, KEEP, 4, true);
    wall(104, 117.5, Y0, Y1, -60, -57.5, KEEP, 5, true);
    wall(62.5, 72, Y0, Y1, -2.5, 0, KEEP, 6, true);
    wall(80, 117.5, Y0, Y1, -2.5, 0, KEEP, 7, true);
    // inner walls: great hall | north room / south room
    wall(89, 91.5, Y0, Y1, -57.5, -47, INNER, 8);
    wall(89, 91.5, Y0, Y1, -39, -18, INNER, 9);
    wall(89, 91.5, Y0, Y1, -10, -2.5, INNER, 10);
    wall(91.5, 101, Y0, Y1, -31.25, -28.75, INNER, 11);
    wall(109, 117.5, Y0, Y1, -31.25, -28.75, INNER, 12);
    // stairwell in the great hall: block steps up to the roof
    ramp({ axis: 'x', u0: 64, u1: 82, h0: Y0, h1: RT, c0: -57.5, c1: -49.5, solid: true, base: Y0, cols: [0x3f7fd9, 0xffcf33, 0xe8453c], rails: [false, true], railH: 2.6, railCol: 0xf4f1ea });
    solid('glossy', 0x3f7fd9, 82, 89, Y0, RT, -57.5, -49.5, 0.4);
    // roof plates (hole above the stairwell)
    const roofCol = 0x8fc6ef;
    solid('painted', roofCol, 60, 120, Y1, RT, -49.5, 0, 0.3);
    solid('painted', roofCol, 60, 68, Y1, RT, -60, -49.5, 0.3);
    solid('painted', roofCol, 68, 89, Y1, RT, -60, -57.5, 0.3);
    solid('painted', roofCol, 89, 120, Y1, RT, -60, -49.5, 0.3);
    // battlements: openings for the tower ramp (NW) and the back ladder (S)
    parapet(60, 120, -60, -58.5, RT, KEEP, [[60, 68]]);
    parapet(60, 120, -1.5, 0, RT, KEEP, [[108, 116]]);
    parapet(60, 61.5, -58.5, -1.5, RT, KEEP);
    parapet(118.5, 120, -58.5, -1.5, RT, KEEP);
    // cover inside the great hall and the rooms
    solid('glossy', 0xffcf33, 70, 78, Y0, Y0 + 4, -33, -29, 0.4);
    solid('glossy', 0xe8453c, 74, 82, Y0, Y0 + 4, -16, -12, 0.4);
    solid('cardboard', 0xc79a64, 107, 115, Y0, Y0 + 6, -54, -47, 0.5);
    solid('glossy', 0x5bbf6a, 95, 101, Y0, Y0 + 4, -22, -17, 0.4);
    // night lights so the rooms read inside
    glowDot(63.3, 53, -20);
    glowDot(116.6, 53, -45);
    glowDot(116.6, 53, -16);
    glowDot(75, 53, -56.6);
    // back ladder from the bed up to the roof
    ramp({ axis: 'z', u0: 0, u1: 11, h0: RT, h1: Y0, c0: 108, c1: 116, ladder: true, thick: 1.2, cols: [0xe8453c, 0xffcf33] });

    // ---- watch tower (NW of the keep): guard room at bed level, deck at 74
    const T0 = 47, TT = 74;
    wall(40, 42.5, T0, 57, -80, -62, TOWER, 0, true);
    wall(57.5, 60, T0, 57, -80, -62, TOWER, 1, true);
    wall(42.5, 57.5, T0, 57, -80, -77.5, TOWER, 2, true);
    wall(42.5, 46, T0, 57, -64.5, -62, TOWER, 3);
    wall(54, 57.5, T0, 57, -64.5, -62, TOWER, 4);
    solid('glossy', 0xffcf33, 40, 60, 57, 65.5, -80, -62, 0.6);
    solid('glossy', 0xff8a1f, 40, 60, 65.5, TT, -80, -62, 0.6);
    glowDot(50, 54, -77.2);
    parapet(40, 41.5, -80, -62, TT, TOWER, [[-76, -66]]);
    parapet(40, 60, -80, -78.5, TT, TOWER, [[48, 56]]);
    parapet(40, 60, -63.5, -62, TT, TOWER);
    // ramp from the keep roof (59) up along the tower to a landing at 74
    ramp({ axis: 'z', u0: -74, u1: -60, h0: TT, h1: RT, c0: 60, c1: 68, thick: 1.5, kind: 'wood', cols: WOOD, rails: [false, true], railCol: 0xe8453c });
    deck(60, 68, -82, -74, TT, 0xe9c27a);
    rail(60, 69.2, TT - 1.5, TT + 3, -83.2, -82, 0xe8453c);
    rail(68.05, 69.25, TT - 1.5, TT + 3, -82, -74, 0xe8453c);

    // ---- ladder from the tower to the window-sill sniper ledge (90)
    ramp({ axis: 'z', u0: -91, u1: -80, h0: 90, h1: TT, c0: 48, c1: 56, ladder: true, thick: 1.2, cols: [0x3f7fd9, 0xf4f1ea] });
    deck(46, 58, -111, -91, 90, 0xe9c27a);
    rail(44.8, 46, 88.5, 92.6, -111, -91, 0x3f7fd9);
    rail(58, 59.2, 88.5, 92.6, -111, -91, 0x3f7fd9);

    // ---- sky bridge: tower (74) -> desk (74), with a block pillar under it
    deck(-12, 40, -76, -66, TT, 0xe9c27a);
    for (let x = -12; x < 40; x += 13) box('painted', 0x2a2420, x, x + 0.3, TT - 0.01, TT + 0.02, -75, -72, 0, { ao: 0, shadow: false });
    rail(-12, 40, TT - 1.5, TT + 3, -77.25, -76.05, 0xe8453c);
    rail(-12, 40, TT - 1.5, TT + 3, -65.95, -64.75, 0xe8453c);
    const pc = [0x3f7fd9, 0xffcf33, 0x5bbf6a, 0xe8453c];
    for (let i = 0; i < 4; i++) solid('glossy', pc[i], 1.5, 8.5, (i * (TT - 1.5)) / 4, ((i + 1) * (TT - 1.5)) / 4, -74.5, -67.5, 0.5);
  }

  // ======================================================================= DESK (74)
  // A brick bunker with a roof deck (84.5) reached by a book staircase,
  // fed by the sky bridge, the chair route and the bookshelf balcony.
  {
    const D = 74, DR = 84.5;
    wall(-100, -98, D, D + 9, -96, -74, BUNKER, 0);
    wall(-98, -66, D, D + 9, -96, -94, BUNKER, 1, true);
    wall(-66, -64, D, D + 9, -96, -89, BUNKER, 2);
    wall(-66, -64, D, D + 9, -82, -74, BUNKER, 3);
    wall(-98, -86, D, D + 9, -76, -74, BUNKER, 4, true);
    wall(-78, -66, D, D + 9, -76, -74, BUNKER, 5);
    solid('painted', 0x2fb3b3, -100, -64, D + 9, DR, -96, -74, 0.3);
    parapet(-65.5, -64, -96, -74, DR, BUNKER);
    parapet(-98.5, -65.5, -75.5, -74, DR, BUNKER);
    parapet(-98.5, -65.5, -96, -94.5, DR, BUNKER);
    glowDot(-81, 80, -94.3);
    // book staircase onto the bunker roof
    ramp({ axis: 'x', u0: -126, u1: -100, h0: D, h1: DR, c0: -92, c1: -80, solid: true, base: D, cols: BOOKS, segs: 6 });
    // books lying around as cover
    solid('painted', 0x3f7fd9, -131, -113, D, D + 3, -116, -103, 0.6);
    solid('painted', 0xf2c84b, -129, -116, D + 3, D + 6, -114, -105, 0.6);
    // ruler ramp from the desk up to the bookshelf balcony (83)
    ramp({ axis: 'z', u0: -58, u1: -32, h0: D, h1: 83, c0: -104, c1: -95, thick: 1.5, kind: 'wood', cols: WOOD, rails: [true, true], railCol: 0x3f7fd9 });
    // big atlas leaning from the chair seat (46.5) up to the desk
    ramp({ axis: 'z', u0: -58, u1: -24, h0: D, h1: 46.5, c0: -64, c1: -54, thick: 2, kind: 'painted', cols: [0x2fb3b3, 0x2a8f8f], segs: 2, rails: [true, true], railCol: 0xffcf33 });
    // plastic ladder from the floor up to the chair seat
    ramp({ axis: 'x', u0: -110, u1: -79, h0: 0, h1: 46.5, c0: -46, c1: -38, ladder: true, thick: 1.2, cols: [0xff4d3d, 0xffcf33, 0x3fa9ff] });
  }

  // ======================================================================= BOOKSHELF BALCONY (83)
  // Runs along the shelf front from the desk ramp to the toy-chest tower;
  // the shelf galleries open off it (built with the bookshelf).
  {
    const Y = 83;
    deck(-104, -95, -32, 80, Y, 0xe9c27a);
    rail(-94.95, -93.75, Y - 1.5, Y + 3, -32, 8, 0x3f7fd9);
    rail(-94.95, -93.75, Y - 1.5, Y + 3, 16, 80, 0x3f7fd9);
    rail(-105.25, -104.05, Y - 1.5, Y + 3, -32, -30, 0x3f7fd9);
    rail(-105.25, -104.05, Y - 1.5, Y + 3, 50, 80, 0x3f7fd9);
    // pencil stilts
    const pcols = [0xffcf33, 0xff4d3d, 0x5bbf6a];
    [-12, 28, 62].forEach((z, i) => {
      solid('painted', pcols[i], -101, -98, 0, Y - 1.5, z, z + 3, 0.4);
    });
  }

  // ======================================================================= BOOKSHELF GALLERIES (83 -> 123 -> 160)
  // Lower gallery: books shoved to the back, a domino-book stair climbs to the
  // upper gallery, where a second book stair leads through a hatch to the
  // crow's nest on top of the shelf.
  {
    let z = -27, k = 0;
    while (z < 5 - 0.01) {
      const w = Math.min(5 - z, 2.6 + ((k * 37) % 10) / 4);
      const h = 24 + ((k * 53) % 9) / 2;
      box('painted', BOOKS[k % BOOKS.length], -132.5, -121, 83, 83 + h, z + 0.05, z + w - 0.05, 0.4, { ao: 0 });
      z += w;
      k++;
    }
    add(-132.5, -121, 83, 111, -27, 5);
    ramp({ axis: 'z', u0: 5, u1: 40, h0: 83, h1: 123, c0: -132.5, c1: -121, solid: true, base: 83, cols: BOOKS, segs: 7 });
    // landing at the top, flush with the upper shelf
    solid('painted', 0x3f7fd9, -132.5, -121, 83, 123, 40, 47, 0.4);
    // cover in the lower gallery
    solid('painted', 0x9b59d0, -118, -108, 83, 86, 18, 25, 0.5);
    solid('painted', 0xf06292, -117, -112, 83, 108, -8, -4, 0.5);
    // upper gallery stair (a plank of books leaning up to the hatch)
    ramp({ axis: 'z', u0: -27, u1: 12, h0: 160, h1: 123, c0: -132.5, c1: -121, thick: 2.5, cols: BOOKS, segs: 6 });
    // crow's nest: book battlement along the front edge
    parapet(-106, -104.5, -27, 47, 160, [0xe35d4f, 0x3f7fd9, 0xf2c84b]);
  }

  // ======================================================================= TOY-CHEST TOWER (83)
  {
    const C = 45, T = 83;
    const cols = [0xe8453c, 0x3f7fd9, 0xffcf33, 0x5bbf6a];
    for (let i = 0; i < 4; i++) solid('glossy', cols[i], -110, -95, C + ((T - C) * i) / 4, C + ((T - C) * (i + 1)) / 4, 80, 100, 0.6);
    parapet(-110, -108.5, 81.5, 100, T, cols);
    parapet(-108.5, -95, 98.5, 100, T, cols);
    parapet(-96.5, -95, 92, 98.5, T, cols);
    parapet(-110, -104, 80, 81.5, T, cols);
    // block ramp along the chest lid from the chest top up to the tower
    ramp({ axis: 'x', u0: -95, u1: -45, h0: T, h1: C, c0: 82, c1: 92, solid: true, base: C, cols: [0xff8a1f, 0x9b59d0, 0x2fb3b3], rails: [true, true], railCol: 0xf4f1ea });
  }

  // ======================================================================= CRATE -> BED LADDER, BED SLIDE
  ramp({ axis: 'z', u0: 84.5, u1: 95.5, h0: 47, h1: 30, c0: 32, c1: 40, ladder: true, thick: 1.2, cols: [0x5bbf6a, 0xf4f1ea] });
  ramp({ axis: 'z', u0: 84.5, u1: 114, h0: 47, h1: 0, c0: 95, c1: 105, solid: true, cols: [0xff4d3d], segs: 1, rails: [true, true], railH: 2.5, railCol: 0xffcf33 });

  return [
    { pos: v(104, 48, -44), kind: 'health', respawn: 20 },
    { pos: v(108, 48, -14), kind: 'ammo', respawn: 15 },
    { pos: v(50, 75, -70), kind: 'ammo', respawn: 15 },
    { pos: v(70, 91, -116), kind: 'flash', respawn: 22 },
    { pos: v(-82, 75, -85), kind: 'frag', respawn: 22 },
    { pos: v(-110, 84, -20), kind: 'health', respawn: 20 },
    { pos: v(-112, 124, 15), kind: 'flash', respawn: 22 },
    { pos: v(-112, 161, 35), kind: 'minigun', respawn: 60 },
    { pos: v(-103, 84, 90), kind: 'ammo', respawn: 15 },
  ];
}
