/** Tiny Web Audio synth: every sound is generated, no assets. */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private lastPlay = new Map<string, number>();
  muted = false;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // iOS unlock
    const b = this.ctx.createBufferSource();
    b.buffer = this.ctx.createBuffer(1, 1, 22050);
    b.connect(this.master);
    b.start();
  }

  private ok(key: string, minGap: number) {
    if (!this.ctx || this.muted) return false;
    const t = this.ctx.currentTime;
    const l = this.lastPlay.get(key) ?? -1;
    if (t - l < minGap) return false;
    this.lastPlay.set(key, t);
    return true;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, pan = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, 0.004, vol, dur);
    let out: AudioNode = g;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    o.connect(g);
    out.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, delay = 0, q = 1, pan = 0) {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, 0.003, vol, dur);
    s.connect(f);
    f.connect(g);
    let out: AudioNode = g;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(this.master);
    s.start(t, Math.random() * 1.0);
    s.stop(t + dur + 0.05);
  }

  blaster() {
    if (!this.ok('blaster', 0.03)) return;
    const p = 1 + (Math.random() - 0.5) * 0.12;
    this.tone('square', 1400 * p, 300 * p, 0.09, 0.18);
    this.tone('sine', 220 * p, 60, 0.08, 0.35);
    this.burst(0.05, 0.25, 'highpass', 3000, 1500);
  }
  weapon(kind: 'blaster' | 'shotgun' | 'rocket' | 'sniper' | 'minigun') {
    if (kind === 'blaster') this.blaster();
    else if (kind === 'shotgun') this.shotgun();
    else if (kind === 'rocket') this.rocket();
    else if (kind === 'sniper') this.sniper();
    else this.minigun();
  }
  sniper() {
    if (!this.ok('sniper', 0.1)) return;
    this.tone('square', 2200, 200, 0.12, 0.25);
    this.tone('sine', 180, 40, 0.4, 0.7);
    this.burst(0.5, 0.6, 'lowpass', 5000, 150);
    // bolt cycle
    this.burst(0.04, 0.35, 'bandpass', 2600, 2200, 0.45, 6);
    this.burst(0.05, 0.35, 'bandpass', 1800, 1500, 0.62, 6);
  }
  minigun() {
    if (!this.ok('minigun', 0.035)) return;
    const p = 1 + (Math.random() - 0.5) * 0.1;
    this.tone('square', 900 * p, 260 * p, 0.05, 0.12);
    this.burst(0.04, 0.2, 'bandpass', 1800, 900, 0, 2);
  }
  throwWhoosh() {
    if (!this.ok('throw', 0.1)) return;
    this.burst(0.2, 0.25, 'bandpass', 500, 1800, 0, 2);
  }
  bounce() {
    if (!this.ok('bounce', 0.06)) return;
    this.tone('sine', 700 + Math.random() * 300, 400, 0.06, 0.15);
  }
  flashbang(dist = 10) {
    if (!this.ok('flash', 0.1)) return;
    const v = Math.max(0.2, Math.min(1, 25 / (dist + 5)));
    this.burst(0.25, 0.8 * v, 'highpass', 3000, 1500);
    this.tone('sine', 3200, 3000, 2.2, 0.08 * v, 0.1);
  }
  shotgun() {
    if (!this.ok('shotgun', 0.05)) return;
    this.burst(0.28, 0.8, 'lowpass', 3000, 200);
    this.tone('sine', 140, 40, 0.25, 0.8);
    this.tone('square', 600, 120, 0.06, 0.15);
    // pump
    this.burst(0.05, 0.3, 'bandpass', 1800, 1200, 0.32, 4);
    this.burst(0.05, 0.3, 'bandpass', 1400, 900, 0.45, 4);
  }
  rocket() {
    if (!this.ok('rocket', 0.05)) return;
    this.tone('sine', 300, 80, 0.2, 0.5);
    this.burst(0.5, 0.4, 'bandpass', 800, 3000, 0, 2);
    this.tone('triangle', 900, 1500, 0.12, 0.1);
  }
  explosion(dist = 10) {
    if (!this.ok('explosion', 0.04)) return;
    const v = Math.max(0.2, Math.min(1, 25 / (dist + 5)));
    this.burst(0.9, 0.9 * v, 'lowpass', 2400, 60);
    this.tone('sine', 120, 30, 0.6, 0.9 * v);
    this.tone('square', 220, 40, 0.15, 0.15 * v);
  }
  reload() {
    if (!this.ok('reload', 0.1)) return;
    this.burst(0.04, 0.4, 'bandpass', 2500, 2000, 0, 6);
    this.tone('square', 420, 380, 0.03, 0.08, 0.02);
    this.burst(0.04, 0.4, 'bandpass', 1800, 1500, 0.25, 6);
    this.burst(0.06, 0.5, 'bandpass', 1200, 900, 0.5, 5);
    this.tone('square', 700, 600, 0.04, 0.1, 0.52);
  }
  empty() {
    if (!this.ok('empty', 0.15)) return;
    this.burst(0.03, 0.4, 'bandpass', 3000, 2500, 0, 8);
  }
  hit(head = false) {
    if (!this.ok('hit', 0.035)) return;
    this.tone('sine', head ? 1600 : 1100, head ? 1200 : 700, 0.06, 0.3);
    this.burst(0.03, 0.2, 'bandpass', 4000, 3000, 0, 3);
  }
  surfaceHit(pan = 0) {
    if (!this.ok('surf', 0.05)) return;
    this.burst(0.04, 0.12, 'bandpass', 2200 + Math.random() * 1500, 1500, 0, 4, pan);
  }
  enemyDeath(big = false) {
    if (!this.ok('edeath', 0.04)) return;
    this.tone('square', big ? 300 : 700, big ? 60 : 120, 0.25, 0.22);
    this.burst(0.15, 0.4, 'highpass', 2000, 800);
    for (let i = 0; i < 5; i++) this.tone('sine', 1500 + Math.random() * 2500, 900, 0.04, 0.12, 0.05 + i * 0.045 + Math.random() * 0.03);
    if (big) this.explosion(5);
  }
  footstep(sprint: boolean) {
    if (!this.ok('step', 0.12)) return;
    this.burst(0.05, sprint ? 0.12 : 0.08, 'lowpass', 900, 300, 0, 1, (Math.random() - 0.5) * 0.3);
    this.tone('sine', 120, 70, 0.05, 0.08);
  }
  jump() {
    if (!this.ok('jump', 0.1)) return;
    this.tone('sine', 300, 600, 0.12, 0.12);
  }
  land() {
    if (!this.ok('land', 0.15)) return;
    this.burst(0.08, 0.25, 'lowpass', 600, 150);
    this.tone('sine', 110, 50, 0.1, 0.25);
  }
  hurt() {
    if (!this.ok('hurt', 0.12)) return;
    this.tone('sawtooth', 220, 80, 0.22, 0.25);
    this.burst(0.12, 0.35, 'lowpass', 1200, 200);
  }
  enemyShot(pan = 0, dist = 10) {
    if (!this.ok('eshot', 0.06)) return;
    const v = Math.max(0.05, Math.min(0.3, 6 / (dist + 2)));
    this.tone('triangle', 900, 250, 0.1, v, 0, pan);
    this.burst(0.06, v, 'bandpass', 1500, 600, 0, 2, pan);
  }
  laser(pan = 0) {
    if (!this.ok('laser', 0.08)) return;
    this.tone('sawtooth', 1800, 200, 0.25, 0.12, 0, pan);
    this.tone('square', 900, 100, 0.25, 0.06, 0.02, pan);
  }
  growl(pan = 0) {
    if (!this.ok('growl', 0.4)) return;
    this.tone('sawtooth', 160, 90, 0.35, 0.18, 0, pan);
    this.tone('square', 240, 120, 0.3, 0.06, 0.02, pan);
  }
  chitter(pan = 0) {
    if (!this.ok('chitter', 0.18)) return;
    for (let i = 0; i < 3; i++) this.tone('square', 2400 + Math.random() * 800, 1800, 0.025, 0.035, i * 0.04, pan);
  }
  windup() {
    if (!this.ok('windup', 0.5)) return;
    for (let i = 0; i < 8; i++) this.burst(0.03, 0.3, 'bandpass', 2600, 2400, i * 0.07, 10);
  }
  stomp() {
    if (!this.ok('stomp', 0.2)) return;
    this.tone('sine', 80, 30, 0.5, 0.9);
    this.burst(0.4, 0.5, 'lowpass', 500, 60);
  }
  melee() {
    if (!this.ok('melee', 0.2)) return;
    this.burst(0.15, 0.3, 'bandpass', 600, 2400, 0, 2);
  }
  meleeHit() {
    this.tone('sine', 180, 60, 0.15, 0.6);
    this.burst(0.08, 0.4, 'lowpass', 1500, 300);
  }
  swap() {
    if (!this.ok('swap', 0.1)) return;
    this.burst(0.05, 0.3, 'bandpass', 1500, 1000, 0, 5);
    this.burst(0.05, 0.3, 'bandpass', 2200, 1800, 0.12, 5);
  }
  pickup() {
    if (!this.ok('pickup', 0.08)) return;
    [880, 1320, 1760].forEach((f, i) => this.tone('square', f, f, 0.07, 0.1, i * 0.06));
  }
  spawnPop() {
    if (!this.ok('spawn', 0.1)) return;
    this.tone('sine', 400, 900, 0.1, 0.1);
  }
  private chord(notes: number[], step: number, dur: number, vol: number, type: OscillatorType = 'square') {
    notes.forEach((f, i) => {
      this.tone(type, f, f * 0.995, dur, vol, i * step);
      this.tone('triangle', f / 2, f / 2, dur, vol * 0.8, i * step);
    });
  }
  waveStart() {
    if (!this.ctx || this.muted) return;
    this.chord([392, 392, 523, 659], 0.13, 0.22, 0.12);
    this.burst(0.6, 0.12, 'bandpass', 300, 300, 0, 0.7);
  }
  waveComplete() {
    if (!this.ctx || this.muted) return;
    this.chord([523, 659, 784, 1047], 0.09, 0.3, 0.12);
  }
  victory() {
    if (!this.ctx || this.muted) return;
    this.chord([523, 523, 523, 659, 784, 659, 784, 1047], 0.14, 0.35, 0.13);
  }
  defeat() {
    if (!this.ctx || this.muted) return;
    this.chord([392, 370, 349, 262], 0.25, 0.5, 0.12, 'triangle');
  }
  // ---- Hidden Troopers
  /** countdown beep before an elimination (higher on the last seconds) */
  beep(urgent = false) {
    if (!this.ctx || this.muted) return;
    this.tone('square', urgent ? 1180 : 880, urgent ? 1180 : 880, 0.09, 0.12);
  }
  /** a small toy cap-pistol crack */
  pistol(dist = 0) {
    if (!this.ok('pistol', 0.05)) return;
    const v = 1 / (1 + dist * 0.04);
    this.burst(0.12, 0.8 * v, 'highpass', 1800, 900);
    this.tone('square', 900, 180, 0.07, 0.25 * v);
  }
  /** the quiet "got it" pop when a steal completes */
  steal() {
    if (!this.ctx || this.muted) return;
    this.chord([659, 988], 0.07, 0.18, 0.1);
  }
  /** soft rising tick while holding a steal */
  stealTick(k: number) {
    if (!this.ok('stealtick', 0.2)) return;
    this.tone('sine', 500 + k * 500, 520 + k * 500, 0.04, 0.05);
  }
  eliminated() {
    if (!this.ctx || this.muted) return;
    this.chord([523, 392, 311], 0.16, 0.35, 0.12, 'triangle');
    this.burst(0.4, 0.15, 'lowpass', 900, 120);
  }
  bossRoar() {
    if (!this.ctx || this.muted) return;
    this.windup();
    this.tone('sawtooth', 90, 45, 1.2, 0.35, 0.6);
    this.tone('square', 135, 60, 1.2, 0.12, 0.6);
    this.burst(1.0, 0.3, 'lowpass', 800, 100, 0.6);
  }
}

export const audio = new Audio();
