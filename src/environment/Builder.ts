import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Materials, MatKind } from './Materials';
import { CollisionWorld } from '../game/Collision';

/** World units per centimetre. The player is ~2.9 cm tall (1.8 units). */
export const CM = 1 / 1.6;

interface PartOpts {
  collide?: boolean;
  /** inflate collision box (cm) */
  pad?: number;
  shadow?: boolean;
  /** floor-contact ambient occlusion strength (0..1) */
  ao?: number;
}

const tmpBox = new THREE.Box3();
const tmpColor = new THREE.Color();

/**
 * Collects static geometry authored in centimetres, bakes colour + fake contact
 * AO into vertex colours and merges everything per material into a handful of
 * meshes. Also registers collision boxes in world units.
 */
export class Builder {
  private parts = new Map<MatKind, THREE.BufferGeometry[]>();
  private noShadow = new Map<MatKind, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4().makeScale(CM, CM, CM)];
  readonly group = new THREE.Group();

  constructor(public mats: Materials, public world: CollisionWorld) {}

  get m() {
    return this.stack[this.stack.length - 1];
  }

  /** Run fn with an extra local transform (position cm, rotation radians, uniform scale). */
  push(pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale = 1) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ')),
      new THREE.Vector3(scale, scale, scale),
    );
    this.stack.push(this.m.clone().multiply(local));
  }
  pop() {
    this.stack.pop();
  }
  with(pos: [number, number, number], rot: [number, number, number], fn: () => void, scale = 1) {
    this.push(pos, rot, scale);
    fn();
    this.pop();
  }

  /** Add a geometry (local cm coords) with a transform relative to current stack. */
  part(
    geo: THREE.BufferGeometry,
    kind: MatKind,
    color: THREE.ColorRepresentation,
    pos: [number, number, number] = [0, 0, 0],
    rot: [number, number, number] = [0, 0, 0],
    opts: PartOpts = {},
  ) {
    const mat = this.m.clone().multiply(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    g.applyMatrix4(mat);
    // vertex colours w/ contact AO from world height
    const p = g.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(p.count * 3);
    tmpColor.set(color);
    const ao = opts.ao ?? 0.55;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = Math.min(1, Math.max(0, y / 2.2));
      const occ = 1 - ao * (1 - t * t * (3 - 2 * t));
      // slight random tint variation per part for imperfect plastic
      cols[i * 3] = tmpColor.r * occ;
      cols[i * 3 + 1] = tmpColor.g * occ;
      cols[i * 3 + 2] = tmpColor.b * occ;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const shadow = opts.shadow ?? true;
    const map = shadow ? this.parts : this.noShadow;
    let l = map.get(kind);
    if (!l) map.set(kind, (l = []));
    l.push(g);
    if (opts.collide) {
      g.computeBoundingBox();
      tmpBox.copy(g.boundingBox!);
      const pad = (opts.pad ?? 0) * CM;
      this.world.add(tmpBox.min.x - pad, tmpBox.min.y, tmpBox.min.z - pad, tmpBox.max.x + pad, tmpBox.max.y, tmpBox.max.z + pad);
    }
    return g;
  }

  /** Axis-aligned rounded box from ranges in local cm. */
  box(
    kind: MatKind,
    color: THREE.ColorRepresentation,
    x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
    radius = 0.6,
    opts: PartOpts = {},
  ) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    const r = Math.min(radius, w / 2.01, h / 2.01, d / 2.01);
    const geo = r > 0.05 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d);
    scaleUV(geo, Math.max(w, h, d) / 40);
    return this.part(geo, kind, color, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [0, 0, 0], opts);
  }

  /** Collision-only box in local cm (current transform translation+scale only). */
  collider(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    const a = new THREE.Vector3(x0, y0, z0).applyMatrix4(this.m);
    const b = new THREE.Vector3(x1, y1, z1).applyMatrix4(this.m);
    this.world.add(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
  }

  /** A separate mesh with its own (textured) material. Geometry in local cm. */
  mesh(geo: THREE.BufferGeometry, material: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], opts: PartOpts = {}) {
    const mesh = new THREE.Mesh(geo, material);
    const mat = this.m.clone().multiply(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    mat.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.castShadow = opts.shadow ?? true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    if (opts.collide) {
      geo.computeBoundingBox();
      tmpBox.copy(geo.boundingBox!).applyMatrix4(mat);
      this.world.add(tmpBox.min.x, tmpBox.min.y, tmpBox.min.z, tmpBox.max.x, tmpBox.max.y, tmpBox.max.z);
    }
    return mesh;
  }

  /** Merge everything into a few meshes. */
  finalize() {
    const emit = (map: Map<MatKind, THREE.BufferGeometry[]>, shadow: boolean) => {
      for (const [kind, geos] of map) {
        // split into chunks to keep frustum culling useful
        const chunk = 400;
        for (let i = 0; i < geos.length; i += chunk) {
          const merged = mergeGeometries(geos.slice(i, i + chunk), false);
          if (!merged) continue;
          merged.computeBoundingSphere();
          merged.computeBoundingBox();
          const mesh = new THREE.Mesh(merged, this.mats.kinds[kind]);
          mesh.castShadow = shadow && kind !== 'glow';
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          this.group.add(mesh);
        }
        geos.forEach((g) => g.dispose());
      }
      map.clear();
    };
    emit(this.parts, true);
    emit(this.noShadow, false);
    return this.group;
  }
}

export function scaleUV(geo: THREE.BufferGeometry, s: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);
  return geo;
}

/** Rounded box helper for dynamic meshes. */
export function rbox(w: number, h: number, d: number, r = 0.1, seg = 2) {
  const rr = Math.min(r, w / 2.01, h / 2.01, d / 2.01);
  return rr > 0.01 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d);
}
