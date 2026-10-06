import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Materials } from '../environment/Materials';
import { buildBedroom, BedroomInfo, SUN_DIR } from '../environment/Bedroom';
import { CollisionWorld, NavGrid, RayHit, rampBottom, rampSurface } from './Collision';
import { SurfaceIndex } from './Surfaces';
import { Input } from './Input';
import { MobileControls } from './MobileControls';
import { Player } from './Player';
import { WeaponSystem, FireContext, WEAPONS, SNIPER, MINIGUN } from './Weapons';
import { Effects } from './Effects';
import { Projectiles, Projectile, ProjectileHooks } from './Projectiles';
import { Enemy, EnemyType, EnemyCtx, createEnemy, debris, Boss, Target } from './Enemies';
import { WaveManager, WAVES } from './WaveManager';
import { DynamicProps, Pickups, PickupKind } from './Props';
import { MODES, ModeId } from './Modes';
import { HUD } from '../ui/HUD';
import { audio } from './Audio';
import type { Session } from '../net/Session';
import type { RemoteAvatar } from '../net/RemotePlayers';

export type GameState = 'menu' | 'playing' | 'paused' | 'dying' | 'over' | 'mpover';

interface Shockwave { pos: THREE.Vector3; r: number; hit: boolean; mesh: THREE.Mesh }

