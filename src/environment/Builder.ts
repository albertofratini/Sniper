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
  /** rounded-corner segments (1 = cheap bevel) */
  seg?: number;
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
      geo.computeBoundingBox();
      this.addOrientedCollider(geo.boundingBox!, mat, (opts.pad ?? 0) * CM);
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
    const geo = r > 0.05 ? new RoundedBoxGeometry(w, h, d, opts.seg ?? 2, r) : new THREE.BoxGeometry(w, h, d);
    scaleUV(geo, Math.max(w, h, d) / 40);
    return this.part(geo, kind, color, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [0, 0, 0], opts);
  }

  /** Collision-only box in local cm (current transform translation+scale only). */
  collider(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    this.addOrientedCollider(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)), this.m, 0);
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
      this.addOrientedCollider(geo.boundingBox!, mat, 0);
    }
    return mesh;
  }

  /**
   * Register collision for a local-space box under an arbitrary transform.
   * Axis-aligned transforms give one AABB; rotated ones are split into a grid of
   * small cells so the union hugs the real (oriented) shape instead of leaving
   * invisible walls around diagonal props.
   */
  private addOrientedCollider(local: THREE.Box3, m: THREE.Matrix4, pad: number) {
    const e = m.elements;
    const sx = Math.hypot(e[0], e[1], e[2]) || 1;
    const sy = Math.hypot(e[4], e[5], e[6]) || 1;
    const sz = Math.hypot(e[8], e[9], e[10]) || 1;
    // each normalized column must point along a single axis
    const aligned = [[e[0] / sx, e[1] / sx, e[2] / sx], [e[4] / sy, e[5] / sy, e[6] / sy], [e[8] / sz, e[9] / sz, e[10] / sz]]
      .every((c) => c.filter((v) => Math.abs(v) > 0.02).length === 1);
    if (aligned) {
      tmpBox.copy(local).applyMatrix4(m);
      this.world.add(tmpBox.min.x - pad, tmpBox.min.y, tmpBox.min.z - pad, tmpBox.max.x + pad, tmpBox.max.y, tmpBox.max.z + pad);
      return;
    }
    const size = local.getSize(new THREE.Vector3());
    const cell = Math.max(0.5, Math.min(size.x, size.y, size.z) / 1.5);
    const nx = Math.min(8, Math.max(1, Math.round(size.x / cell)));
    // objects only rotated about the vertical axis are never split in height:
    // stacked cells would create hidden ledges inside the object
    const upright = Math.abs(e[5] / sy) > 0.98;
    const ny = upright ? 1 : Math.min(4, Math.max(1, Math.round(size.y / cell)));
    const nz = Math.min(8, Math.max(1, Math.round(size.z / cell)));
    const c = new THREE.Box3();
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++)
        for (let k = 0; k < nz; k++) {
          c.min.set(local.min.x + (size.x * i) / nx, local.min.y + (size.y * j) / ny, local.min.z + (size.z * k) / nz);
          c.max.set(local.min.x + (size.x * (i + 1)) / nx, local.min.y + (size.y * (j + 1)) / ny, local.min.z + (size.z * (k + 1)) / nz);
          tmpBox.copy(c).applyMatrix4(m);
          this.world.add(tmpBox.min.x - pad, tmpBox.min.y, tmpBox.min.z - pad, tmpBox.max.x + pad, tmpBox.max.y, tmpBox.max.z + pad);
        }
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
