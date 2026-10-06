import * as THREE from 'three';
import { Builder, CM, scaleUV } from './Builder';
import { Materials } from './Materials';
import * as T from './Textures';
import { CollisionWorld } from '../game/Collision';
import { buildUpperLevels } from './Upper';
import { buildSkyLevels } from './Sky';

// All authoring below is in centimetres. Room interior:
// x [-134.4, 134.4], z [-120, 120], y [0, 240]  (== ROOM in world units)
const RX = 134.4, RZ = 120, RH = 240;
const WIN = { x0: -5, x1: 115, y0: 90, y1: 210 };

export const SUN_DIR = new THREE.Vector3(-0.38, -0.78, 0.5).normalize();

export interface BedroomInfo {
  group: THREE.Group;
  spawnPoints: THREE.Vector3[];
  bossSpawn: THREE.Vector3;
  playerSpawn: THREE.Vector3;
  playerYaw: number;
  train: THREE.Group;
  trainPath: (t: number, out: THREE.Vector3) => THREE.Vector3;
  motes: THREE.Points;
  dynamicSpots: { pos: THREE.Vector3; kind: string; color: number }[];
  pickupSpots: { pos: THREE.Vector3; kind: 'health' | 'ammo' | 'frag' | 'flash' | 'minigun'; respawn: number }[];
  /** spread-out spawn points for players in multiplayer */
  playerSpawns: THREE.Vector3[];
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x * CM, y * CM, z * CM);

