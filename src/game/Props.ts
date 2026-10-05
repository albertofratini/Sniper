import * as THREE from 'three';
import { Materials } from '../environment/Materials';
import { rbox } from '../environment/Builder';
import { CollisionWorld, ROOM } from './Collision';

/** Small loose toys that bounce around when shot, blasted or kicked. */
interface Prop {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  av: THREE.Vector3;
  r: number;
  rolls: boolean;
  home: THREE.Vector3;
}

export class DynamicProps {
  readonly group = new THREE.Group();
  props: Prop[] = [];

  constructor(private mats: Materials, private world: CollisionWorld, spots: { pos: THREE.Vector3; kind: string; color: number }[]) {
    for (const s of spots) this.add(s.kind, s.color, s.pos);
  }

  private add(kind: string, color: number, pos: THREE.Vector3) {
    let mesh: THREE.Object3D;
    let r = 0.5;
    let rolls = false;
    const m = this.mats.plastic(color, 0.3);
    if (kind === 'die') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(rbox(1.3, 1.3, 1.3, 0.22, 3), m));
      const pip = this.mats.plastic(color === 0xffffff ? 0x222222 : 0xffffff, 0.3);
      const pg = new THREE.SphereGeometry(0.11, 8, 6);
      const faces: [THREE.Vector3, number][] = [
        [new THREE.Vector3(0, 0.65, 0), 1], [new THREE.Vector3(0, -0.65, 0), 6], [new THREE.Vector3(0.65, 0, 0), 3],
        [new THREE.Vector3(-0.65, 0, 0), 4], [new THREE.Vector3(0, 0, 0.65), 2], [new THREE.Vector3(0, 0, -0.65), 5],
      ];
      for (const [n, count] of faces) {
        const pts = pipLayout(count);
        for (const [a, b] of pts) {
          const p = new THREE.Mesh(pg, pip);
          if (n.y !== 0) p.position.set(a * 0.32, n.y, b * 0.32);
          else if (n.x !== 0) p.position.set(n.x, a * 0.32, b * 0.32);
          else p.position.set(a * 0.32, b * 0.32, n.z);
          p.scale.set(n.x ? 0.4 : 1, n.y ? 0.4 : 1, n.z ? 0.4 : 1);
          g.add(p);
        }
      }
      mesh = g;
      r = 0.65;
    } else if (kind === 'pawn') {
      const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.55, 0), new THREE.Vector2(0.55, 0.15), new THREE.Vector2(0.3, 0.3), new THREE.Vector2(0.22, 1.1), new THREE.Vector2(0.35, 1.2), new THREE.Vector2(0.1, 1.3)];
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 16), m));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), m);
      head.position.y = 1.5;
      g.add(head);
      g.children.forEach((c) => (c.position.y -= 0.8));
      mesh = g;
      r = 0.6;
    } else if (kind === 'ball') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 22, 16), m));
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.12, 8, 28), this.mats.plastic(0xffffff, 0.3));
      g.add(band);
      const star = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), this.mats.plastic(0xffcf33, 0.3));
      star.position.set(0, 0, 1.0);
      g.add(star);
      mesh = g;
      r = 1.1;
      rolls = true;
    } else if (kind === 'marble') {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 18, 12),
        new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85, envMapIntensity: 1.5 }),
      );
      r = 0.45;
      rolls = true;
    } else {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(rbox(1.6, 1.2, 1.6, 0.12), m));
      for (let i = 0; i < 4; i++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.22, 12), m);
        s.position.set(i % 2 ? 0.4 : -0.4, 0.7, i < 2 ? 0.4 : -0.4);
        g.add(s);
      }
      mesh = g;
      r = 0.8;
    }
    mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).castShadow = false;
        (o as THREE.Mesh).receiveShadow = true;
      }
    });
    const p = pos.clone();
    p.y = this.world.groundAt(p.x, p.z, 50) + r;
    mesh.position.copy(p);
    this.group.add(mesh);
    this.props.push({ mesh, pos: p, vel: new THREE.Vector3(), av: new THREE.Vector3(), r, rolls, home: p.clone() });
  }

  impulseAt(point: THREE.Vector3, dir: THREE.Vector3, strength: number, radius = 0.5) {
    for (const p of this.props) {
      const d = p.pos.distanceTo(point);
      if (d > p.r + radius) continue;
      p.vel.addScaledVector(dir, strength / (p.r * 1.5));
      p.vel.y += strength * 0.35;
      p.av.set((Math.random() - 0.5) * strength * 2, (Math.random() - 0.5) * strength * 2, (Math.random() - 0.5) * strength * 2);
    }
  }

  explosion(c: THREE.Vector3, radius: number, force: number) {
    for (const p of this.props) {
      const d = p.pos.distanceTo(c);
      if (d > radius * 1.6) continue;
      const k = 1 - d / (radius * 1.6);
      const dir = p.pos.clone().sub(c).normalize();
      dir.y = Math.abs(dir.y) + 0.6;
      p.vel.addScaledVector(dir.normalize(), force * k);
      p.av.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20).multiplyScalar(k);
    }
  }

  /** Ray test for bullets; returns distance of nearest prop hit. */
  rayHit(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): { t: number; prop: Prop } | null {
    let best: { t: number; prop: Prop } | null = null;
    for (const p of this.props) {
      const ocx = o.x - p.pos.x, ocy = o.y - p.pos.y, ocz = o.z - p.pos.z;
      const b = ocx * d.x + ocy * d.y + ocz * d.z;
      const c = ocx * ocx + ocy * ocy + ocz * ocz - p.r * p.r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > maxDist) continue;
      if (!best || t < best.t) best = { t, prop: p };
    }
    return best;
  }

  update(dt: number, kickers: { pos: THREE.Vector3; vel: THREE.Vector3; r: number }[]) {
    for (const p of this.props) {
      // kicked by player / enemies walking into it
      for (const k of kickers) {
        const dx = p.pos.x - k.pos.x, dz = p.pos.z - k.pos.z;
        const dy = p.pos.y - (k.pos.y + p.r);
        const d = Math.hypot(dx, dz);
        if (d < p.r + k.r && Math.abs(dy) < 1.5 && d > 0.001) {
          const push = (p.r + k.r - d) / d;
          p.pos.x += dx * push;
          p.pos.z += dz * push;
          const sp = Math.hypot(k.vel.x, k.vel.z);
          p.vel.x += (dx / d) * sp * 0.6;
          p.vel.z += (dz / d) * sp * 0.6;
          if (sp > 5) p.vel.y += 1.2;
        }
      }
      const moving = p.vel.lengthSq() > 0.01 || p.av.lengthSq() > 0.01;
      if (!moving && p.pos.y <= this.world.groundAt(p.pos.x, p.pos.z, p.pos.y) + p.r + 0.02) continue;
      p.vel.y -= 30 * dt;
      // move with simple box collision (treat as small cylinder)
      const nx = p.pos.x + p.vel.x * dt, nz = p.pos.z + p.vel.z * dt;
      if (this.world.pointBlocked(nx, p.pos.y, p.pos.z)) p.vel.x *= -0.5; else p.pos.x = nx;
      if (this.world.pointBlocked(p.pos.x, p.pos.y, nz)) p.vel.z *= -0.5; else p.pos.z = nz;
      p.pos.y += p.vel.y * dt;
      const g = this.world.groundAt(p.pos.x, p.pos.z, p.pos.y);
      if (p.pos.y < g + p.r) {
        p.pos.y = g + p.r;
        if (p.vel.y < 0) p.vel.y *= p.rolls ? -0.55 : -0.35;
        if (Math.abs(p.vel.y) < 0.8) p.vel.y = 0;
        const fr = p.rolls ? 0.6 : 4;
        p.vel.x *= Math.max(0, 1 - fr * dt);
        p.vel.z *= Math.max(0, 1 - fr * dt);
        p.av.multiplyScalar(Math.max(0, 1 - (p.rolls ? 1 : 5) * dt));
        if (!p.rolls) {
          // settle rotation flat-ish
          const e = p.mesh.rotation;
          if (p.av.lengthSq() < 1) {
            e.x += (Math.round(e.x / (Math.PI / 2)) * (Math.PI / 2) - e.x) * Math.min(1, dt * 8);
            e.z += (Math.round(e.z / (Math.PI / 2)) * (Math.PI / 2) - e.z) * Math.min(1, dt * 8);
          }
        }
        if (Math.hypot(p.vel.x, p.vel.z) < 0.05) { p.vel.x = 0; p.vel.z = 0; }
      }
      p.pos.x = Math.max(ROOM.minX + p.r, Math.min(ROOM.maxX - p.r, p.pos.x));
      p.pos.z = Math.max(ROOM.minZ + p.r, Math.min(ROOM.maxZ - p.r, p.pos.z));
      if (p.rolls) {
        p.mesh.rotation.x += (p.vel.z / p.r) * dt;
        p.mesh.rotation.z -= (p.vel.x / p.r) * dt;
      } else {
        p.mesh.rotation.x += p.av.x * dt;
        p.mesh.rotation.y += p.av.y * dt;
        p.mesh.rotation.z += p.av.z * dt;
      }
      p.mesh.position.copy(p.pos);
    }
  }

  reset() {
    for (const p of this.props) {
      p.pos.copy(p.home);
      p.vel.set(0, 0, 0);
      p.av.set(0, 0, 0);
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.set(0, 0, 0);
    }
  }
}

