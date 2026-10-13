// One input layer for the whole station. Keyboard, mouse (pointer lock) and
// gamepad are read here and nowhere else; the engine hands this to exactly
// one active mode per frame, so two modes can never act on the same input.
// When a DOM overlay owns the keyboard (the workstation desktop), the layer
// is suspended and clears its state, so nothing leaks back into the 3D world.

export interface PadState { axes: number[]; buttons: boolean[]; connected: boolean }

// Standard gamepad mapping.
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

export class Input {
  private keys = new Set<string>();
  private hits = new Set<string>();
  private padHits = new Set<number>();
  private padPrev: boolean[] = [];
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  buttons = 0;
  private clicks = 0;
  pad: PadState = { axes: [0, 0, 0, 0], buttons: [], connected: false };
  suspended = false;
  /** Pointer lock was refused (embedded frames, some browsers): look by dragging instead. */
  lockFailed = false;
  private el: HTMLElement;
  private dragging = false;
  private off: (() => void)[] = [];

  constructor(el: HTMLElement) {
    this.el = el;
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, target: Window | HTMLElement = window) => {
      target.addEventListener(t, f as EventListener);
      this.off.push(() => target.removeEventListener(t, f as EventListener));
    };
    on('keydown', (e) => {
      if (this.suspended || (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return;
      if (!this.keys.has(e.code)) this.hits.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    on('keyup', (e) => { this.keys.delete(e.code); });
    on('blur', () => this.reset());
    on('mousemove', (e) => {
      if (this.suspended) return;
      const locked = document.pointerLockElement === this.el;
      // Without pointer lock, a held left button turns mouse motion into look.
      if (!locked && !(this.dragging && (e.buttons & 1))) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    on('mousedown', (e) => {
      if (this.suspended) return;
      if (document.pointerLockElement === this.el) { this.buttons |= 1 << e.button; this.clicks |= 1 << e.button; }
      else if (e.target === this.el) { this.dragging = true; if (e.button === 2) this.clicks |= 4; }
    });
    on('mouseup', () => { this.dragging = false; });
    on('contextmenu', (e) => { if (e.target === this.el) e.preventDefault(); }, el);
    on('mouseup', (e) => { this.buttons &= ~(1 << e.button); });
    on('wheel', (e) => { if (!this.suspended) this.wheel += Math.sign(e.deltaY); }, el);
  }

  /** Held this frame. */
  down(...codes: string[]) { return codes.some((c) => this.keys.has(c)); }
  /** Pressed since the last frame. */
  hit(...codes: string[]) { return codes.some((c) => this.hits.has(c)); }
  clicked(button = 0) { return (this.clicks & (1 << button)) !== 0; }
  held(button = 0) { return (this.buttons & (1 << button)) !== 0; }
  padDown(b: number) { return !!this.pad.buttons[b]; }
  padHit(b: number) { return this.padHits.has(b); }
  /** Stick axis with a dead zone. */
  axis(i: number) { const v = this.pad.axes[i] ?? 0; return Math.abs(v) < 0.15 ? 0 : v; }

  get locked() { return document.pointerLockElement === this.el; }
  lock() {
    if (this.suspended || this.locked || this.lockFailed) return;
    try {
      const p = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
      p?.catch?.(() => { this.lockFailed = true; });
    } catch { this.lockFailed = true; }
  }
  unlock() { if (this.locked) document.exitPointerLock(); }

  /** Read the gamepad; call once at the start of each frame. */
  poll() {
    const gp = navigator.getGamepads?.().find((g) => g && g.connected) ?? null;
    if (!gp || this.suspended) { this.pad = { axes: [0, 0, 0, 0], buttons: [], connected: !!gp }; this.padPrev = []; return; }
    const buttons = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    buttons.forEach((b, i) => { if (b && !this.padPrev[i]) this.padHits.add(i); });
    this.padPrev = buttons;
    this.pad = { axes: [...gp.axes], buttons, connected: true };
  }

  /** Clear per-frame state; call at the end of each frame. */
  endFrame() {
    this.hits.clear();
    this.padHits.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this.clicks = 0;
  }

  reset() {
    this.keys.clear(); this.hits.clear(); this.padHits.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; this.buttons = 0; this.clicks = 0;
  }

  /** Hand the keyboard to a DOM overlay (or take it back). */
  suspend(on: boolean) {
    this.suspended = on;
    this.reset();
    if (on) this.unlock();
  }

  dispose() { this.off.forEach((f) => f()); this.unlock(); }
}
