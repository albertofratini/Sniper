import * as THREE from 'three';
import * as T from '../environment/Textures';
import { CollisionWorld } from './Collision';

const dummy = new THREE.Object3D();
const tmpC = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Frag {
  life: number; max: number;
  p: THREE.Vector3; v: THREE.Vector3;
  r: THREE.Euler; av: THREE.Vector3;
  s: number; bounces: number;
}

interface Glow {
  life: number; max: number;
  p: THREE.Vector3; v: THREE.Vector3;
  s0: number; s1: number;
  color: THREE.Color;
  drag: number;
  up: number;
}

interface Tracer { life: number; max: number; a: THREE.Vector3; b: THREE.Vector3; w: number; color: THREE.Color }

/**
 * All transient visual effects, each as a single InstancedMesh:
 * toy fragments (lit, bouncing), additive glows (flashes/sparks/puffs),
 * tracers, and impact decals.
 */
export class Effects {
  readonly group = new THREE.Group();
  private frags: Frag[] = [];
  private fragMesh: THREE.InstancedMesh;
  private fragCap: number;
  private fragNext = 0;

  private glows: Glow[] = [];
  private glowMesh: THREE.InstancedMesh;
  private glowCap: number;
  private glowNext = 0;

  private puffs: Glow[] = [];
  private puffMesh: THREE.InstancedMesh;
  private puffNext = 0;
  private puffCap = 60;

  private tracers: Tracer[] = [];
  private tracerMesh: THREE.InstancedMesh;
  private tracerNext = 0;
  private tracerCap = 48;

  private decalMesh: THREE.InstancedMesh;
  private decalNext = 0;
  private decalCap = 90;

  private shakeCb: (amt: number) => void = () => {};

