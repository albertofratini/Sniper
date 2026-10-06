/** Unified input state for keyboard/mouse and touch. */
export class Input {
  moveX = 0;
  moveY = 0;
  lookDX = 0;
  lookDY = 0;
  fire = false;
  sprint = false;
  crouch = false;
  jump = false;
  reload = false;
  melee = false;
  swap = 0; // +1 / -1 cycle requests
  slot = -1;
  isTouch = false;
  sensitivity = 1;
  /** extra look multiplier (lowered while scoped) */
  lookScale = 1;
  enabled = false;
  /** aim-down-sights held */
  aim = false;
  /** one-shot: ADS button released (mobile sniper fires on release) */
  aimRelease = false;
  throwFrag = false;
  throwFlash = false;
  /** held: steal (Hidden Troopers) */
  steal = false;
  touchSteal = false;
  private mouseAim = false;
  private touchAim = false;

  private keys = new Set<string>();
  private touchMove = { x: 0, y: 0, active: false };
  private touchSprint = false;
  private touchFire = false;
  private touchCrouch = false;

  onPauseRequest: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    // A desktop with a touch screen still gets mouse controls if it has a fine pointer.
    if (matchMedia('(pointer: fine)').matches && !matchMedia('(hover: none)').matches) this.isTouch = false;
    if (new URLSearchParams(location.search).has('touch')) this.isTouch = true;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Escape' || e.code === 'KeyP') return;
      this.keys.add(e.code);
      if (e.repeat) return;
      switch (e.code) {
        case 'Space': this.jump = true; e.preventDefault(); break;
        case 'KeyR': this.reload = true; break;
        case 'KeyF': case 'KeyV': this.melee = true; break;
        case 'Digit1': this.slot = 0; break;
        case 'Digit2': this.slot = 1; break;
        case 'Digit3': this.slot = 2; break;
        case 'Digit4': this.slot = 3; break;
        case 'Digit5': this.slot = 4; break;
        case 'KeyG': this.throwFrag = true; break;
        case 'KeyT': this.throwFlash = true; break;
        case 'KeyQ': this.swap = 1; break;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.enabled && !this.isTouch) this.onPauseRequest();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.fire = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.isTouch) return;
      if (document.pointerLockElement !== canvas) {
        this.lock();
        return;
      }
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.mouseAim = true;
      if (e.button === 1) this.melee = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.mouseAim = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== canvas) return;
      // ignore absurd spikes some browsers emit on lock
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.lookDX += e.movementX * 0.0027 * this.sensitivity * this.lookScale;
      this.lookDY += e.movementY * 0.0027 * this.sensitivity * this.lookScale;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.enabled || this.isTouch) return;
      this.swap = e.deltaY > 0 ? 1 : -1;
    }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  lock() {
    if (this.isTouch) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  get locked() {
    return document.pointerLockElement === this.canvas;
  }

  // ---- touch hooks (called by MobileControls)
  setTouchMove(x: number, y: number, active: boolean) {
    this.touchMove.x = x;
    this.touchMove.y = y;
    this.touchMove.active = active;
    this.touchSprint = active && Math.hypot(x, y) > 0.92 && y > 0.5;
  }
  addTouchLook(dx: number, dy: number) {
    this.lookDX += dx * 0.0066 * this.sensitivity * this.lookScale;
    this.lookDY += dy * 0.0066 * this.sensitivity * this.lookScale;
  }
  setTouchFire(v: boolean) {
    this.touchFire = v;
  }
  setTouchAim(v: boolean) {
    if (this.touchAim && !v) this.aimRelease = true;
    this.touchAim = v;
  }
  toggleCrouch() {
    this.touchCrouch = !this.touchCrouch;
  }

  /** Called once per frame before game update. */
  poll() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (this.touchMove.active) {
      x = this.touchMove.x;
      y = this.touchMove.y;
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.moveX = x;
    this.moveY = y;
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint;
    this.crouch = k.has('KeyC') || k.has('ControlLeft') || this.touchCrouch;
    if (this.isTouch) this.fire = this.touchFire;
    this.aim = this.mouseAim || this.touchAim;
    this.steal = k.has('KeyE') || this.touchSteal;
  }

  /** Clear one-shot actions after the frame consumed them. */
  endFrame() {
    this.lookDX = 0;
    this.lookDY = 0;
    this.jump = false;
    this.reload = false;
    this.melee = false;
    this.swap = 0;
    this.slot = -1;
    this.aimRelease = false;
    this.throwFrag = false;
    this.throwFlash = false;
  }

  reset() {
    this.keys.clear();
    this.fire = false;
    this.touchFire = false;
    this.touchCrouch = false;
    this.touchAim = false;
    this.mouseAim = false;
    this.touchSteal = false;
    this.steal = false;
    this.touchMove.active = false;
    this.endFrame();
  }
}
