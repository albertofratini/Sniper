import * as THREE from 'three';
import { Materials } from '../environment/Materials';
import { CollisionWorld, RayHit } from './Collision';
import { Effects } from './Effects';

export type ProjKind = 'rocket' | 'dart' | 'bolt' | 'bomb';

export interface Projectile {
  kind: ProjKind;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  radius: number;
  gravity: number;
  hostile: boolean;
  trailT: number;
  active: boolean;
}

export interface ProjectileHooks {
  /** returns true if something (an enemy) was hit by a friendly projectile */
  hitEnemies(p: Projectile, from: THREE.Vector3, to: THREE.Vector3): boolean;
  hitPlayer(p: Projectile): boolean;
  explode(p: Projectile, at: THREE.Vector3, normal: THREE.Vector3 | null): void;
  impact(p: Projectile, hit: RayHit): void;
}

const tmpDir = new THREE.Vector3();
const tmpHit: RayHit = { dist: 0, normal: new THREE.Vector3(), point: new THREE.Vector3(), box: null };

export class Projectiles {
  readonly group = new THREE.Group();
  list: Projectile[] = [];
  private pools = new Map<ProjKind, THREE.Object3D[]>();

  constructor(private mats: Materials, private world: CollisionWorld, private fx: Effects) {}

  private makeMesh(kind: ProjKind): THREE.Object3D {
    const g = new THREE.Group();
    if (kind === 'rocket') {
      const foam = this.mats.plastic(0xff8a1f, 0.85);
      const blue = this.mats.plastic(0x3fa9ff, 0.4);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 12), foam);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), foam);
      nose.rotation.x = -Math.PI / 2;
      nose.position.z = -0.35;
      g.add(nose);
      for (let i = 0; i < 3; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.22), blue);
        fin.position.z = 0.3;
        fin.rotation.z = (i / 3) * Math.PI * 2;
        fin.position.x = Math.sin(fin.rotation.z) * 0.14;
        fin.position.y = Math.cos(fin.rotation.z) * 0.14;
        g.add(fin);
      }
    } else if (kind === 'dart') {
      const red = this.mats.plastic(0xff4d3d, 0.7);
      const tip = this.mats.plastic(0xffcf33, 0.4);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8), red);
      b.rotation.x = Math.PI / 2;
      g.add(b);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.06, 10), tip);
      c.rotation.x = Math.PI / 2;
      c.position.z = -0.25;
      g.add(c);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff6040, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      g.add(glow);
    } else if (kind === 'bolt') {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 3, 3.2), toneMapped: false }));
      g.add(core);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      g.add(halo);
    } else {
      const m = this.mats.plastic(0x2a2d36, 0.4);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), m);
      g.add(ball);
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6), this.mats.plastic(0xd8b25a, 0.4));
      fuse.position.y = 0.55;
      g.add(fuse);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2, 0.6), toneMapped: false }));
      spark.position.y = 0.72;
      g.add(spark);
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });
    return g;
  }

  spawn(kind: ProjKind, pos: THREE.Vector3, vel: THREE.Vector3, damage: number, hostile: boolean) {
    let pool = this.pools.get(kind);
    if (!pool) this.pools.set(kind, (pool = []));
    const mesh = pool.pop() ?? this.makeMesh(kind);
    mesh.visible = true;
    this.group.add(mesh);
    const p: Projectile = {
      kind, mesh, pos: pos.clone(), vel: vel.clone(), damage, hostile,
      life: kind === 'bomb' ? 6 : 5,
      radius: kind === 'bomb' ? 0.5 : kind === 'bolt' ? 0.3 : kind === 'rocket' ? 0.2 : 0.12,
      gravity: kind === 'bomb' ? 22 : kind === 'dart' ? 2.5 : 0,
      trailT: 0,
      active: true,
    };
    mesh.position.copy(pos);
    this.orient(p);
    this.list.push(p);
    return p;
  }

  private orient(p: Projectile) {
    if (p.kind === 'bomb') {
      p.mesh.rotation.x += 0.1;
      return;
    }
    tmpDir.copy(p.vel).normalize();
    p.mesh.lookAt(p.pos.x - tmpDir.x, p.pos.y - tmpDir.y, p.pos.z - tmpDir.z);
  }

  private release(p: Projectile) {
    p.active = false;
    p.mesh.visible = false;
    this.group.remove(p.mesh);
    this.pools.get(p.kind)!.push(p.mesh);
  }

  update(dt: number, hooks: ProjectileHooks) {
    const from = new THREE.Vector3();
    for (const p of this.list) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.kind === 'rocket' || p.kind === 'bomb') hooks.explode(p, p.pos, null);
        this.release(p);
        continue;
      }
      from.copy(p.pos);
      p.vel.y -= p.gravity * dt;
      const step = p.vel.length() * dt;
      tmpDir.copy(p.vel).normalize();
      const hit = this.world.raycast(from, tmpDir, step + p.radius, tmpHit);
      p.pos.addScaledVector(p.vel, dt);

      // trails
      p.trailT -= dt;
      if (p.trailT <= 0) {
        if (p.kind === 'rocket') {
          p.trailT = 0.025;
          const back = p.pos.clone().addScaledVector(tmpDir, -0.45);
          this.fx.glow(back, 0xffb040, 0.7, 0.1, 0.18);
          this.fx.puff(back, 0xf4efe8, 0.25, 0.8, 0.6, undefined, 0.6);
        } else if (p.kind === 'bolt') {
          p.trailT = 0.03;
          this.fx.glow(p.pos, 0x40d8ff, 0.7, 0.05, 0.25);
        } else if (p.kind === 'bomb') {
          p.trailT = 0.05;
          this.fx.glow(p.pos.clone().add(new THREE.Vector3(0, 0.7, 0)), 0xffc040, 0.4, 0.05, 0.25, new THREE.Vector3(0, 2, 0));
        } else {
          p.trailT = 0.04;
          this.fx.glow(p.pos, 0xff6040, 0.35, 0.05, 0.15);
        }
      }

      // entities
      if (!p.hostile) {
        if (hooks.hitEnemies(p, from, p.pos)) {
          this.release(p);
          continue;
        }
      } else if (hooks.hitPlayer(p)) {
        if (p.kind === 'bomb') hooks.explode(p, p.pos, null);
        this.release(p);
        continue;
      }

      if (hit) {
        if (p.kind === 'rocket' || p.kind === 'bomb') {
          if (p.kind === 'bomb' && hit.normal.y < 0.5 && p.life > 0.3) {
            // bombs bounce off walls
            p.pos.copy(hit.point).addScaledVector(hit.normal, p.radius);
            const vn = p.vel.dot(hit.normal);
            p.vel.addScaledVector(hit.normal, -1.6 * vn);
            continue;
          }
          hooks.explode(p, hit.point.clone().addScaledVector(hit.normal, 0.3), hit.normal);
        } else hooks.impact(p, hit);
        this.release(p);
        continue;
      }
      p.mesh.position.copy(p.pos);
      this.orient(p);
      if (p.kind === 'rocket') p.mesh.rotateZ(dt * 12);
    }
    if (this.list.length > 64 || this.list.some((p) => !p.active)) this.list = this.list.filter((p) => p.active);
  }

  clear() {
    for (const p of this.list) if (p.active) this.release(p);
    this.list = [];
  }
}