export function buildBedroom(mats: Materials, world: CollisionWorld): BedroomInfo {
  const b = new Builder(mats, world);
  const rnd = T.rand(1234);

  // ------------------------------------------------------------------ floor / walls
  const floorTex = T.woodFloor();
  floorTex.repeat.set(2.2, 2.2);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.5, metalness: 0, envMapIntensity: 0.6 });
  b.mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2), floorMat, [0, 0, 0], [-Math.PI / 2, 0, 0], { shadow: false });

  const wallTex = T.wallpaper();
  wallTex.repeat.set(4, 3);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0, envMapIntensity: 0.4 });
  const wall = (w: number, h: number, pos: [number, number, number], rotY: number, uvx = 1, uvy = 1) => {
    const g = new THREE.BoxGeometry(w, h, 6);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvx, uv.getY(i) * uvy);
    b.mesh(g, wallMat, pos, [0, rotY, 0]);
  };
  // back wall around window
  wall(WIN.x0 + RX, RH, [(-RX + WIN.x0) / 2, RH / 2, -RZ - 3], 0, (WIN.x0 + RX) / 270, 1);
  wall(RX - WIN.x1, RH, [(WIN.x1 + RX) / 2, RH / 2, -RZ - 3], 0, (RX - WIN.x1) / 270, 1);
  wall(WIN.x1 - WIN.x0, WIN.y0, [(WIN.x0 + WIN.x1) / 2, WIN.y0 / 2, -RZ - 3], 0, 120 / 270, WIN.y0 / RH);
  wall(WIN.x1 - WIN.x0, RH - WIN.y1, [(WIN.x0 + WIN.x1) / 2, (WIN.y1 + RH) / 2, -RZ - 3], 0, 120 / 270, (RH - WIN.y1) / RH);
  wall(RX * 2, RH, [0, RH / 2, RZ + 3], Math.PI);
  wall(RZ * 2, RH, [-RX - 3, RH / 2, 0], Math.PI / 2);
  wall(RZ * 2, RH, [RX + 3, RH / 2, 0], -Math.PI / 2);
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf3ece2, roughness: 0.95 });
  b.mesh(new THREE.BoxGeometry(RX * 2 + 12, 6, RZ * 2 + 12), ceilMat, [0, RH + 3, 0], [0, 0, 0], { shadow: true });

  // baseboards
  const bb = 0xf7f3ea;
  b.box('painted', bb, -RX, RX, 0, 9, -RZ, -RZ + 1.6, 0.4, { ao: 0.3, collide: true });
  b.box('painted', bb, -RX, RX, 0, 9, RZ - 1.6, RZ, 0.4, { ao: 0.3, collide: true });
  b.box('painted', bb, -RX, -RX + 1.6, 0, 8.8, -RZ + 1.6, RZ - 1.6, 0.4, { ao: 0.3, collide: true });
  b.box('painted', bb, RX - 1.6, RX, 0, 8.8, -RZ + 1.6, RZ - 1.6, 0.4, { ao: 0.3, collide: true });

  // window frame, sill, mullions
  const frame = 0xfbf8f2;
  b.box('painted', frame, WIN.x0 - 6, WIN.x1 + 6, WIN.y0 - 4, WIN.y0, -RZ - 2, -RZ + 9, 1, { collide: true });
  b.box('painted', frame, WIN.x0 - 6, WIN.x1 + 6, WIN.y1, WIN.y1 + 6, -RZ - 2, -RZ + 3, 1);
  b.box('painted', frame, WIN.x0 - 6, WIN.x0, WIN.y0, WIN.y1, -RZ - 2, -RZ + 3, 1, { collide: true });
  b.box('painted', frame, WIN.x1, WIN.x1 + 6, WIN.y0, WIN.y1, -RZ - 2, -RZ + 3, 1, { collide: true });
  const mx = (WIN.x0 + WIN.x1) / 2, my = (WIN.y0 + WIN.y1) / 2;
  b.box('painted', frame, mx - 2, mx + 2, WIN.y0, WIN.y1, -RZ - 4, -RZ - 1, 0.5);
  b.box('painted', frame, WIN.x0, WIN.x1, my - 2, my + 2, -RZ - 4, -RZ - 1, 0.5);
  // sill plant pot
  b.with([WIN.x0 + 20, WIN.y0, -RZ + 3], [0, 0, 0], () => {
    b.part(new THREE.CylinderGeometry(7, 5.5, 11, 16), 'matte', 0xd9774a, [0, 5.5, 0]);
    b.part(new THREE.SphereGeometry(8, 12, 10), 'matte', 0x3f9a45, [0, 16, 0]);
    b.part(new THREE.SphereGeometry(5, 10, 8), 'matte', 0x56b55a, [4, 22, 2]);
    b.collider(-7, 7, 0, 22, -5, 7);
  });

  // sky outside
  const skyMat = new THREE.MeshBasicMaterial({ map: T.sky(), color: new THREE.Color(1.6, 1.55, 1.45), fog: false });
  b.mesh(new THREE.PlaneGeometry(480, 300), skyMat, [mx, 150, -RZ - 120], [0, 0, 0], { shadow: false });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.12, envMapIntensity: 1.5, depthWrite: false });
  b.mesh(new THREE.PlaneGeometry(WIN.x1 - WIN.x0, WIN.y1 - WIN.y0), glassMat, [mx, my, -RZ - 2.5], [0, 0, 0], { shadow: false });

  // curtains + rod
  b.part(new THREE.CylinderGeometry(1.2, 1.2, 190, 10), 'metal', 0xc8a050, [mx, WIN.y1 + 14, -RZ + 6], [0, 0, Math.PI / 2]);
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0xff9a7a, map: mats.fabricMap, roughness: 0.95, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(36, 150, 28, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 0.55) * 3.2);
    g.computeVertexNormals();
    scaleUV(g, 3);
    const cx = side < 0 ? WIN.x0 - 22 : WIN.x1 + 22;
    b.mesh(g, curtainMat, [cx, WIN.y1 + 14 - 75, -RZ + 7], [0, 0, 0]);
  }

  // outlets
  const outlet = (x: number, z: number, rotY: number, nightLight = false) =>
    b.with([x, 30, z], [0, rotY, 0], () => {
      b.box('glossy', 0xf6f3ec, -4.5, 4.5, -7, 7, 0, 1.2, 0.8, { collide: true });
      if (nightLight) b.collider(-3.5, 3.5, -1, 10.5, 0, 6);
      for (const oy of [-3, 3]) {
        b.box('rubber', 0x2a2a2a, -1.6, -0.8, oy - 1.2, oy + 1, 1, 1.4, 0);
        b.box('rubber', 0x2a2a2a, 0.8, 1.6, oy - 1.2, oy + 1, 1, 1.4, 0);
      }
      if (nightLight) {
        b.box('glossy', 0xffffff, -3.5, 3.5, -1, 7, 1.2, 4, 1.2);
        b.part(new THREE.SphereGeometry(3.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 'glow', 0xffd27a, [0, 7, 2.6], [0, 0, 0], { shadow: false });
      }
    });
  outlet(-RX, -45, Math.PI / 2, true);
  outlet(RX, 100, -Math.PI / 2);
  outlet(-60, RZ, Math.PI);

  // ------------------------------------------------------------------ desk (back-left)
  const deskWhite = 0xf2efe8, deskTop = 0xd9a46a;
  b.box('wood', deskTop, -134, -12, 70, 74, -120, -58, 1.2, { collide: true });
  b.box('painted', deskWhite, -134, -94, 0, 70, -118, -62, 1, { collide: true });
  for (let i = 0; i < 3; i++) {
    const y0 = 4 + i * 22;
    b.box('painted', 0x8fc6ef, -132, -96, y0, y0 + 20, -62, -60, 1.2, { collide: true });
    b.part(new THREE.SphereGeometry(2.2, 12, 8), 'glossy', 0xffcf33, [-114, y0 + 10, -58.5]);
  }
  for (const z of [-118, -65]) b.box('painted', deskWhite, -19, -14, 0, 70, z, z + 5, 1.2, { collide: true });
  b.box('painted', deskWhite, -19, -14, 8, 12, -113, -65, 1, { collide: true }); // foot rail (you can walk under it)
  // on desk: lamp
  b.with([-40, 74, -100], [0, 0.5, 0], () => {
    b.part(new THREE.CylinderGeometry(9, 10, 2.5, 24), 'glossy', 0x3fa9ff, [0, 1.25, 0]);
    b.part(new THREE.CylinderGeometry(1, 1, 30, 10), 'metal', 0xdddddd, [0, 15, 0], [0, 0, -0.35]);
    b.part(new THREE.CylinderGeometry(1, 1, 26, 10), 'metal', 0xdddddd, [10, 38, 0], [0, 0, 1.0]);
    b.part(new THREE.ConeGeometry(9, 12, 24, 1, false), 'glossy', 0x3fa9ff, [24, 40, 0], [0, 0, 2.2]);
    b.part(new THREE.SphereGeometry(4, 12, 10), 'glow', 0xfff1c4, [26, 37, 0], [0, 0, 0], { shadow: false });
  });
  b.collider(-47, -33, 74, 76.5, -107, -93);
  b.collider(-42, -36, 76.5, 100, -102, -96);
  // lamp cable down to floor
  {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-46, 75, -112), new THREE.Vector3(-30, 74, -118), new THREE.Vector3(-20, 60, -119),
      new THREE.Vector3(-22, 20, -119), new THREE.Vector3(-30, 0.8, -110), new THREE.Vector3(-60, 0.8, -100),
      new THREE.Vector3(-88, 0.8, -90), new THREE.Vector3(-110, 0.8, -80), new THREE.Vector3(-132, 30, -45),
    ]);
    b.part(new THREE.TubeGeometry(curve, 80, 0.7, 6), 'rubber', 0xeeeeee, [0, 0, 0], [0, 0, 0], { ao: 0.2 });
  }
  // pencil cup (a pillar of cover on the desk)
  b.collider(-79.5, -70.5, 74, 85, -109.5, -100.5);
  b.with([-75, 74, -105], [0, 0, 0], () => {
    b.part(new THREE.CylinderGeometry(4.5, 4, 11, 16, 1, false), 'glossy', 0xff6fa8, [0, 5.5, 0]);
    b.part(new THREE.CylinderGeometry(4, 4, 0.6, 16), 'glossy', 0xff6fa8, [0, 0.3, 0]);
    [0xffcf33, 0x3fa9ff, 0x7bd35a, 0xff4d3d].forEach((c, i) => {
      b.part(new THREE.CylinderGeometry(0.45, 0.45, 18, 6), 'painted', c, [Math.cos(i * 1.7) * 2, 10, Math.sin(i * 1.7) * 2], [Math.cos(i) * 0.15, 0, Math.sin(i) * 0.15]);
    });
  });
  // corkboard + drawings over desk
  b.box('cardboard', 0xc4935e, -125, -35, 108, 170, -120, -118.5, 1);
  b.box('painted', 0x8a5a32, -126, -34, 106, 108, -120, -118, 0.5);
  b.box('painted', 0x8a5a32, -126, -34, 170, 172, -120, -118, 0.5);
  const drawingGeo = new THREE.PlaneGeometry(32, 24);
  [0, 1].forEach((k) => {
    const m = mats.textured('drawing' + k, () => T.drawing(k), { roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    b.mesh(drawingGeo, m, [-104 + k * 46, 140 + (k ? -3 : 4), -118.44], [0, 0, (k ? 1 : -1) * 0.06], { shadow: false });
  });

  // ------------------------------------------------------------------ chair
  b.with([-58, 0, -35], [0, 0, 0], () => {
    const red = 0xe8453c;
    b.box('painted', red, -21, 21, 43, 46.5, -20, 20, 2, { collide: true });
    for (const [x, z] of [[-18, -17], [15, -17], [-18, 14], [15, 14]]) {
      b.box('painted', red, x, x + 3, 1.5, 43, z, z + 3, 0.8, { collide: true });
      b.box('rubber', 0x222222, x - 0.2, x + 3.2, 0, 1.5, z - 0.2, z + 3.2, 0.3);
    }
    b.box('painted', red, -18, -15, 46, 92, 15, 18, 0.8, { collide: true });
    b.box('painted', red, 15, 18, 46, 92, 15, 18, 0.8, { collide: true });
    b.box('painted', 0xffcf33, -19, 19, 66, 90, 15.5, 18.5, 1.5, { collide: true });
    b.box('painted', red, -16, 16, 20, 23, -15, -12, 0.6, { collide: true });
  });

  // ------------------------------------------------------------------ bed (back-right)
  const bedFrame = 0x9ec9f0;
  b.box('painted', bedFrame, 30, 130, 18, 30, -118, 82, 1.5, { collide: true });
  for (const [x, z] of [[30, -118], [124, -118], [30, 76], [124, 76]]) b.box('painted', bedFrame, x, x + 6, 0, 18, z, z + 6, 1.2, { collide: true });
  b.box('fabric', 0xf4f1ea, 31, 129, 30, 44, -116, 81, 5, { collide: true });
  // quilt (textured) on top + drapes
  const quiltMat = new THREE.MeshStandardMaterial({ map: T.quilt(), roughness: 0.95, envMapIntensity: 0.3 });
  quiltMat.map!.repeat.set(1, 2);
  b.mesh(new THREE.BoxGeometry(102, 3, 150), quiltMat, [80, 45.5, 8], [0, 0, 0], { collide: true });
  b.mesh(new THREE.BoxGeometry(2, 15.4, 150.8), quiltMat, [28.5, 38.7, 8], [0, 0, 0.05]);
  b.mesh(new THREE.BoxGeometry(101.4, 15.4, 2), quiltMat, [80.2, 38.7, 83.5], [0.05, 0, 0]);
  // side drape: leave a gap where the ramp meets the bed
  b.collider(27.5, 30, 31, 47, -67, -17.5);
  b.collider(27.5, 30, 31, 47, 1.5, 83);
  b.collider(29, 131, 31, 47, 82, 84.5);
  // pillow
  b.box('fabric', 0xffffff, 40, 120, 44, 56, -112, -82, 6, { collide: true });
  // headboard
  b.box('painted', bedFrame, 28, 132, 0, 82, -120, -115, 2, { collide: true });
  b.box('painted', 0xffcf33, 34, 126, 70, 76, -116, -114, 1.5);
  for (let i = 0; i < 6; i++) {
    b.part(new THREE.SphereGeometry(3, 12, 8), 'glossy', [0xff4d3d, 0x7bd35a, 0xffcf33][i % 3], [42 + i * 16, 62, -114.5]);
    b.collider(39.5 + i * 16, 44.5 + i * 16, 59.5, 64.5, -116, -111.6);
  }
  b.collider(34, 126, 70, 76, -116, -114);
  // plush on the bed
  plush(b, [100, 47, 62], [0, 2.8, 0], 0.55, 0xb98a5e);

  // under-bed clutter
  b.with([70, 0, -40], [0, 0.6, 0], () => dino(b));
  sock(b, [55, 0, 30], 0.4, 0x6fc3ff);
  b.box('cardboard', 0xc79a64, 90, 122, 0, 14, -10, 20, 0.6, { collide: true });
  b.box('cardboard', 0xb88a55, 89, 123, 14, 15, -11, 21, 0.4);

  // drawings on right wall above bed
  [2, 0, 1].forEach((k, i) => {
    const m = mats.textured('drawing' + k, () => T.drawing(k), { roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    b.mesh(drawingGeo, m, [RX - 0.04, 118 + (i % 2) * 10, -70 + i * 45], [0, -Math.PI / 2, (i - 1) * 0.07], { shadow: false });
  });

  // ------------------------------------------------------------------ race-track ramp (bed -> floor)
  {
    const top = new THREE.Vector3(30, 46.6, -8);
    const bot = new THREE.Vector3(-60, 0, -8);
    const dx = top.x - bot.x, dy = top.y - bot.y;
    const len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const mid = top.clone().add(bot).multiplyScalar(0.5);
    // one closed solid wedge (no overlapping faces, nothing to see through from any side)
    {
      const shape = new THREE.Shape([new THREE.Vector2(bot.x, 0), new THREE.Vector2(top.x, 0), new THREE.Vector2(top.x, top.y)]);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 15, bevelEnabled: false });
      g.translate(0, 0, top.z - 7.5);
      scaleUV(g, 1 / 40);
      b.part(g, 'glossy', 0xff8a1f, [0, 0, 0], [0, 0, 0], { ao: 0.45 });
    }
    b.with([mid.x, mid.y, mid.z], [0, 0, ang], () => {
      // rails sit on the deck, slightly proud of the wedge sides so faces never coincide
      // rails: high enough that sprinting never spills you off, low enough to hop over (jump is 4.9 cm)
      b.box('glossy', 0xf27512, -len / 2, len / 2, -0.6, 3.1, -7.9, -6.2, 0.5, { ao: 0 });
      b.box('glossy', 0xf27512, -len / 2, len / 2, -0.6, 3.1, 6.2, 7.9, 0.5, { ao: 0 });
      b.box('glossy', 0xffcf33, -len / 2, len / 2, 3.0, 3.9, -8.1, -6.0, 0.4, { ao: 0 });
      b.box('glossy', 0xffcf33, -len / 2, len / 2, 3.0, 3.9, 6.0, 8.1, 0.4, { ao: 0 });
      for (let i = -4; i <= 4; i++) b.box('painted', 0xffffff, i * 11 - 0.6, i * 11 + 0.6, 0.02, 0.2, -0.6, 0.6, 0, { ao: 0 });
    });
    // wall colliders following the slope (world units)
    const segs = 30;
    for (let i = 0; i < segs; i++) {
      const xa = bot.x + (dx * i) / segs, xb = bot.x + (dx * (i + 1)) / segs;
      const yb = bot.y + (dy * (i + 1)) / segs;
      for (const [z0, z1] of [[top.z - 7.8, top.z - 6.2], [top.z + 6.2, top.z + 7.8]]) {
        world.add(xa * CM, 0, z0 * CM, xb * CM, (yb + 4.4) * CM, z1 * CM).wall = true;
      }
    }
    // smooth sloped walking surface (world units)
    world.addRamp({
      minX: bot.x * CM, maxX: top.x * CM, minZ: (top.z - 6.2) * CM, maxZ: (top.z + 6.2) * CM,
      // solid wedge down to the floor: nothing can get underneath and get trapped
      axis: 'x', u0: bot.x * CM, u1: top.x * CM, h0: bot.y * CM, h1: top.y * CM, thick: 1000,
    });
  }

  // ------------------------------------------------------------------ bookshelf (left wall)
  {
    const wood = 0xf6e8cf;
    const x0 = -134, x1 = -104, z0 = -30, z1 = 50;
    b.box('wood', wood, x0, x1, 0, 3, z0, z1, 0.5);
    b.box('wood', wood, x0, x1, 0, 160, z0, z0 + 3, 0.8);
    b.box('wood', wood, x0, x1, 0, 160, z1 - 3, z1, 0.8);
    b.box('wood', 0xe9d5b0, x0, x0 + 1.5, 0, 160, z0, z1, 0);
    for (const y of [40, 80]) b.box('wood', wood, x0, x1 - 0.5, y, y + 3, z0 + 0.4, z1 - 0.4, 0.6);
    // upper shelf and top board each have a stairwell opening at the back
    b.box('wood', wood, -121, x1 - 0.5, 120, 123, z0 + 0.4, z1 - 0.4, 0.6);
    b.box('wood', wood, x0, -121, 120, 123, z0 + 0.4, 28, 0.6);
    b.box('wood', wood, -121, x1 - 0.5, 157, 160, z0 + 0.4, z1 - 0.4, 0.6);
    b.box('wood', wood, x0, -121, 157, 160, -10, z1 - 0.4, 0.6);
    // the two lower compartments are packed solid with books; the upper two are galleries
    b.collider(x0, x1, 0, 83, z0, z1);
    b.collider(x0, x1, 83, 160, z0, z0 + 3);
    b.collider(x0, x1, 83, 160, z1 - 3, z1);
    b.collider(x0, x0 + 1.5, 83, 160, z0 + 3, z1 - 3);
    b.collider(-121, x1, 120, 123, z0 + 3, z1 - 3);
    b.collider(x0 + 1.5, -121, 120, 123, z0 + 3, 28);
    b.collider(-121, x1, 157, 160, z0 + 3, z1 - 3);
    b.collider(x0 + 1.5, -121, 157, 160, -10, z1 - 3);
    const bookCols = [0xe35d4f, 0x3f7fd9, 0xf2c84b, 0x5bbf6a, 0x9b59d0, 0xff8f3f, 0x2fb3b3, 0xf06292, 0x1e2a5a];
    for (const y of [3, 43]) {
      let z = z0 + 4;
      while (z < z1 - 8) {
        const w = 2.5 + rnd() * 3.5, h = 22 + rnd() * 12, d = 18 + rnd() * 6;
        const col = bookCols[Math.floor(rnd() * bookCols.length)];
        const lean = rnd() < 0.08 ? 0.25 : 0;
        b.with([x1 - d / 2 - 1, y, z + w / 2], [lean, 0, 0], () => {
          b.box('painted', col, -d / 2, d / 2, 0, h, -w / 2, w / 2, 0.5);
          b.box('painted', rnd() < 0.5 ? 0xf2d27a : 0xffffff, d / 2, d / 2 + 0.2, h * 0.72, h * 0.78, -w / 2 + 0.4, w / 2 - 0.4, 0);
        });
        z += w + 0.3;
        if (rnd() < 0.08) z += 6;
      }
    }
    // toys on the upper shelf and on top (cover for the galleries)
    b.with([-110, 123, 0], [0, 0, 0], () => robotFigure(b));
    b.collider(-115, -105, 123, 154, -4, 4);
    b.with([-112.5, 123, -18], [0, 0, 0], () => {
      b.part(new THREE.SphereGeometry(7, 20, 14), 'glossy', 0xffd400, [0, 7, 0]);
      b.part(new THREE.SphereGeometry(4.6, 18, 12), 'glossy', 0xffd400, [0, 16, 2]);
      b.part(new THREE.ConeGeometry(2, 4, 12), 'glossy', 0xff8a1f, [0, 15.5, 7], [Math.PI / 2, 0, 0]);
      b.part(new THREE.SphereGeometry(0.9, 8, 6), 'glossy', 0x111111, [2, 17.5, 5.6]);
      b.part(new THREE.SphereGeometry(0.9, 8, 6), 'glossy', 0x111111, [-2, 17.5, 5.6]);
      b.collider(-6.5, 6.5, 0, 20.5, -6.5, 9);
    });
    b.with([-118, 160, 10], [0, 0, 0], () => {
      b.part(new THREE.CylinderGeometry(7, 7, 3, 20), 'wood', 0x7a4a2a, [0, 1.5, 0]);
      b.part(new THREE.SphereGeometry(10, 24, 16), 'glossy', 0x4aa8e8, [0, 13, 0]);
      b.part(new THREE.TorusGeometry(11, 0.6, 6, 24, Math.PI), 'metal', 0xd8b25a, [0, 13, 0], [0, Math.PI / 2, 0]);
      b.collider(-8, 8, 0, 22, -8, 8);
    });
  }

  // ------------------------------------------------------------------ toy chest (front-left)
  {
    const x0 = -110, x1 = -40, z0 = 80, z1 = 118;
    b.box('wood', 0xd64c3f, x0, x1, 0, 45, z0, z1, 2, { collide: true });
    b.box('painted', 0xffcf33, x0 - 0.5, x1 + 0.5, 4, 8, z0 - 0.5, z1 + 0.5, 1);
    b.box('painted', 0xffcf33, x0 - 0.5, x1 + 0.5, 38, 42, z0 - 0.5, z1 + 0.5, 1);
    // the chest is stuffed to the brim: a flat mosaic of toy blocks you can stand on
    {
      const cols = [0xff4d3d, 0x3fa9ff, 0xffcf33, 0x7bd35a, 0xffffff, 0xff8a1f, 0x9b59d0];
      const nx = 12, nz = 6;
      const sx = (x1 - x0 - 4) / nx, sz = (z1 - z0 - 4) / nz;
      for (let i = 0; i < nx; i++)
        for (let k = 0; k < nz; k++) {
          const bx = x0 + 2 + i * sx, bz = z0 + 2 + k * sz;
          b.box('glossy', cols[(i * 5 + k * 3 + ((i * k) % 4)) % cols.length], bx + 0.15, bx + sx - 0.15, 41, 45.05, bz + 0.15, bz + sz - 0.15, 0.6, { ao: 0, shadow: false });
        }
    }
    // lid open against wall
    b.with([0, 45, z1], [1.45, 0, 0], () => {
      b.box('wood', 0xd64c3f, x0, x1, 0, 3, -38, 0, 1.5, { collide: true });
      b.box('painted', 0xffcf33, x0 + 6, x1 - 6, 3, 3.5, -32, -6, 0.5);
    });
    const starMat = mats.textured('sticker-star', () => T.stickerTex('star'), { transparent: true, roughness: 0.4, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    b.mesh(new THREE.CircleGeometry(9, 24), starMat, [(x0 + x1) / 2, 23, z0 - 0.04], [0, Math.PI, 0], { shadow: false });
    // toys peeking out
    b.part(new THREE.SphereGeometry(9, 18, 14), 'glossy', 0x3fa9ff, [-55, 46, 110], [0, 0, 0], { collide: true });
    b.part(new THREE.TorusGeometry(6, 1.6, 10, 20), 'glossy', 0xff4d3d, [-75, 46.6, 108], [Math.PI / 2, 0, 0]);
    for (const [x0, x1, z0, z1] of [[-82.6, -67.4, 100.4, 103.6], [-82.6, -67.4, 112.4, 115.6], [-82.6, -79.4, 103.6, 112.4], [-70.6, -67.4, 103.6, 112.4]])
      b.collider(x0, x1, 45, 48.2, z0, z1);
  }

  // ------------------------------------------------------------------ overturned crate (front)
  b.with([20, 0, 101], [0, 0, 0], () => {
    const c = 0x3fa9ff;
    const W = 20, D = 15, H = 30;
    b.box('glossy', c, -W, W, 0, 2, -D, D, 0.6, { collide: true });
    b.box('glossy', c, -W, W, H - 2, H, -D, D, 0.6, { collide: true });
    b.box('glossy', c, -W, -W + 2, 0, H, -D, D, 0.6, { collide: true });
    b.box('glossy', c, W - 2, W, 0, H, -D, D, 0.6, { collide: true });
    b.box('glossy', c, -W, W, 0, H, D - 2, D, 0.6, { collide: true });
    for (let i = -2; i <= 2; i++) b.box('glossy', 0x2f8be0, i * 7 - 2, i * 7 + 2, H, H + 0.4, -12, 12, 0.3);
    // spilled blocks
    b.part(new THREE.SphereGeometry(4, 14, 10), 'glossy', 0xffcf33, [-10, 6, -4]);
  });

  // ------------------------------------------------------------------ high route: block stairs -> crate top -> ruler bridge -> toy chest
  {
    // stairs of stacked wooden blocks from the board game up to the crate top (30 cm)
    const stepCols = [0xe8c48a, 0xd64c3f, 0x3f7fd9, 0xf2c84b, 0x5bbf6a, 0x9b59d0];
    // treads at the height of a smooth ramp (crate edge 30 -> floor), so you just walk up
    const heights = [27.35, 22.38, 17.41, 12.44, 7.47, 2.5];
    heights.forEach((hgt, k) => {
      const xa = 40.2 + k * 6, xb = xa + 6;
      let y = 0, n = 0;
      while (y < hgt - 0.01) {
        const top = Math.min(hgt, y + 5);
        b.box('wood', stepCols[(k * 4 + n * 3 + (n === 0 ? 0 : k)) % stepCols.length], xa + 0.05, xb - 0.05, y + 0.02, top, 90, 112, 0.35, { ao: n === 0 ? 0.55 : 0.1 });
        y = top;
        n++;
      }
    });
    world.addRamp({ minX: 40 * CM, maxX: 76.2 * CM, minZ: 90 * CM, maxZ: 112 * CM, axis: 'x', u0: 40 * CM, u1: 76.2 * CM, h0: 30 * CM, h1: 0, thick: 1000 });
    for (const [z0, z1] of [[88.75, 89.95], [112.05, 113.25]]) {
      for (let i = 0; i < 6; i++) {
        const xa = 40.2 + i * 6, xb = xa + 6;
        const top = heights[i] + 2.6;
        b.box('glossy', i % 2 ? 0xffcf33 : 0xff4d3d, xa + 0.05, xb - 0.05, 0, top, z0, z1, 0.4, { ao: 0.3 });
        world.add(xa * CM, 0, z0 * CM, xb * CM, top * CM, z1 * CM).wall = true;
      }
    }
    // wooden ruler bridge from the crate top (x 0, 30 cm) up to the toy chest lid edge (x -40, 45 cm)
    const A = new THREE.Vector3(-40, 45, 100), B = new THREE.Vector3(0, 30, 100);
    const rl = A.distanceTo(B), ra = Math.atan2(B.y - A.y, B.x - A.x);
    const rm = A.clone().add(B).multiplyScalar(0.5);
    b.with([rm.x, rm.y, rm.z], [0, 0, ra], () => {
      b.box('wood', 0xe9c27a, -rl / 2 - 1.5, rl / 2 + 1.5, -1.2, 0, -5, 5, 0.25, { ao: 0 });
      for (let cm = 0; cm <= 40; cm++) {
        const big = cm % 5 === 0;
        const x = -rl / 2 + 1 + cm * ((rl - 2) / 40);
        b.box('painted', 0x2a2420, x - 0.08, x + 0.08, 0.01, 0.06, 5 - (big ? 3 : 1.6), 4.9, 0, { ao: 0 });
      }
    });
    world.addRamp({
      minX: A.x * CM, maxX: B.x * CM, minZ: 95 * CM, maxZ: 105 * CM,
      axis: 'x', u0: A.x * CM, u1: B.x * CM, h0: A.y * CM, h1: B.y * CM, thick: 1.2 * CM,
    });
  }

  // ------------------------------------------------------------------ dump truck
  b.with([-2, 0, -40], [0, 0.15, 0], () => truck(b));

  // ------------------------------------------------------------------ cereal box
  {
    const tex = T.cerealBox();
    const side = new THREE.MeshStandardMaterial({ color: 0xffa53a, map: mats.cardMap, roughness: 0.8 });
    const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const g = new THREE.BoxGeometry(20, 30, 7);
    const m = new THREE.Mesh(g, [side, side, side, side, front, front]);
    m.scale.setScalar(CM);
    m.position.copy(v(0, 15, -108));
    m.rotation.y = -0.2;
    m.castShadow = m.receiveShadow = true;
    b.group.add(m);
    b.with([0, 0, -108], [0, -0.2, 0], () => b.collider(-10, 10, 0, 30, -3.5, 3.5));
  }

  // ------------------------------------------------------------------ board game + sneakers (front-right)
  {
    const gm = new THREE.MeshStandardMaterial({ map: T.boardGame(), roughness: 0.5 });
    const sideM = new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.55, map: mats.cardMap });
    const g = new THREE.BoxGeometry(32, 4, 32);
    const m = new THREE.Mesh(g, [sideM, sideM, gm, sideM, sideM, sideM]);
    m.scale.setScalar(CM);
    m.position.copy(v(105, 2, 52));
    m.rotation.y = 0.18;
    m.castShadow = m.receiveShadow = true;
    b.group.add(m);
    b.with([105, 0, 52], [0, 0.18, 0], () => b.collider(-16, 16, 0, 4, -16, 16));
    sneaker(b, [121, 0, 100], [0, -0.25, 0]);
  }

  // door on front wall
  b.with([86, 0, RZ - 1], [0, 0, 0], () => {
    b.box('painted', 0xf7f3ea, -42, 42, 0.8, 206, -2, 1, 1.5, { collide: true });
    b.collider(-37.5, -30.5, 96.5, 103.5, -9.5, -2);
    b.box('painted', 0xece6da, -34, 34, 110, 196, -2.6, -2, 1);
    b.box('painted', 0xece6da, -34, 34, 14, 96, -2.6, -2, 1);
    b.part(new THREE.SphereGeometry(3.4, 14, 10), 'metal', 0xd8b25a, [-34, 100, -6]);
    b.box('metal', 0xd8b25a, -35, -33, 99, 101, -6, -2, 0.3);
  });

  // ------------------------------------------------------------------ plush slumped by bookshelf
  plush(b, [-118, 0, 66], [0, 1.0, 0], 1, 0x9a7ad6);

  // ------------------------------------------------------------------ rug / play mat
  {
    const rugMat = new THREE.MeshStandardMaterial({ map: T.playMat(), roughness: 0.95, envMapIntensity: 0.25 });
    b.mesh(new THREE.BoxGeometry(130, 0.5, 110), rugMat, [-35, 0.25, 25], [0, 0, 0], { shadow: false, collide: true });
  }

  // ------------------------------------------------------------------ castle of wooden blocks
  {
    const cx = -75, cz = 45;
    const woods = [0xe8c48a, 0xdcb075, 0xd64c3f, 0x3f7fd9, 0x5bbf6a, 0xf2c84b];
    const heights = [3, 3, 2, 1, 2, 3, 2, 1, 0, 0, 1, 2, 3, 3, 2, 2, 1, 1, 2, 3];
    let k = 0;
    for (let i = 0; i < 6; i++)
      for (let side = 0; side < 4; side++) {
        let x = 0, z = 0;
        if (side === 0) { x = -15 + i * 5; z = -15; }
        if (side === 1) { x = 15 - 5; z = -15 + i * 5; }
        if (side === 2) { x = 15 - 5 - i * 5; z = 10; }
        if (side === 3) { x = -15; z = 10 - i * 5; }
        if (side === 1 && (i === 2 || i === 3)) continue; // gate
        const h = heights[k++ % heights.length];
        for (let j = 0; j < h; j++) {
          const col = woods[(i * 7 + j * 3 + side) % woods.length];
          b.box('wood', col, cx + x, cx + x + 5, j * 5, j * 5 + 5, cz + z, cz + z + 5, 0.5, { collide: true });
        }
      }
    // arch over gate
    b.box('wood', 0xf2c84b, cx + 10, cx + 15, 10, 13, cz - 5, cz + 5, 0.5, { collide: true });
    // finished tower
    b.part(new THREE.CylinderGeometry(4.5, 4.5, 24, 16), 'wood', 0xe8c48a, [cx - 15, 12, cz - 15]);
    b.part(new THREE.ConeGeometry(6, 9, 16), 'glossy', 0xd64c3f, [cx - 15, 28.5, cz - 15]);
    b.part(new THREE.CylinderGeometry(0.3, 0.3, 6, 6), 'metal', 0xcccccc, [cx - 15, 35, cz - 15]);
    b.box('painted', 0xffcf33, cx - 15, cx - 10, 35, 37.5, cz - 15.2, cz - 14.8, 0);
    world.add((cx - 19.5) * CM, 0, (cz - 19.5) * CM, (cx - 10.5) * CM, 33 * CM, (cz - 10.5) * CM);
  }

  // ------------------------------------------------------------------ jumbo bricks (cover)
  const brickCols = [0xff4d3d, 0x3fa9ff, 0xffcf33, 0x7bd35a, 0xffffff, 0xff8a1f];
  const brick = (x: number, z: number, rotY: number, col: number, y = 0, long = true) =>
    b.with([x, y, z], [0, rotY, 0], () => {
      const L = long ? 8 : 4;
      b.box('glossy', col, -L, L, 0, 4.8, -4, 4, 0.35, { collide: true });
      for (let i = 0; i < (long ? 4 : 2); i++)
        for (let j = 0; j < 2; j++) b.part(new THREE.CylinderGeometry(1.25, 1.25, 1, 14), 'glossy', col, [-L + 2 + i * 4, 5.3, -2 + j * 4]);
    });
  const brickPiles: [number, number, number, number][] = [
    [-20, 18, 0.1, 0], [-20, 18, 0.1, 4.8], [-12, 26, 1.6, 1],
    [22, 45, -0.4, 2], [30, 52, 1.2, 3],
    [-30, 75, 0.0, 4], [-38, 66, 0.9, 5],
    [-92, -16, 1.57, 0], [-92, -2, 1.57, 1], [-92, -9, 1.57, 2], // clear of the balcony ladder foot
    [5, -82, 0.3, 3], [-6, -76, -0.2, 0],
    [-62, 8, 0.7, 2], [-5, 62, 1.1, 0],
  ];
  brickPiles.forEach(([x, z, r, c], i) => brick(x, z, r, brickCols[c], i === 1 ? 4.8 : i === 9 ? 4.8 : 0, i % 4 !== 3));

  // ------------------------------------------------------------------ letter blocks
  const letters: [string, string, string][] = [['A', '#ff4d3d', '#fff'], ['B', '#3fa9ff', '#fff'], ['C', '#7bd35a', '#fff'], ['Z', '#ffcf33', '#c0391b'], ['7', '#9b59d0', '#fff']];
  const blockGeo = new THREE.BoxGeometry(5, 5, 5);
  const placeBlock = (li: number, x: number, y: number, z: number, r: number) => {
    const [L, bg, fg] = letters[li];
    const m = mats.textured('letter' + L, () => T.letterTex(L, bg, fg), { roughness: 0.55 });
    b.mesh(blockGeo, m, [x, y + 2.5, z], [0, r, 0], { collide: true });
  };
  placeBlock(0, 10, 0, 15, 0.1);
  placeBlock(1, 15.5, 0, 15, -0.05);
  placeBlock(2, 12.8, 5, 15, 0.2);
  placeBlock(3, -40, 0, -25, 0.6);
  placeBlock(1, -100, 0, -50, 0.9);
  placeBlock(2, 60, 0, 75, 0.4);

  // ------------------------------------------------------------------ crayons, pencil, batteries, plane, books
  const crayon = (x: number, z: number, rotY: number, col: number) =>
    b.with([x, 1.25, z], [0, rotY, Math.PI / 2], () => {
      b.part(new THREE.CylinderGeometry(1.25, 1.25, 9, 12), 'painted', col, [0, 0, 0], [0, 0, 0], { ao: 0.2 });
      b.collider(-1.3, 1.3, -4.5, 7, -1.3, 1.3);
      b.part(new THREE.CylinderGeometry(1.3, 1.3, 6, 12), 'paper', 0xfaf3e0, [0, -0.5, 0], [0, 0, 0], { ao: 0.2 });
      b.part(new THREE.ConeGeometry(1.25, 2.5, 12), 'painted', col, [0, 5.75, 0], [0, 0, 0], { ao: 0.2 });
    });
  ([[-10, 40, 0.4, 0xff4d3d], [-14, 44, 1.2, 0x3fa9ff], [35, 10, 2.2, 0x7bd35a], [-55, 60, 0.9, 0xffcf33], [-80, -20, 2.5, 0x9b59d0], [15, 65, -0.3, 0xff8a1f], [-45, -10, 1.9, 0xff6fa8]] as const)
    .forEach(([x, z, r, c]) => crayon(x, z, r, c));

  // pencil (a 1 cm step you walk over)
  for (let i = -3; i <= 3; i++) {
    const px = 28 + Math.cos(0.5) * i * 2.6, pz = -65 - Math.sin(0.5) * i * 2.6;
    world.add((px - 1.3) * CM, 0, (pz - 1.3) * CM, (px + 1.3) * CM, 1 * CM, (pz + 1.3) * CM);
  }
  b.with([28, 0.5, -65], [0, 0.5, Math.PI / 2], () => {
    b.part(new THREE.CylinderGeometry(0.5, 0.5, 17, 6), 'painted', 0xffcf33, [0, 0, 0], [0, 0, 0], { ao: 0.1 });
    b.part(new THREE.ConeGeometry(0.5, 2, 6), 'wood', 0xe8c48a, [0, 9.5, 0]);
    b.part(new THREE.CylinderGeometry(0.52, 0.52, 1.5, 6), 'metal', 0xc0c0c0, [0, -9.2, 0]);
    b.part(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 6), 'rubber', 0xff8fb0, [0, -10.5, 0]);
  });
  // D-cell batteries
  const battery = (x: number, z: number, r: number) =>
    b.with([x, 1.7, z], [0, r, Math.PI / 2], () => {
      b.part(new THREE.CylinderGeometry(1.7, 1.7, 5.4, 18), 'metal', 0x222222, [0, -0.6, 0]);
      b.collider(-1.7, 1.7, -3.3, 3.5, -1.7, 1.7);
      b.part(new THREE.CylinderGeometry(1.71, 1.71, 2.6, 18), 'glossy', 0xd8b25a, [0, 1.6, 0]);
      b.part(new THREE.CylinderGeometry(0.5, 0.5, 0.6, 10), 'metal', 0xcccccc, [0, 3.2, 0]);
    }, 1);
  battery(15, -55, 0.3);
  battery(19, -50, 1.1);
  // paper plane
  b.with([0, 0.2, -22], [0, 0.7, 0], () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -10, -6, 1.8, 8, 0, 0, 8, 0, 0, -10, 0, 0, 8, 6, 1.8, 8, 0, 0, -10, 0, -0.1, 8, 0, 0, 8], 3));
    g.computeVertexNormals();
    b.part(g, 'paper', 0xffffff, [0, 0.1, 0], [0, 0, 0], { ao: 0.1 });
    b.part(g, 'paper', 0xf0f0f0, [0, 0.1, 0], [0, Math.PI, 0], { ao: 0.1 });
  });
  world.add(-4 * CM, 0, -26 * CM, 4 * CM, 1.4 * CM, -18 * CM); // paper plane: low enough to step on
  // open book on rug
  b.with([-30, 0.5, -0], [0, 0.4, 0], () => {
    b.box('painted', 0x2fb3b3, -14, 14, 0, 0.6, -9.5, 9.5, 0.2);
    b.part(new THREE.CylinderGeometry(7, 7, 18, 12, 1, false, 0, Math.PI), 'paper', 0xfffcf2, [-6.5, 0.6, 0], [Math.PI / 2, 0, -Math.PI / 2], { ao: 0.1 });
    b.part(new THREE.CylinderGeometry(7, 7, 18, 12, 1, false, 0, Math.PI), 'paper', 0xfffcf2, [6.5, 0.6, 0], [Math.PI / 2, 0, -Math.PI / 2], { ao: 0.1 });
  });
  world.add(-44 * CM, 0, -12 * CM, -16 * CM, 1.1 * CM, 12 * CM);

  // ceiling lamp
  b.part(new THREE.SphereGeometry(28, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 'glow', 0xfff2d6, [-10, RH, 10], [Math.PI, 0, 0], { shadow: false });

  // ------------------------------------------------------------------ train track loop + train
  const tcx = -15, tcz = 35, trx = 34, trz = 26;
  const trackPos = (t: number, out = new THREE.Vector3()) => out.set(tcx + Math.cos(t) * trx, 0.6, tcz + Math.sin(t) * trz);
  {
    const N = 56;
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2;
      trackPos(t0, p);
      trackPos(t1, q);
      const ang = Math.atan2(q.x - p.x, q.z - p.z);
      const len = p.distanceTo(q) + 0.4;
      b.with([(p.x + q.x) / 2, 0.5, (p.z + q.z) / 2], [0, ang, 0], () => {
        b.box('wood', 0xe3b67a, -2.4, 2.4, 0, 1.0, -len / 2, len / 2, 0.15, { ao: 0.1 });
        b.box('wood', 0xb98a52, -1.6, -0.9, 0.95, 1.05, -len / 2, len / 2, 0, { ao: 0 });
        b.box('wood', 0xb98a52, 0.9, 1.6, 0.95, 1.05, -len / 2, len / 2, 0, { ao: 0 });
      });
      // the track is a real (low, step-over) object
      const cx = (p.x + q.x) / 2, cz = (p.z + q.z) / 2;
      const hx = (Math.abs(Math.cos(ang)) * 2.4 + Math.abs(Math.sin(ang)) * len * 0.5) * 0.9;
      const hz = (Math.abs(Math.sin(ang)) * 2.4 + Math.abs(Math.cos(ang)) * len * 0.5) * 0.9;
      world.add((cx - hx) * CM, 0, (cz - hz) * CM, (cx + hx) * CM, 1.5 * CM, (cz + hz) * CM);
    }
  }
  const train = makeTrain(mats);

  // ------------------------------------------------------------------ upper levels (keep, tower, bridges, galleries)
  const upperPickups = [...buildUpperLevels(b, world), ...buildSkyLevels(b, world)];

  // ------------------------------------------------------------------ light shafts & dust motes
  const shafts = makeShafts();
  b.group.add(shafts);
  const motes = makeMotes();
  b.group.add(motes);

  const group = b.finalize();

  const spawnPoints = [
    v(60, 0, -60), v(100, 0, -30), v(80, 0, 50), v(45, 0, -100), // under bed
    v(-75, 0, 70), // toy chest
    v(20, 0, 95), // crate
    v(-88, 0, -22), v(-95, 0, 60), // bookshelf ends
    v(86, 0, 112), // door gap
    v(-30, 0, -105), v(0, 0, 112), v(-125, 0, 110), v(125, 0, 70),
  ];

  return {
    group,
    spawnPoints,
    bossSpawn: v(-10, 0, 80),
    playerSpawn: v(-56, 0, -96),
    playerYaw: Math.PI * 0.82,
    train,
    trainPath: (t, out) => trackPos(t, out).multiplyScalar(CM),
    motes,
    pickupSpots: [
      { pos: v(-20, 0, 40), kind: 'frag', respawn: 20 },
      { pos: v(-10, 0, -62), kind: 'frag', respawn: 20 },
      { pos: v(60, 0, -20), kind: 'frag', respawn: 25 },
      { pos: v(-85, 0, -75), kind: 'flash', respawn: 22 },
      { pos: v(10, 0, 30), kind: 'flash', respawn: 22 },
      { pos: v(-75, 46, 100), kind: 'frag', respawn: 25 },
      { pos: v(20, 31, 101), kind: 'frag', respawn: 25 },
      { pos: v(64, 48, 60), kind: 'health', respawn: 20 },
      { pos: v(70, 0, 0), kind: 'health', respawn: 18 },
      { pos: v(-45, 0, 15), kind: 'health', respawn: 18 },
      { pos: v(-100, 0, 75), kind: 'ammo', respawn: 15 },
      { pos: v(110, 0, 75), kind: 'ammo', respawn: 15 },
      ...upperPickups,
    ],
    playerSpawns: [
      v(-56, 0, -96), v(110, 0, -40), v(-120, 0, 110), v(20, 0, 80), v(-95, 0, 25), v(70, 0, 60),
      v(-30, 0, -15), v(120, 0, 110), v(50, 0, -100), v(-120, 0, -95), v(0, 0, 40), v(95, 0, 20),
    ],
    dynamicSpots: [
      { pos: v(-25, 0, 50), kind: 'die', color: 0xffffff },
      { pos: v(70, 0, 80), kind: 'die', color: 0xff4d3d },
      { pos: v(98, 4, 48), kind: 'pawn', color: 0xffcf33 },
      { pos: v(110, 4, 58), kind: 'pawn', color: 0xff4d3d },
      { pos: v(112, 4, 44), kind: 'pawn', color: 0x7bd35a },
      { pos: v(5, 0, 30), kind: 'ball', color: 0xff6fa8 },
      { pos: v(-50, 0, -60), kind: 'ball', color: 0x3fa9ff },
      { pos: v(-12, 0, 80), kind: 'cube', color: 0xffcf33 },
      { pos: v(-2, 0, 85), kind: 'cube', color: 0x7bd35a },
      { pos: v(30, 0, 70), kind: 'cube', color: 0x3fa9ff },
      { pos: v(-60, 0, -5), kind: 'marble', color: 0x7fd4ff },
      { pos: v(-50, 0, 5), kind: 'marble', color: 0xff8a1f },
      { pos: v(-22, 0, -60), kind: 'marble', color: 0x9b59d0 },
      { pos: v(40, 0, -30), kind: 'cube', color: 0xff4d3d },
      { pos: v(-110, 0, 0), kind: 'ball', color: 0xffcf33 },
    ],
  };

  // ---------------------------------------------------------------- local builders
  function makeShafts() {
    const g = new THREE.Group();
    const tex = T.shaftTex();
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: 0xffd9a0, transparent: true, opacity: 0.025, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const len = 330;
    for (let i = 0; i < 5; i++) {
      const wx = WIN.x0 + 10 + i * 25;
      const start = new THREE.Vector3(wx, WIN.y0 + 10 + (i % 3) * 30, -RZ);
      const geo = new THREE.PlaneGeometry(22 + (i % 2) * 14, len);
      geo.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      m.scale.setScalar(CM);
      m.position.copy(start.multiplyScalar(CM));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), SUN_DIR);
      m.quaternion.copy(q);
      m.rotateY(0.6 + i * 0.5);
      m.renderOrder = 5;
      g.add(m);
    }
    return g;
  }

  function makeMotes() {
    const N = 260;
    const pos = new Float32Array(N * 3);
    const r = T.rand(5);
    for (let i = 0; i < N; i++) {
      const t = r() * 260;
      const p = new THREE.Vector3(WIN.x0 + r() * 120, WIN.y0 + r() * 120, -RZ).addScaledVector(SUN_DIR, t);
      pos[i * 3] = p.x * CM;
      pos[i * 3 + 1] = Math.max(2, p.y) * CM;
      pos[i * 3 + 2] = p.z * CM;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      size: 0.35, map: T.dotTex(), transparent: true, opacity: 0.7, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffe2b0, sizeAttenuation: true, fog: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }
}

