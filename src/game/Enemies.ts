import * as THREE from 'three';
import { Materials } from '../environment/Materials';
import { rbox } from '../environment/Builder';
import { CollisionWorld, NavGrid } from './Collision';
import { Effects } from './Effects';
import { Projectiles } from './Projectiles';
import { Player } from './Player';
import { audio } from './Audio';

export type EnemyType = 'trooper' | 'robot' | 'chomper' | 'bug' | 'boss';

export interface EnemyCtx {
  player: Player;
  world: CollisionWorld;
  nav: NavGrid;
  fx: Effects;
  proj: Projectiles;
  time: number;
  spawn(type: EnemyType, pos: THREE.Vector3): void;
  shockwave(pos: THREE.Vector3): void;
  onKilled(e: Enemy): void;
  playerVisible: boolean;
}

export interface HitSphere {
  c: THREE.Vector3;
  r: number;
  mult: number;
  local: THREE.Vector3;
  bone: THREE.Object3D;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

let blobGeo: THREE.PlaneGeometry | null = null;
let blobMat: THREE.MeshBasicMaterial | null = null;

function panFor(player: Player, p: THREE.Vector3) {
  const right = v2.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const d = v1.subVectors(p, player.pos).normalize();
  return Math.max(-1, Math.min(1, d.dot(right)));
}

/** Base toy enemy: physics, navigation, hit flash, pop-in, and toy-piece death. */
export abstract class Enemy {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp = 1;
  maxHp = 1;
  radius = 0.5;
  height = 1.8;
  speed = 5;
  grounded = true;
  dead = false;
  remove = false;
  score = 100;
  abstract type: EnemyType;
  colors: number[] = [];
  hitSpheres: HitSphere[] = [];
  protected flashMats: THREE.MeshStandardMaterial[] = [];
  protected flash = 0;
  protected stagger = 0;
  protected spawnT = 0;
  protected losT = 0;
  protected hasLos = false;
  protected stuckT = 0;
  protected lastPos = new THREE.Vector3();
  protected seed = Math.random() * 1000;
  protected anim = 0;
  protected blob: THREE.Mesh;
  protected scaleBase = 1;
  /** pieces that pop off on death */
  protected detach: THREE.Object3D[] = [];
  knockResist = 1;

  constructor(protected mats: Materials) {
    this.group.add(this.body);
    if (!blobGeo) {
      blobGeo = new THREE.PlaneGeometry(1, 1);
      blobGeo.rotateX(-Math.PI / 2);
      blobMat = new THREE.MeshBasicMaterial({ map: mats.blob, transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -1 });
    }
    this.blob = new THREE.Mesh(blobGeo, blobMat!);
    this.blob.renderOrder = 2;
  }

  /** Per-instance material so hit flashes don't affect other enemies. */
  protected mat(color: number, rough = 0.35, metal = 0, emissive = 0, ei = 0) {
    const m = new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal, map: this.mats.plasticMap,
      roughnessMap: rough < 0.6 ? this.mats.plasticRough : null,
      emissive, emissiveIntensity: ei,
    });
    m.userData.baseEmissive = new THREE.Color(emissive);
    m.userData.baseEI = ei;
    this.flashMats.push(m);
    return m;
  }

  protected add(geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], parent: THREE.Object3D = this.body, rot: [number, number, number] = [0, 0, 0]) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.castShadow = false;
    parent.add(mesh);
    return mesh;
  }

  protected sphere(r: number, local: [number, number, number], mult = 1, bone: THREE.Object3D = this.body) {
    this.hitSpheres.push({ c: new THREE.Vector3(), r, mult, local: new THREE.Vector3(...local), bone });
  }

  place(p: THREE.Vector3, scene: THREE.Object3D) {
    this.pos.copy(p);
    this.lastPos.copy(p);
    this.group.position.copy(p);
    this.spawnT = 0;
    scene.add(this.group);
    scene.add(this.blob);
    this.blob.scale.setScalar(this.radius * 3);
  }

  dispose(scene: THREE.Object3D) {
    scene.remove(this.group);
    scene.remove(this.blob);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    for (const m of this.flashMats) m.dispose();
  }

  updateHitSpheres() {
    this.group.updateMatrixWorld(true);
    for (const s of this.hitSpheres) s.c.copy(s.local).applyMatrix4(s.bone.matrixWorld);
  }

  /** Ray vs hit spheres. Returns distance and multiplier or null. */
  rayHit(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, pad = 0): { t: number; mult: number } | null {
    if (this.dead) return null;
    let best: { t: number; mult: number } | null = null;
    for (const s of this.hitSpheres) {
      const r = s.r * this.scaleBase + pad;
      const ocx = o.x - s.c.x, ocy = o.y - s.c.y, ocz = o.z - s.c.z;
      const b = ocx * d.x + ocy * d.y + ocz * d.z;
      const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > maxDist) continue;
      if (!best || t < best.t) best = { t, mult: s.mult };
    }
    return best;
  }

  distTo(p: THREE.Vector3) {
    let best = Infinity;
    for (const s of this.hitSpheres) best = Math.min(best, s.c.distanceTo(p) - s.r);
    return Math.max(0, best);
  }

  takeDamage(amount: number, dir: THREE.Vector3 | null, ctx: EnemyCtx, knock = 1) {
    if (this.dead) return false;
    this.hp -= amount;
    this.flash = 1;
    if (dir) {
      this.vel.addScaledVector(dir, (Math.min(amount, 60) / 6) * knock / this.knockResist);
      this.stagger = Math.min(0.35, this.stagger + (amount / this.maxHp) * 1.2 / this.knockResist);
    }
    if (this.hp <= 0) {
      this.die(ctx, dir);
      return true;
    }
    return false;
  }

  protected die(ctx: EnemyCtx, dir: THREE.Vector3 | null) {
    this.dead = true;
    this.updateHitSpheres();
    const c = v1.copy(this.pos).add(new THREE.Vector3(0, this.height * 0.5, 0));
    ctx.fx.fragments(c, this.colors, this.type === 'bug' ? 8 : this.type === 'boss' ? 60 : 18, this.type === 'boss' ? 14 : 7, this.type === 'boss' ? 0.5 : 0.16, 7);
    ctx.fx.confetti(c, this.type === 'bug' ? 6 : 16);
    ctx.fx.glow(c, 0xffe0a0, this.height * 1.4, 0.2, 0.25);
    ctx.fx.puff(c, 0xffffff, this.height * 0.4, this.height * 0.9, 0.5);
    audio.enemyDeath(this.type === 'robot' || this.type === 'boss');
    debris.launch(this, dir);
    ctx.onKilled(this);
  }

  protected faceToward(target: THREE.Vector3, dt: number, rate = 8) {
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * rate);
  }

  protected moveDir = new THREE.Vector3();
  /** Choose a walking direction toward the player using LOS or the flow field. */
  protected navigate(ctx: EnemyCtx, dt: number, directRange = 14) {
    const p = ctx.player.pos;
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.2 + Math.random() * 0.15;
      const eye = v1.copy(this.pos).setY(this.pos.y + this.height * 0.7);
      this.hasLos = ctx.world.lineOfSight(eye, ctx.player.headPos);
    }
    const dist = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    const playerHigh = ctx.player.pos.y > this.pos.y + 3;
    if ((this.hasLos && dist < directRange && !playerHigh) || dist < 2) {
      this.moveDir.set(p.x - this.pos.x, 0, p.z - this.pos.z).normalize();
    } else if (!ctx.nav.steer(this.pos.x, this.pos.z, this.moveDir)) {
      this.moveDir.set(p.x - this.pos.x, 0, p.z - this.pos.z).normalize();
    }
    // unstick
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      if (this.pos.distanceTo(this.lastPos) < 0.6) {
        this.vel.x += (Math.random() - 0.5) * 12;
        this.vel.z += (Math.random() - 0.5) * 12;
        if (this.grounded) this.vel.y = 7;
      }
      this.stuckT = 0;
      this.lastPos.copy(this.pos);
    }
    return dist;
  }

  protected walk(dir: THREE.Vector3, speed: number, dt: number, accel = 30) {
    const tx = dir.x * speed, tz = dir.z * speed;
    const a = (this.grounded ? accel : accel * 0.15) * dt;
    const dx = tx - this.vel.x, dz = tz - this.vel.z;
    const l = Math.hypot(dx, dz);
    if (l > a) {
      this.vel.x += (dx / l) * a;
      this.vel.z += (dz / l) * a;
    } else {
      this.vel.x = tx;
      this.vel.z = tz;
    }
  }

  protected physics(ctx: EnemyCtx, dt: number) {
    this.vel.y -= 30 * dt;
    if (this.stagger > 0) {
      this.vel.x *= 1 - Math.min(1, dt * 3);
      this.vel.z *= 1 - Math.min(1, dt * 3);
    }
    this.grounded = ctx.world.moveCylinder(this.pos, this.vel, dt, this.radius, this.height, 0.6);
  }

  update(dt: number, ctx: EnemyCtx) {
    this.anim += dt;
    this.spawnT += dt;
    this.stagger = Math.max(0, this.stagger - dt);
    this.think(dt, ctx);
    this.physics(ctx, dt);

    // pop-in
    let s = 1;
    if (this.spawnT < 0.45) {
      const t = this.spawnT / 0.45;
      s = 1 + Math.sin(t * Math.PI * 1.5) * (1 - t) * 0.6;
      s *= Math.min(1, t * 2.5);
    }
    this.group.scale.setScalar(s * this.scaleBase);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    // flash
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 7);
      for (const m of this.flashMats) {
        m.emissive.copy(m.userData.baseEmissive).lerp(new THREE.Color(1, 1, 1), this.flash);
        m.emissiveIntensity = m.userData.baseEI + this.flash * 0.9;
      }
    }

    // blob shadow
    const g = ctx.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.2);
    this.blob.position.set(this.pos.x, g + 0.03, this.pos.z);
    const h = Math.max(0, this.pos.y - g);
    this.blob.scale.setScalar(this.radius * 3 * this.scaleBase * Math.max(0.4, 1 - h * 0.08));
    this.updateHitSpheres();
  }

  protected abstract think(dt: number, ctx: EnemyCtx): void;
}

