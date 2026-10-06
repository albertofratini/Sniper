import { Input } from './Input';

/** Floating left joystick, right-side look pad and thumb buttons. */
export class MobileControls {
  private root = document.getElementById('touch')!;
  private base = document.getElementById('stick-base')!;
  private knob = document.getElementById('stick-knob')!;
  private moveId: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private looks = new Map<number, { x: number; y: number }>();
  private radius = 56;

  constructor(private input: Input) {
    const moveZone = document.getElementById('move-zone')!;
    const lookZone = document.getElementById('look-zone')!;

    moveZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.moveId !== null) return;
      this.moveId = e.pointerId;
      moveZone.setPointerCapture(e.pointerId);
      this.moveOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
    });
    const moveEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.moveId) return;
      this.moveId = null;
      this.input.setTouchMove(0, 0, false);
      this.knob.style.transform = '';
      this.base.classList.remove('active');
      this.base.style.left = '';
      this.base.style.top = '';
    };
    moveZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.moveId) return;
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY);
    });
    moveZone.addEventListener('pointerup', moveEnd);
    moveZone.addEventListener('pointercancel', moveEnd);

    const lookStart = (e: PointerEvent, el: HTMLElement) => {
      el.setPointerCapture(e.pointerId);
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const lookMove = (e: PointerEvent) => {
      const p = this.looks.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      // use coalesced events for smoother look on iOS/Android
      const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const list = evs.length ? evs : [e];
      for (const ev of list) {
        this.input.addTouchLook(ev.clientX - p.x, ev.clientY - p.y);
        p.x = ev.clientX;
        p.y = ev.clientY;
      }
    };
    const lookEnd = (e: PointerEvent) => {
      this.looks.delete(e.pointerId);
    };
    lookZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      lookStart(e, lookZone);
    });
    lookZone.addEventListener('pointermove', lookMove);
    lookZone.addEventListener('pointerup', lookEnd);
    lookZone.addEventListener('pointercancel', lookEnd);

    // buttons
    this.root.querySelectorAll<HTMLElement>('.tbtn').forEach((btn) => {
      const act = btn.dataset.act!;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('pressed');
        if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* */ }
        switch (act) {
          case 'fire':
            this.input.setTouchFire(true);
            lookStart(e, btn); // drag on FIRE also aims
            break;
          case 'aim':
            this.input.setTouchAim(true);
            lookStart(e, btn); // drag on AIM also looks
            break;
          case 'frag': this.input.throwFrag = true; break;
          case 'flash': this.input.throwFlash = true; break;
          case 'jump': this.input.jump = true; break;
          case 'reload': this.input.reload = true; break;
          case 'steal': this.input.touchSteal = true; break;
          case 'swap': this.input.swap = 1; break;
        }
      });
      const up = (e: PointerEvent) => {
        btn.classList.remove('pressed');
        if (act === 'fire') {
          this.input.setTouchFire(false);
          lookEnd(e);
        }
        if (act === 'aim') {
          this.input.setTouchAim(false);
          lookEnd(e);
        }
        if (act === 'steal') this.input.touchSteal = false;
      };
      if (act === 'fire' || act === 'aim') btn.addEventListener('pointermove', lookMove);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
    });

    // block iOS gestures / double-tap zoom
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => {
      if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
    }, { passive: false });
    let lastTouch = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTouch < 350 && (e.target as HTMLElement).closest('#touch')) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
  }

  private updateStick(x: number, y: number) {
    let dx = x - this.moveOrigin.x;
    let dy = y - this.moveOrigin.y;
    const l = Math.hypot(dx, dy);
    const max = this.radius;
    // drag the origin along if the thumb goes far, so the stick never "sticks"
    if (l > max * 1.6) {
      const k = (l - max * 1.6) / l;
      this.moveOrigin.x += dx * k;
      this.moveOrigin.y += dy * k;
      this.base.style.left = `${this.moveOrigin.x}px`;
      this.base.style.top = `${this.moveOrigin.y}px`;
      dx = x - this.moveOrigin.x;
      dy = y - this.moveOrigin.y;
    }
    const cl = Math.min(max, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    const kx = Math.cos(a) * cl, ky = Math.sin(a) * cl;
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
    let nx = kx / max, ny = -ky / max;
    // small dead zone
    const m = Math.hypot(nx, ny);
    if (m < 0.12) { nx = 0; ny = 0; }
    this.input.setTouchMove(nx, ny, true);
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
    if (!v) {
      this.looks.clear();
      this.moveId = null;
      this.input.setTouchMove(0, 0, false);
      this.input.setTouchFire(false);
      this.input.touchSteal = false;
      this.root.querySelectorAll('.tbtn').forEach((b) => b.classList.remove('pressed'));
    }
  }
}
