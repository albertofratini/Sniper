import * as THREE from 'three';
import { Builder, CM } from './Builder';
import { makeKit } from './Kit';
import { CollisionWorld } from '../game/Collision';
import type { PickupSpot } from './Upper';

/**
 * The high layer above the room (all in centimetres):
 *
 *   Sky Hub (135)    a construction-set plate hung from the ceiling over the rug,
 *                    with a lookout deck (151) on stilts reached by stairs
 *   Cargo plane      high-wing toy plane parked against the bookshelf; its wing
 *                    (123) bridges the upper shelf gallery to the hub stairs
 *   Red biplane      its spine (135) bridges the hub to the sky-stair tower
 *   Sky-stair tower  square spiral staircase on the bed, bed (47) -> roof (135),
 *                    with a side link from the keep roof (59)
 *   Yellow jet       the highest perch (165), ladder up from the lookout
 *   Tubes            desk (74) -> hub (135) and lookout (151) -> crow's nest (160)
 */
export function buildSkyLevels(b: Builder, world: CollisionWorld): PickupSpot[] {
  const { box, solid, parapet, rail, deck, ramp, tube, string, glowDot, vladder } = makeKit(b, world);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x * CM, y * CM, z * CM);

  const RED = 0xe8453c, BLUE = 0x3f7fd9, YEL = 0xffcf33, WHITE = 0xf4f1ea, GREEN = 0x5bbf6a, TEAL = 0x2fb3b3, ORANGE = 0xff8a1f;
  const HUBPAL = [YEL, RED, BLUE, GREEN];

  // ======================================================================= SKY HUB (135) + LOOKOUT (151)
  const HUB = 135, LOOK = 151;
  {
    // the plate: a big construction baseplate with a contrasting rim
    solid('painted', 0x8fc6ef, -28, 12, HUB - 2, HUB, 8, 52, 0.4);
    box('glossy', BLUE, -28.4, 12.4, HUB - 3.2, HUB - 2, 7.6, 52.4, 0.4, { ao: 0 });
    // tile pattern so the floor reads at a distance
    for (let x = -26; x < 10; x += 9)
      for (let z = 10; z < 50; z += 10)
        if (((x + 26) / 9 + (z - 10) / 10) % 2 === 0) box('painted', 0xa9d4f5, x, x + 9, HUB - 0.02, HUB + 0.03, z, z + 10, 0, { ao: 0, shadow: false });
    // battlements, open where routes arrive
    parapet(-28, -26.5, 8, 52, HUB, HUBPAL, [[24, 38]]);
    parapet(10.5, 12, 8, 52, HUB, HUBPAL, [[14, 22]]);
    parapet(-28, 12, 8, 9.5, HUB, HUBPAL, [[-26.5, -12.5]]);
    parapet(-28, 12, 50.5, 52, HUB, HUBPAL, [[-12, -4]]);
    // rope ladder hanging from the plate down to the rug: the quick way up
    vladder(-8, 52, 0, -1, 7, 0.5, HUB, [0xe8dcc0, 0xd64c3f, 0xffcf33], true);
    for (const [x, z] of [[-27, 9], [11, 9], [-27, 51], [11, 51]]) string(x, HUB, z);

    // lookout on four block stilts, stairs up from the plate
    for (const [x, z] of [[-16, 36], [2, 36], [-16, 48], [2, 48]]) solid('glossy', [RED, YEL, GREEN, BLUE][(x + z) & 3], x, x + 2, HUB, LOOK - 1.5, z, z + 2, 0.4);
    solid('painted', YEL, -16, 4, LOOK - 1.5, LOOK, 36, 50, 0.4);
    ramp({ axis: 'z', u0: 14, u1: 36, h0: HUB, h1: LOOK, c0: -12, c1: -4, solid: true, base: HUB, steps: 2, cols: [WHITE, 0xe9e4d8], nosing: RED, rails: [true, true], railCol: RED });
    parapet(-16, 4, 36, 37.5, LOOK, HUBPAL, [[-12, -4]]);
    parapet(2.5, 4, 37.5, 48.5, LOOK, HUBPAL);
    parapet(-16, 4, 48.5, 50, LOOK, HUBPAL);
    glowDot(-6, LOOK - 2.4, 43, 0xfff1c4);
  }

  // ======================================================================= TUBES
  // desk (74) -> hub (135): the fast, steep route up
  tube({ axis: 'z', u0: -66, u1: 8, h0: 74, h1: HUB, c: -19.5, cols: [ORANGE, YEL], inner: 0xffe2a8, hang: [-40, -10] });
  // lookout (151) -> crow's nest on the bookshelf (160): the high, hidden route
  tube({ axis: 'x', u0: -104, u1: -16, h0: 160, h1: LOOK, c: 42.5, cols: [TEAL, WHITE], inner: 0xc9f0f0, hang: [-82, -40] });

  // ======================================================================= CARGO PLANE (wing 123)
  {
    const W = 123;
    // gangway from the upper shelf gallery onto the wing
    deck(-104, -96, 26, 36, W, 0xe9c27a);
    rail(-104, -96, W - 1.5, W + 2.6, 24.8, 26, BLUE);
    rail(-104, -96, W - 1.5, W + 2.6, 36, 37.2, BLUE);
    // high wing on top of the fuselage
    solid('glossy', BLUE, -96, -46, W - 1.5, W, 24, 38, 0.6);
    box('glossy', WHITE, -96.3, -94, W - 1.6, W - 0.3, 23.7, 38.3, 0.4, { ao: 0 });
    box('glossy', WHITE, -48, -45.7, W - 1.6, W - 0.3, 23.7, 38.3, 0.4, { ao: 0 });
    // fuselage (its spine is a narrow perch fore and aft of the wing)
    solid('glossy', WHITE, -78, -68, W - 12.5, W - 1.5, 6, 62, 2);
    box('glossy', BLUE, -78.3, -67.7, W - 8, W - 6.5, 6.5, 61.5, 0.5, { ao: 0 });
    for (const z of [46, 50, 54]) box('glossy', 0x24334a, -78.4, -77.6, W - 5.5, W - 3.2, z, z + 2.6, 0.4, { ao: 0 });
    for (const z of [46, 50, 54]) box('glossy', 0x24334a, -68.4, -67.6, W - 5.5, W - 3.2, z, z + 2.6, 0.4, { ao: 0 });
    // nose + propeller
    solid('glossy', RED, -76, -70, W - 9.5, W - 3.5, 62, 64.5, 1);
    box('glossy', 0x333333, -73.6, -72.4, W - 15, W + 2, 64.6, 65.4, 0.3, { ao: 0 });
    box('glossy', 0x333333, -81, -65, W - 7.1, W - 5.9, 64.6, 65.4, 0.3, { ao: 0 });
    // tail: stabiliser flush with the spine, fin as cover
    solid('glossy', BLUE, -88, -58, W - 3, W - 1.5, 6, 13, 0.5);
    solid('glossy', RED, -74, -72, W - 1.5, W + 8, 6, 14, 0.5);
    // wing fences (open over the fuselage so you can step onto the spine)
    for (const [z0, z1] of [[22.8, 24], [38, 39.2]]) {
      rail(-96, -78, W - 1.5, W + 2, z0, z1, YEL);
      rail(-68, -46, W - 1.5, W + 2, z0, z1, YEL);
    }
    // stairs from the wing tip up to the hub
    ramp({ axis: 'x', u0: -46, u1: -28, h0: W, h1: HUB, c0: 24, c1: 38, thick: 1.5, steps: 2, cols: [WHITE, 0xe9e4d8], nosing: BLUE, rails: [true, true], railCol: YEL });
    string(-94, W, 31);
    string(-48, W, 31);
    string(-73, W + 8, 10);
    string(-73, W - 1.5, 58);
  }

  // ======================================================================= RED BIPLANE (spine 135)
  {
    // fuselage spine docks to the hub (x 12) and the tower roof (x 78)
    solid('glossy', RED, 12, 78, HUB - 9, HUB, 14, 22, 1.2);
    box('glossy', WHITE, 11.8, 78.2, HUB - 5.5, HUB - 4.2, 13.7, 22.3, 0.4, { ao: 0 });
    // handrails along the spine, open where the lower wings meet it
    for (const [z0, z1] of [[12.8, 14], [22, 23.2]]) {
      rail(14, 40, HUB - 1, HUB + 2.6, z0, z1, YEL);
      rail(54, 78, HUB - 1, HUB + 2.6, z0, z1, YEL);
    }
    // lower wings (131) either side, upper wing (146.5) as a roof on struts
    solid('glossy', YEL, 40, 54, 129.5, 131, -10, 14, 0.6);
    solid('glossy', YEL, 40, 54, 129.5, 131, 22, 46, 0.6);
    solid('glossy', YEL, 40, 54, 145, 146.5, -10, 46, 0.6);
    for (const [x, z] of [[42, -7], [50, -7], [42, 41], [50, 41]]) solid('painted', WHITE, x, x + 2, 131, 145, z, z + 2, 0.3);
    for (const [z0, z1] of [[-11.2, -10], [46, 47.2]]) rail(40, 54, 129.5, 133, z0, z1, RED);
    rail(38.8, 40, 129.5, 133, -10, 14, RED);
    rail(54, 55.2, 129.5, 133, -10, 14, RED);
    rail(38.8, 40, 129.5, 133, 22, 46, RED);
    rail(54, 55.2, 129.5, 133, 22, 46, RED);
    string(47, 146.5, -8);
    string(47, 146.5, 44);
  }

  // ======================================================================= SKY-STAIR TOWER (bed 47 -> roof 135)
  {
    const B = 47, TOP = HUB;
    const rx = 9.43, rz = 12.57; // rise of the x / z flights (44 per turn, two turns)
    const RC = BLUE;
    // core column of stacked blocks
    const cc = [RED, YEL, GREEN, BLUE, ORANGE, TEAL];
    for (let i = 0; i < 6; i++) solid('glossy', cc[i], 84, 96, B + ((TOP - 1.5 - B) * i) / 6, B + ((TOP - 1.5 - B) * (i + 1)) / 6, 20, 36, 0.6);
    let h = B;
    for (let turn = 0; turn < 2; turn++) {
      const solidBase = turn === 0;
      // stacked toy-block treads: their sides read as a colourful block wall from the bed
      const cols = turn === 0 ? [YEL, WHITE, RED, WHITE, GREEN, WHITE] : [WHITE, 0xe9e4d8];
      // south flight (+x)
      ramp({ axis: 'x', u0: 84, u1: 96, h0: h, h1: h + rx, c0: 14, c1: 20, solid: solidBase, base: B, thick: 1.5, steps: 2, cols, nosing: RC, rails: [true, false], railCol: RC });
      h += rx;
      // south-east landing (the keep-roof link arrives here on the first turn)
      if (solidBase) solid('painted', WHITE, 96, 102, B, h, 14, 20, 0.3);
      else deck(96, 102, 14, 20, h, WHITE, 'painted');
      if (turn === 1) rail(96, 102, h - 1.5, h + 3, 12.75, 13.95, RC);
      rail(102.05, 103.25, h - 1.5, h + 3, 14, 20, RC);
      // east flight (+z)
      ramp({ axis: 'z', u0: 20, u1: 36, h0: h, h1: h + rz, c0: 96, c1: 102, solid: solidBase, base: B, thick: 1.5, steps: 2, cols, nosing: RC, rails: [false, true], railCol: RC });
      h += rz;
      if (solidBase) solid('painted', WHITE, 96, 102, B, h, 36, 42, 0.3);
      else deck(96, 102, 36, 42, h, WHITE, 'painted');
      rail(102.05, 103.25, h - 1.5, h + 3, 36, 43.25, RC);
      rail(96, 102.05, h - 1.5, h + 3, 42.05, 43.25, RC);
      // north flight (-x)
      ramp({ axis: 'x', u0: 84, u1: 96, h0: h + rx, h1: h, c0: 36, c1: 42, solid: solidBase, base: B, thick: 1.5, steps: 2, cols, nosing: RC, rails: [false, true], railCol: RC });
      h += rx;
      if (solidBase) solid('painted', WHITE, 78, 84, B, h, 36, 42, 0.3);
      else deck(78, 84, 36, 42, h, WHITE, 'painted');
      rail(76.75, 77.95, h - 1.5, h + 3, 36, 43.25, RC);
      rail(77.95, 84, h - 1.5, h + 3, 42.05, 43.25, RC);
      // west flight (-z)
      ramp({ axis: 'z', u0: 20, u1: 36, h0: h + rz, h1: h, c0: 78, c1: 84, solid: solidBase, base: B, thick: 1.5, steps: 2, cols, nosing: RC });
      // its outer rail stops short of the biplane dock on the top turn
      {
        const z0 = turn === 1 ? 22.5 : 20;
        const n = 6;
        const surf = (z: number) => h + rz * (36 - z) / 16;
        for (let i = 0; i < n; i++) {
          const za = z0 + ((36 - z0) * i) / n, zb = z0 + ((36 - z0) * (i + 1)) / n;
          rail(76.75, 77.95, Math.min(surf(za), surf(zb)) - 1.8, Math.max(surf(za), surf(zb)) + 3, za, zb, RC);
        }
      }
      h += rz;
      // south-west landing (the first-turn one is a slab over the entrance)
      if (turn === 0) {
        deck(78, 84, 14, 20, h, WHITE, 'painted');
        rail(76.75, 84, h - 1.5, h + 3, 12.75, 13.95, RC);
        rail(76.75, 77.95, h - 1.5, h + 3, 13.95, 20, RC);
      }
    }
    // roof deck (135) with a stairwell opening over the last flight
    deck(78, 102, 14, 20, TOP, 0x8fc6ef, 'painted');
    deck(84, 102, 20, 42, TOP, 0x8fc6ef, 'painted');
    deck(78, 84, 36, 42, TOP, 0x8fc6ef, 'painted');
    // (starts a little past the stair top so the walkway round to the biplane dock is roomy)
    rail(84.05, 85.25, TOP, TOP + 2.6, 22.5, 36, RC);
    rail(78, 85.25, TOP, TOP + 2.6, 36.05, 37.25, RC);
    parapet(100.5, 102, 14, 42, TOP, HUBPAL);
    parapet(78, 102, 40.5, 42, TOP, HUBPAL);
    // closed on the south side: the last flight arrives heading this way
    parapet(78, 102, 14, 15.5, TOP, HUBPAL);
    // keep roof (59) -> first landing (56.4)
    ramp({ axis: 'z', u0: 0, u1: 14, h0: 59, h1: B + rx, c0: 96, c1: 102, thick: 1.5, kind: 'wood', cols: [0xe9c27a, 0xdcb075], rails: [true, true], railCol: RC });
  }

  // ======================================================================= YELLOW JET (165)
  {
    const J = 165;
    vladder(-6, 48.5, 0, 1, 7, LOOK, J, [YEL, RED, WHITE]);
    solid('glossy', YEL, -10, -2, J - 8, J, 60, 112, 2);
    solid('glossy', WHITE, -9, -3, J - 7, J - 1, 112, 116, 2);
    for (const z of [100, 104]) box('glossy', 0x24334a, -10.4, -1.6, J - 4, J - 2.2, z, z + 3, 0.4, { ao: 0 });
    solid('glossy', YEL, -45, 35, J - 1.5, J, 84, 98, 0.6);
    // tailplane reaches back over the lookout so the ladder can climb to it
    solid('glossy', YEL, -20, 8, J - 1.5, J, 48.5, 66, 0.5);
    // twin tail fins double as rails at the back
    solid('glossy', RED, -11.2, -10, J - 1.5, J + 7, 60, 68, 0.3);
    solid('glossy', RED, -2, -0.8, J - 1.5, J + 7, 60, 68, 0.3);
    for (const [x0, x1] of [[-45, -10], [-2, 35]]) {
      rail(x0, x1, J - 1.5, J + 2, 82.8, 84, RED);
      rail(x0, x1, J - 1.5, J + 2, 98, 99.2, RED);
    }
    for (const [z0, z1] of [[68, 84], [98, 112]]) {
      rail(-11.2, -10, J - 1.5, J + 2.4, z0, z1, RED);
      rail(-2, -0.8, J - 1.5, J + 2.4, z0, z1, RED);
    }
    rail(-21.2, -20, J - 1.5, J + 2, 48.5, 66, RED);
    rail(8, 9.2, J - 1.5, J + 2, 48.5, 66, RED);
    rail(-20, -10.2, J - 1.5, J + 2, 47.3, 48.5, RED);
    rail(-1.8, 8, J - 1.5, J + 2, 47.3, 48.5, RED);
    rail(-46.2, -45, J - 1.5, J + 2, 82.8, 99.2, RED);
    rail(35, 36.2, J - 1.5, J + 2, 82.8, 99.2, RED);
    string(-42, J, 91);
    string(32, J, 91);
    string(-6, J, 108);
  }

  return [
    { pos: v(-8, HUB + 1, 24), kind: 'health', respawn: 20 },
    { pos: v(-22, HUB + 1, 44), kind: 'flash', respawn: 22 },
    { pos: v(-6, LOOK + 1, 43), kind: 'ammo', respawn: 15 },
    { pos: v(-73, 123, 58), kind: 'frag', respawn: 25 },
    { pos: v(47, 132, 36), kind: 'ammo', respawn: 15 },
    { pos: v(93, HUB + 1, 38), kind: 'health', respawn: 20 },
    { pos: v(-36, 166, 91), kind: 'health', respawn: 20 },
    { pos: v(26, 166, 91), kind: 'frag', respawn: 25 },
  ];
}