// ----------------------------------------------------------------------------- debris

interface Piece { obj: THREE.Object3D; vel: THREE.Vector3; av: THREE.Vector3; life: number; s: number }

class DebrisSystem {
  scene: THREE.Object3D | null = null;
  pieces: Piece[] = [];
  world: CollisionWorld | null = null;

  launch(e: Enemy, dir: THREE.Vector3 | null) {
    if (!this.scene) return;
    const parts = (e as unknown as { detach: THREE.Object3D[] }).detach;
    e.group.updateMatrixWorld(true);
    for (const p of parts) {
      const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
      p.matrixWorld.decompose(wp, wq, ws);
      this.scene.add(p);
      p.position.copy(wp);
      p.quaternion.copy(wq);
      p.scale.copy(ws);
      const out = wp.clone().sub(e.pos).setY(0).normalize();
      const v = out.multiplyScalar(3 + Math.random() * 5).add(new THREE.Vector3(0, 6 + Math.random() * 6, 0));
      if (dir) v.addScaledVector(dir, 4);
      this.pieces.push({ obj: p, vel: v, av: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14), life: 1.6 + Math.random() * 0.6, s: ws.x });
    }
    // overflow: drop oldest
    while (this.pieces.length > 70) {
      const p = this.pieces.shift()!;
      this.scene.remove(p.obj);
    }
  }

  update(dt: number) {
    for (const p of this.pieces) {
      p.life -= dt;
      p.vel.y -= 28 * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      const g = this.world ? this.world.groundAt(p.obj.position.x, p.obj.position.z, p.obj.position.y + 0.5) : 0;
      if (p.obj.position.y < g + 0.1) {
        p.obj.position.y = g + 0.1;
        if (p.vel.y < 0) p.vel.y *= -0.4;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
        p.av.multiplyScalar(0.7);
      }
      p.obj.rotation.x += p.av.x * dt;
      p.obj.rotation.y += p.av.y * dt;
      p.obj.rotation.z += p.av.z * dt;
      if (p.life < 0.3) p.obj.scale.setScalar(Math.max(0.001, p.s * (p.life / 0.3)));
      if (p.life <= 0) {
        this.scene?.remove(p.obj);
        p.obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
      }
    }
    this.pieces = this.pieces.filter((p) => p.life > 0);
  }

  clear() {
    for (const p of this.pieces) this.scene?.remove(p.obj);
    this.pieces = [];
  }
}
export const debris = new DebrisSystem();

// ----------------------------------------------------------------------------- Trooper

/** Red Brigade plastic trooper: moulded on its base, so it hops everywhere. */
export class Trooper extends Enemy {
  type: EnemyType = 'trooper';
  private gun = new THREE.Group();
  private muzzle = new THREE.Object3D();
  private state: 'advance' | 'aim' | 'recover' | 'strafe' = 'advance';
  private stateT = 0;
  private fireCd = 1 + Math.random() * 1.5;
  private strafeDir = 1;
  private hop = 0;
  private muzzleGlow: THREE.Mesh;
  private holdDist = 10 + Math.random() * 12;

