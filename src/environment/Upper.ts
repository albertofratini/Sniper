import * as THREE from 'three';
import { Builder, CM } from './Builder';
import { makeKit } from './Kit';
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

export type PickupKind = 'health' | 'ammo' | 'frag' | 'flash' | 'minigun';
export interface PickupSpot { pos: THREE.Vector3; kind: PickupKind; respawn: number }

const v = (x: number, y: number, z: number) => new THREE.Vector3(x * CM, y * CM, z * CM);

export function buildUpperLevels(b: Builder, world: CollisionWorld): PickupSpot[] {
  const { add, box, solid, wall, parapet, rail, deck, ramp, glowDot, slopeRail } = makeKit(b, world);

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
    parapet(60, 120, -1.5, 0, RT, KEEP, [[96, 102], [108, 116]]);
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
    ramp({ axis: 'z', u0: 0, u1: 11, h0: RT, h1: Y0, c0: 108, c1: 116, ladder: true, thick: 1.2, cols: [0xe8453c, 0xffcf33], rails: [true, true], railH: 2.6, railCol: 0xf4f1ea });

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
    ramp({ axis: 'z', u0: -91, u1: -80, h0: 90, h1: TT, c0: 48, c1: 56, ladder: true, thick: 1.2, cols: [0x3f7fd9, 0xf4f1ea], rails: [true, true], railH: 2.6, railCol: 0xffcf33 });
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
    ramp({ axis: 'x', u0: -126, u1: -100, h0: D, h1: DR, c0: -92, c1: -80, solid: true, base: D, cols: BOOKS, segs: 6, rails: [true, true], railH: 2.6, railCol: 0xf4f1ea });
    // books lying around as cover
    solid('painted', 0x3f7fd9, -131, -113, D, D + 3, -116, -103, 0.6);
    solid('painted', 0xf2c84b, -129, -116, D + 3, D + 6, -114, -105, 0.6);
    // ruler ramp from the desk up to the bookshelf balcony (83)
    ramp({ axis: 'z', u0: -58, u1: -32, h0: D, h1: 83, c0: -104, c1: -95, thick: 1.5, kind: 'wood', cols: WOOD, rails: [true, true], railCol: 0x3f7fd9 });
    // big atlas leaning from the chair seat (46.5) up to the desk
    ramp({ axis: 'z', u0: -58, u1: -24, h0: D, h1: 46.5, c0: -64, c1: -54, thick: 2, kind: 'painted', cols: [0x2fb3b3, 0x2a8f8f], segs: 2, rails: [true, true], railCol: 0xffcf33 });
    // plastic ladder from the floor up to the chair seat
    ramp({ axis: 'x', u0: -110, u1: -79, h0: 0, h1: 46.5, c0: -46, c1: -38, ladder: true, thick: 1.2, cols: [0xff4d3d, 0xffcf33, 0x3fa9ff], rails: [true, true], railH: 2.6, railCol: 0xf4f1ea });
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
    [-12, 20, 44].forEach((z, i) => {
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
    ramp({ axis: 'z', u0: 5, u1: 40, h0: 83, h1: 123, c0: -132.5, c1: -121, solid: true, base: 83, cols: BOOKS, segs: 7, rails: [false, true], railFrom: 10, railH: 2.6, railCol: 0xf4f1ea });
    // landing at the top, flush with the upper shelf
    solid('painted', 0x3f7fd9, -132.5, -121, 83, 123, 40, 47, 0.4);
    // cover in the lower gallery
    solid('painted', 0x9b59d0, -118, -108, 83, 86, 18, 25, 0.5);
    solid('painted', 0xf06292, -117, -112, 83, 108, -8, -4, 0.5);
    // upper gallery stair (a plank of books leaning up to the hatch)
    ramp({ axis: 'z', u0: -27, u1: 12, h0: 160, h1: 123, c0: -132.5, c1: -121, solid: true, base: 123, cols: BOOKS, segs: 6, rails: [false, true], railFrom: -20, railH: 2.6, railCol: 0xf4f1ea });
    // upper gallery: a rail of books along the front, open to the cargo-plane gangway
    rail(-105.5, -104.5, 123, 125.6, -27, 26, 0xe35d4f);
    rail(-105.5, -104.5, 123, 125.6, 36, 47, 0xe35d4f);
    // crow's nest: book battlement along the front edge
    parapet(-106, -104.5, -27, 47, 160, [0xe35d4f, 0x3f7fd9, 0xf2c84b], [[36, 47]]);
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
  ramp({ axis: 'z', u0: 84.5, u1: 95.5, h0: 47, h1: 30, c0: 32, c1: 40, ladder: true, thick: 1.2, cols: [0x5bbf6a, 0xf4f1ea], rails: [true, true], railTo: 90, railH: 2.6, railCol: 0xf4f1ea });

  // ======================================================================= EDGE SAFETY
  // Low toy barriers along drops you could run off by accident. All of them are
  // jumpable (2.2-2.6 cm against a 4.9 cm jump), and open wherever a route arrives.
  {
    // picket fence along the open bed edges
    const picket = (x0: number, x1: number, z0: number, z1: number, gaps: [number, number][] = []) => parapet(x0, x1, z0, z1, 47, [0xf4f1ea, 0xffcf33], gaps, 2.4);
    picket(29.2, 30.4, -67, -17.5);
    picket(29.2, 30.4, 1.5, 82.2);
    picket(29.2, 130, 82.2, 83.4, [[32, 40], [95, 105]]);
    // pencil fence along the desk edges (open at the ramps, the atlas, the tube and the sky bridge)
    const pencil = (x0: number, x1: number, z0: number, z1: number) => rail(x0, x1, 74, 76.2, z0, z1, 0xffcf33);
    pencil(-134, -104, -59.2, -58);
    pencil(-95, -64, -59.2, -58);
    pencil(-54, -26.5, -59.2, -58);
    pencil(-13.2, -12, -120, -76.5);
    // under the desk-to-hub tube mouth
    pencil(-26.5, -12, -59.2, -58);
    pencil(-13.2, -12, -66, -59.2);
    // crate rim (open to the stairs, the ruler bridge and the ladder)
    const rim = (x0: number, x1: number, z0: number, z1: number) => rail(x0, x1, 30, 32.2, z0, z1, 0x2f8be0);
    rim(0, 40, 114.8, 116);
    rim(0, 32, 86, 87.2);
    rim(0, 1.2, 87.2, 95);
    rim(0, 1.2, 105, 114.8);
    rim(38.8, 40, 87.2, 90);
    rim(38.8, 40, 112, 114.8);
    // toy-chest rim (open to the ruler bridge and the block ramp)
    rail(-41.2, -40, 45, 47.2, 80, 95, 0xffcf33);
    rail(-41.2, -40, 45, 47.2, 105, 118, 0xffcf33);
    rail(-45, -41.2, 45, 47.2, 80, 81.2, 0xffcf33);
    // ruler bridge hand rails
    slopeRail('x', -40, 0, 45, 30, 93.75, 94.95, 2.4, 0xd64c3f);
    slopeRail('x', -40, 0, 45, 30, 105.05, 106.25, 2.4, 0xd64c3f);
    // window-sill lip (open where the walkway arrives)
    rail(-5, 8, 90, 92.2, -111.2, -110, 0xfbf8f2);
    rail(22, 46, 90, 92.2, -111.2, -110, 0xfbf8f2);
    rail(58, 115, 90, 92.2, -111.2, -110, 0xfbf8f2);
  }
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
