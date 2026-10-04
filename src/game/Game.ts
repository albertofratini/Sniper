import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Materials } from '../environment/Materials';
import { buildBedroom, BedroomInfo, SUN_DIR } from '../environment/Bedroom';
import { CollisionWorld, NavGrid, RayHit } from './Collision';
import { Input } from './Input';
import { MobileControls } from './MobileControls';
import { Player } from './Player';
import { WeaponSystem, FireContext, WEAPONS } from './Weapons';
import { Effects } from './Effects';
import { Projectiles, Projectile, ProjectileHooks } from './Projectiles';
import { Enemy, EnemyType, EnemyCtx, createEnemy, debris, Boss } from './Enemies';
import { WaveManager, WAVES } from './WaveManager';
import { DynamicProps, Pickups, PickupKind } from './Props';
import { HUD } from '../ui/HUD';
import { audio } from './Audio';

type GameState = 'menu' | 'playing' | 'paused' | 'dying' | 'over';

interface Shockwave { pos: THREE.Vector3; r: number; hit: boolean; mesh: THREE.Mesh }

const tmpHit: RayHit = { dist: 0, normal: new THREE.Vector3(), point: new THREE.Vector3(), box: null };
const v1 = new THREE.Vector3();

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

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
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
  private maxPixelRatio = 1;
  private frameAcc = 0;
  private frameCount = 0;
  private lastAdjust = 0;
  private stats = { kills: 0, shots: 0, hits: 0, time: 0, score: 0 };
  private onTarget = false;
  private trainT = 0;
  private menuT = 0;
  private boss: Boss | null = null;
  private victoryT = -1;
  onStateChange: (s: GameState, info?: { victory: boolean; stats: Game['stats'] }) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.input = new Input(canvas);
    const params = new URLSearchParams(location.search);
    this.lowEnd = this.input.isTouch || params.has('low');
    if (params.has('high')) this.lowEnd = false;
    document.body.classList.toggle('is-touch', this.input.isTouch);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowEnd, powerPreference: 'high-performance', stencil: false });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, this.lowEnd ? 2 : 2);
    this.pixelRatio = this.lowEnd ? Math.min(this.maxPixelRatio, 1.5) : this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;

    // ---- scene, environment, lights
    this.scene.background = new THREE.Color(0xe9d8c4);
    this.scene.fog = new THREE.Fog(0xcdb497, 90, 330);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.32;

    this.mats = new Materials();
    this.room = buildBedroom(this.mats, this.world);
    this.scene.add(this.room.group);
    this.scene.add(this.room.train);
    this.setupLights();
    this.nav = new NavGrid(this.world);

    const aspect = window.innerWidth / window.innerHeight;
    this.player = new Player(this.world, aspect);
    this.scene.add(this.player.camera);
    this.weapons = new WeaponSystem(this.mats, aspect, env);
    this.fx = new Effects(this.world, this.lowEnd);
    this.scene.add(this.fx.group);
    this.fx.onShake((a) => {
      this.player.shake(a);
    });
    this.proj = new Projectiles(this.mats, this.world, this.fx);
    this.scene.add(this.proj.group);
    this.props = new DynamicProps(this.mats, this.world, this.room.dynamicSpots);
    this.scene.add(this.props.group);
    this.pickups = new Pickups(this.mats, this.world);
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
          audio.waveStart();
        },
        waveCleared: (i) => {
          this.hud.banner('WAVE CLEARED!', `+25 HEALTH · AMMO RESTOCKED · WAVE ${i + 2} INCOMING`, 3.2);
          this.player.heal(25);
          this.weapons.addAmmo(0.5);
          this.stats.score += 500 * (i + 1);
          audio.waveComplete();
        },
        victory: () => this.victory(),
      },
    );

    this.player.onDamage = (amount, from) => {
      if (from) {
        const d = v1.subVectors(from, this.player.pos);
        const fwd = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
        const right = new THREE.Vector3(Math.cos(this.player.yaw), 0, -Math.sin(this.player.yaw));
        this.hud.hitDir(Math.atan2(d.dot(right), d.dot(fwd)));
      }
      void amount;
    };
    this.weapons.onAmmoChange = () => this.updateWeaponHud();

    // post-processing on capable devices
    if (!this.lowEnd) this.setupComposer();

    this.mobile = new MobileControls(this.input);
    this.input.onPauseRequest = () => this.pause();
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.state === 'playing' && !this.input.isTouch) this.pause();
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    this.resize();

    this.renderer.shadowMap.needsUpdate = true;
    (window as unknown as { __game: Game }).__game = this;
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
    s.bias = -0.0004;
    s.normalBias = 0.06;
    s.radius = 3;
    this.scene.add(sun, sun.target);

    const hemi = new THREE.HemisphereLight(0xc4d8ff, 0xb58258, 0.62);
    this.scene.add(hemi);
    // warm bounce from the sunlit floor, from the front of the room
    const bounce = new THREE.DirectionalLight(0xffb48a, 0.4);
    bounce.position.set(-20, 10, 80);
    this.scene.add(bounce);
    // cool skylight through the window
    const sky = new THREE.DirectionalLight(0xa8c8ff, 0.45);
    sky.position.set(30, 60, -90);
    this.scene.add(sky);
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.2, 0.4, 0.95);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.player.camera.aspect = w / h;
    // keep a decent horizontal FOV in narrow landscape phones
    this.player.baseFov = w / h > 1.9 ? 70 : 75;
    this.player.camera.updateProjectionMatrix();
    this.weapons.resize(w / h);
    this.composer?.setSize(w, h);
    const portrait = this.input.isTouch && h > w;
    document.getElementById('rotate')!.classList.toggle('hidden', !portrait);
    if (portrait && this.state === 'playing') this.pause();
  }

  // ------------------------------------------------------------------ flow

  start() {
    audio.init();
    this.resetWorld();
    this.state = 'playing';
    this.hud.show(true);
    this.mobile.show(this.input.isTouch);
    this.input.enabled = true;
    this.input.lock();
    this.waves.start();
    this.onStateChange('playing');
  }

  pause() {
    if (this.state !== 'playing') return;
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
    this.player.spawn(this.room.playerSpawn, this.room.playerYaw);
    this.victoryT = -1;
    this.hitstop = 0;
    this.weapons.reset();
    this.hud.reset();
    this.stats = { kills: 0, shots: 0, hits: 0, time: 0, score: 0 };
    this.hud.health(100, 100);
    this.hud.score(0);
    this.updateWeaponHud();
    this.nav.update(this.player.pos.x, this.player.pos.z);
  }

  private victory() {
    this.hud.banner('VICTORY!', 'THE BEDROOM IS SAFE… FOR NOW', 4);
    audio.victory();
    for (let i = 0; i < 6; i++) this.fx.confetti(this.player.eyePos.add(new THREE.Vector3((Math.random() - 0.5) * 10, 2 + i, (Math.random() - 0.5) * 10)), 40);
    this.stats.score += Math.max(0, Math.round(this.player.health) * 20);
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

  // ------------------------------------------------------------------ spawning

  private spawnWaveEnemy(type: EnemyType, hard: boolean) {
    let pos: THREE.Vector3;
    if (type === 'boss') {
      pos = this.room.bossSpawn.clone();
    } else {
      const pts = this.room.spawnPoints
        .map((p, i) => ({ p, i, d: Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z) }))
        .filter((o) => o.d > 18 && this.spawnCooldown[o.i] <= 0)
        .sort((a, b) => a.d - b.d);
      const pick = pts.length ? pts[Math.floor(Math.random() * Math.min(4, pts.length))] : { p: this.room.spawnPoints[0], i: 0 };
      this.spawnCooldown[pick.i] = 1.2;
      pos = pick.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.5, 0, (Math.random() - 0.5) * 2.5));
    }
    this.spawnEnemy(type, pos, hard);
  }

  private spawnEnemy(type: EnemyType, pos: THREE.Vector3, hard = false) {
    const e = createEnemy(type, this.mats, hard);
    e.yaw = Math.atan2(this.player.pos.x - pos.x, this.player.pos.z - pos.z);
    e.place(pos, this.scene);
    this.enemies.push(e);
    const c = pos.clone().add(new THREE.Vector3(0, e.height * 0.5, 0));
    this.fx.puff(c, 0xffffff, e.height * 0.4, e.height * 1.1, 0.5);
    this.fx.glow(c, 0xfff0c0, e.height * 1.5, 0.1, 0.25);
    audio.spawnPop();
    if (type === 'boss') {
      this.boss = e as Boss;
      this.hud.banner('THE WIND-UP KING', 'AIM FOR THE GLOWING CORE!', 3.2);
      audio.bossRoar();
      this.player.shake(0.6);
      this.fx.confetti(c, 60);
    }
  }

  private ectx(): EnemyCtx {
    return {
      player: this.player,
      world: this.world,
      nav: this.nav,
      fx: this.fx,
      proj: this.proj,
      time: this.time,
      playerVisible: true,
      spawn: (type, pos) => {
        this.spawnEnemy(type, pos);
        this.waves.onExtraSpawn();
      },
      shockwave: (pos) => this.spawnShockwave(pos),
      onKilled: (e) => this.onKilled(e),
    };
  }

  private onKilled(e: Enemy) {
    this.stats.kills++;
    this.stats.score += e.score;
    this.waves.onKill();
    this.hud.hitmarker(true);
    if (e.type === 'robot' || e.type === 'boss') this.hitstop = e.type === 'boss' ? 0.25 : 0.06;
    if (e.type === 'boss') {
      this.boss = null;
      this.hud.boss(null);
      this.fx.explosion(e.pos.clone().add(new THREE.Vector3(0, 5, 0)), 7);
      audio.explosion(5);
    }
    // drops
    const r = Math.random();
    const hpChance = e.type === 'robot' ? 0.6 : e.type === 'chomper' ? 0.3 : e.type === 'bug' ? 0.05 : 0.15;
    const amChance = e.type === 'robot' ? 0.7 : e.type === 'bug' ? 0.06 : 0.25;
    if (e.type === 'boss') {
      for (let i = 0; i < 3; i++) this.pickups.spawn('health', e.pos);
    } else {
      if (r < hpChance) this.pickups.spawn('health', e.pos);
      if (Math.random() < amChance) this.pickups.spawn('ammo', e.pos);
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

  // ------------------------------------------------------------------ combat

  private fireCtx: FireContext = {
    hitscan: (origin, dir, range, damage, tracerColor, muzzle, pellet) => {
      this.stats.shots += pellet === 0 ? 1 : 0;
      const wh = this.world.raycast(origin, dir, range, tmpHit);
      let maxD = wh ? wh.dist : range;
      let best: { e: Enemy; t: number; mult: number } | null = null;
      const pad = this.input.isTouch ? 0.22 : 0.05;
      for (const e of this.enemies) {
        const h = e.rayHit(origin, dir, maxD, pad);
        if (h && (!best || h.t < best.t)) best = { e, t: h.t, mult: h.mult };
      }
      if (best) maxD = best.t;
      const ph = this.props.rayHit(origin, dir, maxD);
      let end: THREE.Vector3;
      if (ph) {
        end = origin.clone().addScaledVector(dir, ph.t);
        this.props.impulseAt(end, dir, this.weapons.current === 1 ? 2.2 : 3.5, 0.3);
        this.fx.impact(end, dir.clone().negate(), 0xfff0c0);
        audio.surfaceHit();
      } else if (best) {
        end = origin.clone().addScaledVector(dir, best.t);
        const dmg = damage * best.mult;
        const head = best.mult > 1.2;
        best.e.takeDamage(dmg, dir, this.ectx(), this.weapons.current === 1 ? 0.5 : 1);
        this.stats.hits++;
        this.fx.impact(end, dir.clone().negate(), head ? 0xffff80 : 0xffe0a0, best.e.colors);
        if (!best.e.dead) this.hud.hitmarker(false);
        audio.hit(head);
      } else if (wh) {
        end = wh.point.clone();
        this.fx.impact(end, wh.normal, 0xfff0c0);
        if (pellet < 4) this.fx.decal(end, wh.normal, this.weapons.current === 1 ? 0.18 : 0.14);
        if (pellet === 0) audio.surfaceHit();
      } else end = origin.clone().addScaledVector(dir, range);
      if (pellet < 3) this.fx.tracer(muzzle, end, tracerColor, this.weapons.current === 1 ? 0.04 : 0.05, this.weapons.current === 1 ? 0.07 : 0.06);
    },
    fireRocket: (muzzle, dir) => {
      this.stats.shots++;
      this.proj.spawn('rocket', muzzle, dir.clone().multiplyScalar(46), WEAPONS[2].damage, false);
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
        e.takeDamage(e.type === 'bug' ? 50 : 45, flat, this.ectx(), 3);
        this.fx.impact(c, dir.clone().negate(), 0xffffff, e.colors);
        if (!e.dead) this.hud.hitmarker(false);
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
      return origin.clone().addScaledVector(dir, Math.max(3, d));
    },
    muzzleFlash: (p, color, size) => {
      this.fx.glow(p, color, size * 0.6, size * 0.2, 0.06);
      if (this.muzzleLight) {
        this.muzzleLight.position.copy(p);
        this.muzzleLight.color.setHex(color);
        this.muzzleLight.intensity = 30 * size;
      }
    },
  };

  private explode(at: THREE.Vector3, radius: number, damage: number, hostile: boolean) {
    this.fx.explosion(at, radius * 0.55);
    this.props.explosion(at, radius, 22);
    const pd = this.player.centerPos.distanceTo(at);
    audio.explosion(pd);
    this.player.shake(Math.max(0, 0.6 - pd * 0.02));
    const ctx = this.ectx();
    if (!hostile) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = e.distTo(at);
        if (d > radius) continue;
        const k = 1 - d / radius;
        const dir = e.pos.clone().sub(at).setY(0.5).normalize();
        e.takeDamage(damage * (0.3 + 0.7 * k), dir, ctx, 2.2);
        this.stats.hits++;
      }
    }
    if (pd < radius) {
      const k = 1 - pd / radius;
      const dir = this.player.centerPos.sub(at).normalize();
      // rocket jumping is allowed (and fun); self damage is reduced
      this.player.knock(dir, 14 * k);
      this.player.damage((hostile ? damage : damage * 0.12) * (0.35 + 0.65 * k), at);
    }
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
          e.takeDamage(p.damage * 0.5, d, this.ectx(), 1.5);
          this.explode(to.clone().addScaledVector(d, -0.3), 6.5, p.damage * 0.75, false);
          return true;
        }
      }
      return false;
    },
    hitPlayer: (p) => {
      const pl = this.player;
      if (!pl.alive) return false;
      const dy = p.pos.y - pl.pos.y;
      if (dy < -p.radius || dy > pl.height + p.radius) return false;
      const dx = p.pos.x - pl.pos.x, dz = p.pos.z - pl.pos.z;
      if (Math.hypot(dx, dz) > pl.radius + p.radius + 0.1) return false;
      if (p.kind !== 'bomb') {
        pl.damage(p.damage, p.pos.clone().sub(p.vel));
        this.fx.impact(p.pos, p.vel.clone().normalize().negate(), p.kind === 'bolt' ? 0x60e0ff : 0xff8060);
      }
      return true;
    },
    explode: (p, at) => {
      this.explode(at, p.kind === 'bomb' ? 5.5 : 6.5, p.kind === 'bomb' ? p.damage : p.damage * 0.75, p.hostile);
    },
    impact: (p, hit) => {
      this.fx.impact(hit.point, hit.normal, p.kind === 'bolt' ? 0x60e0ff : 0xff9060);
      if (p.kind === 'bolt') this.fx.glow(hit.point, 0x40c0ff, 1.2, 0.2, 0.2);
    },
  };

  // ------------------------------------------------------------------ aim assist

  private updateAim(dt: number) {
    const cam = this.player.camera;
    const fwd = this.player.forward();
    const origin = cam.position;
    let best: Enemy | null = null;
    let bestAng = this.input.isTouch ? 0.13 : 0.035;
    let bestPoint: THREE.Vector3 | null = null;
    for (const e of this.enemies) {
      if (e.dead || !e.hitSpheres.length) continue;
      const c = e.hitSpheres[0].c;
      const to = v1.subVectors(c, origin);
      const dist = to.length();
      if (dist > 80) continue;
      const ang = Math.acos(Math.min(1, to.dot(fwd) / dist)) - Math.atan2(e.hitSpheres[0].r, dist);
      if (ang < bestAng) {
        bestAng = ang;
        best = e;
        bestPoint = c.clone();
      }
    }
    if (best && bestPoint && !this.world.lineOfSight(origin, bestPoint)) best = null;
    this.onTarget = !!best && bestAng < 0.03;
    if (best && bestPoint && this.input.isTouch && this.player.alive) {
      const to = bestPoint.sub(origin).normalize();
      const wantYaw = Math.atan2(-to.x, -to.z);
      const wantPitch = Math.asin(to.y);
      let dy = wantYaw - this.player.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const strength = (this.input.fire ? 4.5 : 1.6) * dt;
      this.player.yaw += dy * Math.min(1, strength);
      this.player.pitch += (wantPitch - this.player.pitch) * Math.min(1, strength * 0.7);
    }
  }

  // ------------------------------------------------------------------ loop

  private updateWeaponHud() {
    const w = this.weapons;
    const a = w.ammo[w.current];
    this.hud.weapon(w.current, w.def.name, a.mag, a.reserve, w.state === 'reload');
  }

  tick = () => {
    requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.trackPerf(dt);
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
    if (this.state === 'playing' || this.state === 'dying') this.updatePlaying(dt);
    if (this.state !== 'paused') {
      this.updateAmbient(dt);
      this.fx.update(dt, this.player.camera);
      debris.update(dt);
    }
    this.hud.update(dt);
  }

  private updateMenuCam(dt: number) {
    this.menuT += dt * 0.06;
    const cam = this.player.camera;
    const t = this.menuT + 2.2;
    cam.position.set(-22 + Math.cos(t) * 26, 6 + Math.sin(t * 1.7) * 1.5, 18 + Math.sin(t) * 16);
    cam.lookAt(-22 + Math.cos(t + 1.9) * 10, 4, 14 + Math.sin(t + 1.9) * 10);
    cam.updateMatrixWorld();
    // still animate the hands for the menu
    this.weapons.camera.updateMatrixWorld();
  }

  private updateAmbient(dt: number) {
    // train loop
    this.trainT += dt * 0.32;
    const cars = this.room.train.userData.cars as THREE.Group[];
    cars.forEach((car, i) => {
      const t = this.trainT - i * 0.2;
      this.room.trainPath(t, car.position);
      const ahead = this.room.trainPath(t + 0.02, v1);
      car.lookAt(ahead.x, car.position.y, ahead.z);
      car.position.y += Math.abs(Math.sin(this.time * 18 + i)) * 0.03;
    });
    // dust motes drift
    const attr = this.room.motes.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += Math.sin(this.time * 0.5 + i) * 0.004;
      arr[i] += Math.cos(this.time * 0.3 + i * 0.7) * 0.003;
    }
    attr.needsUpdate = true;
    if (this.muzzleLight) this.muzzleLight.intensity *= Math.max(0, 1 - dt * 30);
  }

  private updatePlaying(dt: number) {
    const input = this.input;
    input.poll();
    const pl = this.player;
    if (this.state === 'playing') {
      this.stats.time += dt;
      this.updateAim(dt);
    }
    pl.update(dt, input, this.weapons.def.speedMul);
    this.weapons.update(dt, input, pl, this.fireCtx, this.time);

    this.navTimer -= dt;
    if (this.navTimer <= 0) {
      this.navTimer = 0.3;
      this.nav.update(pl.pos.x, pl.pos.z);
    }
    for (let i = 0; i < this.spawnCooldown.length; i++) this.spawnCooldown[i] -= dt;

    const ctx = this.ectx();
    for (const e of this.enemies) if (!e.dead) e.update(dt, ctx);
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
    this.pickups.update(dt, pl.pos, (k: PickupKind) => {
      if (k === 'health') {
        if (pl.health >= pl.maxHealth) return false;
        pl.heal(25);
        this.hud.toast('+25 HEALTH');
      } else {
        this.weapons.addAmmo(0.25);
        this.hud.toast('AMMO +');
      }
      audio.pickup();
      return true;
    });
    this.updateShockwaves(dt);

    if (this.state === 'playing') this.waves.update(dt);
    if (this.victoryT > 0 && this.state === 'playing') {
      this.victoryT -= dt;
      if (this.victoryT <= 0) this.endGame(true);
    }

    // HUD
    this.hud.health(pl.health, pl.maxHealth);
    this.hud.enemies(this.waves.remaining);
    const total = this.waves.total + this.waves.extraSpawned;
    this.hud.waveProgress(total ? this.waves.killed / total : 0);
    this.hud.score(this.stats.score);
    this.hud.damage(pl.hurtFlash * 0.9 + (pl.health < 30 ? 0.25 + Math.sin(this.time * 6) * 0.1 : 0));
    const spread = this.weapons.def.spread * 400 * (1 + pl.speed01 * (this.weapons.current === 1 ? 0.2 : 1.6)) + (this.weapons.state === 'reload' ? 6 : 0);
    this.hud.crosshair(Math.min(30, spread), this.onTarget);
    this.hud.boss(this.boss && !this.boss.dead ? Math.max(0, this.boss.hp / this.boss.maxHp) : null);
    this.updateWeaponHud();

    // death
    if (!pl.alive && this.state === 'playing') {
      this.state = 'dying';
      this.deathT = 0;
      audio.defeat();
      this.hud.banner('KNOCKED OVER!', '', 2);
      this.mobile.show(false);
    }
    if (this.state === 'dying') {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 0.9);
      const cam = pl.camera;
      cam.position.y = pl.pos.y + 0.25 + (pl.eye - 0.25) * (1 - k * k);
      cam.rotation.z = k * 1.35;
      cam.rotation.x = pl.pitch * (1 - k) + 0.2 * k;
      cam.updateMatrixWorld();
      if (this.deathT > 2.2) this.endGame(false);
    }
    input.endFrame();
  }

  private separate() {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead) continue;
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
      // keep enemies out of the player
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
    const showVm = this.state === 'playing' || this.state === 'dying' || this.state === 'paused';
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

  private trackPerf(dt: number) {
    this.frameAcc += dt;
    this.frameCount++;
    if (this.frameAcc < 1) return;
    const fps = this.frameCount / this.frameAcc;
    this.frameAcc = 0;
    this.frameCount = 0;
    const now = performance.now();
    if (now - this.lastAdjust < 2000 || this.state !== 'playing') return;
    let pr = this.pixelRatio;
    if (fps < 42 && pr > 0.7) pr = Math.max(0.7, pr - 0.2);
    else if (fps > 58 && pr < this.maxPixelRatio && this.lowEnd) pr = Math.min(this.maxPixelRatio, pr + 0.1);
    if (pr !== this.pixelRatio) {
      this.pixelRatio = pr;
      this.lastAdjust = now;
      this.renderer.setPixelRatio(pr);
      this.composer?.setPixelRatio(pr);
      this.resize();
    }
  }

  // ------------------------------------------------------------------ debug helpers (used by automated tests)
  debugKillAll() {
    const ctx = this.ectx();
    for (const e of [...this.enemies]) if (!e.dead) e.takeDamage(99999, null, ctx);
  }
  debugSkipToWave(i: number) {
    this.debugKillAll();
    (this.waves as unknown as { begin(i: number): void }).begin(i);
  }
}