  constructor(mats: Materials, hard = false) {
    super(mats);
    const col = hard ? 0xb02a20 : 0xd8352a;
    this.colors = [col, 0xe85a4a, 0x8f1f17];
    const m = this.mat(col, 0.38);
    this.radius = 0.5;
    this.height = 1.9;
    this.hp = this.maxHp = hard ? 40 : 30;
    this.speed = 6.2;
    this.score = 100;

    const base = this.add(rbox(0.95, 0.12, 0.75, 0.05), m, [0, 0.06, 0]);
    const sprue = this.add(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 6), m, [0.42, 0.14, -0.3]);
    void sprue;
    const legs = new THREE.Group();
    this.body.add(legs);
    this.add(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), m, [-0.14, 0.45, 0.05], legs, [0.15, 0, 0]);
    this.add(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), m, [0.14, 0.42, -0.1], legs, [-0.25, 0, 0]);
    const torso = this.add(rbox(0.5, 0.58, 0.32, 0.1), m, [0, 1.0, 0]);
    this.add(new THREE.TorusGeometry(0.22, 0.04, 6, 14), m, [0, 0.76, 0], this.body, [Math.PI / 2, 0, 0]);
    const pack = this.add(rbox(0.36, 0.4, 0.18, 0.06), m, [0, 1.05, -0.24]);
    const head = new THREE.Group();
    head.position.set(0, 1.5, 0);
    this.body.add(head);
    this.add(new THREE.SphereGeometry(0.19, 12, 10), m, [0, 0, 0.02], head);
    this.add(new THREE.SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m, [0, 0.06, 0], head);
    this.add(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), m, [0, 0.06, 0], head);
    // little painted face so they read at distance
    const eye = new THREE.MeshBasicMaterial({ color: 0x2a0a08 });
    this.add(new THREE.SphereGeometry(0.03, 6, 4), eye, [-0.07, 0.0, 0.18], head);
    this.add(new THREE.SphereGeometry(0.03, 6, 4), eye, [0.07, 0.0, 0.18], head);
    // gun + arms (moulded together)
    this.gun.position.set(0.05, 1.2, 0.05);
    this.body.add(this.gun);
    this.add(rbox(0.09, 0.12, 0.85, 0.03), m, [0.1, -0.05, 0.3], this.gun);
    this.add(rbox(0.07, 0.18, 0.08, 0.02), m, [0.1, -0.17, 0.12], this.gun);
    this.add(new THREE.CapsuleGeometry(0.075, 0.32, 4, 8), m, [0.22, -0.02, 0.06], this.gun, [1.2, 0, 0.2]);
    this.add(new THREE.CapsuleGeometry(0.075, 0.38, 4, 8), m, [-0.12, -0.04, 0.2], this.gun, [1.3, 0, -0.6]);
    this.muzzle.position.set(0.1, -0.03, 0.78);
    this.gun.add(this.muzzle);
    this.muzzleGlow = this.add(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [0.1, -0.03, 0.8], this.gun);
    this.detach = [head, pack, this.gun, base, torso];
    this.sphere(0.42, [0, 0.95, 0]);
    this.sphere(0.3, [0, 0.45, 0]);
    this.sphere(0.26, [0, 0.08, 0.02], 1.6, head);
    this.body.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== this.muzzleGlow) (o as THREE.Mesh).castShadow = false; });
  }

  protected think(dt: number, ctx: EnemyCtx) {
    const pl = ctx.player;
    this.stateT -= dt;
    this.fireCd -= dt;
    const dist = this.navigate(ctx, dt, 18);
    let moving = false;
    const glowM = this.muzzleGlow.material as THREE.MeshBasicMaterial;
    glowM.opacity = Math.max(0, glowM.opacity - dt * 3);

    if (this.stagger > 0.05) {
      this.state = 'recover';
      this.stateT = Math.max(this.stateT, 0.15);
    }

    switch (this.state) {
      case 'advance':
        if (dist > this.holdDist || !this.hasLos) {
          this.walk(this.moveDir, this.speed, dt);
          moving = true;
        } else this.walk(this.moveDir, 0, dt);
        this.faceToward(v1.copy(this.pos).add(this.vel), dt, 6);
        if (this.hasLos && dist < 38 && this.fireCd <= 0 && this.spawnT > 0.8) {
          this.state = 'aim';
          this.stateT = 0.5;
        } else if (this.hasLos && dist < this.holdDist && this.stateT <= 0) {
          this.state = 'strafe';
          this.stateT = 0.8 + Math.random();
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        }
        break;
      case 'strafe': {
        const to = v1.set(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z).normalize();
        const side = v2.set(to.z * this.strafeDir, 0, -to.x * this.strafeDir);
        if (dist < 6) side.addScaledVector(to, -0.8);
        this.walk(side.normalize(), this.speed * 0.7, dt);
        moving = true;
        this.faceToward(pl.pos, dt, 8);
        if (this.stateT <= 0) { this.state = 'advance'; this.stateT = 1 + Math.random(); }
        if (this.fireCd <= 0 && this.hasLos) { this.state = 'aim'; this.stateT = 0.5; }
        break;
      }
      case 'aim':
        this.walk(this.moveDir, 0, dt);
        this.faceToward(pl.pos, dt, 12);
        glowM.opacity = Math.min(0.9, (0.5 - this.stateT) * 2.2);
        if (this.stateT <= 0) {
          this.shoot(ctx);
          this.state = 'recover';
          this.stateT = 0.35;
          this.fireCd = 1.3 + Math.random() * 1.0;
        }
        break;
      case 'recover':
        this.walk(this.moveDir, 0, dt);
        if (this.stateT <= 0) { this.state = Math.random() < 0.5 ? 'strafe' : 'advance'; this.stateT = 0.8 + Math.random(); this.strafeDir = Math.random() < 0.5 ? -1 : 1; }
        break;
    }

    // aim gun pitch
    const aiming = this.state === 'aim' || this.state === 'recover';
    const dy = pl.pos.y + 1.2 - (this.pos.y + 1.2);
    const pitch = aiming ? -Math.atan2(dy, Math.max(1, dist)) : 0.15;
    this.gun.rotation.x += (pitch - this.gun.rotation.x) * Math.min(1, dt * 10);

    // hop animation (they're glued to a base!)
    if (moving && this.grounded) {
      this.hop += dt * 9;
    } else {
      this.hop += (Math.round(this.hop / Math.PI) * Math.PI - this.hop) * Math.min(1, dt * 10);
    }
    const h = Math.abs(Math.sin(this.hop));
    this.body.position.y = h * 0.32;
    const squash = 1 - (1 - h) * (moving ? 0.12 : 0);
    this.body.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6);
    this.body.rotation.x = moving ? 0.12 + Math.cos(this.hop) * 0.08 : 0;
    this.body.rotation.z = this.stagger * 1.2 * Math.sin(this.anim * 40);
  }

  private shoot(ctx: EnemyCtx) {
    const pl = ctx.player;
    const from = this.muzzle.getWorldPosition(new THREE.Vector3());
    const target = pl.centerPos.add(new THREE.Vector3(0, 0.2, 0));
    const dist = from.distanceTo(target);
    const speed = 34;
    target.addScaledVector(pl.vel, (dist / speed) * 0.6);
    const inacc = 0.03 + dist * 0.001;
    const dir = target.sub(from).normalize();
    dir.x += (Math.random() - 0.5) * inacc * 2;
    dir.y += (Math.random() - 0.5) * inacc;
    dir.z += (Math.random() - 0.5) * inacc * 2;
    dir.normalize();
    ctx.proj.spawn('dart', from, dir.multiplyScalar(speed), 8, true);
    ctx.fx.glow(from, 0xffa060, 0.8, 0.1, 0.1);
    audio.enemyShot(panFor(pl, from), dist);
    this.body.position.z -= 0.08;
  }
}