// ----------------------------------------------------------------------------- props

function plush(b: Builder, pos: [number, number, number], rot: [number, number, number], s: number, col: number) {
  b.push(pos, rot, s);
  const f = 'fabric' as const;
  b.part(new THREE.SphereGeometry(13, 18, 14), f, col, [0, 13, 0], [0, 0, 0]);
  // body + head + legs
  b.collider(-13, 13, 0, 26, -12, 13);
  b.collider(-10, 10, 22, 42, -9, 11);
  b.collider(-11, 11, 0, 10, 4, 23);
  b.part(new THREE.SphereGeometry(9, 12, 10), f, 0xf5e3c8, [0, 12, 8]);
  b.part(new THREE.SphereGeometry(10, 18, 14), f, col, [0, 32, 1]);
  b.part(new THREE.SphereGeometry(4.5, 12, 10), f, 0xf5e3c8, [0, 30, 10]);
  b.part(new THREE.SphereGeometry(1.4, 10, 8), 'glossy', 0x2a1a14, [0, 31.5, 14.2]);
  // floppy ears
  b.part(new THREE.CapsuleGeometry(3, 12, 4, 10), f, col, [-9, 38, 0], [0, 0, 1.0]);
  b.part(new THREE.CapsuleGeometry(3, 12, 4, 10), f, col, [9, 36, 0], [0.3, 0, -1.3]);
  // button eyes (mismatched)
  b.part(new THREE.CylinderGeometry(1.8, 1.8, 0.8, 14), 'glossy', 0x1a1a1a, [-4, 35, 8.6], [Math.PI / 2 - 0.3, 0, 0]);
  b.part(new THREE.CylinderGeometry(1.4, 1.4, 0.8, 14), 'glossy', 0x3fa9ff, [4, 35.5, 8.6], [Math.PI / 2 - 0.3, 0, 0]);
  // stitched patch
  b.part(new THREE.BoxGeometry(6, 6, 0.6), 'fabric', 0xff8a7a, [5, 18, 12], [0.2, 0.4, 0.3]);
  // arms + legs
  b.part(new THREE.CapsuleGeometry(4, 10, 4, 10), f, col, [-13, 16, 5], [0.8, 0, 0.6]);
  b.part(new THREE.CapsuleGeometry(4, 10, 4, 10), f, col, [13, 16, 5], [0.8, 0, -0.6]);
  b.part(new THREE.CapsuleGeometry(5, 9, 4, 10), f, col, [-7, 5, 12], [Math.PI / 2, 0, 0]);
  b.part(new THREE.CapsuleGeometry(5, 9, 4, 10), f, col, [7, 5, 12], [Math.PI / 2, 0, 0]);
  b.part(new THREE.SphereGeometry(4, 10, 8), f, 0xf5e3c8, [-7, 5, 19]);
  b.part(new THREE.SphereGeometry(4, 10, 8), f, 0xf5e3c8, [7, 5, 19]);
  b.pop();
}