  constructor(private world: CollisionWorld, lowEnd: boolean) {
    this.fragCap = lowEnd ? 220 : 400;
    this.glowCap = lowEnd ? 80 : 140;

    const fragMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0 });
    this.fragMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), fragMat, this.fragCap);
    this.fragMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.fragCap * 3).fill(1), 3);
    this.initMesh(this.fragMesh, this.fragCap);
    for (let i = 0; i < this.fragCap; i++)
      this.frags.push({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), av: new THREE.Vector3(), s: 0.2, bounces: 0 });

    const dot = T.dotTex();
    const glowMat = new THREE.MeshBasicMaterial({ map: dot, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    this.glowMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMat, this.glowCap);
    this.glowMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.glowCap * 3), 3);
    this.glowMesh.renderOrder = 10;
    this.initMesh(this.glowMesh, this.glowCap);
    for (let i = 0; i < this.glowCap; i++)
      this.glows.push({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s0: 1, s1: 1, color: new THREE.Color(), drag: 0, up: 0 });

    // soft foam puffs: normal blending, shrink out
    const puffMat = new THREE.MeshStandardMaterial({ map: dot, transparent: true, depthWrite: false, roughness: 1, alphaTest: 0.02 });
    this.puffMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), puffMat, this.puffCap);
    this.puffMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.puffCap * 3).fill(1), 3);
    this.puffMesh.renderOrder = 9;
    this.initMesh(this.puffMesh, this.puffCap);
    for (let i = 0; i < this.puffCap; i++)
      this.puffs.push({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), s0: 1, s1: 1, color: new THREE.Color(), drag: 0, up: 0 });

    const trGeo = new THREE.BoxGeometry(1, 1, 1);
    trGeo.translate(0, 0, 0.5);
    const trMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
    this.tracerMesh = new THREE.InstancedMesh(trGeo, trMat, this.tracerCap);
    this.tracerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.tracerCap * 3), 3);
    this.initMesh(this.tracerMesh, this.tracerCap);
    for (let i = 0; i < this.tracerCap; i++)
      this.tracers.push({ life: 0, max: 1, a: new THREE.Vector3(), b: new THREE.Vector3(), w: 0.05, color: new THREE.Color() });

    const decalTex = makeDecalTex();
    const decalMat = new THREE.MeshStandardMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.6 });
    this.decalMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), decalMat, this.decalCap);
    this.decalMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.decalCap * 3).fill(1), 3);
    this.initMesh(this.decalMesh, this.decalCap);
    this.decalMesh.receiveShadow = true;
  }

  private initMesh(m: THREE.InstancedMesh, cap: number) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) m.setMatrixAt(i, ZERO);
    m.frustumCulled = false;
    m.castShadow = false;
    this.group.add(m);
  }

  onShake(cb: (amt: number) => void) {
    this.shakeCb = cb;
  }

  // ------------------------------------------------------------- spawners

  fragments(p: THREE.Vector3, colors: number[], n: number, speed = 8, size = 0.18, up = 6) {
    for (let i = 0; i < n; i++) {
      const f = this.frags[this.fragNext];
      const idx = this.fragNext;
      this.fragNext = (this.fragNext + 1) % this.fragCap;
      f.life = f.max = 1.6 + Math.random() * 1.2;
      f.p.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4));
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.8);
      f.v.set(Math.cos(a) * s, up * (0.4 + Math.random()), Math.sin(a) * s);
      f.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      f.av.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      f.s = size * (0.5 + Math.random() * 0.9);
      f.bounces = 0;
      tmpC.setHex(colors[(Math.random() * colors.length) | 0]);
      this.fragMesh.setColorAt(idx, tmpC);
    }
    this.fragMesh.instanceColor!.needsUpdate = true;
  }

  glow(p: THREE.Vector3, color: number | THREE.Color, s0: number, s1: number, life: number, v?: THREE.Vector3, drag = 2, up = 0) {
    const g = this.glows[this.glowNext];
    this.glowNext = (this.glowNext + 1) % this.glowCap;
    g.life = g.max = life;
    g.p.copy(p);
    if (v) g.v.copy(v); else g.v.set(0, 0, 0);
    g.s0 = s0;
    g.s1 = s1;
    if (typeof color === 'number') g.color.setHex(color); else g.color.copy(color);
    g.drag = drag;
    g.up = up;
  }

  puff(p: THREE.Vector3, color: number, s0: number, s1: number, life: number, v?: THREE.Vector3, up = 1.5) {
    const g = this.puffs[this.puffNext];
    const idx = this.puffNext;
    this.puffNext = (this.puffNext + 1) % this.puffCap;
    g.life = g.max = life;
    g.p.copy(p);
    if (v) g.v.copy(v); else g.v.set(0, 0, 0);
    g.s0 = s0;
    g.s1 = s1;
    g.color.setHex(color);
    g.up = up;
    g.drag = 3;
    this.puffMesh.setColorAt(idx, g.color);
    this.puffMesh.instanceColor!.needsUpdate = true;
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number, w = 0.05, life = 0.08) {
    const t = this.tracers[this.tracerNext];
    this.tracerNext = (this.tracerNext + 1) % this.tracerCap;
    t.a.copy(a);
    t.b.copy(b);
    t.color.setHex(color);
    t.w = w;
    t.life = t.max = life;
  }

  decal(p: THREE.Vector3, n: THREE.Vector3, size: number, color = 0x2a2026) {
    const i = this.decalNext;
    this.decalNext = (this.decalNext + 1) % this.decalCap;
    // sits on the surface (tiny lift + polygon offset against z-fighting), facing along its normal
    dummy.position.copy(p).addScaledVector(n, 0.004);
    dummy.lookAt(dummy.position.x + n.x, dummy.position.y + n.y, dummy.position.z + n.z);
    dummy.rotateZ(Math.random() * 6.28);
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    this.decalMesh.setMatrixAt(i, dummy.matrix);
    tmpC.setHex(color);
    this.decalMesh.setColorAt(i, tmpC);
    this.decalMesh.instanceMatrix.needsUpdate = true;
    this.decalMesh.instanceColor!.needsUpdate = true;
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, color = 0xfff0c0, colors?: number[]) {
    this.glow(p.clone().addScaledVector(n, 0.05), color, 0.6, 0.1, 0.12);
    for (let i = 0; i < 3; i++) {
      const v = n.clone().multiplyScalar(4 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5));
      this.glow(p, 0xffc070, 0.12, 0.02, 0.25 + Math.random() * 0.15, v, 1, -18);
    }
    if (colors) this.fragments(p.clone().addScaledVector(n, 0.1), colors, 2, 3, 0.07, 3);
  }

  explosion(p: THREE.Vector3, radius: number, colors = [0xff4d3d, 0xffcf33, 0x3fa9ff, 0x7bd35a, 0xff6fa8, 0xffffff]) {
    this.glow(p, 0xffc860, radius * 2.4, radius * 0.3, 0.35);
    this.glow(p, 0xff7a30, radius * 1.4, radius * 2.2, 0.45);
    for (let i = 0; i < 10; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(radius * 3 + Math.random() * radius * 3);
      this.glow(p, 0xffb050, 0.3, 0.05, 0.5 + Math.random() * 0.3, v, 1.5, -12);
    }
    for (let i = 0; i < 7; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize().multiplyScalar(radius * 1.2);
      this.puff(p.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xfff6ea, radius * 0.5, radius * 1.4, 0.9 + Math.random() * 0.5, v, 1.2);
    }
    this.fragments(p, colors, 26, radius * 2.2, 0.16, radius * 2);
    this.shakeCb(radius * 0.12);
  }

  confetti(p: THREE.Vector3, n = 40) {
    this.fragments(p, [0xff4d3d, 0xffcf33, 0x3fa9ff, 0x7bd35a, 0xff6fa8, 0xffffff, 0x9b59d0], n, 10, 0.14, 10);
  }

  // ------------------------------------------------------------- update

  update(dt: number, cam: THREE.Camera) {
    // fragments
    const fm = this.fragMesh;
    let anyF = false;
    for (let i = 0; i < this.fragCap; i++) {
      const f = this.frags[i];
      if (f.life <= 0) continue;
      anyF = true;
      f.life -= dt;
      if (f.life <= 0) {
        fm.setMatrixAt(i, ZERO);
        continue;
      }
      f.v.y -= 26 * dt;
      f.p.addScaledVector(f.v, dt);
      const ground = f.p.y < 4 ? this.world.groundAt(f.p.x, f.p.z, f.p.y + 0.3) : this.world.groundAt(f.p.x, f.p.z, f.p.y + 0.3);
      if (f.p.y < ground + f.s * 0.5) {
        f.p.y = ground + f.s * 0.5;
        if (f.v.y < 0) {
          f.v.y *= -0.45;
          f.v.x *= 0.6;
          f.v.z *= 0.6;
          f.av.multiplyScalar(0.6);
          f.bounces++;
          if (Math.abs(f.v.y) < 0.6) f.v.y = 0;
        }
      }
      f.r.x += f.av.x * dt;
      f.r.y += f.av.y * dt;
      f.r.z += f.av.z * dt;
      dummy.position.copy(f.p);
      dummy.rotation.copy(f.r);
      const fade = Math.min(1, f.life / 0.4);
      dummy.scale.set(f.s, f.s * 0.6, f.s * 1.3).multiplyScalar(fade);
      dummy.updateMatrix();
      fm.setMatrixAt(i, dummy.matrix);
    }
    if (anyF) fm.instanceMatrix.needsUpdate = true;

    // glows (billboards)
    const q = cam.quaternion;
    const gm = this.glowMesh;
    for (let i = 0; i < this.glowCap; i++) {
      const g = this.glows[i];
      if (g.life <= 0) {
        if (g.max > 0) { gm.setMatrixAt(i, ZERO); g.max = 0; }
        continue;
      }
      g.life -= dt;
      const t = 1 - Math.max(0, g.life) / g.max;
      g.v.multiplyScalar(Math.max(0, 1 - g.drag * dt));
      g.v.y += g.up * dt;
      g.p.addScaledVector(g.v, dt);
      dummy.position.copy(g.p);
      dummy.quaternion.copy(q);
      dummy.scale.setScalar(Math.max(0.001, g.s0 + (g.s1 - g.s0) * t));
      dummy.updateMatrix();
      gm.setMatrixAt(i, dummy.matrix);
      const k = (1 - t) * (1 - t);
      tmpC.copy(g.color).multiplyScalar(k);
      gm.setColorAt(i, tmpC);
    }
    gm.instanceMatrix.needsUpdate = true;
    gm.instanceColor!.needsUpdate = true;

    const pm = this.puffMesh;
    for (let i = 0; i < this.puffCap; i++) {
      const g = this.puffs[i];
      if (g.life <= 0) {
        if (g.max > 0) { pm.setMatrixAt(i, ZERO); g.max = 0; }
        continue;
      }
      g.life -= dt;
      const t = 1 - Math.max(0, g.life) / g.max;
      g.v.multiplyScalar(Math.max(0, 1 - g.drag * dt));
      g.v.y += g.up * dt;
      g.p.addScaledVector(g.v, dt);
      dummy.position.copy(g.p);
      dummy.quaternion.copy(q);
      const s = (g.s0 + (g.s1 - g.s0) * Math.sqrt(t)) * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      dummy.scale.setScalar(Math.max(0.001, s));
      dummy.updateMatrix();
      pm.setMatrixAt(i, dummy.matrix);
    }
    pm.instanceMatrix.needsUpdate = true;

    const tm = this.tracerMesh;
    for (let i = 0; i < this.tracerCap; i++) {
      const tr = this.tracers[i];
      if (tr.life <= 0) {
        if (tr.max > 0) { tm.setMatrixAt(i, ZERO); tr.max = 0; }
        continue;
      }
      tr.life -= dt;
      const k = Math.max(0, tr.life / tr.max);
      // tracer slides from a toward b
      const len = tr.a.distanceTo(tr.b);
      const head = 1 - k;
      dummy.position.copy(tr.a).lerp(tr.b, Math.max(0, head - 0.35));
      dummy.lookAt(tr.b);
      dummy.scale.set(tr.w, tr.w, Math.max(0.01, len * 0.5));
      dummy.updateMatrix();
      tm.setMatrixAt(i, dummy.matrix);
      tmpC.copy(tr.color).multiplyScalar(k);
      tm.setColorAt(i, tmpC);
    }
    tm.instanceMatrix.needsUpdate = true;
    tm.instanceColor!.needsUpdate = true;
  }

  clear() {
    for (const f of this.frags) f.life = 0;
    for (let i = 0; i < this.fragCap; i++) this.fragMesh.setMatrixAt(i, ZERO);
    this.fragMesh.instanceMatrix.needsUpdate = true;
    for (const g of this.glows) g.life = 0;
    for (const g of this.puffs) g.life = 0;
    for (const t of this.tracers) t.life = 0;
    for (let i = 0; i < this.decalCap; i++) this.decalMesh.setMatrixAt(i, ZERO);
    this.decalMesh.instanceMatrix.needsUpdate = true;
  }
}

function makeDecalTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  // paint-chip splat
  const r = T.rand(9);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const rr = 14 + r() * 12;
    ctx.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr);
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  ctx.arc(32, 32, 7, 0, 6.3);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