// ----------------------------------------------------------------------------- Robot

/** Clank Bot: wind-up tin robot. Slow, tanky, fires charged bolt volleys. */
export class Robot extends Enemy {
  type: EnemyType = 'robot';
  private key = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private eyes: THREE.MeshStandardMaterial;
  private chest: THREE.MeshStandardMaterial;
  private bulb: THREE.MeshStandardMaterial;
  private state: 'walk' | 'charge' | 'slam' | 'cool' = 'walk';
  private stateT = 0;
  private fireCd = 1.5 + Math.random();
  private head = new THREE.Group();

  constructor(mats: Materials) {
    super(mats);
    this.colors = [0xc8402f, 0xb8c0cc, 0xffcf33, 0x3a3f4a];
    this.radius = 1.1;
    this.height = 3.5;
    this.hp = this.maxHp = 190;
    this.speed = 3.4;
    this.score = 400;
    this.knockResist = 3;
    const red = this.mat(0xc8402f, 0.3, 0.55);
    const tin = this.mat(0xb8c0cc, 0.25, 0.9);
    const yel = this.mat(0xffcf33, 0.35, 0.3);
    const dark = this.mat(0x3a3f4a, 0.5, 0.5);
    this.eyes = this.mat(0x331100, 0.3, 0, 0xffc030, 2.5);
    this.chest = this.mat(0x102030, 0.3, 0, 0x40d8ff, 1.2);
    this.bulb = this.mat(0x400000, 0.3, 0, 0xff3020, 2);

    for (const [leg, x] of [[this.legL, -0.42], [this.legR, 0.42]] as const) {
      leg.position.set(x, 1.1, 0);
      this.body.add(leg);
      this.add(rbox(0.5, 0.9, 0.55, 0.1), tin, [0, -0.45, 0], leg);
      this.add(rbox(0.66, 0.28, 0.85, 0.1), red, [0, -0.98, 0.1], leg);
    }
    const torso = this.add(rbox(1.6, 1.4, 1.1, 0.22), red, [0, 1.85, 0]);
    this.add(rbox(1.64, 0.14, 1.14, 0.05), yel, [0, 1.3, 0]);
    this.add(rbox(1.64, 0.14, 1.14, 0.05), yel, [0, 2.45, 0]);
    this.add(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 20), this.chest, [0, 1.9, 0.56], this.body, [Math.PI / 2, 0, 0]);
    this.add(new THREE.TorusGeometry(0.36, 0.06, 8, 20), tin, [0, 1.9, 0.57]);
    for (let i = 0; i < 4; i++) this.add(new THREE.SphereGeometry(0.06, 6, 4), tin, [-0.65 + (i % 2) * 1.3, 1.45 + Math.floor(i / 2) * 0.85, 0.56]);
    this.head.position.set(0, 2.55, 0);
    this.body.add(this.head);
    const headM = this.add(rbox(1.05, 0.78, 0.85, 0.18), tin, [0, 0.4, 0], this.head);
    void headM;
    this.add(new THREE.SphereGeometry(0.15, 12, 8), this.eyes, [-0.24, 0.48, 0.42], this.head);
    this.add(new THREE.SphereGeometry(0.15, 12, 8), this.eyes, [0.24, 0.48, 0.42], this.head);
    for (let i = 0; i < 4; i++) this.add(new THREE.BoxGeometry(0.08, 0.16, 0.04), dark, [-0.18 + i * 0.12, 0.17, 0.43], this.head);
    this.add(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 6), tin, [0, 0.98, 0], this.head);
    this.add(new THREE.SphereGeometry(0.11, 10, 8), this.bulb, [0, 1.25, 0], this.head);
    for (const s of [-1, 1]) this.add(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12), yel, [s * 0.56, 0.42, 0], this.head, [0, 0, Math.PI / 2]);
    // arms
    for (const [arm, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(s * 0.95, 2.3, 0);
      this.body.add(arm);
      this.add(new THREE.SphereGeometry(0.2, 10, 8), yel, [0, 0, 0], arm);
      this.add(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 10), tin, [0, -0.5, 0.1], arm, [0.2, 0, 0]);
      this.add(rbox(0.12, 0.3, 0.12, 0.04), dark, [-0.07, -1.05, 0.25], arm, [0.4, 0, 0]);
      this.add(rbox(0.12, 0.3, 0.12, 0.04), dark, [0.07, -1.05, 0.25], arm, [0.4, 0, 0]);
    }
    // wind-up key on back
    this.key.position.set(0, 1.9, -0.6);
    this.body.add(this.key);
    this.add(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 8), tin, [0, 0, -0.2], this.key, [Math.PI / 2, 0, 0]);
    this.add(new THREE.TorusGeometry(0.22, 0.07, 8, 16), yel, [-0.25, 0, -0.42], this.key, [0, Math.PI / 2, 0]);
    this.add(new THREE.TorusGeometry(0.22, 0.07, 8, 16), yel, [0.25, 0, -0.42], this.key, [0, Math.PI / 2, 0]);
    this.detach = [this.head, this.armL, this.armR, this.key, torso, this.legL];
    this.sphere(0.95, [0, 1.85, 0]);
    this.sphere(0.6, [0, 0.45, 0], 1.5, this.head);
    this.sphere(0.55, [0, 0.7, 0]);
  }

  protected think(dt: number, ctx: EnemyCtx) {
    const pl = ctx.player;
    this.stateT -= dt;
    this.fireCd -= dt;
    const dist = this.navigate(ctx, dt, 20);
    let walking = false;
    this.key.rotation.z += dt * (this.state === 'charge' ? 14 : 3);
    this.bulb.emissiveIntensity = Math.sin(this.anim * 6) > 0 ? 3 : 0.3;

    switch (this.state) {
      case 'walk':
        if (dist > 7 || !this.hasLos) {
          this.walk(this.moveDir, this.speed, dt, 12);
          walking = true;
        } else this.walk(this.moveDir, 0, dt, 12);
        this.faceToward(this.hasLos ? pl.pos : v1.copy(this.pos).add(this.moveDir), dt, 3);
        if (dist < 3.6 && Math.abs(pl.pos.y - this.pos.y) < 2.5) {
          this.state = 'slam';
          this.stateT = 0.7;
        } else if (this.hasLos && dist < 34 && this.fireCd <= 0 && this.spawnT > 1) {
          this.state = 'charge';
          this.stateT = 0.9;
          audio.windup();
        }
        break;
      case 'charge':
        this.walk(this.moveDir, 0, dt, 12);
        this.faceToward(pl.pos, dt, 5);
        this.body.position.x = Math.sin(this.anim * 60) * 0.04;
        this.chest.emissiveIntensity = 1.2 + (0.9 - this.stateT) * 6;
        this.eyes.emissive.setHex(0xff4020);
        if (this.stateT <= 0) {
          this.fire(ctx);
          this.state = 'cool';
          this.stateT = 0.6;
          this.fireCd = 2.6 + Math.random() * 1.2;
        }
        break;
      case 'slam': {
        this.walk(this.moveDir, 0, dt, 12);
        this.faceToward(pl.pos, dt, 6);
        const t = 1 - this.stateT / 0.7;
        const up = t < 0.6 ? t / 0.6 : 1 - (t - 0.6) / 0.4;
        this.armL.rotation.x = this.armR.rotation.x = -up * 2.6;
        if (this.stateT <= 0) {
          if (dist < 4.6 && Math.abs(pl.pos.y - this.pos.y) < 2.5) {
            const dir = v1.set(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z).normalize();
            if (pl.damage(20, this.pos)) pl.knock(dir, 14);
          }
          ctx.fx.puff(v1.copy(this.pos).addScaledVector(this.moveDir, 1.4), 0xffffff, 0.8, 2.2, 0.5);
          audio.stomp();
          pl.shake(0.25);
          this.state = 'cool';
          this.stateT = 0.8;
        }
        break;
      }
      case 'cool':
        this.walk(this.moveDir, 0, dt, 12);
        this.chest.emissiveIntensity += (1.2 - this.chest.emissiveIntensity) * Math.min(1, dt * 4);
        this.eyes.emissive.setHex(0xffc030);
        this.body.position.x = 0;
        if (this.stateT <= 0) this.state = 'walk';
        break;
    }
    // stomp-waddle
    if (walking) {
      const ph = this.anim * 5;
      this.legL.rotation.x = Math.sin(ph) * 0.45;
      this.legR.rotation.x = -Math.sin(ph) * 0.45;
      this.body.rotation.z = Math.sin(ph) * 0.07;
      this.body.position.y = Math.abs(Math.cos(ph)) * 0.12;
      if (this.state === 'walk') {
        this.armL.rotation.x = -Math.sin(ph) * 0.5;
        this.armR.rotation.x = Math.sin(ph) * 0.5;
      }
    } else {
      this.legL.rotation.x *= 0.9;
      this.legR.rotation.x *= 0.9;
      this.body.rotation.z *= 0.9;
      if (this.state !== 'slam') { this.armL.rotation.x *= 0.9; this.armR.rotation.x *= 0.9; }
    }
    this.head.rotation.z = this.stagger * Math.sin(this.anim * 30) * 0.8;
  }

  private fire(ctx: EnemyCtx) {
    const pl = ctx.player;
    const from = v1.set(0, 1.9, 0.7).applyMatrix4(this.group.matrixWorld).clone();
    const target = pl.centerPos;
    const base = target.clone().sub(from).normalize();
    const side = new THREE.Vector3().crossVectors(base, UP).normalize();
    for (let i = -1; i <= 1; i++) {
      const d = base.clone().addScaledVector(side, i * 0.09).normalize();
      ctx.proj.spawn('bolt', from, d.multiplyScalar(24), 14, true);
    }
    ctx.fx.glow(from, 0x60e8ff, 2.2, 0.2, 0.2);
    audio.laser(panFor(pl, from));
    this.vel.addScaledVector(base, -3);
  }
}