function pipLayout(n: number): [number, number][] {
  const c: [number, number][] = [[0, 0]];
  const d: [number, number][] = [[-1, -1], [1, 1]];
  const e: [number, number][] = [[-1, 1], [1, -1]];
  const m: [number, number][] = [[-1, 0], [1, 0]];
  switch (n) {
    case 1: return c;
    case 2: return d;
    case 3: return [...d, ...c];
    case 4: return [...d, ...e];
    case 5: return [...d, ...e, ...c];
    default: return [...d, ...e, ...m];
  }
}

// ----------------------------------------------------------------------------- pickups

export type PickupKind = 'health' | 'ammo' | 'frag' | 'flash' | 'minigun';
interface Pickup {
  kind: PickupKind; mesh: THREE.Object3D; pos: THREE.Vector3; vel: THREE.Vector3; life: number; t: number; spot: number;
  /** 0..1 appear animation; -1 = not collected, >= 0 = seconds since collected; rest = fixed map item */
  grow: number; gone: number; rest: boolean;
}
interface Spot { pos: THREE.Vector3; kind: PickupKind; respawn: number; timer: number; taken: boolean }

export class Pickups {
  readonly group = new THREE.Group();
  list: Pickup[] = [];
  private proto: Record<PickupKind, THREE.Object3D>;
  spots: Spot[] = [];
  onSpotTaken: (i: number) => void = () => {};

