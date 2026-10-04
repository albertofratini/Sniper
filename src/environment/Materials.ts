import * as THREE from 'three';
import * as T from './Textures';

export type MatKind =
  | 'glossy'
  | 'matte'
  | 'painted'
  | 'rubber'
  | 'fabric'
  | 'cardboard'
  | 'wood'
  | 'metal'
  | 'paper'
  | 'glow';

/**
 * Shared material library. Static props use vertex colours so many differently
 * coloured parts can be merged into a single draw call per material kind.
 */
export class Materials {
  readonly kinds: Record<MatKind, THREE.MeshStandardMaterial>;
  readonly plasticMap: THREE.Texture;
  readonly plasticRough: THREE.Texture;
  readonly fabricMap: THREE.Texture;
  readonly cardMap: THREE.Texture;
  readonly blob: THREE.Texture;
  private cache = new Map<string, THREE.Material>();

  constructor() {
    this.plasticMap = T.plasticDetail();
    this.plasticRough = T.plasticRough();
    this.fabricMap = T.fabricDetail();
    this.cardMap = T.cardboardDetail();
    this.blob = T.blobTex();

    const std = (p: THREE.MeshStandardMaterialParameters) =>
      new THREE.MeshStandardMaterial({ vertexColors: true, ...p });

    this.kinds = {
      glossy: std({ map: this.plasticMap, roughness: 0.32, roughnessMap: this.plasticRough, metalness: 0.0, envMapIntensity: 1.0 }),
      painted: std({ map: this.plasticMap, roughness: 0.48, roughnessMap: this.plasticRough, metalness: 0.0, envMapIntensity: 0.7 }),
      matte: std({ map: this.plasticMap, roughness: 0.75, metalness: 0.0, envMapIntensity: 0.45 }),
      rubber: std({ roughness: 0.92, metalness: 0.0, envMapIntensity: 0.25 }),
      fabric: std({ map: this.fabricMap, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.25 }),
      cardboard: std({ map: this.cardMap, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.3 }),
      wood: std({ map: this.cardMap, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.5 }),
      metal: std({ map: this.plasticMap, roughness: 0.28, roughnessMap: this.plasticRough, metalness: 0.85, envMapIntensity: 1.2 }),
      paper: std({ roughness: 0.9, metalness: 0.0, envMapIntensity: 0.3 }),
      glow: std({ roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 1.4, toneMapped: true }),
    };
    // glow uses vertex colour as emissive tint via onBeforeCompile
    this.kinds.glow.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;',
      );
    };
  }

  /** Cached textured material (book covers, drawings, etc.) */
  textured(key: string, make: () => THREE.Texture, params: THREE.MeshStandardMaterialParameters = {}) {
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: make(), roughness: 0.7, metalness: 0, ...params });
      this.cache.set(key, m);
    }
    return m as THREE.MeshStandardMaterial;
  }

  /** Non-vertex-colour plastic for dynamic objects (enemies, weapons, props). */
  plastic(color: THREE.ColorRepresentation, rough = 0.35, extra: THREE.MeshStandardMaterialParameters = {}) {
    const key = `p:${new THREE.Color(color).getHexString()}:${rough}:${JSON.stringify(extra)}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        map: this.plasticMap,
        roughness: rough,
        roughnessMap: rough < 0.6 ? this.plasticRough : null,
        metalness: 0,
        ...extra,
      });
      this.cache.set(key, m);
    }
    return m as THREE.MeshStandardMaterial;
  }
}
