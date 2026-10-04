import * as THREE from 'three';
import { Materials } from '../environment/Materials';
import { rbox } from '../environment/Builder';
import { Target } from '../game/Enemies';

/** Network snapshot of a player, sent ~15 times a second. */
export interface PlayerState {
  p: [number, number, number];
  v: [number, number, number];
  y: number;
  pi: number;
  w: number;
  a: 0 | 1;
  c: 0 | 1;
  h: number;
}

export interface AvatarHit { t: number; mult: number }

const v1 = new THREE.Vector3();

/** Another player's toy soldier, driven by network snapshots. */
export class RemoteAvatar implements Target {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private gun = new THREE.Group();
  private head = new THREE.Group();
  private legs: THREE.Object3D[] = [];
  private tag: THREE.Sprite;
  private mats: THREE.MeshStandardMaterial[] = [];
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  height = 1.8;
  alive = true;
  hp = 100;
  weapon = 0;
  crouch = false;
  private target = new THREE.Vector3();
  private lastStateAt = 0;
  private anim = 0;
  private deathT = 0;
  private flash = 0;
  private spheres: { c: THREE.Vector3; r: number; mult: number }[] = [
    { c: new THREE.Vector3(), r: 0.42, mult: 1 },
    { c: new THREE.Vector3(), r: 0.3, mult: 0.8 },
    { c: new THREE.Vector3(), r: 0.26, mult: 2 },
  ];
  /** set by the session: deals damage to this player over the network */
  sendDamage: (amount: number, from?: THREE.Vector3, knock?: THREE.Vector3) => void = () => {};

