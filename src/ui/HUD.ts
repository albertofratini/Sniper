const $ = (id: string) => document.getElementById(id)!;

/** DOM HUD. Every setter only touches the DOM when the value changes. */
export class HUD {
  private el = {
    hud: $('hud'),
    wave: $('wave-num'),
    waveLabel: $('wave-label'),
    waveFill: $('wave-bar-fill'),
    enemies: $('enemy-count'),
    score: $('score'),
    hpFill: $('health-fill'),
    hpLag: $('health-lag'),
    hpNum: $('health-num'),
    wName: $('weapon-name'),
    mag: $('ammo-mag'),
    res: $('ammo-res'),
    slots: Array.from(document.querySelectorAll<HTMLElement>('#weapon-slots span')),
    reload: $('reload-hint'),
    cross: $('crosshair'),
    hit: $('hitmarker'),
    banner: $('banner'),
    toast: $('toast'),
    vignette: $('damage-vignette'),
    dirs: $('hit-dirs'),
  };
  private cache = new Map<string, string | number | boolean>();
  private bannerTimer = 0;
  private toastTimer = 0;
  private bossBar: HTMLDivElement | null = null;

  private set(key: string, v: string | number | boolean, fn: () => void) {
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    fn();
  }

  show(v: boolean) {
    this.el.hud.classList.toggle('hidden', !v);
  }

  wave(i: number, total: number, label?: string) {
    this.set('wave', `${i}/${total}/${label}`, () => {
      if (label) this.el.waveLabel.innerHTML = label;
      else this.el.waveLabel.innerHTML = `WAVE <b id="wave-num">${i}</b> / ${total}`;
    });
  }

  waveProgress(f: number) {
    const v = Math.round(f * 100);
    this.set('wp', v, () => (this.el.waveFill.style.width = `${v}%`));
  }

  enemies(n: number) {
    this.set('en', n, () => (this.el.enemies.textContent = String(n)));
  }

  score(n: number) {
    this.set('sc', n, () => (this.el.score.textContent = String(n)));
  }

  health(hp: number, max: number) {
    const v = Math.ceil(hp);
    this.set('hp', v, () => {
      const pct = `${(Math.max(0, hp) / max) * 100}%`;
      this.el.hpFill.style.width = pct;
      this.el.hpLag.style.width = pct;
      this.el.hpNum.textContent = String(v);
      this.el.hpFill.classList.toggle('low', hp < 35);
    });
  }

  weapon(index: number, name: string, mag: number, reserve: number, reloading: boolean) {
    this.set('wn', name, () => (this.el.wName.textContent = name));
    this.set('mag', mag, () => {
      this.el.mag.textContent = String(mag);
      this.el.mag.classList.toggle('empty', mag === 0);
    });
    const res = reserve === Infinity ? '/ ∞' : `/ ${reserve}`;
    this.set('res', res, () => (this.el.res.textContent = res));
    this.set('slot', index, () => this.el.slots.forEach((s, i) => s.classList.toggle('active', i === index)));
    this.set('rl', reloading, () => this.el.reload.classList.toggle('hidden', !reloading));
  }

  crosshair(spread: number, onTarget: boolean) {
    const g = Math.round(6 + spread);
    this.set('cg', g, () => this.el.cross.style.setProperty('--gap', `${g}px`));
    this.set('ct', onTarget, () => this.el.cross.classList.toggle('on-target', onTarget));
  }

  hitmarker(kill: boolean) {
    const h = this.el.hit;
    h.classList.remove('show', 'kill');
    void h.offsetWidth;
    h.classList.add('show');
    if (kill) h.classList.add('kill');
  }

  banner(text: string, sub = '', dur = 2.4) {
    this.el.banner.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.el.banner.classList.add('show');
    this.bannerTimer = dur;
  }

  toast(text: string, dur = 1.6) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = dur;
  }

  damage(flash: number) {
    const v = Math.round(flash * 100) / 100;
    this.set('dmg', v, () => (this.el.vignette.style.opacity = String(Math.min(1, v))));
  }

  /** angle: radians, 0 = in front, positive = to the right */
  hitDir(angle: number) {
    if (this.el.dirs.childElementCount >= 3) this.el.dirs.firstElementChild?.remove();
    const d = document.createElement('div');
    d.className = 'hit-dir';
    d.style.transform = `rotate(${angle}rad)`;
    this.el.dirs.appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  boss(frac: number | null) {
    if (frac === null) {
      if (this.bossBar) {
        this.bossBar.remove();
        this.bossBar = null;
      }
      return;
    }
    if (!this.bossBar) {
      const b = document.createElement('div');
      b.style.cssText = 'position:absolute;top:calc(64px + var(--sat));left:50%;transform:translateX(-50%);width:min(420px,60vw);text-align:center;font-family:var(--display);font-size:16px;letter-spacing:2px;color:#ffcf33;text-shadow:0 2px 0 rgba(0,0,0,.5)';
      b.innerHTML = 'THE WIND-UP KING<div style="height:12px;margin-top:4px;border-radius:8px;background:rgba(0,0,0,.5);border:2px solid #fff;overflow:hidden"><div class="bf" style="height:100%;width:100%;background:linear-gradient(90deg,#ff4d3d,#ffcf33);transition:width .2s"></div></div>';
      this.el.hud.appendChild(b);
      this.bossBar = b;
    }
    const f = Math.round(frac * 200) / 2;
    this.set('boss', f, () => ((this.bossBar!.querySelector('.bf') as HTMLElement).style.width = `${f}%`));
  }

  update(dt: number) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }

  reset() {
    this.cache.clear();
    this.boss(null);
    this.el.banner.classList.remove('show');
    this.el.dirs.innerHTML = '';
  }
}