function dino(b: Builder) {
  const g = 0x5bbf6a;
  b.part(new THREE.CapsuleGeometry(5, 10, 6, 12), 'glossy', g, [0, 9, 0], [0, 0, Math.PI / 2]);
  b.part(new THREE.CapsuleGeometry(2.4, 8, 4, 10), 'glossy', g, [8, 14, 0], [0, 0, -0.7]);
  b.part(new THREE.SphereGeometry(3.6, 12, 10), 'glossy', g, [12, 18.5, 0]);
  b.part(new THREE.ConeGeometry(3, 12, 10), 'glossy', g, [-12, 8, 0], [0, 0, Math.PI / 2 + 0.25]);
  for (const [x, z] of [[-4, -3], [-4, 3], [4, -3], [4, 3]]) b.part(new THREE.CylinderGeometry(1.8, 2.1, 5, 10), 'glossy', g, [x, 2.5, z]);
  for (let i = 0; i < 5; i++) b.part(new THREE.ConeGeometry(1.4, 3, 6), 'glossy', 0xff8a1f, [-6 + i * 3, 14 - Math.abs(i - 2) * 0.4, 0]);
  b.part(new THREE.SphereGeometry(0.7, 8, 6), 'glossy', 0x111111, [14.5, 19.5, 2]);
  b.part(new THREE.SphereGeometry(0.7, 8, 6), 'glossy', 0x111111, [14.5, 19.5, -2]);
  b.collider(-16, 16, 0, 15, -5, 5);
}

