import * as THREE from 'three';
import { Materials } from '../environment/Materials';
import { rbox } from '../environment/Builder';
import * as T from '../environment/Textures';
import { Input } from './Input';
import { Player } from './Player';
import { audio } from './Audio';

export interface WeaponDef {
  name: string;
  mag: number;
  reserve: number; // Infinity for unlimited
  rate: number; // seconds between shots
  damage: number;
  pellets: number;
  spread: number;
  auto: boolean;
  reload: number;
  recoil: number;
  range: number;
  tracer: number;
  rocket?: boolean;
  sniper?: boolean;
  /** seconds of barrel spin before firing (minigun) */
  spin?: number;
  speedMul: number;
  /** how far forward the muzzle sits (for tracers / rockets) */
  reach: number;
  sound: 'blaster' | 'shotgun' | 'rocket' | 'sniper' | 'minigun';
}

export const WEAPONS: WeaponDef[] = [
  { name: 'ASSAULT BLASTER', mag: 32, reserve: Infinity, rate: 0.088, damage: 12, pellets: 1, spread: 0.011, auto: true, reload: 1.3, recoil: 0.011, range: 220, tracer: 0x6fe8ff, speedMul: 1, reach: 0.45, sound: 'blaster' },
  { name: 'CHUNK SHOTGUN', mag: 6, reserve: 24, rate: 0.78, damage: 11, pellets: 10, spread: 0.075, auto: true, reload: 1.6, recoil: 0.065, range: 70, tracer: 0xffd27a, speedMul: 0.97, reach: 0.45, sound: 'shotgun' },
  { name: 'FOAM ROCKET LAUNCHER', mag: 3, reserve: 9, rate: 0.95, damage: 140, pellets: 1, spread: 0, auto: true, reload: 2.0, recoil: 0.08, range: 300, tracer: 0xff8a1f, rocket: true, speedMul: 0.9, reach: 0.55, sound: 'rocket' },
  { name: 'SNAP SNIPER', mag: 5, reserve: 20, rate: 1.05, damage: 105, pellets: 1, spread: 0.07, auto: false, reload: 2.1, recoil: 0.1, range: 420, tracer: 0xfff6c8, sniper: true, speedMul: 0.93, reach: 0.75, sound: 'sniper' },
  { name: 'TOY MINIGUN', mag: 160, reserve: 0, rate: 0.045, damage: 9, pellets: 1, spread: 0.032, auto: true, reload: 3, recoil: 0.006, range: 180, tracer: 0xff6fa8, spin: 0.4, speedMul: 0.8, reach: 0.5, sound: 'minigun' },
];
export const SNIPER = 3;
export const MINIGUN = 4;
/** Weapons you start a survival run with (the minigun is a pickup). */
export const DEFAULT_OWNED = [true, true, true, true, false];