const tmpHit: RayHit = { dist: 0, normal: new THREE.Vector3(), point: new THREE.Vector3(), box: null };
const tmpN = new THREE.Vector3();
const v1 = new THREE.Vector3();
const MAX_NADES = 4;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: Input;
  readonly mobile: MobileControls;
  readonly hud = new HUD();
  readonly world = new CollisionWorld();
  readonly mats: Materials;
  readonly room: BedroomInfo;
  readonly nav: NavGrid;
  readonly surfaces: SurfaceIndex;
  readonly navLarge: NavGrid;
  readonly navHuge: NavGrid;
  readonly player: Player;
  readonly weapons: WeaponSystem;
  readonly fx: Effects;
  readonly proj: Projectiles;
  readonly props: DynamicProps;
  readonly pickups: Pickups;
  readonly waves: WaveManager;
  enemies: Enemy[] = [];
  state: GameState = 'menu';
  lowEnd: boolean;
  /** 'survival' = solo waves; otherwise a multiplayer mode */
  mode: 'survival' | ModeId = 'survival';
  mp: Session | null = null;
  nades = { frag: 2, flash: 1 };
  blind = 0;

  private composer: EffectComposer | null = null;
  private vmPass: RenderPass | null = null;
  private muzzleLight: THREE.PointLight | null = null;
  private lastFrame = performance.now();
  private time = 0;
  private navTimer = 0;
  private hitstop = 0;
  private deathT = 0;
  private shockwaves: Shockwave[] = [];
  private spawnCooldown: number[] = [];
  private pixelRatio = 1;
  private stats = { kills: 0, shots: 0, hits: 0, time: 0, score: 0 };
  private onTarget = false;
  private trainT = 0;
  private menuT = 0;
  private boss: Boss | null = null;
  private victoryT = -1;
  private enemyNetId = 1;
  private shotEnds: THREE.Vector3[] = [];
  private shotWeapon = -1;
  onStateChange: (s: GameState, info?: { victory: boolean; stats: Game['stats'] }) => void = () => {};
  onPeerJoinedWhileSolo: ((name: string) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.input = new Input(canvas);
    const params = new URLSearchParams(location.search);
    this.lowEnd = this.input.isTouch || params.has('low');
    if (params.has('high')) this.lowEnd = false;
    document.body.classList.toggle('is-touch', this.input.isTouch);

    // Always render at the device's native sharpness (capped at 2x: beyond that is invisible on phones but costs a lot).
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: dpr < 2, powerPreference: 'high-performance', stencil: false });
    this.pixelRatio = Math.min(dpr, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;

    this.scene.background = new THREE.Color(0xe9d8c4);
    this.scene.fog = new THREE.Fog(0xcdb497, 90, 330);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.32;

    this.mats = new Materials();
    this.room = buildBedroom(this.mats, this.world);
    this.scene.add(this.room.group);
    this.scene.add(this.room.train);
    this.setupLights();
    this.world.mergeStacks();
    this.surfaces = new SurfaceIndex(this.room.group);
    this.nav = new NavGrid(this.world, 2.4, 0.7, 3.3);
    this.nav.addLadderLinks(this.world.ladders);
    this.navLarge = new NavGrid(this.world, 3.8, 1.5, 2.0);
    this.navHuge = new NavGrid(this.world, 10.5, 3.0, 1.0);
    // make sure no spawn or pickup point sits inside furniture
    const fix = (p: THREE.Vector3) => (p.y > 0.5 ? p : p.copy(this.freeSpot(p)));
    this.room.playerSpawns.forEach(fix);
    this.room.spawnPoints.forEach(fix);
    this.room.pickupSpots.forEach((sp) => fix(sp.pos));
    fix(this.room.playerSpawn);
    this.room.playerSpawns = this.computeArenaSpawns();

    const aspect = window.innerWidth / window.innerHeight;
    this.player = new Player(this.world, aspect);
    this.scene.add(this.player.camera);
    this.weapons = new WeaponSystem(this.mats, aspect, env);
    this.fx = new Effects(this.world, this.lowEnd);
    this.scene.add(this.fx.group);
    this.fx.onShake((a) => this.player.shake(a));
    this.proj = new Projectiles(this.mats, this.world, this.fx);
    this.scene.add(this.proj.group);
    this.proj.onSpawn = (p) => {
      // co-op host shares enemy shots so everyone sees them
      if (this.mp && this.mode === 'coop' && this.mp.isLeader && p.hostile && !p.ghost && (p.kind === 'dart' || p.kind === 'bolt' || p.kind === 'bomb'))
        this.mp.sendEnemyProjectile(p.kind, p.pos, p.vel);
    };
    this.props = new DynamicProps(this.mats, this.world, this.room.dynamicSpots);
    this.scene.add(this.props.group);
    this.pickups = new Pickups(this.mats, this.world);
    this.pickups.onSpotTaken = (i) => this.mp?.sendPick(i);
    this.scene.add(this.pickups.group);
    debris.scene = this.scene;
    debris.world = this.world;
    this.spawnCooldown = this.room.spawnPoints.map(() => 0);

    if (!this.lowEnd) {
      this.muzzleLight = new THREE.PointLight(0xffd090, 0, 14, 1.6);
      this.scene.add(this.muzzleLight);
    }

    this.waves = new WaveManager(
      (type, hard) => this.spawnWaveEnemy(type, hard),
      () => this.enemies.filter((e) => !e.dead).length,
      {
        waveStart: (i) => {
          const def = WAVES[i];
          this.hud.wave(i + 1, WAVES.length, i === WAVES.length - 1 ? 'FINAL WAVE' : undefined);
          this.hud.banner(def.title, def.sub, 2.6);
          this.mp?.sendBanner(def.title, def.sub);
          audio.waveStart();
        },
        waveCleared: (i) => {
          const sub = `HEALTH RESTORED · AMMO + GRENADES · WAVE ${i + 2} INCOMING`;
          this.hud.banner('WAVE CLEARED!', sub, 3.2);
          this.mp?.sendBanner('WAVE CLEARED!', sub);
          this.waveReward();
          this.stats.score += 500 * (i + 1);
          audio.waveComplete();
        },
        victory: () => this.victory(),
      },
    );

    this.player.onDamage = (_amount, from) => {
      if (from) {
        const d = v1.subVectors(from, this.player.pos);
        const fwd = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
        const right = new THREE.Vector3(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw));
        this.hud.hitDir(Math.atan2(d.dot(right), d.dot(fwd)));
      }
    };
    this.weapons.onAmmoChange = () => this.updateWeaponHud();
    this.weapons.onShot = (w) => {
      this.shotWeapon = w;
    };

    if (!this.lowEnd) this.setupComposer();

    this.mobile = new MobileControls(this.input);
    this.input.onPauseRequest = () => this.pause();
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.state === 'playing' && !this.input.isTouch) this.pause();
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.resize(), 100));
    document.addEventListener('visibilitychange', () => {
      // multiplayer matches keep running in the background
      if (document.hidden && this.state === 'playing' && !this.matchLive) this.pause();
    });
    this.resize();

    this.renderer.shadowMap.needsUpdate = true;
    (window as unknown as { __game: Game }).__game = this;
  }

  private spotBlocked(p: THREE.Vector3, r: number, h = 1.9) {
    for (const b of this.world.query(p.x - r - 1, p.z - r - 1, p.x + r + 1, p.z + r + 1)) {
      if (b.minY > h || b.maxY < 0.55) continue;
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX)), cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      if (Math.hypot(p.x - cx, p.z - cz) < r) return true;
    }
    // inside a ramp, ladder or slide that is too high to stand under
    for (const rp of this.world.ramps) {
      const cx = Math.max(rp.minX, Math.min(p.x, rp.maxX)), cz = Math.max(rp.minZ, Math.min(p.z, rp.maxZ));
      if (Math.hypot(p.x - cx, p.z - cz) >= r) continue;
      const s = rampSurface(rp, cx, cz);
      if (s > 0.55 && rampBottom(rp, s) < h) return true;
    }
    return false;
  }

  /**
   * Multiplayer spawn points: open floor toward the middle of the room, never
   * under furniture, on the ramp, or tucked behind objects or against walls.
   */
  private computeArenaSpawns(): THREE.Vector3[] {
    this.nav.update(this.room.playerSpawn.x, this.room.playerSpawn.z);
    const dirs = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(Math.cos((i / 8) * Math.PI * 2), 0, Math.sin((i / 8) * Math.PI * 2)));
    const cands: { p: THREE.Vector3; score: number }[] = [];
    const track = Array.from({ length: 64 }, (_, i) => this.room.trainPath((i / 64) * Math.PI * 2, new THREE.Vector3()));
    for (let x = -60; x <= 60; x += 2)
      for (let z = -54; z <= 54; z += 2) {
        const p = new THREE.Vector3(x, 0, z);
        if (this.spotBlocked(p, 2.6, 2.2)) continue;
        // never on the train track
        if (track.some((t) => Math.hypot(t.x - x, t.z - z) < 4)) continue;
        if (this.nav.distAt(x, z) < 0) continue;
        if (this.world.groundAt(x, z, 50) > 0.4) continue; // ramp / raised surfaces (the rug is fine)
        // nothing overhead (desk, bed, chair seat, ramp)
        let roofed = false;
        for (const b of this.world.query(x - 1.5, z - 1.5, x + 1.5, z + 1.5)) {
          if (b.minY > 1.9 && b.minY < 60 && x + 1.5 > b.minX && x - 1.5 < b.maxX && z + 1.5 > b.minZ && z - 1.5 < b.maxZ) { roofed = true; break; }
        }
        if (roofed) continue;
        // openness: how far you can see around you at chest height
        const eye = new THREE.Vector3(x, 1.4, z);
        let open = 0;
        for (const d of dirs) {
          const h = this.world.raycast(eye, d, 40);
          open += Math.min(40, h ? h.dist : 40);
        }
        if (open < 150) continue; // boxed in
        // must be out in the open middle: close to the play mat and able to see it
        const mid = new THREE.Vector3(-12, 1.4, 22);
        if (Math.hypot(x - mid.x, z - mid.z) > 52) continue;
        const refs = [mid, new THREE.Vector3(8, 1.4, 30), new THREE.Vector3(-34, 1.4, 12), new THREE.Vector3(-12, 1.4, 44)];
        if (refs.filter((r) => this.world.lineOfSight(eye, r)).length < 2) continue;
        const centre = 1 - Math.hypot((x - mid.x) / 60, (z - mid.z) / 60);
        cands.push({ p, score: open / 320 + centre * 0.8 });
      }
    cands.sort((a, b) => b.score - a.score);
    const pool = cands.slice(0, Math.max(12, Math.floor(cands.length * 0.75)));
    // spread them out: farthest-point sampling starting from the best spot
    const picked: THREE.Vector3[] = [];
    if (pool.length) picked.push(pool[0].p);
    while (picked.length < 10 && picked.length < pool.length) {
      let best = pool[0].p, bd = -1;
      for (const c of pool) {
        const d = Math.min(...picked.map((q) => q.distanceTo(c.p)));
        if (d > bd) { bd = d; best = c.p; }
      }
      picked.push(best);
    }
    return picked.length >= 4 ? picked : this.room.playerSpawns;
  }

  /** Nearest floor position around p with room for a soldier. */
  private freeSpot(p: THREE.Vector3) {
    if (!this.spotBlocked(p, 1.0)) return p.clone();
    for (let r = 1; r < 32; r += 0.75)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const q = new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
        if (Math.abs(q.x) > 82 || Math.abs(q.z) > 73) continue;
        if (!this.spotBlocked(q, 1.0)) return q;
      }
    return p.clone();
  }

  get inMatch() {
    return !!this.mp && !!this.mp.self.inMatch && this.mode !== 'survival';
  }

  /** online matches keep running behind the pause menu; offline bot matches really pause */
  get matchLive() {
    return this.inMatch && !this.mp!.offline;
  }

  get selfId() {
    return this.mp?.self.id ?? 'me';
  }

  private setupLights() {
    const sun = new THREE.DirectionalLight(0xffd29a, 4.4);
    const target = new THREE.Vector3(0, 0, 10);
    sun.position.copy(target).addScaledVector(SUN_DIR, -280);
    sun.target.position.copy(target);
    sun.castShadow = true;
    const s = sun.shadow;
    s.mapSize.set(this.lowEnd ? 1024 : 2048, this.lowEnd ? 1024 : 2048);
    s.camera.left = -125;
    s.camera.right = 125;
    s.camera.top = 105;
    s.camera.bottom = -105;
    s.camera.near = 120;
    s.camera.far = 470;
    // enough bias to keep sloped surfaces (the ramp, the bridge) free of shadow acne stripes
    s.bias = -0.0006;
    s.normalBias = this.lowEnd ? 0.32 : 0.16;
    s.radius = 3;
    this.scene.add(sun, sun.target);
    // phones: one hemisphere fill instead of extra directional lights (cheaper per pixel)
    const hemi = new THREE.HemisphereLight(0xc4d8ff, 0xb58258, this.lowEnd ? 0.95 : 0.62);
    this.scene.add(hemi);
    if (!this.lowEnd) {
      const bounce = new THREE.DirectionalLight(0xffb48a, 0.4);
      bounce.position.set(-20, 10, 80);
      this.scene.add(bounce);
      const sky = new THREE.DirectionalLight(0xa8c8ff, 0.45);
      sky.position.set(30, 60, -90);
      this.scene.add(sky);
    }
  }

  private setupComposer() {
    const w = window.innerWidth, h = window.innerHeight;
    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(this.pixelRatio);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(this.scene, this.player.camera));
    const vm = new RenderPass(this.weapons.scene, this.weapons.camera);
    vm.clear = false;
    vm.clearDepth = true;
    composer.addPass(vm);
    this.vmPass = vm;
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.2, 0.4, 0.95));
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.player.camera.aspect = w / h;
    this.player.baseFov = w / h > 1.9 ? 70 : 75;
    this.player.camera.updateProjectionMatrix();
    this.weapons.resize(w / h);
    this.composer?.setPixelRatio(this.pixelRatio);
    this.composer?.setSize(w, h);
    const portrait = this.input.isTouch && h > w;
    document.getElementById('rotate')!.classList.toggle('hidden', !portrait);
    if (portrait && this.state === 'playing' && !this.matchLive) this.pause();
  }

  // ------------------------------------------------------------------ flow

  /** Solo survival. */
  start() {
    audio.init();
    this.mode = 'survival';
    this.resetWorld();
    this.weapons.reset();
    this.nades = { frag: 2, flash: 1 };
    this.player.regenDelay = 3.5;
    this.player.regenRate = 14;
    this.pickups.setSpots(this.room.pickupSpots);
    this.pickups.clear();
    this.player.spawn(this.room.playerSpawn, this.room.playerYaw);
    this.beginPlay();
    this.waves.start();
  }

  private beginPlay() {
    this.state = 'playing';
    this.hud.show(true);
    this.mobile.show(this.input.isTouch);
    this.input.enabled = true;
    this.input.lock();
    this.updateWeaponHud();
    this.onStateChange('playing');
  }

  /** Called by the multiplayer session when a match begins (or we join one in progress). */
  startMatch(s: Session) {
    audio.init();
    this.mp = s;
    this.mode = s.match!.mode;
    const def = MODES[this.mode];
    this.resetWorld();
    this.weapons.reset(s.loadout());
    this.weapons.setLoadout(s.loadout());
    this.nades = { frag: def.frags, flash: def.flashes };
    this.player.regenDelay = this.mode === 'coop' ? 3.5 : 4;
    this.player.regenRate = this.mode === 'coop' ? 14 : 20;
    this.pickups.setSpots(this.room.pickupSpots.filter((p) => def.pickups.includes(p.kind)));
    this.pickups.clear();
    const sp = this.pickSpawn();
    this.player.spawn(sp, Math.atan2(sp.x, sp.z));
    this.beginPlay();
    if (this.mode === 'coop') {
      if (s.isLeader) this.waves.start();
      this.hud.wave(1, WAVES.length);
    } else {
      this.hud.banner(def.name, def.blurb, 3);
      audio.waveStart();
    }
  }

  /** Match over: freeze and show results (session returns to the lobby after a few seconds). */
  matchEnded() {
    this.state = 'mpover';
    this.input.reset();
    this.mobile.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.onStateChange('mpover');
  }

  stopMatch() {
    this.resetWorld();
    this.mode = 'survival';
    this.state = 'menu';
    this.input.enabled = false;
    this.input.reset();
    this.hud.show(false);
    this.mobile.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.onStateChange('menu');
  }

  pause() {
    if (this.state !== 'playing') return;
    if (this.matchLive) {
      // matches can't be paused; just release the mouse and show the menu overlay
      this.state = 'paused';
      this.input.reset();
      this.onStateChange('paused');
      return;
    }
    this.state = 'paused';
    this.input.reset();
    this.mobile.show(false);
    this.onStateChange('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    audio.init();
    this.state = 'playing';
    this.mobile.show(this.input.isTouch);
    this.input.lock();
    this.lastFrame = performance.now();
    this.onStateChange('playing');
  }

  quitToMenu() {
    if (this.inMatch) {
      this.mp!.backToLobby();
      return;
    }
    this.resetWorld();
    this.state = 'menu';
    this.input.enabled = false;
    this.hud.show(false);
    this.mobile.show(false);
    this.onStateChange('menu');
  }

  private resetWorld() {
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies = [];
    this.boss = null;
    this.proj.clear();
    this.fx.clear();
    this.pickups.clear();
    debris.clear();
    this.props.reset();
    for (const s of this.shockwaves) this.scene.remove(s.mesh);
    this.shockwaves = [];
    this.victoryT = -1;
    this.hitstop = 0;
    this.blind = 0;
    this.hud.reset();
    this.stats = { kills: 0, shots: 0, hits: 0, time: 0, score: 0 };
    this.hud.health(100, 100);
    this.hud.score(0);
    this.waves.state = 'done';
    this.nav.update(this.player.pos.x, this.player.pos.z);
    this.navLarge.update(this.player.pos.x, this.player.pos.z);
  }

  private pickSpawn(): THREE.Vector3 {
    const pts = this.room.playerSpawns;
    if (!this.mp) return this.room.playerSpawn.clone();
    const others = [...this.mp.avatars.values()].filter((a) => a.alive);
    if (this.mode === 'coop') {
      // spawn next to a teammate if possible
      const mate = others[Math.floor(Math.random() * others.length)];
      if (mate) return pts.slice().sort((a, b) => a.distanceTo(mate.pos) - b.distanceTo(mate.pos))[0].clone();
      return this.room.playerSpawn.clone();
    }
    const foes = others.filter((a) => this.mp!.isEnemy(a.id));
    let best = pts[Math.floor(Math.random() * pts.length)];
    let bestD = -1;
    for (const p of pts) {
      const d = foes.length ? Math.min(...foes.map((f) => f.pos.distanceTo(p))) : Math.random() * 100;
      if (d > bestD) { bestD = d; best = p; }
    }
    return best.clone();
  }

  respawnLocal() {
    if (!this.inMatch) return;
    const sp = this.pickSpawn();
    this.player.spawn(sp, Math.atan2(-sp.x, -sp.z) + Math.PI);
    this.player.invuln = 1.5;
    this.weapons.setLoadout(this.mp!.loadout());
    const def = MODES[this.mode as ModeId];
    this.nades = { frag: Math.max(this.nades.frag, def.frags), flash: Math.max(this.nades.flash, def.flashes) };
    this.state = 'playing';
    this.mobile.show(this.input.isTouch);
    this.hud.banner('BACK IN ACTION', '', 1.0);
  }

  private waveReward() {
    this.player.heal(100);
    this.weapons.addAmmo(0.5);
    this.nades.frag = Math.min(MAX_NADES, this.nades.frag + 1);
    this.nades.flash = Math.min(MAX_NADES, this.nades.flash + 1);
  }

  private victory() {
    this.hud.banner('VICTORY!', 'THE BEDROOM IS SAFE… FOR NOW', 4);
    audio.victory();
    for (let i = 0; i < 6; i++) this.fx.confetti(this.player.eyePos.add(new THREE.Vector3((Math.random() - 0.5) * 10, 2 + i, (Math.random() - 0.5) * 10)), 40);
    this.stats.score += Math.max(0, Math.round(this.player.health) * 20);
    if (this.inMatch && this.mode === 'coop') {
      this.mp!.coopEnd(true);
      return;
    }
    this.victoryT = 3.6;
  }

  private endGame(victory: boolean) {
    this.state = 'over';
    this.input.enabled = false;
    this.input.reset();
    this.mobile.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.onStateChange('over', { victory, stats: { ...this.stats } });
  }

  // ------------------------------------------------------------------ enemies

  private get simulatesEnemies() {
    return this.mode === 'survival' || (this.mode === 'coop' && !!this.mp?.isLeader);
  }

  private targets(): Target[] {
    const list: Target[] = [this.player];
    if (this.inMatch && this.mode === 'coop') for (const a of this.mp!.avatars.values()) list.push(a);
    return list;
  }

  private static readonly SIZE: Record<EnemyType, [number, number]> = {
    trooper: [0.5, 1.9], robot: [1.1, 3.5], chomper: [0.75, 1.6], bug: [0.32, 0.5], boss: [2.6, 10],
  };

  /** Is p a good place for an enemy of this size: clear of furniture and connected to the players? */
  private spawnOk(p: THREE.Vector3, type: EnemyType) {
    const [r, h] = Game.SIZE[type];
    if (Math.abs(p.x) > 83 - r || Math.abs(p.z) > 74 - r) return false;
    if (this.spotBlocked(p, r + 0.35, h)) return false;
    const nav = r > 2 ? this.navHuge : r > 0.9 ? this.navLarge : this.nav;
    return nav.distAt(p.x, p.z) >= 0;
  }

  /** Nearest valid spot around p for this enemy type (or null). */
  private validSpawnNear(p: THREE.Vector3, type: EnemyType, maxR = 14) {
    if (this.spawnOk(p, type)) return p.clone();
    for (let r = 1; r < maxR; r += 0.75)
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + r;
        const q = new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
        if (this.spawnOk(q, type)) return q;
      }
    return null;
  }

  private chooseSpawn(type: EnemyType): THREE.Vector3 {
    const ts = this.targets().filter((t) => t.alive);
    const distTo = (p: THREE.Vector3) => Math.min(...ts.map((t) => Math.hypot(p.x - t.pos.x, p.z - t.pos.z)), 999);
    const cands = this.room.spawnPoints
      .map((p, i) => ({ p: this.validSpawnNear(p, type, 8), i }))
      .filter((o): o is { p: THREE.Vector3; i: number } => !!o.p && this.spawnCooldown[o.i] <= 0)
      .map((o) => ({ ...o, d: distTo(o.p) }))
      .filter((o) => o.d > 18)
      .sort((a, b) => a.d - b.d);
    if (cands.length) {
      const pick = cands[Math.floor(Math.random() * Math.min(4, cands.length))];
      this.spawnCooldown[pick.i] = 1.2;
      const j = pick.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
      return this.spawnOk(j, type) ? j : pick.p;
    }
    // fallback: any open, reachable floor 20-60 units from the players
    for (let k = 0; k < 200; k++) {
      const q = new THREE.Vector3((Math.random() - 0.5) * 160, 0, (Math.random() - 0.5) * 140);
      const d = distTo(q);
      if (d > 20 && d < 60 && this.spawnOk(q, type)) return q;
    }
    return this.room.bossSpawn.clone();
  }

  private spawnWaveEnemy(type: EnemyType, hard: boolean) {
    if (type === 'boss') this.navHuge.update(this.player.pos.x, this.player.pos.z, this.targets().slice(1).map((t) => ({ x: t.pos.x, z: t.pos.z })));
    const pos = type === 'boss' ? this.validSpawnNear(this.room.bossSpawn, 'boss', 30) ?? this.room.bossSpawn.clone() : this.chooseSpawn(type);
    this.spawnEnemy(type, pos, hard);
  }

  /** Teleport an enemy that keeps getting stuck to a fresh valid spot. */
  private relocate(e: Enemy) {
    e.needsRelocate = false;
    const c = e.pos.clone().add(new THREE.Vector3(0, e.height * 0.5, 0));
    this.fx.puff(c, 0xffffff, e.height * 0.4, e.height, 0.4);
    const near = this.validSpawnNear(e.pos, e.type, 10);
    const p = near && near.distanceTo(e.pos) > 1.5 ? near : this.chooseSpawn(e.type);
    e.pos.copy(p);
    e.vel.set(0, 0, 0);
    e.netPos.copy(p);
    this.fx.puff(p.clone().setY(e.height * 0.5), 0xffffff, e.height * 0.4, e.height, 0.4);
  }

  private spawnEnemy(type: EnemyType, pos: THREE.Vector3, hard = false, puppetId = 0) {
    const e = createEnemy(type, this.mats, hard);
    e.yaw = Math.atan2(this.player.pos.x - pos.x, this.player.pos.z - pos.z);
    e.netId = puppetId || this.enemyNetId++;
    if (puppetId) {
      e.puppet = true;
      e.netPos.copy(pos);
      e.netYaw = e.yaw;
    }
    e.place(pos, this.scene);
    this.enemies.push(e);
    const c = pos.clone().add(new THREE.Vector3(0, e.height * 0.5, 0));
    this.fx.puff(c, 0xffffff, e.height * 0.4, e.height * 1.1, 0.5);
    this.fx.glow(c, 0xfff0c0, e.height * 1.5, 0.1, 0.25);
    audio.spawnPop();
    if (type === 'boss') {
      this.boss = e as Boss;
      if (puppetId) (e as Boss).intro = 0;
      this.hud.banner('THE WIND-UP KING', 'AIM FOR THE GLOWING CORE!', 3.2);
      audio.bossRoar();
      this.player.shake(0.6);
      this.fx.confetti(c, 60);
    }
    return e;
  }

  spawnPuppet(type: EnemyType, id: number, pos: THREE.Vector3) {
    return this.spawnEnemy(type, pos, false, id);
  }

  removeEnemySilently(e: Enemy) {
    e.dead = true;
  }

  killPuppet(e: Enemy, dir: THREE.Vector3) {
    e.puppet = false;
    e.takeDamage(1e9, dir, this.ectx(), 1);
  }

  /** Local damage to an enemy; co-op clients forward it to the simulating player. */
  damageEnemy(e: Enemy, dmg: number, dir: THREE.Vector3 | null, knock = 1) {
    if (e.dead) return false;
    if (e.puppet) {
      e.hitFx();
      if (dir) this.mp?.sendEnemyHit(e, dmg, dir);
      return false;
    }
    if (!e.lastHitBy || !this.mp || this.mp.isLeader) e.lastHitBy = e.lastHitBy || this.selfId;
    return e.takeDamage(dmg, dir, this.ectx(), knock);
  }

  /** Damage from my own weapons (records me as the attacker for co-op credit). */
  private myHitEnemy(e: Enemy, dmg: number, dir: THREE.Vector3 | null, knock = 1) {
    if (!e.puppet) e.lastHitBy = this.selfId;
    return this.damageEnemy(e, dmg, dir, knock);
  }

  coopBecomeLeader(info: Session['coopInfo']) {
    for (const e of this.enemies) {
      e.puppet = false;
      e.vel.set(0, 0, 0);
    }
    const alive = this.enemies.filter((e) => !e.dead).length;
    this.waves.resume(info.wave, info.killed, info.total, alive);
    this.hud.toast('You are now hosting the toys');
  }

  private ectx(): EnemyCtx {
    return {
      player: this.player,
      listener: this.player,
      world: this.world,
      nav: this.nav,
      navLarge: this.navLarge,
      navHuge: this.navHuge,
      fx: this.fx,
      proj: this.proj,
      time: this.time,
      playerVisible: true,
      spawn: (type, pos) => {
        this.spawnEnemy(type, this.validSpawnNear(pos, type, 8) ?? this.chooseSpawn(type));
        this.waves.onExtraSpawn();
      },
      shockwave: (pos) => {
        this.spawnShockwave(pos);
        if (this.inMatch) this.mp!.sendShock(pos);
      },
      onKilled: (e) => this.onKilled(e),
    };
  }

  private onKilled(e: Enemy) {
    this.stats.kills++;
    this.stats.score += e.score;
    this.waves.onKill();
    if (e.lastHitBy === this.selfId || !this.inMatch) this.hud.hitmarker(true);
    if (this.inMatch && this.mode === 'coop' && this.mp!.isLeader) this.mp!.coopKilled(e, null);
    if (e.type === 'robot' || e.type === 'boss') this.hitstop = e.type === 'boss' ? 0.25 : 0.06;
    if (e.type === 'boss') {
      this.boss = null;
      this.hud.boss(null);
      this.fx.explosion(e.pos.clone().add(new THREE.Vector3(0, 5, 0)), 7);
      audio.explosion(5);
    }
    // drops (each player rolls their own loot)
    const hpChance = e.type === 'robot' ? 0.8 : e.type === 'chomper' ? 0.45 : e.type === 'bug' ? 0.08 : 0.25;
    const amChance = e.type === 'robot' ? 0.7 : e.type === 'bug' ? 0.06 : 0.25;
    const nadeChance = e.type === 'robot' ? 0.5 : e.type === 'chomper' ? 0.2 : e.type === 'bug' ? 0.02 : 0.08;
    if (e.type === 'boss') {
      for (let i = 0; i < 3; i++) this.pickups.spawn('health', e.pos);
    } else {
      if (Math.random() < hpChance) this.pickups.spawn('health', e.pos);
      if (Math.random() < amChance) this.pickups.spawn('ammo', e.pos);
      if (Math.random() < nadeChance) this.pickups.spawn(Math.random() < 0.65 ? 'frag' : 'flash', e.pos);
    }
  }

  private spawnShockwave(pos: THREE.Vector3) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.35, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(pos).setY(pos.y + 0.4);
    this.scene.add(mesh);
    this.shockwaves.push({ pos: pos.clone(), r: 1, hit: false, mesh });
    this.fx.puff(pos.clone().setY(1), 0xffffff, 3, 8, 0.8);
  }

  spawnShockwavePublic(pos: THREE.Vector3) {
    this.spawnShockwave(pos);
    audio.stomp();
  }

  // ------------------------------------------------------------------ combat

  private hostileAvatars(): RemoteAvatar[] {
    if (!this.inMatch || this.mode === 'coop') return [];
    return [...this.mp!.avatars.values()].filter((a) => a.alive && this.mp!.isEnemy(a.id));
  }

  private fireCtx: FireContext = {
    hitscan: (origin, dir, range, damage, tracerColor, muzzle, pellet) => {
      this.stats.shots += pellet === 0 ? 1 : 0;
      const wpn = this.weapons.current;
      const wh = this.world.raycast(origin, dir, range, tmpHit);
      let maxD = wh ? wh.dist : range;
      let best: { e: Enemy; t: number; mult: number } | null = null;
      // touch gets a slightly kinder hitbox, except on the precision sniper (same on every device)
      const pad = this.input.isTouch && wpn !== SNIPER ? 0.22 : 0.05;
      for (const e of this.enemies) {
        const h = e.rayHit(origin, dir, maxD, pad);
        if (h && (!best || h.t < best.t)) best = { e, t: h.t, mult: h.mult };
      }
      if (best) maxD = best.t;
      let bestAv: { a: RemoteAvatar; t: number; mult: number } | null = null;
      for (const a of this.hostileAvatars()) {
        const h = a.rayHit(origin, dir, maxD, this.input.isTouch && wpn !== SNIPER ? 0.12 : 0.03);
        if (h && (!bestAv || h.t < bestAv.t)) bestAv = { a, t: h.t, mult: h.mult };
      }
      if (bestAv) {
        maxD = bestAv.t;
        best = null;
      }
      const ph = this.props.rayHit(origin, dir, maxD);
      let end: THREE.Vector3;
      if (ph) {
        end = origin.clone().addScaledVector(dir, ph.t);
        this.props.impulseAt(end, dir, wpn === 1 ? 2.2 : 3.5, 0.3);
        this.fx.impact(end, dir.clone().negate(), 0xfff0c0);
        audio.surfaceHit();
      } else if (bestAv) {
        end = origin.clone().addScaledVector(dir, bestAv.t);
        const head = bestAv.mult > 1.2;
        this.mp!.sendHit(bestAv.a.id, damage * bestAv.mult, wpn, origin);
        bestAv.a.hitFlash();
        this.stats.hits++;
        this.fx.impact(end, dir.clone().negate(), head ? 0xffff80 : 0xffe0a0, [0xffffff, 0xffcf33]);
        this.hud.hitmarker(false);
        audio.hit(head);
      } else if (best) {
        end = origin.clone().addScaledVector(dir, best.t);
        const head = best.mult > 1.2;
        this.myHitEnemy(best.e, damage * best.mult, dir, wpn === 1 ? 0.5 : 1);
        this.stats.hits++;
        this.fx.impact(end, dir.clone().negate(), head ? 0xffff80 : 0xffe0a0, best.e.colors);
        if (!best.e.dead) this.hud.hitmarker(false);
        audio.hit(head);
      } else if (wh) {
        // find the rendered surface near the collision hit, so marks sit on what you see
        const st = this.surfaces.raycast(origin, dir, Math.max(0, wh.dist - 0.9), wh.dist + 0.9, tmpN);
        if (st >= 0) {
          end = origin.clone().addScaledVector(dir, st);
          this.fx.impact(end, tmpN, 0xfff0c0);
          if (pellet < 4) {
            const size = this.surfaces.fitDecal(end, tmpN, (wpn === 1 ? 0.18 : 0.14) * (0.8 + Math.random() * 0.4));
            if (size > 0) this.fx.decal(end, tmpN, size);
          }
        } else {
          end = wh.point.clone();
          this.fx.impact(end, wh.normal, 0xfff0c0);
        }
        if (pellet === 0) audio.surfaceHit();
      } else end = origin.clone().addScaledVector(dir, range);
      if (pellet < 3) {
        if (!this.weapons.scoped) this.fx.tracer(muzzle, end, tracerColor, wpn === SNIPER ? 0.06 : wpn === 1 ? 0.04 : 0.05, wpn === SNIPER ? 0.15 : 0.07);
        else this.fx.tracer(origin.clone().addScaledVector(dir, 2).add(new THREE.Vector3(0, -0.3, 0)), end, tracerColor, 0.05, 0.12);
        this.shotEnds.push(end);
      }
    },
    fireRocket: (muzzle, dir) => {
      this.stats.shots++;
      const vel = dir.clone().multiplyScalar(46);
      this.proj.spawn('rocket', muzzle, vel, WEAPONS[2].damage, false, this.selfId);
      if (this.inMatch) this.mp!.sendRocket(muzzle, vel);
    },
    melee: (origin, dir) => {
      let hit = false;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const c = e.pos.clone().setY(e.pos.y + Math.min(e.height * 0.5, 1.5));
        const to = c.clone().sub(origin);
        const d = to.length() - e.radius;
        if (d > 2.4) continue;
        if (to.normalize().dot(dir) < 0.45 && d > 0.6) continue;
        const flat = new THREE.Vector3(dir.x, 0.25, dir.z).normalize();
        this.myHitEnemy(e, e.type === 'bug' ? 50 : 45, flat, 3);
        this.fx.impact(c, dir.clone().negate(), 0xffffff, e.colors);
        if (!e.dead) this.hud.hitmarker(false);
        hit = true;
      }
      for (const a of this.hostileAvatars()) {
        const c = a.centerPos;
        const to = c.clone().sub(origin);
        const d = to.length() - 0.45;
        if (d > 2.4 || (to.normalize().dot(dir) < 0.45 && d > 0.6)) continue;
        const flat = new THREE.Vector3(dir.x, 0.35, dir.z).normalize();
        this.mp!.sendHit(a.id, 55, 98, origin, flat.multiplyScalar(9));
        a.hitFlash();
        this.fx.impact(c, dir.clone().negate(), 0xffffff, [0xffffff]);
        this.hud.hitmarker(false);
        hit = true;
      }
      const end = origin.clone().addScaledVector(dir, 2.4);
      this.props.impulseAt(end, dir, 6, 1.2);
      return hit;
    },
    aimPoint: (origin, dir) => {
      const wh = this.world.raycast(origin, dir, 300, tmpHit);
      let d = wh ? wh.dist : 300;
      for (const e of this.enemies) {
        const h = e.rayHit(origin, dir, d, 0.1);
        if (h) d = Math.min(d, h.t);
      }
      for (const a of this.hostileAvatars()) {
        const h = a.rayHit(origin, dir, d, 0.1);
        if (h) d = Math.min(d, h.t);
      }
      return origin.clone().addScaledVector(dir, Math.max(3, d));
    },
    muzzleFlash: (p, color, size) => {
      if (!this.weapons.scoped) this.fx.glow(p, color, size * 0.6, size * 0.2, 0.06);
      if (this.muzzleLight) {
        this.muzzleLight.position.copy(p);
        this.muzzleLight.color.setHex(color);
        this.muzzleLight.intensity = 30 * size;
      }
    },
  };

  /** Explosion with gameplay effects. `mine` = caused by the local player. */
  private explode(at: THREE.Vector3, radius: number, damage: number, hostile: boolean, mine: boolean) {
    this.explodeVisual(at, radius);
    if (mine && this.inMatch) this.mp!.sendBoom(at, radius);
    const ctx = this.ectx();
    if (!hostile && mine) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = e.distTo(at);
        if (d > radius) continue;
        const k = 1 - d / radius;
        const dir = e.pos.clone().sub(at).setY(0.5).normalize();
        this.myHitEnemy(e, damage * (0.3 + 0.7 * k), dir, 2.2);
        this.stats.hits++;
      }
      for (const a of this.hostileAvatars()) {
        const d = a.centerPos.distanceTo(at);
        if (d > radius) continue;
        const k = 1 - d / radius;
        const dir = a.centerPos.sub(at).normalize();
        this.mp!.sendHit(a.id, damage * 0.85 * (0.3 + 0.7 * k), 2, at, dir.multiplyScalar(14 * k));
        a.hitFlash();
        this.hud.hitmarker(false);
      }
    }
    if (hostile && this.inMatch && this.mode === 'coop' && this.mp!.isLeader) {
      // the co-op host resolves enemy bombs against everyone
      for (const a of this.mp!.avatars.values()) {
        const d = a.centerPos.distanceTo(at);
        if (d < radius && a.alive) a.damage(damage * (0.35 + 0.65 * (1 - d / radius)), at);
      }
    }
    void ctx;
    const pd = this.player.centerPos.distanceTo(at);
    if (pd < radius && (hostile || mine)) {
      const k = 1 - pd / radius;
      const dir = this.player.centerPos.sub(at).normalize();
      // rocket/grenade jumping is allowed (and fun); self damage is reduced
      this.player.knock(dir, 14 * k);
      this.player.damage((hostile ? damage : damage * 0.12) * (0.35 + 0.65 * k), at);
    }
  }

  /** Purely visual explosion (also used for other players' explosions). */
  explodeVisual(at: THREE.Vector3, radius: number) {
    this.fx.explosion(at, radius * 0.55);
    this.props.explosion(at, radius, 22);
    const pd = this.player.centerPos.distanceTo(at);
    audio.explosion(pd);
    this.player.shake(Math.max(0, 0.6 - pd * 0.02));
  }

  /** A flash cube went off. `from` = player id that threw it ('' = me in solo). */
  flashAt(p: THREE.Vector3, from: string) {
    this.fx.glow(p, 0xffffff, 16, 2, 0.35);
    this.fx.glow(p, 0xbfe0ff, 6, 22, 0.6);
    this.fx.puff(p, 0xffffff, 1, 4, 0.8);
    const cam = this.player.camera.position;
    const dist = cam.distanceTo(p);
    audio.flashbang(dist);
    if (this.player.alive && dist < 34 && this.world.lineOfSight(cam, p)) {
      const facing = this.player.forward().dot(p.clone().sub(cam).normalize());
      let amt = (1 - dist / 34) * (0.35 + 0.65 * Math.max(0, facing)) * 1.7;
      const friendly = from === this.selfId || (this.inMatch && (this.mode === 'coop' || !this.mp!.isEnemy(from)));
      if (friendly) amt *= from === this.selfId ? 0.55 : 0.3;
      this.blind = Math.min(1.4, Math.max(this.blind, amt));
    }
    if (this.simulatesEnemies) {
      for (const e of this.enemies) {
        if (e.dead || e.puppet) continue;
        const d = e.pos.distanceTo(p);
        if (d < 22 && this.world.lineOfSight(p, e.pos.clone().setY(e.pos.y + e.height * 0.6))) e.stun = Math.max(e.stun, 1.2 + 3 * (1 - d / 22) * (e.type === 'boss' ? 0.4 : 1));
      }
    }
  }

  private throwNade(kind: 'frag' | 'flash') {
    if (this.nades[kind] <= 0 || !this.player.alive) {
      if (this.nades[kind] <= 0) this.hud.toast(kind === 'frag' ? 'NO GRENADES — find one on the floor' : 'NO FLASH CUBES — find one on the floor');
      return;
    }
    this.nades[kind]--;
    const pl = this.player;
    const fwd = pl.forward();
    const from = pl.camera.position.clone().addScaledVector(fwd, 0.7).add(new THREE.Vector3(0, -0.2, 0));
    const vel = fwd.clone().multiplyScalar(24).add(new THREE.Vector3(0, 5, 0)).addScaledVector(pl.vel, 0.5);
    this.proj.spawn(kind, from, vel, kind === 'frag' ? 115 : 0, false, this.selfId);
    if (this.inMatch) this.mp!.sendNade(kind, from, vel);
    audio.throwWhoosh();
  }

  private projHooks: ProjectileHooks = {
    hitEnemies: (p: Projectile, from, to) => {
      const d = to.clone().sub(from);
      const len = d.length();
      if (len < 1e-5) return false;
      d.divideScalar(len);
      for (const e of this.enemies) {
        if (e.rayHit(from, d, len + p.radius, p.radius)) {
          this.stats.hits++;
          this.myHitEnemy(e, p.damage * 0.5, d, 1.5);
          this.explode(to.clone().addScaledVector(d, -0.3), 6.5, p.damage * 0.75, false, true);
          return true;
        }
      }
      for (const a of this.hostileAvatars()) {
        if (a.rayHit(from, d, len + p.radius, p.radius)) {
          this.mp!.sendHit(a.id, p.damage * 0.4, 2, from);
          this.explode(to.clone().addScaledVector(d, -0.3), 6.5, p.damage * 0.75, false, true);
          return true;
        }
      }
      return false;
    },
    hitPlayer: (p) => {
      const tryHit = (t: Target) => {
        if (!t.alive) return false;
        const dy = p.pos.y - t.pos.y;
        if (dy < -p.radius || dy > t.height + p.radius) return false;
        if (Math.hypot(p.pos.x - t.pos.x, p.pos.z - t.pos.z) > 0.42 + p.radius + 0.1) return false;
        if (p.kind !== 'bomb') {
          t.damage(p.damage, p.pos.clone().sub(p.vel));
          this.fx.impact(p.pos, p.vel.clone().normalize().negate(), p.kind === 'bolt' ? 0x60e0ff : 0xff8060);
        }
        return true;
      };
      for (const t of this.targets()) if (tryHit(t)) return true;
      return false;
    },
    explode: (p, at) => {
      if (p.kind === 'flash') {
        if (!p.ghost) {
          this.flashAt(at, this.selfId);
          if (this.inMatch) this.mp!.sendFlash(at);
        }
        return;
      }
      if (p.ghost) {
        this.explodeVisual(at, p.kind === 'bomb' ? 5.5 : p.kind === 'frag' ? 7 : 6.5);
        return;
      }
      if (p.kind === 'frag') this.explode(at, 7.5, p.damage, false, true);
      else if (p.kind === 'bomb') this.explode(at, 5.5, p.damage, true, false);
      else this.explode(at, 6.5, p.damage * 0.75, p.hostile, !p.hostile);
    },
    impact: (p, hit) => {
      this.fx.impact(hit.point, hit.normal, p.kind === 'bolt' ? 0x60e0ff : 0xff9060);
      if (p.kind === 'bolt') this.fx.glow(hit.point, 0x40c0ff, 1.2, 0.2, 0.2);
    },
    bounce: () => audio.bounce(),
  };

  // ------------------------------------------------------------------ aim assist

  private updateAim(dt: number) {
    const cam = this.player.camera;
    const fwd = this.player.forward();
    const origin = cam.position;
    let bestAng = this.input.isTouch ? 0.13 : 0.035;
    if (this.weapons.scoped) bestAng *= 0.4;
    let bestPoint: THREE.Vector3 | null = null;
    const consider = (c: THREE.Vector3, r: number) => {
      const to = v1.subVectors(c, origin);
      const dist = to.length();
      if (dist > 90) return;
      const ang = Math.acos(Math.min(1, to.dot(fwd) / dist)) - Math.atan2(r, dist);
      if (ang < bestAng) {
        bestAng = ang;
        bestPoint = c.clone();
      }
    };
    for (const e of this.enemies) if (!e.dead && e.hitSpheres.length) consider(e.hitSpheres[0].c, e.hitSpheres[0].r);
    for (const a of this.hostileAvatars()) consider(a.centerPos, 0.45);
    let found = bestPoint as THREE.Vector3 | null;
    if (found && !this.world.lineOfSight(origin, found)) found = null;
    this.onTarget = !!found && bestAng < 0.03;
    if (found && this.input.isTouch && this.player.alive) {
      const to = found.sub(origin).normalize();
      const wantYaw = Math.atan2(-to.x, -to.z);
      const wantPitch = Math.asin(to.y);
      let dy = wantYaw - this.player.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      // gentler assist against real players
      const pvp = this.hostileAvatars().length > 0 ? 0.55 : 1;
      const strength = (this.input.fire ? 4.5 : 1.6) * dt * pvp;
      this.player.yaw += dy * Math.min(1, strength);
      this.player.pitch += (wantPitch - this.player.pitch) * Math.min(1, strength * 0.7);
    }
  }

  // ------------------------------------------------------------------ loop

  private updateWeaponHud() {
    const w = this.weapons;
    const a = w.ammo[w.current];
    this.hud.weapon(w.current, w.def.name, a.mag, a.reserve, w.state === 'reload', w.owned, w.allowed);
  }

  tick = () => {
    requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.step(dt);
    this.renderer.info.reset();
    this.render();
  };

  /** Advance the simulation without rendering (used by automated tests). */
  debugStep(frames: number, dt = 1 / 60) {
    for (let i = 0; i < frames; i++) this.step(dt);
  }

  private step(dt: number) {
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      dt *= 0.15;
    }
    this.time += dt;
    if (this.state === 'menu' || this.state === 'over') this.updateMenuCam(dt);
    // matches keep simulating while the pause overlay is open
    const live = this.state === 'playing' || this.state === 'dying' || (this.state === 'paused' && this.matchLive) || this.state === 'mpover';
    if (live) this.updatePlaying(dt);
    if (this.state !== 'paused' || this.matchLive) {
      this.updateAmbient(dt);
      this.fx.update(dt, this.player.camera);
      debris.update(dt);
    }
    if (this.mp && !this.mp.self.inMatch) this.mp.update(dt);
    this.hud.update(dt);
  }

  private updateMenuCam(dt: number) {
    this.menuT += dt * 0.06;
    const cam = this.player.camera;
    const t = this.menuT + 2.2;
    cam.position.set(-22 + Math.cos(t) * 26, 6 + Math.sin(t * 1.7) * 1.5, 18 + Math.sin(t) * 16);
    cam.lookAt(-22 + Math.cos(t + 1.9) * 10, 4, 14 + Math.sin(t + 1.9) * 10);
    cam.updateMatrixWorld();
  }

  private updateAmbient(dt: number) {
    // shared clock so every player sees the train in the same place
    this.trainT = ((Date.now() / 1000) * 0.32) % (Math.PI * 2000);
    void dt;
    const cars = this.room.train.userData.cars as THREE.Group[];
    cars.forEach((car, i) => {
      const t = this.trainT - i * 0.2;
      this.room.trainPath(t, car.position);
      const ahead = this.room.trainPath(t + 0.02, v1);
      car.lookAt(ahead.x, car.position.y, ahead.z);
      car.position.y += Math.abs(Math.sin(this.time * 18 + i)) * 0.03;
    });
    const attr = this.room.motes.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += Math.sin(this.time * 0.5 + i) * 0.004;
      arr[i] += Math.cos(this.time * 0.3 + i * 0.7) * 0.003;
    }
    attr.needsUpdate = true;
    if (this.muzzleLight) this.muzzleLight.intensity *= Math.max(0, 1 - dt * 30);
  }

  private trainHitCd = 0;
  /** The toy train is solid: it shoves players and enemies off the track and hurts on impact. */
  private trainCollide(dt: number) {
    this.trainHitCd = Math.max(0, this.trainHitCd - dt);
    const cars = this.room.train.userData.cars as THREE.Group[];
    const inv = new THREE.Quaternion();
    const local = new THREE.Vector3();
    const hx = 1.75, hz = 2.9, top = 4.6;
    const bodies: { pos: THREE.Vector3; vel: THREE.Vector3; r: number; y: number; hurt: (d: THREE.Vector3) => void }[] = [];
    const pl = this.player;
    if (pl.alive)
      bodies.push({
        pos: pl.pos, vel: pl.vel, r: pl.radius, y: pl.pos.y,
        hurt: (d) => {
          if (this.trainHitCd > 0) return;
          this.trainHitCd = 1;
          if (pl.damage(10, pl.pos.clone().sub(d))) {
            audio.stomp();
            this.hud.toast('CHOO CHOO! -10');
          }
        },
      });
    if (this.simulatesEnemies)
      for (const e of this.enemies)
        if (!e.dead && e.type !== 'boss')
          bodies.push({ pos: e.pos, vel: e.vel, r: e.radius, y: e.pos.y, hurt: (d) => { if (Math.random() < dt * 4) this.damageEnemy(e, 10, d, 2); } });
    for (const car of cars) {
      inv.copy(car.quaternion).invert();
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
      for (const b of bodies) {
        if (b.y > car.position.y + top - 0.3) continue;
        local.subVectors(b.pos, car.position).setY(0).applyQuaternion(inv);
        const px = hx + b.r - Math.abs(local.x);
        const pz = hz + b.r - Math.abs(local.z);
        if (px <= 0 || pz <= 0) continue;
        // push out along the shallow axis (mostly sideways off the track)
        if (px < pz) local.x += Math.sign(local.x || 1) * px;
        else local.z += Math.sign(local.z || 1) * pz;
        const world = local.applyQuaternion(car.quaternion).add(car.position);
        const side = world.clone().sub(car.position).setY(0).normalize();
        b.pos.x = world.x;
        b.pos.z = world.z;
        b.vel.addScaledVector(fwd, 6).addScaledVector(side, 9);
        b.vel.y = Math.max(b.vel.y, 5);
        b.hurt(side.clone().add(fwd).normalize());
      }
    }
  }

  private updatePlaying(dt: number) {
    const input = this.input;
    const frozen = this.state === 'mpover' || this.state === 'paused';
    if (!frozen) input.poll();
    else input.reset();
    const pl = this.player;
    if (this.state === 'playing') {
      this.stats.time += dt;
      this.updateAim(dt);
    }
    // scope zoom
    const sniperAds = this.weapons.def.sniper && this.weapons.adsT > 0.5;
    pl.zoomFov = sniperAds ? 24 : null;
    input.lookScale = this.weapons.scoped ? 0.35 : 1;
    pl.update(dt, input, this.weapons.def.speedMul * (this.weapons.adsT > 0.5 ? 0.6 : 1));
    this.shotEnds = [];
    this.shotWeapon = -1;
    this.weapons.update(dt, input, pl, this.fireCtx, this.time);
    if (this.inMatch && this.shotWeapon >= 0 && this.shotWeapon !== 2) this.mp!.sendShot(this.shotWeapon, this.shotEnds);
    if (input.throwFrag) this.throwNade('frag');
    if (input.throwFlash) this.throwNade('flash');

    this.navTimer -= dt;
    if (this.navTimer <= 0) {
      this.navTimer = 0.3;
      const extra = this.targets().slice(1).filter((t) => t.alive).map((t) => ({ x: t.pos.x, z: t.pos.z, y: t.pos.y }));
      this.nav.update(pl.pos.x, pl.pos.z, extra, pl.pos.y);
      this.navLarge.update(pl.pos.x, pl.pos.z, extra, pl.pos.y);
      if (this.boss) this.navHuge.update(pl.pos.x, pl.pos.z, extra, pl.pos.y);
    }
    for (let i = 0; i < this.spawnCooldown.length; i++) this.spawnCooldown[i] -= dt;

    // enemies (survival / co-op)
    const ctx = this.ectx();
    const targets = this.targets().filter((t) => t.alive);
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (targets.length > 1) {
        let best = targets[0], bd = Infinity;
        for (const t of targets) {
          const d = t.pos.distanceToSquared(e.pos);
          if (d < bd) { bd = d; best = t; }
        }
        ctx.player = best;
      } else ctx.player = this.player;
      e.update(dt, ctx);
      if (e.needsRelocate && !e.puppet) this.relocate(e);
    }
    this.separate();
    const dead = this.enemies.filter((e) => e.dead);
    if (dead.length) {
      for (const e of dead) e.dispose(this.scene);
      this.enemies = this.enemies.filter((e) => !e.dead);
    }

    this.proj.update(dt, this.projHooks);
    const kickers = [{ pos: pl.pos, vel: pl.vel, r: pl.radius }];
    for (const e of this.enemies) if (e.type !== 'bug') kickers.push({ pos: e.pos, vel: e.vel, r: e.radius });
    this.props.update(dt, kickers);
    this.trainCollide(dt);
    this.pickups.update(dt, pl.pos, pl.height, (k: PickupKind) => this.wants(k), (k: PickupKind) => this.collect(k));
    this.updateShockwaves(dt);

    if (this.state === 'playing' && this.simulatesEnemies && this.waves.state !== 'done') this.waves.update(dt);
    if (this.victoryT > 0 && this.state === 'playing') {
      this.victoryT -= dt;
      if (this.victoryT <= 0) this.endGame(true);
    }
    if (this.mp && this.mp.self.inMatch) this.mp.update(dt);

    this.blind = Math.max(0, this.blind - dt * 0.42);
    this.updateHud();

    // death
    if (!pl.alive && this.state === 'playing') {
      if (this.inMatch) {
        this.mp!.localDied();
        this.state = 'dying';
        this.deathT = 0;
        this.hud.banner('KNOCKED OUT!', this.mode === 'coop' ? 'your squad can still win — back in a few seconds' : 'respawning…', 2);
        this.mobile.show(false);
      } else {
        this.state = 'dying';
        this.deathT = 0;
        audio.defeat();
        this.hud.banner('KNOCKED OVER!', '', 2);
        this.mobile.show(false);
      }
    }
    if (this.state === 'dying') {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.9);
      const cam = pl.camera;
      cam.position.y = pl.pos.y + 0.25 + (pl.eye - 0.25) * (1 - k * k);
      cam.rotation.z = k * 1.35;
      cam.rotation.x = pl.pitch * (1 - k) + 0.2 * k;
      cam.updateMatrixWorld();
      if (!this.inMatch && this.deathT > 2.2) this.endGame(false);
      if (this.inMatch && pl.alive) this.state = 'playing';
    }
    input.endFrame();
  }

  /** Could the player use this pickup right now? */
  private wants(k: PickupKind): boolean {
    const pl = this.player;
    if (!pl.alive) return false;
    switch (k) {
      case 'health': return pl.health < pl.maxHealth;
      case 'frag': return this.nades.frag < MAX_NADES;
      case 'flash': return this.nades.flash < MAX_NADES;
      case 'minigun': return !this.weapons.allowed || this.weapons.allowed.includes(MINIGUN);
      default: return true;
    }
  }

  private collect(k: PickupKind): boolean {
    const pl = this.player;
    if (!this.wants(k)) return false;
    switch (k) {
      case 'health':
        if (pl.health >= pl.maxHealth) return false;
        pl.heal(35);
        this.hud.toast('+35 HEALTH');
        break;
      case 'ammo':
        this.weapons.addAmmo(0.3);
        this.hud.toast('AMMO +');
        break;
      case 'frag':
        if (this.nades.frag >= MAX_NADES) return false;
        this.nades.frag++;
        this.hud.toast(`+1 GRENADE  (${this.input.isTouch ? 'tap 💣' : 'press G'})`);
        break;
      case 'flash':
        if (this.nades.flash >= MAX_NADES) return false;
        this.nades.flash++;
        this.hud.toast(`+1 FLASH CUBE  (${this.input.isTouch ? 'tap ✨' : 'press T'})`);
        break;
      case 'minigun':
        if (this.weapons.allowed && !this.weapons.allowed.includes(MINIGUN)) return false;
        this.weapons.give(MINIGUN);
        this.hud.banner('TOY MINIGUN!', '160 rounds of pure chaos', 1.8);
        break;
    }
    audio.pickup();
    return true;
  }

  private updateHud() {
    const pl = this.player;
    const hud = this.hud;
    hud.health(pl.health, pl.maxHealth);
    hud.score(this.stats.score);
    hud.damage(pl.hurtFlash * 0.9 + (pl.health < 30 ? 0.25 + Math.sin(this.time * 6) * 0.1 : 0));
    hud.flashbang(Math.min(1, this.blind));
    hud.scope(this.weapons.scoped);
    hud.nades(this.nades.frag, this.nades.flash);
    hud.sniperButton(this.weapons.def.sniper === true);
    const spread = this.weapons.def.spread * 400 * (1 + pl.speed01 * (this.weapons.current === 1 ? 0.2 : 1.6)) + (this.weapons.state === 'reload' ? 6 : 0);
    hud.crosshair(Math.min(30, this.weapons.def.sniper ? 0 : spread), this.onTarget);
    this.updateWeaponHud();

    if (this.inMatch && this.mode !== 'coop') {
      const s = this.mp!;
      const def = MODES[this.mode as ModeId];
      const tl = s.timeLeft();
      const clock = def.timeLimit ? ` · ${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}` : '';
      let label: string;
      if (def.teams) {
        label = `<span style="color:#9be06a">GREEN ${s.teamScore(0)}</span> · <span style="color:#e8c48a">TAN ${s.teamScore(1)}</span>`;
      } else {
        const lead = [...s.inMatchPlayers].sort((a, b) => b.kills - a.kills)[0];
        label = `YOU ${s.self.kills} · ${lead === s.self ? 'YOU LEAD' : `BEST ${lead.kills}`}`;
      }
      hud.wave(0, 0, `${def.name}<br><small style="font-size:15px">${label} · FIRST TO ${def.scoreLimit}${clock}</small>`);
      hud.waveProgress(def.teams ? Math.max(s.teamScore(0), s.teamScore(1)) / def.scoreLimit : Math.max(...s.inMatchPlayers.map((p) => p.kills)) / def.scoreLimit);
      hud.enemies(s.inMatchPlayers.length, 'PLAYERS');
      if (this.state === 'dying' && s.respawnT > 0) hud.respawn(s.respawnT);
      else hud.respawn(0);
      return;
    }
    hud.respawn(this.inMatch && this.state === 'dying' ? this.mp!.respawnT : 0);
    // survival / co-op wave HUD
    if (this.simulatesEnemies) {
      hud.enemies(this.waves.remaining, 'ENEMIES');
      const total = this.waves.total + this.waves.extraSpawned;
      hud.waveProgress(total ? this.waves.killed / total : 0);
      hud.wave(this.waves.wave + 1, WAVES.length, this.waves.wave === WAVES.length - 1 ? 'FINAL WAVE' : undefined);
      hud.boss(this.boss && !this.boss.dead ? Math.max(0, this.boss.hp / this.boss.maxHp) : null);
    } else if (this.mp) {
      const ci = this.mp.coopInfo;
      hud.enemies(ci.remaining, 'ENEMIES');
      hud.waveProgress(ci.total ? ci.killed / ci.total : 0);
      hud.wave(ci.wave + 1, WAVES.length, ci.wave === WAVES.length - 1 ? 'FINAL WAVE' : undefined);
      const b = this.enemies.find((e) => e.type === 'boss' && !e.dead);
      hud.boss(b ? Math.max(0, b.hp / b.maxHp) : null);
    }
  }

  private separate() {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || a.puppet) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || b.puppet) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const r = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || d2 < 1e-6) continue;
        if (Math.abs(a.pos.y - b.pos.y) > Math.max(a.height, b.height)) continue;
        const d = Math.sqrt(d2);
        const push = (r - d) * 0.5;
        const wa = a.type === 'boss' ? 0.05 : b.type === 'boss' ? 1.9 : 1;
        const wb = 2 - wa;
        a.pos.x -= (dx / d) * push * wa;
        a.pos.z -= (dz / d) * push * wa;
        b.pos.x += (dx / d) * push * wb;
        b.pos.z += (dz / d) * push * wb;
      }
      const pl = this.player;
      const dx = a.pos.x - pl.pos.x, dz = a.pos.z - pl.pos.z;
      const r = a.radius + pl.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-6 && Math.abs(a.pos.y - pl.pos.y) < Math.max(a.height, pl.height)) {
        const d = Math.sqrt(d2);
        const push = r - d;
        if (a.type === 'boss') {
          pl.pos.x -= (dx / d) * push;
          pl.pos.z -= (dz / d) * push;
        } else {
          a.pos.x += (dx / d) * push * 0.7;
          a.pos.z += (dz / d) * push * 0.7;
          pl.pos.x -= (dx / d) * push * 0.3;
          pl.pos.z -= (dz / d) * push * 0.3;
        }
      }
    }
  }

  private updateShockwaves(dt: number) {
    const pl = this.player;
    for (const s of this.shockwaves) {
      s.r += dt * 26;
      s.mesh.scale.set(s.r, s.r, 1 + s.r * 0.05);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - s.r / 34));
      if (!s.hit && pl.alive) {
        const d = Math.hypot(pl.pos.x - s.pos.x, pl.pos.z - s.pos.z);
        if (Math.abs(d - s.r) < 1.3 && pl.pos.y - s.pos.y < 1.1) {
          s.hit = true;
          const dir = new THREE.Vector3(pl.pos.x - s.pos.x, 0, pl.pos.z - s.pos.z).normalize();
          if (pl.damage(24, s.pos)) pl.knock(dir, 12);
        }
      }
      if (Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        this.fx.puff(new THREE.Vector3(s.pos.x + Math.cos(a) * s.r, s.pos.y + 0.4, s.pos.z + Math.sin(a) * s.r), 0xffffff, 0.6, 1.4, 0.4);
      }
    }
    const done = this.shockwaves.filter((s) => s.r > 34);
    for (const s of done) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
    this.shockwaves = this.shockwaves.filter((s) => s.r <= 34);
  }

  private render() {
    const showVm = this.state === 'playing' || this.state === 'dying' || this.state === 'paused' || this.state === 'mpover';
    if (this.composer) {
      this.vmPass!.enabled = showVm;
      this.composer.render();
    } else {
      const r = this.renderer;
      r.autoClear = false;
      r.clear();
      r.render(this.scene, this.player.camera);
      if (showVm) {
        r.clearDepth();
        r.render(this.weapons.scene, this.weapons.camera);
      }
    }
  }

  // ------------------------------------------------------------------ debug helpers (used by automated tests)
  debugKillAll() {
    for (const e of [...this.enemies]) if (!e.dead && !e.puppet) e.takeDamage(99999, null, this.ectx());
  }
  debugSkipToWave(i: number) {
    this.debugKillAll();
    (this.waves as unknown as { begin(i: number): void }).begin(i);
  }
}