function sock(b: Builder, pos: [number, number, number], rotY: number, col: number) {
  b.with(pos, [0, rotY, 0], () => {
    b.part(new THREE.CapsuleGeometry(3.5, 16, 4, 10), 'fabric', col, [0, 2.6, 0], [Math.PI / 2, 0, 0.0], { ao: 0.4 });
    b.collider(-3.4, 7, 0, 5.5, -11.5, 12);
    b.part(new THREE.CapsuleGeometry(3.3, 7, 4, 10), 'fabric', col, [3.5, 2.4, 10], [0, 0, Math.PI / 2], { ao: 0.4 });
    b.part(new THREE.CylinderGeometry(3.7, 3.7, 3, 12), 'fabric', 0xffffff, [0, 2.6, -9], [Math.PI / 2, 0, 0], { ao: 0.4 });
    b.part(new THREE.SphereGeometry(3.4, 10, 8), 'fabric', 0xff4d3d, [6.5, 2.4, 10.5], [0, 0, 0], { ao: 0.4 });
  });
}

function robotFigure(b: Builder) {
  b.box('metal', 0xb0b8c8, -5, 5, 8, 20, -4, 4, 1.5);
  b.box('metal', 0xb0b8c8, -4, 4, 20, 27, -3.5, 3.5, 1.5);
  b.part(new THREE.SphereGeometry(1.2, 8, 6), 'glow', 0xff4d3d, [-1.8, 24, 3.6], [0, 0, 0], { shadow: false });
  b.part(new THREE.SphereGeometry(1.2, 8, 6), 'glow', 0xff4d3d, [1.8, 24, 3.6], [0, 0, 0], { shadow: false });
  b.box('metal', 0x8890a0, -4.5, -1, 0, 8, -2.5, 2.5, 1);
  b.box('metal', 0x8890a0, 1, 4.5, 0, 8, -2.5, 2.5, 1);
  b.part(new THREE.CylinderGeometry(0.3, 0.3, 5, 6), 'metal', 0xcccccc, [0, 29, 0]);
  b.part(new THREE.SphereGeometry(1, 8, 6), 'glossy', 0xffcf33, [0, 31.5, 0]);
}