// ----------------------------------------------------------------------------- Chomper

/** Toy monster: googly-eyed chomping ball that pounces. */
export class Chomper extends Enemy {
  type: EnemyType = 'chomper';
  private jaw = new THREE.Group();
  private eyes: THREE.Object3D[] = [];
  private pupils: THREE.Object3D[] = [];
  private feet: THREE.Object3D[] = [];
  private state: 'chase' | 'crouch' | 'leap' | 'recover' = 'chase';
  private stateT = 0;
  private leapCd = 1 + Math.random();
  private hitThisLeap = false;
  private biteCd = 0;
  private wob = new THREE.Vector2();

  constructor(mats: Materials) {
    super(mats);
    const hue = [0x9b59d0, 0x2fb3b3, 0xff6fa8][Math.floor(Math.random() * 3)];
    this.colors = [hue, 0xffcf33, 0xffffff];
    this.radius = 0.75;
    this.height = 1.6;
    this.hp = this.maxHp = 55;
    this.speed = 10.5;
    this.score = 200;
    const m = this.mat(hue, 0.3);
    const belly = this.mat(0xfff0c8, 0.5);
    const horn = this.mat(0xffcf33, 0.3);
    const white = this.mat(0xffffff, 0.15);
    const mouth = this.mat(0x5a1030, 0.7);
    const black = new THREE.MeshBasicMaterial({ color: 0x111111 });

    const bodyM = this.add(new THREE.SphereGeometry(0.78, 20, 14), m, [0, 0.95, 0]);
    bodyM.scale.set(1, 0.85, 1);
    this.add(new THREE.SphereGeometry(0.62, 16, 10), belly, [0, 0.82, 0.28]).scale.set(0.9, 0.75, 0.6);
    this.add(new THREE.SphereGeometry(0.5, 14, 10), mouth, [0, 0.72, 0.42]).scale.set(1.1, 0.5, 0.6);
    // jaw
    this.jaw.position.set(0, 0.72, 0.05);
    this.body.add(this.jaw);
    const jm = this.add(new THREE.SphereGeometry(0.66, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), m, [0, 0.02, 0.1], this.jaw);
    jm.scale.set(1, 0.6, 1);
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      this.add(new THREE.ConeGeometry(0.08, 0.2, 6), white, [Math.sin(a) * 0.55, 0.05, 0.1 + Math.cos(a) * 0.55], this.jaw);
      this.add(new THREE.ConeGeometry(0.08, 0.22, 6), white, [Math.sin(a + 0.22) * 0.6, 0.66 - 0.72 + 0.12, 0.1 + Math.cos(a + 0.22) * 0.6], this.body, [Math.PI, 0, 0]).position.y = 0.78;
    }
    // googly eyes
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.3, 1.62, 0.28);
      this.body.add(eye);
      this.add(new THREE.SphereGeometry(0.24, 14, 10), white, [0, 0, 0], eye);
      const pupil = this.add(new THREE.SphereGeometry(0.11, 10, 8), black, [0, 0, 0.17], eye);
      this.eyes.push(eye);
      this.pupils.push(pupil);
      this.add(new THREE.ConeGeometry(0.12, 0.42, 8), horn, [s * 0.55, 1.5, -0.1], this.body, [-0.3, 0, -s * 0.5]);
    }
    for (const s of [-1, 1]) {
      const f = this.add(new THREE.SphereGeometry(0.22, 10, 8), horn, [s * 0.38, 0.18, 0.1]);
      f.scale.set(1, 0.6, 1.4);
      this.feet.push(f);
    }
    this.add(new THREE.ConeGeometry(0.2, 0.7, 8), m, [0, 0.7, -0.8], this.body, [-1.9, 0, 0]);
    for (let i = 0; i < 4; i++) this.add(new THREE.SphereGeometry(0.12, 8, 6), belly, [Math.sin(i * 2) * 0.6, 1.1 + Math.cos(i * 3) * 0.2, -0.45]).scale.set(1, 1, 0.4);
    this.detach = [this.jaw, ...this.eyes, bodyM];
    this.sphere(0.8, [0, 0.95, 0]);
    this.sphere(0.32, [0, 1.6, 0.25], 1.4);
  }

  protected think(dt: number, ctx: EnemyCtx) {
    const pl = ctx.player;
    this.stateT -= dt;
    this.leapCd -= dt;
    this.biteCd -= dt;
    const dist = this.navigate(ctx, dt, 16);
    const dy = pl.pos.y - this.pos.y;

    switch (this.state) {
      case 'chase':
        this.walk(this.moveDir, this.speed, dt, 40);
        this.faceToward(v1.copy(this.pos).add(this.moveDir), dt, 10);
        this.jaw.rotation.x = 0.25 + Math.sin(this.anim * 14) * 0.25;
        if (this.hasLos && dist < 10 && dist > 2.5 && this.leapCd <= 0 && this.grounded && dy < 4 && this.spawnT > 0.6) {
          this.state = 'crouch';
          this.stateT = 0.32;
          audio.growl(panFor(pl, this.pos));
        }
        if (dist < this.radius + 0.9 && Math.abs(dy) < 1.5 && this.biteCd <= 0) {
          this.biteCd = 0.8;
          this.jaw.rotation.x = 0;
          pl.damage(8, this.pos);
        }
        break;
      case 'crouch':
        this.walk(this.moveDir, 0, dt, 40);
        this.faceToward(pl.pos, dt, 14);
        this.body.scale.set(1.2, 0.7, 1.2);
        this.jaw.rotation.x = 0.7;
        if (this.stateT <= 0) {
          const lead = pl.pos.clone().addScaledVector(pl.vel, 0.4);
          const d = v1.set(lead.x - this.pos.x, 0, lead.z - this.pos.z);
          const flight = 0.62;
          const hs = Math.min(22, d.length() / flight);
          d.normalize();
          this.vel.set(d.x * hs, 9.5 + Math.max(0, dy) * 1.2, d.z * hs);
          this.grounded = false;
          this.state = 'leap';
          this.stateT = 1.4;
          this.hitThisLeap = false;
        }
        break;
      case 'leap':
        this.body.scale.set(0.85, 1.25, 0.85);
        this.jaw.rotation.x = 0.9;
        this.body.rotation.x = -0.4;
        if (!this.hitThisLeap && pl.centerPos.distanceTo(v1.copy(this.pos).setY(this.pos.y + 0.9)) < this.radius + 0.9) {
          this.hitThisLeap = true;
          const dir = v2.set(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z).normalize();
          if (pl.damage(15, this.pos)) pl.knock(dir, 10);
          this.vel.multiplyScalar(-0.3);
        }
        if ((this.grounded && this.stateT < 1.3) || this.stateT <= 0) {
          this.state = 'recover';
          this.stateT = 0.55;
          this.leapCd = 1.8 + Math.random() * 1.5;
          ctx.fx.puff(this.pos, 0xffffff, 0.4, 1.2, 0.4);
        }
        break;
      case 'recover':
        this.walk(this.moveDir, 0, dt, 30);
        this.jaw.rotation.x = 0.1;
        this.body.rotation.x *= 0.85;
        if (this.stateT <= 0) this.state = 'chase';
        break;
    }
    if (this.state !== 'crouch' && this.state !== 'leap') {
      this.body.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 10));
      this.body.rotation.x *= 0.9;
    }
    // run cycle
    const ph = this.anim * 16;
    const sp = Math.hypot(this.vel.x, this.vel.z) / this.speed;
    if (this.grounded && this.state === 'chase') {
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.18 * sp;
      this.feet[0].position.z = 0.1 + Math.sin(ph) * 0.3 * sp;
      this.feet[1].position.z = 0.1 - Math.sin(ph) * 0.3 * sp;
    } else this.body.position.y *= 0.8;
    // googly pupils jiggle against motion
    this.wob.x += (-this.vel.x * 0.02 - this.wob.x) * Math.min(1, dt * 6) + (Math.random() - 0.5) * 0.02;
    this.wob.y += (-this.vel.y * 0.02 - this.wob.y) * Math.min(1, dt * 6);
    for (const p of this.pupils) {
      p.position.x = THREE.MathUtils.clamp(this.wob.x + Math.sin(this.anim * 13 + this.seed) * 0.03, -0.09, 0.09);
      p.position.y = THREE.MathUtils.clamp(this.wob.y + Math.cos(this.anim * 11 + this.seed) * 0.03, -0.09, 0.09);
    }
  }
}

