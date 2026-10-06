import * as THREE from 'three';
import { CM } from '../../environment/Builder';

/**
 * Stealable toys for Hidden Troopers. Each one is its own small mesh (the rest
 * of the map is merged into a few static meshes) so it can vanish when stolen.
 *
 * Value = size + risk: small 1, medium 3, large 5, plus +1 on raised furniture
 * and +2 high up or out in the open. The best single item is worth 7, so no one
 * steal decides a round: you have to keep taking risks.
 */

export type LootKind = 'gem' | 'coins' | 'duck' | 'car' | 'robot' | 'trophy' | 'rocket' | 'crown';
const SIZE: Record<LootKind, { base: number; name: string; r: number }> = {
  gem: { base: 1, name: 'GEM', r: 0.45 },
  coins: { base: 1, name: 'COIN STACK', r: 0.45 },
  duck: { base: 3, name: 'RUBBER DUCK', r: 0.6 },
  car: { base: 3, name: 'TOY CAR', r: 0.7 },
  robot: { base: 3, name: 'ROBOT', r: 0.6 },
  trophy: { base: 5, name: 'TROPHY', r: 0.7 },
  rocket: { base: 5, name: 'TOY ROCKET', r: 0.7 },
  crown: { base: 5, name: 'GOLD CROWN', r: 0.7 },
};

/** [x, y, z] in cm, kind, extra risk bonus */
const SPOTS: [number, number, number, LootKind, number][] = [
  // floor: mostly small, tucked away; the open rug pays more
  [110, 0, -60, 'gem', 0], [-60, 0, -90, 'coins', 0], [10, 0, -95, 'gem', 0], [120, 0, 110, 'coins', 0],
  [-120, 0, -12, 'duck', 0], [-30, 0.5, 40, 'car', 2], [60, 0, 100, 'gem', 0], [-20, 0.5, -25, 'coins', 1],
  // furniture tops
  [75, 47, 40, 'duck', 1], [115, 47, -70, 'gem', 1], [110, 47, -40, 'robot', 1], [75, 47, -10, 'coins', 1],
  [-50, 46.5, -30, 'car', 1], [-85, 45, 108, 'robot', 1], [25, 30, 110, 'coins', 1],
  // second floor
  [100, 59, -15, 'trophy', 1], [50, 74, -66, 'duck', 1], [-50, 74, -100, 'car', 1], [-90, 74, -80, 'gem', 1],
  [-80, 84.5, -85, 'rocket', 1], [-99, 83, -20, 'coins', 1], [-110, 83, 30, 'robot', 1], [-102, 83, 92, 'duck', 1], [90, 90, -116, 'trophy', 2],
  // high layer: big rewards, nowhere to hide
  [-112, 123, -5, 'car', 2], [-115, 160, 40, 'crown', 2], [5, 135, 45, 'trophy', 2], [-10, 151, 45, 'rocket', 2],
  [-85, 123, 31, 'gem', 2], [47, 131, -5, 'robot', 2], [20, 165, 91, 'crown', 2], [98, 135, 40, 'rocket', 2],
];

export const STEAL_TIME = 2.0;
export const LOOT_RESPAWN = 90;

export interface LootItem {
  id: number;
  kind: LootKind;
  name: string;
  value: number;
  pos: THREE.Vector3;
  radius: number;
  mesh: THREE.Group;
  available: boolean;
  /** seconds until it comes back (leader) */
  respawn: number;
}