function truck(b: Builder) {
  const y = 0xffc21a;
  b.box('glossy', 0x444a55, -17, 17, 4, 7, -6, 6, 1, { collide: true });
  b.box('glossy', y, 4, 17, 7, 19, -7, 7, 2.5, { collide: true });
  b.box('glossy', 0x9fd6ff, 9, 16.5, 12, 17.5, -7.2, 7.2, 1);
  b.box('glossy', 0x9fd6ff, 16.4, 17.2, 12, 17, -5.5, 5.5, 0.5);
  b.box('glossy', y, -18, 3, 7, 9, -8, 8, 1, { collide: true });
  b.box('glossy', y, -18, 3, 9, 18, -8, -6.5, 0.8);
  b.box('glossy', y, -18, 3, 9, 18, 6.5, 8, 0.8);
  b.box('glossy', y, -18, -16.5, 9, 18, -8, 8, 0.8);
  b.box('glossy', 0xff4d3d, 17, 18, 8, 11, -5, 5, 0.6);
  b.collider(-18, 3, 0, 18, -8, 8);
  b.collider(-15.5, 15.5, 0, 8.5, -9.2, 9.2); // wheels
  for (const x of [-11, 11])
    for (const z of [-7.5, 7.5]) {
      b.part(new THREE.CylinderGeometry(4.2, 4.2, 3, 20), 'rubber', 0x1f1f22, [x, 4.2, z], [Math.PI / 2, 0, 0]);
      b.part(new THREE.CylinderGeometry(2.2, 2.2, 3.2, 14), 'glossy', 0xdddddd, [x, 4.2, z], [Math.PI / 2, 0, 0]);
    }
  // headlights
  b.part(new THREE.SphereGeometry(1.2, 10, 8), 'glow', 0xfff3c0, [17.3, 13, -4.5], [0, 0, 0], { shadow: false });
  b.part(new THREE.SphereGeometry(1.2, 10, 8), 'glow', 0xfff3c0, [17.3, 13, 4.5], [0, 0, 0], { shadow: false });
  // dirt (blocks) in bed
  b.box('glossy', 0x7bd35a, -14, -8, 9, 14, -5, 0, 0.4);
  b.box('glossy', 0xff4d3d, -8, -2, 9, 13, 1, 6, 0.4);
}