// ----------------------------------------------------------------------------- Bug

/** Wind-up beetle: tiny, fast, comes in swarms. */
export class Bug extends Enemy {
  type: EnemyType = 'bug';
  private key = new THREE.Group();
  private biteCd = 0;
  private zig = Math.random() * 10;

  constructor(mats: Materials) {
    super(mats);
    const shell = [0xff4d3d, 0xffcf33, 0x7bd35a, 0x3fa9ff, 0xff6fa8, 0xff8a1f][Math.floor(Math.random() * 6)];
    this.colors = [shell, 0x2a2d36, 0xffffff];
    this.radius = 0.32;
    this.height = 0.5;
    this.hp = this.maxHp = 10;
    this.speed = 9 + Math.random() * 2;
    this.score = 40;
    const sm = this.mat(shell, 0.25);
    const dark = this.mat(0x2a2d36, 0.5);
    const tin = this.mat(0xc8ccd4, 0.3, 0.8);
    const shellM = this.add(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), sm, [0, 0.12, 0]);
    shellM.scale.set(1, 0.9, 1.25);
    this.add(new THREE.CylinderGeometry(0.33, 0.33, 0.08, 14), dark, [0, 0.12, 0]).scale.set(1, 1, 1.25);
    this.add(new THREE.BoxGeometry(0.02, 0.3, 0.8), dark, [0, 0.3, 0]);
    this.add(new THREE.SphereGeometry(0.14, 10, 8), dark, [0, 0.16, 0.42]);
    const eyeW = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.add(new THREE.SphereGeometry(0.05, 6, 4), eyeW, [-0.07, 0.22, 0.52]);
    this.add(new THREE.SphereGeometry(0.05, 6, 4), eyeW, [0.07, 0.22, 0.52]);
    for (const s of [-1, 1]) this.add(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 4), dark, [s * 0.08, 0.32, 0.6], this.body, [0.8, 0, s * 0.4]);
    for (const s of [-1, 1]) this.add(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10), dark, [s * 0.3, 0.07, 0], this.body, [0, 0, Math.PI / 2]);
    this.key.position.set(0, 0.42, -0.05);
    this.body.add(this.key);
    this.add(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 6), tin, [0, 0, 0], this.key);
    this.add(new THREE.TorusGeometry(0.07, 0.025, 6, 10), tin, [-0.08, 0.09, 0], this.key, [0, 0, 0]);
    this.add(new THREE.TorusGeometry(0.07, 0.025, 6, 10), tin, [0.08, 0.09, 0], this.key, [0, 0, 0]);
    this.detach = [this.key, shellM];
    this.sphere(0.38, [0, 0.2, 0.05]);
  }

  protected think(dt: number, ctx: EnemyCtx) {
    const pl = ctx.player;
    this.biteCd -= dt;
    const dist = this.navigate(ctx, dt, 12);
    // zig-zag
    const z = Math.sin(this.anim * 7 + this.zig) * (dist > 3 ? 0.7 : 0.15);
    const d = v1.copy(this.moveDir);
    const c = Math.cos(z), s = Math.sin(z);
    const dx = d.x * c - d.z * s, dz = d.x * s + d.z * c;
    d.set(dx, 0, dz);
    this.walk(d, this.speed, dt, 50);
    this.faceToward(v2.copy(this.pos).add(d), dt, 14);
    this.key.rotation.z += dt * 18;
    this.body.position.y = Math.abs(Math.sin(this.anim * 22)) * 0.05;
    this.body.rotation.z = Math.sin(this.anim * 30) * 0.08;
    if (Math.random() < 0.004) audio.chitter(panFor(pl, this.pos));
    if (dist < this.radius + 0.75 && Math.abs(pl.pos.y - this.pos.y) < 1.2 && this.biteCd <= 0) {
      this.biteCd = 0.7;
      pl.damage(5, this.pos);
      this.vel.addScaledVector(this.moveDir, -6);
      this.vel.y = 4;
    }
  }
}