  /** Someone else (multiplayer) took the item at spot i. */
  takeSpot(i: number) {
    const sp = this.spots[i];
    if (!sp) return;
    sp.taken = true;
    sp.timer = sp.respawn;
    for (const p of this.list) if (p.spot === i && p.gone < 0) p.gone = 0;
  }

  constructor(private mats: Materials, private world: CollisionWorld) {
    this.proto = { health: this.makeHeart(), ammo: this.makeBattery(), frag: this.makeFrag(), flash: this.makeFlash(), minigun: this.makeCrate() };
  }

  /** Fixed map spots that respawn their item after it's collected. */
  setSpots(list: { pos: THREE.Vector3; kind: PickupKind; respawn: number }[]) {
    this.spots = list.map((l) => ({ ...l, pos: l.pos.clone(), timer: 0, taken: true }));
  }

  private makeFrag() {
    const g = new THREE.Group();
    const green = new THREE.MeshStandardMaterial({ color: 0x4f8f2a, roughness: 0.4, emissive: 0x1f4010, emissiveIntensity: 0.6 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), green);
    b.scale.set(1, 1.2, 1);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0xffcf33, roughness: 0.3, emissive: 0x806000, emissiveIntensity: 0.5 }));
    cap.position.y = 0.42;
    g.add(b, cap);
    return g;
  }

  private makeFlash() {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x6080a0, emissiveIntensity: 0.6 }));
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.12, 0.47), new THREE.MeshStandardMaterial({ color: 0x3fa9ff, roughness: 0.3 }));
    g.add(c, st);
    return g;
  }

  private makeCrate() {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0xff6fa8, roughness: 0.35, emissive: 0x802040, emissiveIntensity: 0.5, map: this.mats.plasticMap });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.8), m);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.18, 0.84), new THREE.MeshStandardMaterial({ color: 0xffcf33, roughness: 0.3, emissive: 0x806000, emissiveIntensity: 0.6 }));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0x2fb3b3, roughness: 0.3 }));
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(0.2, 0.55 + Math.sin(a) * 0.12, Math.cos(a) * 0.12);
      g.add(barrel);
    }
    g.add(box, band);
    g.scale.setScalar(0.8);
    return g;
  }

  private makeHeart() {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: 0.25, emissive: 0xff2040, emissiveIntensity: 0.5, map: this.mats.plasticMap });
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), m);
    a.position.set(-0.2, 0.15, 0);
    const b = a.clone();
    b.position.x = 0.2;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.6, 14), m);
    c.rotation.z = Math.PI;
    c.position.y = -0.2;
    c.scale.z = 0.7;
    a.scale.z = b.scale.z = 0.7;
    g.add(a, b, c);
    return g;
  }

  private makeBattery() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.8, 14), new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.3, metalness: 0.6 }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.35, 14), new THREE.MeshStandardMaterial({ color: 0xffcf33, roughness: 0.3, emissive: 0xffa000, emissiveIntensity: 0.4 }));
    band.position.y = 0.2;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9, roughness: 0.2 }));
    tip.position.y = 0.45;
    g.add(body, band, tip);
    g.rotation.z = 0.4;
    return g;
  }

  spawn(kind: PickupKind, pos: THREE.Vector3, spot = -1) {
    const mesh = this.proto[kind].clone();
    mesh.scale.setScalar(0.001);
    const still = spot >= 0;
    const p: Pickup = {
      kind, mesh, pos: pos.clone(), vel: new THREE.Vector3(), life: still ? Infinity : 22, t: Math.random() * 6, spot,
      grow: 0, gone: -1, rest: false,
    };
    if (still) {
      // map items sit at a fixed height above whatever they rest on, forever
      p.pos.y = this.world.groundAt(pos.x, pos.z, pos.y + 0.5) + 0.6;
      p.rest = true;
    } else {
      p.pos.y += 0.6;
      p.vel.set((Math.random() - 0.5) * 4, 7, (Math.random() - 0.5) * 4);
    }
    mesh.position.copy(p.pos);
    this.group.add(mesh);
    this.list.push(p);
  }

  private tmp = new THREE.Vector3();
  /**
   * Items are picked up when the player's body overlaps them (walking through,
   * or jumping over them), exactly once. `wants` says whether the player could
   * use an item right now (dropped ones then drift toward the player).
   */
  update(dt: number, playerPos: THREE.Vector3, playerHeight: number, wants: (k: PickupKind) => boolean, collect: (k: PickupKind) => boolean) {
    this.spots.forEach((sp, i) => {
      if (!sp.taken) return;
      sp.timer -= dt;
      if (sp.timer <= 0) {
        sp.taken = false;
        this.spawn(sp.kind, sp.pos, i);
      }
    });
    const chest = this.tmp.set(playerPos.x, playerPos.y + playerHeight * 0.45, playerPos.z);
    for (const p of this.list) {
      p.t += dt;
      if (p.gone >= 0) {
        // collected: quick pop up and shrink away
        p.gone += dt;
        const k = Math.min(1, p.gone / 0.22);
        p.mesh.position.y += dt * 4;
        p.mesh.scale.setScalar(1.3 * (1 + 0.35 * Math.sin(k * Math.PI)) * (1 - k));
        if (k >= 1) p.life = 0;
        continue;
      }
      p.life -= dt;
      if (!p.rest) {
        const dx = chest.x - p.pos.x, dy = chest.y - p.pos.y, dz = chest.z - p.pos.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 4.5 && d > 0.01 && wants(p.kind)) {
          // magnet toward the player, only for things they can use
          const k = Math.min(1, dt * 6);
          p.vel.x += ((dx / d) * 16 - p.vel.x) * k;
          p.vel.y += ((dy / d) * 16 - p.vel.y) * k;
          p.vel.z += ((dz / d) * 16 - p.vel.z) * k;
        } else {
          p.vel.y -= 25 * dt;
          p.vel.x *= 1 - Math.min(1, dt * 2);
          p.vel.z *= 1 - Math.min(1, dt * 2);
        }
        p.pos.addScaledVector(p.vel, dt);
        const g = this.world.groundAt(p.pos.x, p.pos.z, p.pos.y) + 0.6;
        if (p.pos.y <= g) {
          p.pos.y = g;
          p.vel.y = Math.max(0, p.vel.y);
          if (Math.abs(p.vel.x) + Math.abs(p.vel.z) < 0.05 && !wants(p.kind)) p.vel.set(0, 0, 0);
        }
      }
      // body overlap: horizontally inside the pickup radius, vertically between
      // a jump below the feet and the top of the head
      const hx = playerPos.x - p.pos.x, hz = playerPos.z - p.pos.z;
      const over = hx * hx + hz * hz < 1.25 * 1.25 && p.pos.y > playerPos.y - 3.1 && p.pos.y < playerPos.y + playerHeight + 0.4;
      if (over && p.grow > 0.5 && collect(p.kind)) {
        p.gone = 0;
        if (p.spot >= 0) {
          const sp = this.spots[p.spot];
          sp.taken = true;
          sp.timer = sp.respawn;
          this.onSpotTaken(p.spot);
        }
        continue;
      }
      // presentation only: gentle bob/spin, smooth grow-in and fade-out
      p.grow = Math.min(1, p.grow + dt / 0.35);
      const e = 1 - Math.pow(1 - p.grow, 3);
      const fade = p.life < 0.4 ? Math.max(0, p.life / 0.4) : 1;
      const pulse = p.life < 3 ? 0.92 + 0.08 * Math.sin(p.t * 10) : 1;
      p.mesh.position.set(p.pos.x, p.pos.y + Math.sin(p.t * 3) * 0.12, p.pos.z);
      p.mesh.rotation.y += dt * 2.5;
      p.mesh.scale.setScalar(1.3 * e * fade * pulse);
    }
    let w = 0;
    for (const p of this.list) {
      if (p.life > 0) this.list[w++] = p;
      else this.group.remove(p.mesh);
    }
    this.list.length = w;
  }

  clear() {
    for (const p of this.list) this.group.remove(p.mesh);
    this.list = [];
    for (const sp of this.spots) {
      sp.taken = true;
      sp.timer = sp.kind === 'minigun' ? 30 : 4;
    }
  }
}