function sneaker(b: Builder, pos: [number, number, number], rot: [number, number, number]) {
  b.with(pos, rot, () => {
    b.box('rubber', 0xf4f4f4, -5, 5, 0, 2.5, -14, 14, 2, { collide: true });
    b.box('fabric', 0x3fa9ff, -4.7, 4.7, 2.5, 8, -13, 6, 3.5, { collide: true });
    b.box('fabric', 0x3fa9ff, -4.5, 4.5, 2.5, 12, 3, 13, 3);
    b.box('fabric', 0xff4d3d, -4.8, 4.8, 3, 6, -13.5, -6, 2.5);
    for (let i = 0; i < 4; i++) b.box('fabric', 0xffffff, -3.5, 3.5, 7.6 + i * 0.6, 8.4 + i * 0.6, -6 + i * 3, -5 + i * 3, 0.3);
    b.collider(-5, 5, 0, 12, 3, 13);
  });
}

function makeTrain(mats: Materials) {
  const g = new THREE.Group();
  const red = mats.plastic(0xd64c3f, 0.4);
  const blue = mats.plastic(0x3f7fd9, 0.4);
  const yel = mats.plastic(0xffcf33, 0.4);
  const blk = mats.plastic(0x222222, 0.8);
  const wood = mats.plastic(0xe3b67a, 0.6);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, rx = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cars: THREE.Group[] = [];
  for (let c = 0; c < 3; c++) {
    const car = new THREE.Group();
    const body = c === 0 ? red : c === 1 ? blue : yel;
    add(new THREE.BoxGeometry(4, 1.2, 8), wood, 0, 1.6, 0, car);
    if (c === 0) {
      add(new THREE.CylinderGeometry(1.8, 1.8, 5, 14), body, 0, 4, 1, car, Math.PI / 2);
      add(new THREE.BoxGeometry(3.8, 4.5, 3), body, 0, 4.4, -2.5, car);
      add(new THREE.BoxGeometry(4.4, 0.6, 3.6), blk, 0, 6.9, -2.5, car);
      add(new THREE.CylinderGeometry(0.6, 0.8, 2.2, 10), blk, 0, 6.4, 2.6, car);
    } else {
      add(new THREE.BoxGeometry(3.8, 3, 6.5), body, 0, 3.6, 0, car);
    }
    for (const z of [-2.5, 2.5])
      for (const x of [-2.1, 2.1]) add(new THREE.CylinderGeometry(1.1, 1.1, 0.6, 12), blk, x, 1.1, z, car, 0, Math.PI / 2);
    car.scale.setScalar(CM);
    g.add(car);
    cars.push(car);
  }
  g.userData.cars = cars;
  return g;
}