const mats = new Map<number, THREE.MeshStandardMaterial>();
function mat(c: number, metal = 0) {
  const k = c * 2 + metal;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color: c, roughness: metal ? 0.25 : 0.35, metalness: metal })));
  return m;
}
function add(g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

/** small, readable toy models (world units) */
function build(kind: LootKind) {
  const g = new THREE.Group();
  switch (kind) {
    case 'gem':
      add(g, new THREE.OctahedronGeometry(0.32, 0), mat(0x3fe0ff), 0, 0.34, 0).scale.set(1, 1.3, 1);
      break;
    case 'coins':
      for (let i = 0; i < 4; i++) add(g, new THREE.CylinderGeometry(0.26, 0.26, 0.07, 16), mat(0xffcf33, 0.8), (i % 2) * 0.03, 0.04 + i * 0.075, 0);
      break;
    case 'duck':
      add(g, new THREE.SphereGeometry(0.34, 14, 10), mat(0xffd400), 0, 0.3, 0).scale.set(1.2, 0.85, 1);
      add(g, new THREE.SphereGeometry(0.22, 12, 10), mat(0xffd400), 0.22, 0.62, 0);
      add(g, new THREE.ConeGeometry(0.1, 0.18, 10), mat(0xff8a1f), 0.42, 0.6, 0, 0, 0, -Math.PI / 2);
      break;
    case 'car':
      add(g, new THREE.BoxGeometry(0.9, 0.24, 0.45), mat(0xe8453c), 0, 0.24, 0);
      add(g, new THREE.BoxGeometry(0.45, 0.2, 0.4), mat(0x9fd6ff), -0.05, 0.45, 0);
      for (const x of [-0.3, 0.3]) for (const z of [-0.24, 0.24]) add(g, new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12), mat(0x222222), x, 0.12, z, Math.PI / 2);
      break;
    case 'robot':
      add(g, new THREE.BoxGeometry(0.4, 0.5, 0.3), mat(0xb0b8c8, 0.6), 0, 0.45, 0);
      add(g, new THREE.BoxGeometry(0.3, 0.25, 0.25), mat(0xb0b8c8, 0.6), 0, 0.85, 0);
      add(g, new THREE.BoxGeometry(0.12, 0.2, 0.12), mat(0x8890a0, 0.6), -0.1, 0.1, 0);
      add(g, new THREE.BoxGeometry(0.12, 0.2, 0.12), mat(0x8890a0, 0.6), 0.1, 0.1, 0);
      add(g, new THREE.SphereGeometry(0.04, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3030 }), 0.07, 0.88, 0.13);
      break;
    case 'trophy':
      add(g, new THREE.CylinderGeometry(0.22, 0.28, 0.12, 16), mat(0x7a4a2a), 0, 0.06, 0);
      add(g, new THREE.CylinderGeometry(0.05, 0.08, 0.35, 10), mat(0xffcf33, 0.9), 0, 0.3, 0);
      add(g, new THREE.CylinderGeometry(0.3, 0.12, 0.38, 18, 1, true), mat(0xffcf33, 0.9), 0, 0.66, 0);
      add(g, new THREE.TorusGeometry(0.14, 0.03, 6, 12), mat(0xffcf33, 0.9), 0.32, 0.68, 0);
      add(g, new THREE.TorusGeometry(0.14, 0.03, 6, 12), mat(0xffcf33, 0.9), -0.32, 0.68, 0);
      break;
    case 'rocket':
      add(g, new THREE.CylinderGeometry(0.16, 0.16, 0.8, 14), mat(0xf4f1ea), 0, 0.5, 0);
      add(g, new THREE.ConeGeometry(0.16, 0.3, 14), mat(0xe8453c), 0, 1.05, 0);
      for (let i = 0; i < 3; i++) add(g, new THREE.BoxGeometry(0.04, 0.25, 0.22), mat(0x3f7fd9), Math.cos((i / 3) * 6.28) * 0.18, 0.2, Math.sin((i / 3) * 6.28) * 0.18, 0, -(i / 3) * 6.28, 0);
      break;
    case 'crown':
      add(g, new THREE.CylinderGeometry(0.32, 0.3, 0.22, 16, 1, true), mat(0xffcf33, 0.9), 0, 0.12, 0);
      for (let i = 0; i < 6; i++) add(g, new THREE.ConeGeometry(0.07, 0.2, 6), mat(0xffcf33, 0.9), Math.cos((i / 6) * 6.28) * 0.3, 0.32, Math.sin((i / 6) * 6.28) * 0.3);
      for (let i = 0; i < 3; i++) add(g, new THREE.SphereGeometry(0.05, 8, 6), mat([0xe8453c, 0x3fa9ff, 0x5bbf6a][i]), Math.cos((i / 3) * 6.28 + 0.5) * 0.31, 0.12, Math.sin((i / 3) * 6.28 + 0.5) * 0.31);
      break;
  }
  return g;
}

export class Loot {
  readonly group = new THREE.Group();
  items: LootItem[] = [];

  constructor() {
    SPOTS.forEach(([x, y, z, kind, bonus], id) => {
      const mesh = build(kind);
      mesh.position.set(x * CM, y * CM, z * CM);
      mesh.rotation.y = id * 1.7;
      this.group.add(mesh);
      const sz = SIZE[kind];
      this.items.push({ id, kind, name: sz.name, value: sz.base + bonus, pos: mesh.position.clone(), radius: sz.r, mesh, available: true, respawn: 0 });
    });
  }

  setAvailable(id: number, on: boolean) {
    const it = this.items[id];
    if (!it) return;
    it.available = on;
    it.mesh.visible = on;
  }

  /** the item you're close to and looking at (or null) */
  lookedAt(eye: THREE.Vector3, dir: THREE.Vector3, feet: THREE.Vector3): LootItem | null {
    let best: LootItem | null = null, bd = Infinity;
    for (const it of this.items) {
      if (!it.available) continue;
      const dx = it.pos.x - feet.x, dz = it.pos.z - feet.z;
      if (dx * dx + dz * dz > 2.6 * 2.6 || Math.abs(it.pos.y - feet.y) > 2.2) continue;
      // ray vs a generous sphere around the toy
      const cx = it.pos.x - eye.x, cy = it.pos.y + 0.35 - eye.y, cz = it.pos.z - eye.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z;
      if (t < 0) continue;
      const d2 = cx * cx + cy * cy + cz * cz - t * t;
      if (d2 > (it.radius + 0.25) ** 2) continue;
      if (t < bd) { bd = t; best = it; }
    }
    return best;
  }

  /** gentle idle spin so loot reads as "special" without glowing */
  update(dt: number) {
    for (const it of this.items) if (it.available) it.mesh.rotation.y += dt * 0.6;
  }
}
