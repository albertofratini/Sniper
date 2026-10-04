import * as THREE from 'three';
import { CollisionWorld } from './Collision';
import { Input } from './Input';
import { audio } from './Audio';

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  readonly camera: THREE.PerspectiveCamera;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  radius = 0.42;
  height = 1.8;
  eye = 1.62;
  grounded = true;
  health = 100;
  maxHealth = 100;
  alive = true;
  invuln = 0;

  // feel
  bobPhase = 0;
  bobAmt = 0;
  private landDip = 0;
  private landVel = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private trauma = 0;
  private roll = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private stepDist = 0;
  private fallStartVel = 0;
  sprinting = false;
  crouching = false;
  speed01 = 0;
  baseFov = 75;
  hurtFlash = 0;
  lookDelta = new THREE.Vector2();
  godMode = false;
  onDamage: (amount: number, from?: THREE.Vector3) => void = () => {};
  moveIntent = new THREE.Vector2();

  constructor(private world: CollisionWorld, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.baseFov, aspect, 0.05, 600);
    this.camera.rotation.order = 'YXZ';
  }

  spawn(p: THREE.Vector3, yaw: number) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.alive = true;
    this.invuln = 1.0;
    this.trauma = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this.height = 1.8;
    this.crouching = false;
  }

  get eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }

  get headPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.85, this.pos.z);
  }

  get centerPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z);
  }

  addRecoil(pitch: number, yawJitter: number) {
    this.recoilPitch += pitch;
    this.recoilYaw += (Math.random() - 0.5) * yawJitter;
  }

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  damage(amount: number, from?: THREE.Vector3) {
    if (!this.alive || this.invuln > 0) return false;
    if (!this.godMode) this.health = Math.max(0, this.health - amount);
    this.onDamage(amount, from);
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.35 + amount / 40);
    this.shake(0.25 + amount / 60);
    if (from) {
      const d = from.clone().sub(this.pos);
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      this.roll += Math.sign(d.dot(right)) * 0.03;
    }
    audio.hurt();
    if (this.health <= 0) this.alive = false;
    return true;
  }

  heal(n: number) {
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  knock(dir: THREE.Vector3, force: number) {
    this.vel.addScaledVector(dir, force);
    if (this.vel.y < 4 && force > 4) this.vel.y = Math.max(this.vel.y, force * 0.35);
  }

  update(dt: number, input: Input, weaponSpeedMul: number) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.8);

    // ---- look
    this.lookDelta.set(input.lookDX, input.lookDY);
    if (this.alive) {
      this.yaw -= input.lookDX;
      this.pitch -= input.lookDY;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    }

    // ---- crouch
    const wantCrouch = input.crouch && this.alive;
    if (wantCrouch) this.crouching = true;
    else if (this.crouching) {
      // stand up only if space above
      const p = this.pos;
      if (!this.world.pointBlocked(p.x, p.y + 1.85, p.z)) this.crouching = false;
    }
    const targetH = this.crouching ? 1.1 : 1.8;
    this.height += (targetH - this.height) * Math.min(1, dt * 14);
    this.eye = this.height - 0.18;

    // ---- move
    const mx = this.alive ? input.moveX : 0;
    const my = this.alive ? input.moveY : 0;
    this.moveIntent.set(mx, my);
    this.sprinting = input.sprint && my > 0.3 && !this.crouching && this.alive;
    let maxSpeed = this.crouching ? 4.8 : this.sprinting ? 14.5 : 9.5;
    maxSpeed *= weaponSpeedMul;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(my).addScaledVector(right, mx);
    const wishLen = Math.min(1, wish.length());
    if (wishLen > 0.001) wish.normalize();
    const target = wish.multiplyScalar(maxSpeed * wishLen);
    const accel = this.grounded ? 80 : 26;
    const hv = new THREE.Vector2(this.vel.x, this.vel.z);
    const tv = new THREE.Vector2(target.x, target.z);
    const diff = tv.sub(hv);
    const dl = diff.length();
    const maxStep = accel * dt * (wishLen < 0.01 && this.grounded ? 1.3 : 1);
    if (dl > maxStep) diff.multiplyScalar(maxStep / dl);
    this.vel.x += diff.x;
    this.vel.z += diff.y;

    // jump with coyote time + buffer
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    if (input.jump) this.jumpBuffer = 0.14;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && this.alive) {
      this.vel.y = this.crouching ? 10 : 14;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      audio.jump();
    }

    this.vel.y -= 32 * dt;
    if (this.vel.y < -60) this.vel.y = -60;
    const wasGrounded = this.grounded;
    const preVy = this.vel.y;
    if (!wasGrounded) this.fallStartVel = Math.min(this.fallStartVel, preVy);
    this.grounded = this.world.moveCylinder(this.pos, this.vel, dt, this.radius, this.height, 0.6);
    if (this.grounded && !wasGrounded) {
      const impact = Math.min(1, -this.fallStartVel / 30);
      this.landVel -= 2.5 * impact + 0.3;
      if (impact > 0.25) audio.land();
      this.fallStartVel = 0;
    }

    // ---- feel: bob / landing spring / recoil recovery / shake
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speed01 = Math.min(1, hs / 14.5);
    const bobTarget = this.grounded ? Math.min(1, hs / 9.5) : 0;
    this.bobAmt += (bobTarget - this.bobAmt) * Math.min(1, dt * 8);
    if (this.grounded) {
      this.bobPhase += hs * dt * 0.95;
      this.stepDist += hs * dt;
      if (this.stepDist > (this.sprinting ? 3.6 : 3.0)) {
        this.stepDist = 0;
        if (hs > 2) audio.footstep(this.sprinting);
      }
    }
    // landing spring
    this.landVel += (-this.landDip * 140 - this.landVel * 16) * dt;
    this.landDip += this.landVel * dt;
    // recoil recovery
    const rec = Math.min(1, dt * 9);
    const pr = this.recoilPitch * rec;
    this.recoilPitch -= pr;
    const yr = this.recoilYaw * rec;
    this.recoilYaw -= yr;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.roll *= Math.max(0, 1 - dt * 6);

    this.updateCamera(dt);
  }

  private time = 0;
  updateCamera(dt: number) {
    this.time += dt;
    const c = this.camera;
    const bobY = Math.sin(this.bobPhase * 2) * 0.045 * this.bobAmt * (this.sprinting ? 1.5 : 1);
    const bobX = Math.cos(this.bobPhase) * 0.03 * this.bobAmt;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    c.position.set(this.pos.x, this.pos.y + this.eye + bobY + this.landDip * 0.25, this.pos.z).addScaledVector(right, bobX);
    const sh = this.trauma * this.trauma;
    const t = this.time * 40;
    const shx = (Math.sin(t * 1.3) + Math.sin(t * 2.7) * 0.5) * 0.03 * sh;
    const shy = (Math.sin(t * 1.7 + 1) + Math.sin(t * 3.1) * 0.5) * 0.03 * sh;
    c.rotation.set(
      this.pitch + this.recoilPitch + shy + this.landDip * 0.02,
      this.yaw + this.recoilYaw + shx,
      this.roll + Math.cos(this.bobPhase) * 0.004 * this.bobAmt + shx * 0.5 - this.lookDelta.x * 0.0,
    );
    const fovT = this.baseFov + (this.sprinting ? 7 * this.speed01 : 0);
    c.fov += (fovT - c.fov) * Math.min(1, dt * 6);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  get up() {
    return UP;
  }
}