// ----------------------------------------------------------------------------- Boss

/** THE WIND-UP KING: a giant tin monarch with clashing cymbals. */
export class Boss extends Enemy {
  type: EnemyType = 'boss';
  private key = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private core: THREE.MeshStandardMaterial;
  private eyes: THREE.MeshStandardMaterial;
  private state: 'walk' | 'clash' | 'volley' | 'bombs' | 'summon' = 'walk';
  private stateT = 0;
  private volleyCd = 3;
  private bombCd = 6;
  private clashCd = 2;
  private summoned = 0;
  intro = 2.2;

  constructor(mats: Materials) {
    super(mats);
    this.colors = [0xd8b25a, 0xc8402f, 0x8a4fd8, 0xb8c0cc];
    this.radius = 2.6;
    this.height = 10;
    this.hp = this.maxHp = 2600;
    this.speed = 2.6;
    this.score = 5000;
    this.knockResist = 25;
    const gold = this.mat(0xd8b25a, 0.25, 0.9);
    const red = this.mat(0xc8402f, 0.3, 0.5);
    const purple = this.mat(0x6a3fb8, 0.4, 0.2);
    const tin = this.mat(0xb8c0cc, 0.25, 0.9);
    const dark = this.mat(0x2a2d36, 0.5, 0.4);
    this.core = this.mat(0x301008, 0.2, 0, 0xff5020, 2.5);
    this.eyes = this.mat(0x301008, 0.2, 0, 0xffd040, 3);
    const gem = this.mat(0x20c0ff, 0.1, 0.2, 0x0060ff, 0.6);

    for (const [leg, x] of [[this.legL, -1.2], [this.legR, 1.2]] as const) {
      leg.position.set(x, 3, 0);
      this.body.add(leg);
      this.add(new THREE.CylinderGeometry(0.55, 0.6, 2.4, 14), tin, [0, -1.3, 0], leg);
      this.add(rbox(1.6, 0.7, 2.2, 0.25), red, [0, -2.65, 0.3], leg);
    }
    const torso = this.add(new THREE.CylinderGeometry(2.1, 2.3, 3.6, 24), red, [0, 4.9, 0]);
    for (const y of [3.2, 6.6]) this.add(new THREE.TorusGeometry(2.25, 0.18, 8, 28), gold, [0, y, 0], this.body, [Math.PI / 2, 0, 0]);
    this.add(new THREE.SphereGeometry(0.75, 18, 12), this.core, [0, 5, 2.05]);
    this.add(new THREE.TorusGeometry(0.85, 0.15, 8, 24), gold, [0, 5, 2.1]);
    // cape
    const cape = this.add(rbox(4.2, 5.2, 0.25, 0.1), purple, [0, 5.0, -2.35], this.body, [0.12, 0, 0]);
    this.add(rbox(4.4, 0.5, 0.4, 0.15), this.mat(0xffffff, 0.8), [0, 7.4, -2.1]);
    // head
    const head = new THREE.Group();
    head.position.set(0, 6.8, 0);
    this.body.add(head);
    this.add(rbox(2.6, 1.9, 2.2, 0.45), tin, [0, 1.0, 0], head);
    this.add(new THREE.SphereGeometry(0.32, 14, 10), this.eyes, [-0.6, 1.2, 1.1], head);
    this.add(new THREE.SphereGeometry(0.32, 14, 10), this.eyes, [0.6, 1.2, 1.1], head);
    this.add(rbox(1.6, 0.3, 0.3, 0.12), dark, [0, 0.55, 1.1], head);
    // moustache
    for (const s of [-1, 1]) this.add(new THREE.CapsuleGeometry(0.16, 0.6, 4, 8), dark, [s * 0.4, 0.78, 1.15], head, [0, 0, s * 1.2]);
    // crown
    this.add(new THREE.CylinderGeometry(1.2, 1.1, 0.7, 20, 1, true), gold, [0, 2.3, 0], head);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.add(new THREE.ConeGeometry(0.25, 0.7, 8), gold, [Math.sin(a) * 1.15, 2.95, Math.cos(a) * 1.15], head);
      this.add(new THREE.SphereGeometry(0.14, 8, 6), gem, [Math.sin(a) * 1.2, 2.3, Math.cos(a) * 1.2], head);
    }
    // arms with cymbals
    for (const [arm, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(s * 2.35, 6.0, 0);
      this.body.add(arm);
      this.add(new THREE.SphereGeometry(0.55, 12, 10), gold, [0, 0, 0], arm);
      this.add(new THREE.CylinderGeometry(0.35, 0.35, 2.6, 12), tin, [0, -1.4, 0.4], arm, [0.3, 0, 0]);
      const cym = this.add(new THREE.CylinderGeometry(1.4, 1.4, 0.1, 28), gold, [-s * 0.4, -2.8, 1.0], arm, [0, 0, Math.PI / 2]);
      this.add(new THREE.SphereGeometry(0.3, 10, 8), gold, [0, 0.08, 0], cym);
    }
    // big key
    this.key.position.set(0, 5, -2.6);
    this.body.add(this.key);
    this.add(new THREE.CylinderGeometry(0.25, 0.25, 1.2, 10), tin, [0, 0, -0.6], this.key, [Math.PI / 2, 0, 0]);
    this.add(new THREE.TorusGeometry(0.75, 0.22, 10, 20), gold, [-0.8, 0, -1.3], this.key, [0, Math.PI / 2, 0]);
    this.add(new THREE.TorusGeometry(0.75, 0.22, 10, 20), gold, [0.8, 0, -1.3], this.key, [0, Math.PI / 2, 0]);
    this.detach = [head, this.armL, this.armR, this.key, cape, torso, this.legL, this.legR];
    this.sphere(2.3, [0, 4.9, 0]);
    this.sphere(0.95, [0, 5, 2.05], 2.0);
    this.sphere(1.5, [0, 1.1, 0.1], 1.5, head);
    this.sphere(0.9, [0, 1.6, 0.4], 1, this.legL);
    this.sphere(0.9, [0, 1.6, 0.4], 1, this.legR);
  }