export interface FireContext {
  hitscan(origin: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number, tracerColor: number, muzzle: THREE.Vector3, pelletIndex: number): void;
  fireRocket(muzzle: THREE.Vector3, dir: THREE.Vector3): void;
  melee(origin: THREE.Vector3, dir: THREE.Vector3): boolean;
  aimPoint(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3;
  muzzleFlash(p: THREE.Vector3, color: number, size: number): void;
}

interface Viewmodel {
  root: THREE.Group;
  muzzle: THREE.Object3D;
  pump?: THREE.Object3D;
  rocketTip?: THREE.Object3D;
  glow?: THREE.MeshStandardMaterial;
  drum?: THREE.Object3D;
  spinner?: THREE.Object3D;
  bolt?: THREE.Object3D;
  rest: THREE.Vector3;
}

type State = 'idle' | 'reload' | 'swap' | 'melee';

export class WeaponSystem {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  current = 0;
  ammo = WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve }));
  state: State = 'idle';
  private timer = 0;
  private cooldown = 0;
  private pending = -1;
  private vms: Viewmodel[] = [];
  private holder = new THREE.Group();
  private flash: THREE.Mesh;
  private flashTime = 0;
  private kick = 0;
  private kickVel = 0;
  private sway = new THREE.Vector2();
  private swayVel = new THREE.Vector2();
  private meleeT = 0;
  private triggerHeld = false;
  /** 0..1 aim-down-sights blend */
  adsT = 0;
  owned = [...DEFAULT_OWNED];
  /** restrict to these weapon indices (multiplayer modes), null = any owned */
  allowed: number[] | null = null;
  private spinT = 0;
  infiniteAmmo = false;
  /** called on every shot (for multiplayer replication) */
  onShot: (weapon: number) => void = () => {};
  shotsFired = 0;
  lastFireTime = 0;
  onAmmoChange: () => void = () => {};

  constructor(private mats: Materials, aspect: number, env: THREE.Texture | null) {
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.01, 10);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.5;
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x8a6a50, 0.55);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe0b8, 1.5);
    key.position.set(-1, 2, 1.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 0.6);
    rim.position.set(1.5, 0.5, -1);
    this.scene.add(rim);
    this.scene.add(this.camera);
    this.camera.add(this.holder);

    this.vms = [this.buildBlaster(), this.buildShotgun(), this.buildRocket(), this.buildSniper(), this.buildMinigun()];
    for (const vm of this.vms) {
      vm.root.visible = false;
      this.holder.add(vm.root);
    }
    this.vms[0].root.visible = true;

    const flashTex = makeFlashTex();
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.flash.visible = false;
    this.flash.renderOrder = 20;
    this.camera.add(this.flash);
  }

  get def() {
    return WEAPONS[this.current];
  }

  get scoped() {
    return this.def.sniper === true && this.adsT > 0.85;
  }

  reset(allowed: number[] | null = null) {
    this.ammo = WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve }));
    this.owned = [...DEFAULT_OWNED];
    this.allowed = allowed;
    this.state = 'idle';
    this.timer = 0;
    this.cooldown = 0;
    this.adsT = 0;
    this.switchTo(allowed ? allowed[0] : 0, true);
    this.onAmmoChange();
  }

  /** Multiplayer loadouts: only these weapons, all with full ammo. */
  setLoadout(allowed: number[]) {
    this.allowed = allowed;
    for (const i of allowed) {
      this.owned[i] = true;
      this.ammo[i] = { mag: WEAPONS[i].mag, reserve: WEAPONS[i].reserve === 0 ? WEAPONS[i].mag * 2 : WEAPONS[i].reserve };
    }
    if (!allowed.includes(this.current)) this.switchTo(allowed[0], true);
    this.onAmmoChange();
  }

  /** Pick up a weapon (e.g. the minigun crate). */
  give(i: number) {
    this.owned[i] = true;
    this.ammo[i].mag = WEAPONS[i].mag;
    if (this.allowed && !this.allowed.includes(i)) return;
    this.switchTo(i);
    this.onAmmoChange();
  }

  private usable(i: number) {
    return this.owned[i] && (!this.allowed || this.allowed.includes(i)) && (this.ammo[i].mag > 0 || this.ammo[i].reserve > 0);
  }

  addAmmo(fraction: number) {
    WEAPONS.forEach((w, i) => {
      if (w.reserve === Infinity || w.reserve === 0) return;
      const add = Math.max(1, Math.round(w.reserve * fraction));
      this.ammo[i].reserve = Math.min(w.reserve * 2, this.ammo[i].reserve + add);
    });
    this.onAmmoChange();
  }

  switchTo(i: number, instant = false) {
    if (i === this.current && !instant) return;
    this.spinT = 0;
    if (instant) {
      this.pending = -1;
      this.vms.forEach((v, k) => (v.root.visible = k === i));
      this.current = i;
      this.state = 'idle';
      return;
    }
    if (this.state === 'melee') return;
    this.pending = i;
    this.state = 'swap';
    this.timer = 0.36;
    audio.swap();
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** World-space muzzle position approximated from the main camera. */
  private muzzleWorld(player: Player) {
    const vm = this.vms[this.current];
    const off = vm.rest.clone();
    off.z -= this.def.reach;
    off.y += 0.04;
    if (this.scoped) off.set(0, -0.05, -0.4);
    return player.camera.localToWorld(off.multiplyScalar(1.4));
  }

  update(dt: number, input: Input, player: Player, ctx: FireContext, time: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const def = this.def;
    const am = this.ammo[this.current];

    // ---- input: switching
    if (player.alive) {
      if (input.slot >= 0 && input.slot < WEAPONS.length && input.slot !== this.current && this.owned[input.slot] && (!this.allowed || this.allowed.includes(input.slot))) this.switchTo(input.slot);
      else if (input.swap !== 0) {
        for (let k = 1; k < WEAPONS.length; k++) {
          const n = (this.current + input.swap * k + WEAPONS.length * 2) % WEAPONS.length;
          if (this.usable(n)) {
            this.switchTo(n);
            break;
          }
        }
      }
    }

    // ---- state machine
    if (this.state === 'swap') {
      this.timer -= dt;
      if (this.timer <= 0.18 && this.pending >= 0) {
        this.vms[this.current].root.visible = false;
        this.current = this.pending;
        this.vms[this.current].root.visible = true;
        this.pending = -1;
        this.onAmmoChange();
      }
      if (this.timer <= 0) this.state = 'idle';
    } else if (this.state === 'reload') {
      this.timer -= dt;
      if (this.timer <= 0) {
        const need = def.mag - am.mag;
        const take = Math.min(need, am.reserve);
        am.mag += take;
        if (am.reserve !== Infinity) am.reserve -= take;
        this.state = 'idle';
        this.onAmmoChange();
      }
    } else if (this.state === 'melee') {
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'idle';
    }

    // aim down sights (sniper scope)
    const wantAds = player.alive && input.aim && this.def.sniper === true && (this.state === 'idle' || this.state === 'melee');
    this.adsT = Math.max(0, Math.min(1, this.adsT + (wantAds ? dt * 7 : -dt * 9)));
    // minigun spin-up
    if (this.def.spin) this.spinT = input.fire && this.state === 'idle' && player.alive ? Math.min(this.def.spin + 0.2, this.spinT + dt) : Math.max(0, this.spinT - dt * 1.5);
    const spunUp = !this.def.spin || this.spinT >= this.def.spin;
    // COD-mobile style: releasing the scope button fires
    const releaseFire = input.aimRelease && this.def.sniper === true;

    if (player.alive && this.state === 'idle') {
      if (input.melee && this.cooldown <= 0.2) {
        this.state = 'melee';
        this.timer = 0.5;
        this.meleeT = 0;
        audio.melee();
        const dir = player.forward();
        setTimeout(() => {
          if (ctx.melee(player.eyePos, player.forward())) {
            audio.meleeHit();
            player.shake(0.2);
          }
        }, 110);
        void dir;
      } else if (input.reload && am.mag < def.mag && am.reserve > 0) {
        this.startReload();
      } else if (((input.fire && (def.auto || !this.triggerHeld)) || releaseFire) && this.cooldown <= 0 && spunUp) {
        if (am.mag > 0) {
          this.fire(player, ctx, time);
          if (releaseFire) this.adsT = 0;
        } else if (am.reserve > 0) {
          this.startReload();
        } else {
          audio.empty();
          this.cooldown = 0.3;
          // auto-switch to something with ammo
          for (let k = 0; k < WEAPONS.length; k++) if (k !== this.current && this.usable(k)) { this.switchTo(k); break; }
        }
      }
    }
    this.triggerHeld = input.fire;

    this.animate(dt, player, time);
  }

  private startReload() {
    this.state = 'reload';
    this.timer = this.def.reload;
    audio.reload();
    this.onAmmoChange();
  }

  private fire(player: Player, ctx: FireContext, time: number) {
    const def = this.def;
    const am = this.ammo[this.current];
    if (!this.infiniteAmmo) am.mag--;
    this.cooldown = def.rate;
    this.onShot(this.current);
    this.shotsFired++;
    this.lastFireTime = time;
    const origin = player.camera.getWorldPosition(new THREE.Vector3());
    const fwd = player.forward();
    const muzzle = this.muzzleWorld(player);
    const moving = player.speed01;
    if (def.rocket) {
      const target = ctx.aimPoint(origin, fwd);
      const dir = target.sub(muzzle).normalize();
      ctx.fireRocket(muzzle, dir);
      audio.rocket();
    } else {
      let spreadBase = def.spread * (1 + moving * (def.pellets > 1 ? 0.2 : 1.6) + (player.grounded ? 0 : 0.8)) * (player.crouching ? 0.6 : 1);
      if (def.sniper) spreadBase = this.adsT > 0.85 ? 0.0012 + moving * 0.01 : def.spread * (0.6 + moving * 0.8) * (player.grounded ? 1 : 1.6);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(player.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(player.camera.quaternion);
      for (let i = 0; i < def.pellets; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = (def.pellets > 1 ? Math.sqrt(Math.random()) : Math.random()) * spreadBase;
        const d = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
        ctx.hitscan(origin, d, def.range, def.damage, def.tracer, muzzle, i);
      }
      audio.weapon(def.sound);
    }
    ctx.muzzleFlash(muzzle, this.current === 0 ? 0x8ff0ff : this.current === MINIGUN ? 0xff9fd0 : 0xffc060, this.current === 1 ? 2.2 : this.current === MINIGUN ? 1.0 : 1.4);
    player.addRecoil(def.recoil, def.recoil * 0.8);
    player.shake(this.current === 0 || this.current === MINIGUN ? 0.03 : 0.22);
    this.kickVel += this.current === 0 || this.current === MINIGUN ? 1.6 : 6;
    this.flashTime = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.onAmmoChange();
  }

  private animate(dt: number, player: Player, time: number) {
    const vm = this.vms[this.current];
    // recoil spring
    this.kickVel += (-this.kick * 260 - this.kickVel * 20) * dt;
    this.kick += this.kickVel * dt;
    // sway (lag behind look)
    const ld = player.lookDelta;
    this.swayVel.x += (-ld.x * 2.2 - this.sway.x * 120 - this.swayVel.x * 14) * dt * 1;
    this.swayVel.y += (-ld.y * 2.2 - this.sway.y * 120 - this.swayVel.y * 14) * dt * 1;
    this.swayVel.x -= ld.x * 30;
    this.swayVel.y -= ld.y * 30;
    this.sway.x += this.swayVel.x * dt;
    this.sway.y += this.swayVel.y * dt;
    this.sway.clampScalar(-0.08, 0.08);

    const bob = player.bobAmt;
    const ph = player.bobPhase;
    const sprint = player.sprinting ? 1 : 0;
    const p = vm.rest.clone();
    p.x += Math.cos(ph) * 0.012 * bob + this.sway.x * 0.4;
    p.y += Math.abs(Math.sin(ph)) * -0.012 * bob + this.sway.y * 0.3 + Math.sin(time * 1.6) * 0.003;
    p.z += this.kick * 0.04;
    let rx = this.kick * 0.12 + this.sway.y * 0.6;
    let ry = this.sway.x * 0.8;
    let rz = Math.cos(ph) * 0.02 * bob;

    // sprint pose
    p.x += sprint * 0.03;
    p.y -= sprint * 0.03;
    rx -= sprint * 0.18;
    ry += sprint * 0.45;

    // state poses
    if (this.state === 'reload') {
      const total = this.def.reload;
      const t = 1 - this.timer / total;
      const k = Math.sin(Math.min(1, t) * Math.PI);
      p.y -= k * 0.12;
      rx -= k * 0.35;
      rz += k * 0.6;
      if (vm.drum) vm.drum.position.y = -0.07 - Math.max(0, Math.sin(t * Math.PI * 2)) * 0.12;
      if (vm.rocketTip) vm.rocketTip.visible = t > 0.6;
    } else if (vm.drum) vm.drum.position.y = -0.07;
    if (this.state === 'swap') {
      const k = Math.sin((1 - this.timer / 0.36) * Math.PI);
      p.y -= k * 0.3;
      rx -= k * 0.6;
    }
    if (this.state === 'melee') {
      this.meleeT += dt;
      const t = Math.min(1, this.meleeT / 0.45);
      const k = Math.sin(t * Math.PI);
      p.x -= k * 0.16;
      p.z -= k * 0.18;
      p.y += k * 0.02;
      ry += k * 0.9;
      rz -= k * 0.4;
    }
    if (!player.alive) {
      p.y -= 0.4;
      rx -= 0.8;
    }
    // ADS: bring the scope to the eye
    if (this.adsT > 0) {
      const k = this.adsT * this.adsT;
      p.x += (0 - p.x) * k;
      p.y += (-0.16 - p.y) * k;
      rx *= 1 - k;
      ry *= 1 - k;
      rz *= 1 - k;
    }
    vm.root.visible = !this.scoped;
    if (vm.spinner) vm.spinner.rotation.z += dt * (this.spinT / (this.def.spin ?? 1)) * 40;
    if (vm.bolt) {
      const t = Math.max(0, Math.min(1, (this.def.rate - this.cooldown) / this.def.rate));
      vm.bolt.position.z = 0.05 + (t > 0.2 && t < 0.8 ? Math.sin(((t - 0.2) / 0.6) * Math.PI) * 0.09 : 0);
    }

    vm.root.position.copy(p);
    vm.root.rotation.set(rx, ry, rz);

    // pump & glow & rocket tip
    if (vm.pump) {
      const t = Math.max(0, Math.min(1, (this.def.rate - this.cooldown) / this.def.rate));
      vm.pump.position.z = -0.36 + (t > 0.15 && t < 0.75 ? Math.sin(((t - 0.15) / 0.6) * Math.PI) * 0.08 : 0);
    }
    const am = this.ammo[this.current];
    if (vm.glow) vm.glow.emissiveIntensity = 0.6 + 2.2 * (am.mag / this.def.mag);
    if (vm.rocketTip && this.state !== 'reload') vm.rocketTip.visible = am.mag > 0 && this.cooldown < this.def.rate * 0.5;

    // muzzle flash
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flash.visible = true;
      const mw = vm.muzzle.getWorldPosition(new THREE.Vector3());
      this.camera.worldToLocal(mw);
      this.flash.position.copy(mw);
      const s = (this.current === 1 ? 0.32 : this.current === 2 ? 0.36 : this.current === SNIPER ? 0.3 : 0.2) * (0.8 + Math.random() * 0.4);
      this.flash.scale.set(s, s, s);
      (this.flash.material as THREE.MeshBasicMaterial).color.setHex(this.current === 0 ? 0xa8f4ff : this.current === MINIGUN ? 0xffb0e0 : 0xffd080);
      this.flash.visible = !this.scoped;
    } else this.flash.visible = false;
  }

  // -------------------------------------------------------------- viewmodels

  private part(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], parent: THREE.Object3D, rot: [number, number, number] = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    parent.add(m);
    return m;
  }

  private limb(from: THREE.Vector3, to: THREE.Vector3, r: number, mat: THREE.Material, parent: THREE.Object3D) {
    const len = from.distanceTo(to);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 12), mat);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    parent.add(m);
    return m;
  }

  /** Toy-soldier arms: olive moulded plastic with seam rings and chunky gloves. */
  private arms(parent: THREE.Object3D, gripR: THREE.Vector3, gripL: THREE.Vector3) {
    const sleeve = this.mats.plastic(0x5f8f2f, 0.45);
    const seam = this.mats.plastic(0x4a7524, 0.5);
    const glove = this.mats.plastic(0x6b4a2b, 0.6);
    const shoulderR = new THREE.Vector3(0.16, -0.32, 0.32);
    const elbowR = new THREE.Vector3(0.12, -0.2, 0.18);
    this.limb(shoulderR, elbowR, 0.05, sleeve, parent);
    this.limb(elbowR, gripR.clone().add(new THREE.Vector3(0.0, -0.03, 0.06)), 0.042, sleeve, parent);
    const cuffR = this.part(new THREE.TorusGeometry(0.043, 0.01, 6, 16), seam, [gripR.x, gripR.y - 0.03, gripR.z + 0.07], parent, [0.4, 0, 0]);
    void cuffR;
    this.part(rbox(0.07, 0.07, 0.09, 0.03), glove, [gripR.x, gripR.y - 0.01, gripR.z], parent, [0.3, 0, 0]);
    this.part(new THREE.CapsuleGeometry(0.015, 0.04, 3, 8), glove, [gripR.x - 0.035, gripR.y + 0.02, gripR.z - 0.03], parent, [1.2, 0, 0.3]);

    const shoulderL = new THREE.Vector3(-0.42, -0.42, 0.05);
    const elbowL = new THREE.Vector3(-0.26, -0.24, -0.12);
    this.limb(shoulderL, elbowL, 0.05, sleeve, parent);
    this.limb(elbowL, gripL.clone().add(new THREE.Vector3(-0.02, -0.03, 0.05)), 0.042, sleeve, parent);
    this.part(new THREE.TorusGeometry(0.043, 0.01, 6, 16), seam, [gripL.x - 0.015, gripL.y - 0.03, gripL.z + 0.06], parent, [0.6, 0.5, 0]);
    this.part(rbox(0.075, 0.06, 0.09, 0.028), glove, [gripL.x, gripL.y - 0.015, gripL.z], parent, [0.2, 0.3, 0.3]);
  }

  private sticker(kind: 'star' | 'bolt' | 'smile' | 'number', size: number, pos: [number, number, number], rotY: number, parent: THREE.Object3D, label = '7') {
    const m = this.mats.textured('vm-sticker-' + kind + label, () => T.stickerTex(kind, label), { transparent: true, alphaTest: 0.5, roughness: 0.5 });
    return this.part(new THREE.CircleGeometry(size, 20), m, pos, parent, [0, rotY, 0]);
  }

  private screws(parent: THREE.Object3D, pts: [number, number, number][], side: number) {
    const metal = new THREE.MeshStandardMaterial({ color: 0xd0d4dc, metalness: 0.9, roughness: 0.3 });
    for (const p of pts) this.part(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 8), metal, p, parent, [0, 0, Math.PI / 2 * side]);
  }

  private buildBlaster(): Viewmodel {
    const root = new THREE.Group();
    const orange = this.mats.plastic(0xff8a1f, 0.32);
    const blue = this.mats.plastic(0x2f7fe0, 0.3);
    const dark = this.mats.plastic(0x2a2d36, 0.55);
    const yellow = this.mats.plastic(0xffcf33, 0.3);
    const tip = this.mats.plastic(0xff5a00, 0.5);
    const glow = new THREE.MeshStandardMaterial({ color: 0x0a2a30, emissive: 0x4ff0ff, emissiveIntensity: 2, roughness: 0.3 });
    const w = new THREE.Group();
    root.add(w);
    this.part(rbox(0.09, 0.11, 0.42, 0.025), orange, [0, 0.02, -0.14], w);
    this.part(rbox(0.1, 0.05, 0.32, 0.02), blue, [0, 0.085, -0.13], w);
    this.part(new THREE.CylinderGeometry(0.026, 0.026, 0.24, 16), dark, [0, 0.035, -0.44], w, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) this.part(new THREE.TorusGeometry(0.03, 0.008, 8, 16), yellow, [0, 0.035, -0.37 - i * 0.06], w);
    this.part(new THREE.CylinderGeometry(0.032, 0.032, 0.045, 16), tip, [0, 0.035, -0.57], w, [Math.PI / 2, 0, 0]);
    const drum = this.part(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 20), yellow, [0, -0.07, -0.13], w, [0, 0, Math.PI / 2]);
    this.part(new THREE.CylinderGeometry(0.03, 0.03, 0.075, 12), blue, [0, 0, 0], drum);
    this.part(rbox(0.055, 0.15, 0.07, 0.02), dark, [0, -0.08, 0.05], w, [0.28, 0, 0]);
    this.part(new THREE.TorusGeometry(0.03, 0.007, 6, 12, Math.PI), dark, [0, -0.04, -0.01], w, [0, Math.PI / 2, Math.PI]);
    this.part(rbox(0.07, 0.09, 0.15, 0.03), blue, [0, 0.0, 0.16], w);
    this.part(new THREE.TorusGeometry(0.018, 0.005, 6, 16), yellow, [0, 0.13, -0.2], w);
    this.part(rbox(0.012, 0.03, 0.02, 0.004), yellow, [0, 0.117, -0.2], w);
    this.part(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0x66ff66, toneMapped: false }), [0, 0.13, -0.2], w);
    for (const s of [-1, 1]) this.part(new THREE.BoxGeometry(0.004, 0.014, 0.22), glow, [s * 0.046, 0.03, -0.16], w);
    this.sticker('star', 0.025, [-0.0462, 0.02, -0.02], -Math.PI / 2, w);
    this.sticker('number', 0.018, [-0.0462, 0.03, -0.27], -Math.PI / 2, w, '7');
    this.screws(w, [[-0.0465, -0.02, -0.06], [-0.0465, -0.02, -0.3], [-0.0465, 0.06, -0.3]], 1);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.035, -0.6);
    w.add(muzzle);
    this.arms(root, new THREE.Vector3(0, -0.1, 0.06), new THREE.Vector3(-0.045, -0.05, -0.3));
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).renderOrder = 1; });
    return { root, muzzle, glow, drum, rest: new THREE.Vector3(0.2, -0.22, -0.46) };
  }

  private buildShotgun(): Viewmodel {
    const root = new THREE.Group();
    const lime = this.mats.plastic(0x7bd35a, 0.32);
    const purple = this.mats.plastic(0x8a4fd8, 0.3);
    const dark = this.mats.plastic(0x2a2d36, 0.55);
    const orange = this.mats.plastic(0xff5a00, 0.5);
    const red = this.mats.plastic(0xe8342a, 0.35);
    const brass = new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 0.9, roughness: 0.3 });
    const w = new THREE.Group();
    root.add(w);
    this.part(rbox(0.12, 0.13, 0.36, 0.035), lime, [0, 0.02, -0.08], w);
    for (const s of [-1, 1]) {
      this.part(new THREE.CylinderGeometry(0.034, 0.034, 0.4, 18), purple, [s * 0.034, 0.07, -0.42], w, [Math.PI / 2, 0, 0]);
      this.part(new THREE.TorusGeometry(0.034, 0.01, 8, 18), orange, [s * 0.034, 0.07, -0.62], w);
      this.part(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 12), dark, [s * 0.034, 0.07, -0.623], w, [Math.PI / 2, 0, 0]);
    }
    const pump = this.part(rbox(0.13, 0.075, 0.15, 0.03), purple, [0, -0.01, -0.36], w);
    for (let i = 0; i < 4; i++) this.part(new THREE.BoxGeometry(0.135, 0.008, 0.012), dark, [0, -0.01, -0.31 - i * 0.03], pump.parent!);
    for (let i = 0; i < 4; i++) {
      this.part(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 10), red, [-0.065, 0.0, -0.02 - i * 0.04], w, [0, 0, Math.PI / 2]);
      this.part(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 10), brass, [-0.09, 0.0, -0.02 - i * 0.04], w, [0, 0, Math.PI / 2]);
    }
    this.part(rbox(0.06, 0.16, 0.08, 0.025), dark, [0, -0.09, 0.07], w, [0.3, 0, 0]);
    this.part(rbox(0.09, 0.13, 0.18, 0.04), purple, [0, -0.01, 0.2], w);
    this.part(rbox(0.02, 0.02, 0.03, 0.006), orange, [0, 0.1, -0.24], w);
    this.sticker('bolt', 0.035, [-0.0605, 0.035, -0.17], -Math.PI / 2, w);
    this.screws(w, [[-0.061, -0.03, 0.04], [-0.061, 0.07, 0.04], [-0.061, 0.07, -0.22]], 1);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.07, -0.65);
    w.add(muzzle);
    this.arms(root, new THREE.Vector3(0, -0.11, 0.08), new THREE.Vector3(-0.06, -0.03, -0.36));
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).renderOrder = 1; });
    return { root, muzzle, pump, rest: new THREE.Vector3(0.2, -0.23, -0.46) };
  }

  private buildRocket(): Viewmodel {
    const root = new THREE.Group();
    const DS = { side: THREE.DoubleSide };
    const teal = this.mats.plastic(0x2fb3b3, 0.3, DS);
    const white = this.mats.plastic(0xf6f3ec, 0.35);
    const yellow = this.mats.plastic(0xffcf33, 0.3, DS);
    const dark = this.mats.plastic(0x2a2d36, 0.55, DS);
    const foam = this.mats.plastic(0xff8a1f, 0.85);
    const w = new THREE.Group();
    root.add(w);
    this.part(new THREE.CylinderGeometry(0.085, 0.085, 0.8, 24, 1, true), teal, [0, 0.09, -0.18], w, [Math.PI / 2, 0, 0]);
    this.part(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 18, 1, true), dark, [0, 0.09, -0.18], w, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) this.part(new THREE.CylinderGeometry(0.088, 0.088, 0.04, 24), i % 2 ? white : yellow, [0, 0.09, -0.4 + i * 0.22], w, [Math.PI / 2, 0, 0]);
    this.part(new THREE.CylinderGeometry(0.11, 0.088, 0.08, 24, 1, true), yellow, [0, 0.09, -0.6], w, [Math.PI / 2, 0, 0]);
    this.part(new THREE.CylinderGeometry(0.088, 0.115, 0.07, 24, 1, true), yellow, [0, 0.09, 0.24], w, [Math.PI / 2, 0, 0]);
    const tip = new THREE.Group();
    tip.position.set(0, 0.09, -0.6);
    w.add(tip);
    this.part(new THREE.SphereGeometry(0.065, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), foam, [0, 0, -0.02], tip, [-Math.PI / 2, 0, 0]);
    this.part(new THREE.CylinderGeometry(0.066, 0.066, 0.06, 16), foam, [0, 0, 0.02], tip, [Math.PI / 2, 0, 0]);
    this.part(rbox(0.06, 0.15, 0.08, 0.025), dark, [0, -0.06, 0.06], w, [0.25, 0, 0]);
    this.part(rbox(0.05, 0.12, 0.06, 0.02), dark, [0, -0.03, -0.3], w, [0.1, 0, 0]);
    this.part(rbox(0.03, 0.045, 0.08, 0.012), white, [-0.075, 0.165, -0.3], w);
    const ring = new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false });
    this.part(new THREE.TorusGeometry(0.014, 0.003, 6, 16), ring, [-0.075, 0.17, -0.341], w);
    this.sticker('smile', 0.04, [-0.0865, 0.09, -0.08], -Math.PI / 2, w);
    this.screws(w, [[-0.087, 0.04, -0.3], [-0.087, 0.04, 0.1]], 1);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.09, -0.66);
    w.add(muzzle);
    this.arms(root, new THREE.Vector3(0, -0.09, 0.08), new THREE.Vector3(-0.05, -0.04, -0.3));
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).renderOrder = 1; });
    return { root, muzzle, rocketTip: tip, rest: new THREE.Vector3(0.25, -0.27, -0.56) };
  }

  private buildSniper(): Viewmodel {
    const root = new THREE.Group();
    const navy = this.mats.plastic(0x24345e, 0.35);
    const orange = this.mats.plastic(0xff8a1f, 0.32);
    const dark = this.mats.plastic(0x1e2028, 0.5);
    const tip = this.mats.plastic(0xff5a00, 0.5);
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a1830, emissive: 0x3fa9ff, emissiveIntensity: 0.8, roughness: 0.05, metalness: 0.3 });
    const w = new THREE.Group();
    root.add(w);
    this.part(rbox(0.075, 0.1, 0.5, 0.025), navy, [0, 0.0, -0.12], w);
    this.part(rbox(0.08, 0.035, 0.3, 0.012), orange, [0, -0.06, -0.2], w);
    this.part(new THREE.CylinderGeometry(0.018, 0.022, 0.5, 14), dark, [0, 0.025, -0.6], w, [Math.PI / 2, 0, 0]);
    this.part(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 14), tip, [0, 0.025, -0.86], w, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 2; i++) this.part(new THREE.TorusGeometry(0.024, 0.006, 6, 14), orange, [0, 0.025, -0.45 - i * 0.15], w);
    // scope
    this.part(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 18), dark, [0, 0.1, -0.12], w, [Math.PI / 2, 0, 0]);
    this.part(new THREE.CylinderGeometry(0.042, 0.032, 0.06, 18), dark, [0, 0.1, -0.27], w, [Math.PI / 2, 0, 0]);
    this.part(new THREE.CircleGeometry(0.038, 18), glass, [0, 0.1, -0.301], w, [0, Math.PI, 0]);
    this.part(rbox(0.02, 0.04, 0.03, 0.006), dark, [0, 0.06, -0.06], w);
    this.part(rbox(0.02, 0.04, 0.03, 0.006), dark, [0, 0.06, -0.18], w);
    // mag + grip + stock
    this.part(rbox(0.05, 0.08, 0.07, 0.015), orange, [0, -0.08, -0.14], w);
    this.part(rbox(0.055, 0.15, 0.07, 0.02), dark, [0, -0.09, 0.07], w, [0.3, 0, 0]);
    this.part(rbox(0.07, 0.1, 0.2, 0.03), navy, [0, -0.01, 0.22], w);
    this.part(rbox(0.072, 0.03, 0.12, 0.012), orange, [0, 0.045, 0.2], w);
    const bolt = new THREE.Group();
    bolt.position.set(0.045, 0.03, 0.05);
    w.add(bolt);
    this.part(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8), dark, [0.02, 0, 0], bolt, [0, 0, Math.PI / 2]);
    this.part(new THREE.SphereGeometry(0.015, 10, 8), orange, [0.045, 0, 0], bolt);
    this.sticker('bolt', 0.022, [-0.0382, 0.0, -0.05], -Math.PI / 2, w);
    this.screws(w, [[-0.0385, -0.03, -0.3], [-0.0385, 0.03, -0.3], [-0.0385, -0.03, 0.15]], 1);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.025, -0.9);
    w.add(muzzle);
    this.arms(root, new THREE.Vector3(0, -0.11, 0.08), new THREE.Vector3(-0.04, -0.05, -0.36));
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).renderOrder = 1; });
    return { root, muzzle, bolt, rest: new THREE.Vector3(0.2, -0.22, -0.5) };
  }

  private buildMinigun(): Viewmodel {
    const root = new THREE.Group();
    const pink = this.mats.plastic(0xff6fa8, 0.3);
    const yellow = this.mats.plastic(0xffcf33, 0.3);
    const dark = this.mats.plastic(0x2a2d36, 0.5);
    const teal = this.mats.plastic(0x2fb3b3, 0.3);
    const w = new THREE.Group();
    root.add(w);
    this.part(rbox(0.15, 0.15, 0.3, 0.04), pink, [0, 0, -0.05], w);
    const spinner = new THREE.Group();
    spinner.position.set(0, 0.0, -0.35);
    w.add(spinner);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.part(new THREE.CylinderGeometry(0.016, 0.016, 0.42, 10), i % 2 ? teal : dark, [Math.cos(a) * 0.04, Math.sin(a) * 0.04, -0.05], spinner, [Math.PI / 2, 0, 0]);
    }
    this.part(new THREE.TorusGeometry(0.06, 0.012, 8, 18), yellow, [0, 0, 0.05], spinner);
    this.part(new THREE.TorusGeometry(0.06, 0.012, 8, 18), yellow, [0, 0, -0.24], spinner);
    this.part(new THREE.CylinderGeometry(0.075, 0.075, 0.09, 18), yellow, [0, -0.11, 0.0], w, [0, 0, Math.PI / 2]);
    for (let i = 0; i < 6; i++) this.part(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 6), yellow, [0.05, -0.08 + i * 0.02, -0.02 + i * 0.01], w, [0, 0, Math.PI / 2]);
    this.part(rbox(0.04, 0.05, 0.16, 0.015), dark, [0, 0.11, -0.05], w);
    this.part(rbox(0.06, 0.15, 0.07, 0.02), dark, [0, -0.08, 0.13], w, [0.3, 0, 0]);
    this.sticker('star', 0.035, [-0.0755, 0.01, -0.05], -Math.PI / 2, w);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, -0.62);
    w.add(muzzle);
    this.arms(root, new THREE.Vector3(0, -0.1, 0.12), new THREE.Vector3(-0.07, 0.06, -0.08));
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).renderOrder = 1; });
    return { root, muzzle, spinner, rest: new THREE.Vector3(0.22, -0.26, -0.48) };
  }
}

function makeFlashTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,240,200,0.9)');
  g.addColorStop(1, 'rgba(255,200,100,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = i % 2 ? 22 : 62;
    ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
