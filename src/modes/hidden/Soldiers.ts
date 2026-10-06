import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rbox } from '../../environment/Builder';

/**
 * The Red Brigade marching soldiers, drawn as one crowd. NPCs and real players
 * in Hidden Troopers are ALL drawn by this one renderer, with the same model,
 * scale, materials and animation, so nobody can be told apart by looks.
 *
 * Four instanced meshes (body, two arms, concealed pistol): the whole crowd is a
 * handful of draw calls no matter how many soldiers there are.
 */

const RED = new THREE.Color(0xd8352a);
const DARK = new THREE.Color(0x2a0a08);
const GREY = new THREE.Color(0x2a2d36);
const ORANGE = new THREE.Color(0xff8a1f);

function paint(g: THREE.BufferGeometry, c: THREE.Color) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  return g.index ? g.toNonIndexed() : g;
}
function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return g;
}

function bodyGeo() {
  const parts = [
    paint(at(rbox(0.95, 0.12, 0.75, 0.05), 0, 0.06, 0), RED),
    paint(at(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), -0.14, 0.45, 0.05, 0.15), RED),
    paint(at(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), 0.14, 0.42, -0.1, -0.25), RED),
    paint(at(rbox(0.5, 0.58, 0.32, 0.1), 0, 1.0, 0), RED),
    paint(at(new THREE.TorusGeometry(0.22, 0.04, 6, 14), 0, 0.76, 0, Math.PI / 2), RED),
    paint(at(rbox(0.36, 0.4, 0.18, 0.06), 0, 1.05, -0.24), RED),
    paint(at(new THREE.SphereGeometry(0.19, 12, 10), 0, 1.5, 0.02), RED),
    paint(at(new THREE.SphereGeometry(0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.56, 0), RED),
    paint(at(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), 0, 1.56, 0), RED),
    paint(at(new THREE.SphereGeometry(0.03, 6, 4), -0.07, 1.5, 0.18), DARK),
    paint(at(new THREE.SphereGeometry(0.03, 6, 4), 0.07, 1.5, 0.18), DARK),
  ];
  return mergeGeometries(parts)!;
}
/** arm hanging from its shoulder pivot (origin) */
function armGeo() {
  return mergeGeometries([paint(at(new THREE.CapsuleGeometry(0.075, 0.34, 4, 8), 0, -0.24, 0), RED), paint(at(new THREE.SphereGeometry(0.085, 8, 6), 0, -0.46, 0.02), RED)])!;
}
/** toy pistol held in the hand at the end of the arm (origin = shoulder) */
function pistolGeo() {
  return mergeGeometries([
    paint(at(rbox(0.07, 0.11, 0.3, 0.02), 0, -0.5, 0.14), GREY),
    paint(at(rbox(0.06, 0.15, 0.07, 0.02), 0, -0.6, 0.02, 0.3), GREY),
    paint(at(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10), 0, -0.48, 0.3, Math.PI / 2), ORANGE),
  ])!;
}

export const SHOULDER_L = new THREE.Vector3(-0.31, 1.22, 0.0);
export const SHOULDER_R = new THREE.Vector3(0.31, 1.22, 0.0);

/** Animation state of one soldier (filled by whoever drives it). */
export interface SoldierPose {
  pos: THREE.Vector3;
  yaw: number;
  /** horizontal speed (drives the hop) */
  speed: number;
  /** 0..1 right arm reaching out to steal */
  reach: number;
  /** 0..1 pistol drawn and aimed */
  pistol: number;
  /** 0..1 knocked over (eliminated players) */
  fallen: number;
  /** look pitch, for the aiming arm */
  pitch: number;
  visible: boolean;
}

export class SoldierCrowd {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private armL: THREE.InstancedMesh;
  private armR: THREE.InstancedMesh;
  private gun: THREE.InstancedMesh;
  private hop: Float32Array;
  private m = new THREE.Matrix4();
  private mb = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(readonly capacity: number) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0, side: THREE.DoubleSide });
    this.body = new THREE.InstancedMesh(bodyGeo(), mat, capacity);
    this.armL = new THREE.InstancedMesh(armGeo(), mat, capacity);
    this.armR = new THREE.InstancedMesh(armGeo(), mat, capacity);
    this.gun = new THREE.InstancedMesh(pistolGeo(), mat, capacity);
    for (const im of [this.body, this.armL, this.armR, this.gun]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = true;
      for (let i = 0; i < capacity; i++) im.setMatrixAt(i, this.zero);
      this.group.add(im);
    }
    this.hop = new Float32Array(capacity).map(() => Math.random() * Math.PI);
  }

  /** Same animation for everyone: hop on the moulded base, swing the arms. */
  set(i: number, pose: SoldierPose, dt: number) {
    if (!pose.visible) {
      this.body.setMatrixAt(i, this.zero);
      this.armL.setMatrixAt(i, this.zero);
      this.armR.setMatrixAt(i, this.zero);
      this.gun.setMatrixAt(i, this.zero);
      return;
    }
    const moving = pose.speed > 1 && pose.fallen <= 0;
    let h = this.hop[i];
    if (moving) h += dt * 9 * Math.min(1.3, pose.speed / 6);
    else h += (Math.round(h / Math.PI) * Math.PI - h) * Math.min(1, dt * 10);
    this.hop[i] = h;
    const k = Math.abs(Math.sin(h));
    const squash = 1 - (1 - k) * (moving ? 0.12 : 0);
    // body: hop height, squash, forward lean while marching, topple when knocked out
    this.e.set(moving ? 0.12 + Math.cos(h) * 0.08 : 0, pose.yaw + Math.PI, 0);
    this.e.x -= pose.fallen * 1.5;
    this.q.setFromEuler(this.e);
    this.s.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6);
    this.p.set(pose.pos.x, pose.pos.y + k * 0.32 * (1 - pose.fallen) + pose.fallen * 0.2, pose.pos.z);
    this.mb.compose(this.p, this.q, this.s);
    this.body.setMatrixAt(i, this.mb);
    // arms: marching swing; the right arm reaches out to steal or aims the pistol
    const swing = moving ? Math.sin(h * 0.5) * 0.55 : 0;
    this.limb(this.armL, i, SHOULDER_L, swing, 0.12);
    const aim = Math.max(pose.reach, pose.pistol);
    const reachAngle = pose.pistol > 0 ? -Math.PI / 2 - pose.pitch : -1.25;
    this.limb(this.armR, i, SHOULDER_R, -swing * (1 - aim) + reachAngle * aim, -0.12 * (1 - aim), 1 + 0.25 * pose.reach);
    if (pose.pistol > 0.05) {
      this.armR.getMatrixAt(i, this.m);
      this.gun.setMatrixAt(i, this.m);
    } else this.gun.setMatrixAt(i, this.zero);
  }

  private limb(im: THREE.InstancedMesh, i: number, shoulder: THREE.Vector3, rx: number, rz: number, stretch = 1) {
    this.m.compose(shoulder, this.q.setFromEuler(this.e.set(rx, 0, rz)), this.s.set(1, stretch, 1));
    this.m.premultiply(this.mb);
    im.setMatrixAt(i, this.m);
  }

  /** hide everything from index n up */
  hideFrom(n: number) {
    for (let i = n; i < this.capacity; i++) for (const im of [this.body, this.armL, this.armR, this.gun]) im.setMatrixAt(i, this.zero);
  }

  commit() {
    for (const im of [this.body, this.armL, this.armR, this.gun]) im.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const im of [this.body, this.armL, this.armR, this.gun]) im.geometry.dispose();
    (this.body.material as THREE.Material).dispose();
  }
}
