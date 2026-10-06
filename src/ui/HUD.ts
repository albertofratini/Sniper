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

  enemies(n: number, label = 'ENEMIES') {
    this.set('en', n, () => (this.el.enemies.textContent = String(n)));
    this.set('enl', label, () => (this.el.enemies.previousElementSibling!.textContent = label));
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

  weapon(index: number, name: string, mag: number, reserve: number, reloading: boolean, owned?: boolean[], allowed?: number[] | null) {
    if (owned) {
      const key = owned.map((o, i) => (o && (!allowed || allowed.includes(i)) ? 1 : 0)).join('');
      this.set('owned', key, () => this.el.slots.forEach((sl, i) => sl.classList.toggle('hidden', key[i] !== '1')));
    }
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

  private overlay(id: string, css: string, html = '') {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = css;
      el.innerHTML = html;
      this.el.hud.appendChild(el);
    }
    return el;
  }

  flashbang(a: number) {
    const v = Math.round(a * 50) / 50;
    this.set('fb', v, () => {
      const el = this.overlay('flash-ov', 'position:absolute;inset:0;background:#fff;pointer-events:none;opacity:0;z-index:5');
      el.style.opacity = String(Math.min(1, v * 1.1));
    });
  }

  scope(on: boolean) {
    this.set('scope', on, () => {
      const el = this.overlay(
        'scope-ov',
        'position:absolute;inset:0;pointer-events:none;display:none;z-index:4;background:radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) min(38vh,38vw), #07060a calc(min(38vh,38vw) + 2px))',
        '<div style="position:absolute;left:50%;top:50%;width:min(76vh,76vw);height:min(76vh,76vw);transform:translate(-50%,-50%);border-radius:50%;box-shadow:inset 0 0 40px rgba(0,0,0,.6), 0 0 0 4px #111">' +
          '<div style="position:absolute;left:0;right:0;top:50%;height:2px;background:rgba(10,10,10,.85)"></div>' +
          '<div style="position:absolute;top:0;bottom:0;left:50%;width:2px;background:rgba(10,10,10,.85)"></div>' +
          '<div style="position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px;border-radius:50%;background:#ff3b30"></div></div>',
      );
      el.style.display = on ? 'block' : 'none';
      this.el.cross.style.visibility = on ? 'hidden' : 'visible';
    });
  }

  nades(frag: number, flash: number) {
    this.set('nades', `${frag}/${flash}`, () => {
      const el = this.overlay('nade-hud', 'display:flex;gap:8px;justify-content:flex-end;margin-top:6px;font-size:16px');
      if (!el.parentElement?.classList.contains('hud-bottomright')) document.querySelector('.hud-bottomright')!.appendChild(el);
      el.innerHTML = `<span style="opacity:${frag ? 1 : 0.35}">💣 ${frag}</span><span style="opacity:${flash ? 1 : 0.35}">✨ ${flash}</span>`;
      const fc = document.getElementById('frag-count');
      const lc = document.getElementById('flash-count');
      if (fc) fc.textContent = String(frag);
      if (lc) lc.textContent = String(flash);
      document.getElementById('btn-frag')?.classList.toggle('empty', frag === 0);
      document.getElementById('btn-flash')?.classList.toggle('empty', flash === 0);
    });
  }

  sniperButton(on: boolean) {
    this.set('snbtn', on, () => document.getElementById('btn-aim')?.classList.toggle('hidden', !on));
  }

  respawn(t: number) {
    const v = Math.ceil(t);
    this.set('resp', v, () => {
      const el = this.overlay('respawn-ov', 'position:absolute;left:0;right:0;top:46%;text-align:center;font-size:24px;color:#fff;text-shadow:0 3px 0 rgba(0,0,0,.5);display:none');
      el.style.display = v > 0 ? 'block' : 'none';
      el.textContent = `RESPAWNING IN ${v}`;
    });
  }

  killFeed(items: { killer: string; victim: string; weapon: string; t: number }[]) {
    // compact: a few small lines in the corner, never a big block over the action
    const el = this.overlay('killfeed', 'position:absolute;left:calc(12px + var(--sal));top:calc(104px + var(--sat));display:flex;flex-direction:column;align-items:flex-start;gap:2px;font-family:var(--body);font-weight:800;font-size:10px;line-height:1.25;opacity:.85;max-width:38vw');
    const esc = (x: string) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    el.innerHTML = items
      .slice(-3)
      .map((k) => `<div class="kf" style="background:rgba(20,12,30,.45);padding:1px 6px;border-radius:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${esc(k.killer)} <span style="color:#ffcf33;font-size:8px">${esc(k.weapon)}</span> ${esc(k.victim)}</div>`)
      .join('');
    clearTimeout(this.feedTimer);
    this.feedTimer = window.setTimeout(() => (el.innerHTML = ''), 6000);
  }
  private feedTimer = 0;

  reset() {
    this.cache.clear();
    this.boss(null);
    this.el.banner.classList.remove('show');
    this.el.dirs.innerHTML = '';
    for (const id of ['flash-ov', 'scope-ov', 'respawn-ov', 'killfeed']) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
    this.el.cross.style.visibility = 'visible';
  }
}