  protected think(dt: number, ctx: EnemyCtx) {
    const pl = ctx.player;
    this.stateT -= dt;
    this.key.rotation.z += dt * 2.5;
    this.core.emissiveIntensity = 2 + Math.sin(this.anim * 5) * 0.8;
    const dist = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    this.moveDir.set(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z).normalize();
    if (this.intro > 0) {
      this.intro -= dt;
      this.faceToward(pl.pos, dt, 2);
      this.armL.rotation.z = -0.8 * Math.sin(this.anim * 3);
      this.armR.rotation.z = 0.8 * Math.sin(this.anim * 3);
      return;
    }
    this.volleyCd -= dt;
    this.bombCd -= dt;
    this.clashCd -= dt;
    // summon at thresholds
    const frac = this.hp / this.maxHp;
    if ((this.summoned === 0 && frac < 0.66) || (this.summoned === 1 && frac < 0.33)) {
      this.summoned++;
      this.state = 'summon';
      this.stateT = 1.4;
      audio.bossRoar();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        ctx.spawn('bug', this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 4, 0, Math.sin(a) * 4)));
      }
      if (this.summoned === 2) for (let i = 0; i < 2; i++) ctx.spawn('chomper', this.pos.clone().add(new THREE.Vector3(i ? 5 : -5, 0, 2)));
    }

    switch (this.state) {
      case 'walk':
        this.faceToward(pl.pos, dt, 1.5);
        if (dist > 6) this.walk(this.moveDir, this.speed * (frac < 0.33 ? 1.4 : 1), dt, 6);
        else this.walk(this.moveDir, 0, dt, 6);
        if (dist < 15 && this.clashCd <= 0 && Math.abs(pl.pos.y - this.pos.y) < 4) {
          this.state = 'clash';
          this.stateT = 1.0;
          audio.windup();
        } else if (this.volleyCd <= 0) {
          this.state = 'volley';
          this.stateT = 0.8;
        } else if (this.bombCd <= 0) {
          this.state = 'bombs';
          this.stateT = 0.9;
        }
        break;
      case 'clash': {
        this.walk(this.moveDir, 0, dt, 6);
        const t = 1 - this.stateT;
        const open = t < 0.8 ? t / 0.8 : 1 - (t - 0.8) / 0.2;
        this.armL.rotation.z = -open * 1.2;
        this.armR.rotation.z = open * 1.2;
        if (this.stateT <= 0) {
          ctx.shockwave(this.pos.clone());
          audio.stomp();
          audio.explosion(dist);
          pl.shake(0.5);
          this.clashCd = frac < 0.33 ? 3.2 : 4.5;
          this.state = 'walk';
        }
        break;
      }
      case 'volley': {
        this.walk(this.moveDir, 0, dt, 6);
        this.faceToward(pl.pos, dt, 3);
        if (this.stateT <= 0) {
          const from = v1.set(0, 5, 2.4).applyMatrix4(this.group.matrixWorld).clone();
          const base = pl.centerPos.sub(from).normalize();
          const side = new THREE.Vector3().crossVectors(base, UP).normalize();
          const n = frac < 0.5 ? 9 : 7;
          for (let i = 0; i < n; i++) {
            const k = i - (n - 1) / 2;
            const d = base.clone().addScaledVector(side, k * 0.08).normalize();
            ctx.proj.spawn('bolt', from, d.multiplyScalar(22), 10, true);
          }
          ctx.fx.glow(from, 0xff8040, 4, 0.5, 0.3);
          audio.laser(panFor(pl, from));
          this.volleyCd = frac < 0.5 ? 2.6 : 3.4;
          this.state = 'walk';
        }
        break;
      }
      case 'bombs':
        this.walk(this.moveDir, 0, dt, 6);
        this.armR.rotation.x = -Math.sin((1 - this.stateT / 0.9) * Math.PI) * 2;
        if (this.stateT <= 0) {
          const from = v1.set(0, 9.5, 0).applyMatrix4(this.group.matrixWorld).clone();
          for (let i = 0; i < 3; i++) {
            const tgt = pl.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
            const T = 1.3 + Math.random() * 0.3;
            const vel = new THREE.Vector3((tgt.x - from.x) / T, 0, (tgt.z - from.z) / T);
            vel.y = (tgt.y - from.y + 0.5 * 22 * T * T) / T;
            ctx.proj.spawn('bomb', from, vel, 22, true);
          }
          this.bombCd = 6 + Math.random() * 2;
          this.state = 'walk';
        }
        break;
      case 'summon':
        this.walk(this.moveDir, 0, dt, 6);
        this.armL.rotation.z = -1.0;
        this.armR.rotation.z = 1.0;
        this.body.position.x = Math.sin(this.anim * 50) * 0.08;
        if (this.stateT <= 0) { this.state = 'walk'; this.body.position.x = 0; }
        break;
    }
    if (this.state === 'walk') {
      this.armL.rotation.z *= 0.92;
      this.armR.rotation.z *= 0.92;
      this.armR.rotation.x *= 0.9;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      const ph = this.anim * 3;
      if (sp > 0.5) {
        this.legL.rotation.x = Math.sin(ph) * 0.35;
        this.legR.rotation.x = -Math.sin(ph) * 0.35;
        this.body.rotation.z = Math.sin(ph) * 0.05;
        if (Math.abs(Math.sin(ph)) > 0.98 && Math.random() < 0.3) {
          pl.shake(Math.max(0, 0.15 - dist * 0.003));
        }
      }
    }
  }
}

export function createEnemy(type: EnemyType, mats: Materials, hard = false): Enemy {
  switch (type) {
    case 'trooper': return new Trooper(mats, hard);
    case 'robot': return new Robot(mats);
    case 'chomper': return new Chomper(mats);
    case 'bug': return new Bug(mats);
    case 'boss': return new Boss(mats);
  }
}