  constructor(mats: Materials, readonly id: string, public name: string, color: number, scene: THREE.Object3D) {
    const m = this.mat(color);
    const dark = this.mat(new THREE.Color(color).multiplyScalar(0.7).getHex());
    const glove = this.mat(0x6b4a2b);
    void mats;
    this.group.add(this.body);
    // legs
    for (const x of [-0.14, 0.14]) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.85, 0);
      this.body.add(leg);
      const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), dark);
      l.position.y = -0.4;
      leg.add(l);
      const boot = new THREE.Mesh(rbox(0.22, 0.14, 0.32, 0.05), dark);
      boot.position.set(0, -0.78, 0.05);
      leg.add(boot);
      this.legs.push(leg);
    }
    const torso = new THREE.Mesh(rbox(0.5, 0.6, 0.32, 0.1), m);
    torso.position.y = 1.15;
    this.body.add(torso);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 14), dark);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.88;
    this.body.add(belt);
    const pack = new THREE.Mesh(rbox(0.36, 0.4, 0.18, 0.06), dark);
    pack.position.set(0, 1.18, -0.24);
    this.body.add(pack);
    this.head.position.set(0, 1.58, 0);
    this.body.add(this.head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), this.mat(0xf1c9a0));
    this.head.add(face);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m);
    helmet.position.y = 0.06;
    this.head.add(helmet);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), m);
    brim.position.y = 0.06;
    this.head.add(brim);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x1a1010 });
    for (const x of [-0.07, 0.07]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), eyeM);
      e.position.set(x, 0.0, 0.17);
      this.head.add(e);
    }
    // gun + arms
    this.gun.position.set(0.05, 1.3, 0.05);
    this.body.add(this.gun);
    const gunBody = new THREE.Mesh(rbox(0.1, 0.13, 0.8, 0.03), this.mat(0xff8a1f));
    gunBody.position.set(0.1, -0.05, 0.32);
    this.gun.add(gunBody);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), this.mat(0x2a2d36));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.1, -0.03, 0.85);
    this.gun.add(barrel);
    for (const [x, z, rx, rz] of [[0.22, 0.06, 1.2, 0.2], [-0.12, 0.2, 1.3, -0.6]] as const) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 4, 8), m);
      arm.position.set(x, -0.03, z);
      arm.rotation.set(rx, 0, rz);
      this.gun.add(arm);
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), glove);
      g.position.set(x * 0.6, -0.08, z + 0.22);
      this.gun.add(g);
    }
    // name tag
    this.tag = makeTag(name, color);
    this.tag.position.y = 2.35;
    this.group.add(this.tag);
    // blob shadow
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ map: mats.blob, transparent: true, depthWrite: false, opacity: 0.7 }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    this.group.add(blob);
    scene.add(this.group);
  }

  private mat(color: number) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0 });
    this.mats.push(m);
    return m;
  }

  setName(name: string, color: number) {
    if (name === this.name) return;
    this.name = name;
    this.group.remove(this.tag);
    this.tag = makeTag(name, color);
    this.tag.position.y = 2.35;
    this.group.add(this.tag);
  }

  setColor(color: number) {
    // body + helmet use the first material
    this.mats[0].color.setHex(color);
    this.mats[1].color.setHex(new THREE.Color(color).multiplyScalar(0.7).getHex());
  }

  applyState(s: PlayerState, now: number) {
    this.target.set(s.p[0], s.p[1], s.p[2]);
    this.vel.set(s.v[0], s.v[1], s.v[2]);
    if (this.lastStateAt === 0 || this.pos.distanceTo(this.target) > 12) this.pos.copy(this.target);
    this.lastStateAt = now;
    this.yaw = s.y;
    this.pitch = s.pi;
    this.weapon = s.w;
    this.crouch = s.c === 1;
    this.hp = s.h;
    const wasAlive = this.alive;
    this.alive = s.a === 1;
    if (wasAlive && !this.alive) this.deathT = 0;
    if (!wasAlive && this.alive) this.pos.copy(this.target);
  }

  hitFlash() {
    this.flash = 1;
  }

  update(dt: number, now: number) {
    this.anim += dt;
    // extrapolate briefly past the last snapshot, then ease toward it
    const age = Math.min(0.2, (now - this.lastStateAt) / 1000);
    v1.copy(this.target).addScaledVector(this.vel, age);
    this.pos.lerp(v1, Math.min(1, dt * 14));
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw + Math.PI;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const ph = this.anim * 11;
    const moving = sp > 1 && this.alive;
    this.legs[0].rotation.x = moving ? Math.sin(ph) * 0.6 : 0;
    this.legs[1].rotation.x = moving ? -Math.sin(ph) * 0.6 : 0;
    this.body.position.y = moving ? Math.abs(Math.sin(ph)) * 0.06 : 0;
    this.gun.rotation.x = -this.pitch;
    this.head.rotation.x = -this.pitch * 0.5;
    const crouchK = this.crouch ? 0.65 : 1;
    this.body.scale.y += (crouchK - this.body.scale.y) * Math.min(1, dt * 12);
    this.height = 1.8 * this.body.scale.y;
    if (!this.alive) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.5);
      this.body.rotation.x = -k * 1.5;
      this.body.position.y = k * 0.2;
      this.tag.visible = false;
      this.group.visible = this.deathT < 2.5;
    } else {
      this.body.rotation.x = 0;
      this.tag.visible = true;
      this.group.visible = true;
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 7);
      for (const m of this.mats) m.emissive.setRGB(this.flash, this.flash, this.flash);
    }
    // hit spheres
    const s = this.body.scale.y;
    this.spheres[0].c.set(this.pos.x, this.pos.y + 1.1 * s, this.pos.z);
    this.spheres[1].c.set(this.pos.x, this.pos.y + 0.45 * s, this.pos.z);
    this.spheres[2].c.set(this.pos.x, this.pos.y + 1.6 * s, this.pos.z);
  }

  rayHit(o: THREE.Vector3, d: THREE.Vector3, maxDist: number, pad = 0): AvatarHit | null {
    if (!this.alive) return null;
    let best: AvatarHit | null = null;
    for (const sp of this.spheres) {
      const r = sp.r + pad;
      const ocx = o.x - sp.c.x, ocy = o.y - sp.c.y, ocz = o.z - sp.c.z;
      const b = ocx * d.x + ocy * d.y + ocz * d.z;
      const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > maxDist) continue;
      // headshots only count on the true (unpadded) head
      const mult = sp.mult > 1 && pad > 0 && Math.sqrt(Math.max(0, ocx * ocx + ocy * ocy + ocz * ocz - b * b)) > sp.r ? 1 : sp.mult;
      if (!best || t < best.t) best = { t, mult };
    }
    return best;
  }

  get centerPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z);
  }
  get headPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.88, this.pos.z);
  }
  /** muzzle point for drawing their tracers */
  get muzzle() {
    const f = new THREE.Vector3(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI));
    return new THREE.Vector3(this.pos.x, this.pos.y + 1.3 * this.body.scale.y, this.pos.z).addScaledVector(f, 1.0);
  }

  // Target interface (co-op enemies attack remote players through the network)
  private pendingKnock: THREE.Vector3 | null = null;
  damage(amount: number, from?: THREE.Vector3) {
    if (!this.alive) return false;
    this.sendDamage(amount, from, this.pendingKnock ?? undefined);
    this.pendingKnock = null;
    return true;
  }
  knock(dir: THREE.Vector3, force: number) {
    // forwarded with the next damage message
    this.sendDamage(0, undefined, dir.clone().multiplyScalar(force));
  }
  shake() {}

  dispose(scene: THREE.Object3D) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh) mm.geometry.dispose();
    });
    for (const m of this.mats) m.dispose();
  }
}

function makeTag(name: string, color: number) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(20,12,30,0.6)';
  const w = Math.min(250, 40 + name.length * 15);
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 8, w, 46, 14);
  ctx.fill();
  ctx.fillStyle = '#' + new THREE.Color(color).offsetHSL(0, 0, 0.25).getHexString();
  ctx.font = 'bold 30px Arial Black, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.slice(0, 14), 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  sp.scale.set(2.0, 0.5, 1);
  sp.renderOrder = 15;
  return sp;
}
