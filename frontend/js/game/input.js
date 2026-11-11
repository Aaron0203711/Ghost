// 입력: 모바일 멀티터치(조이스틱 + 버튼 + 시점 회전 동시 입력)와 PC 키보드/마우스.
//
// 모든 터치를 화면 전체를 덮는 레이어 하나에서 pointerId별로 추적한다.
// 손가락마다 "조이스틱 / 버튼 / 시점" 역할을 따로 배정하므로
// 조이스틱으로 이동하는 중에도 공격·덫·달리기 버튼이 그대로 눌린다.

const TOUCH_LOOK = 0.0055;
const MOUSE_LOOK = 0.0022;

export class Controls {
  /**
   * @param {HTMLElement} layer 터치를 받을 전체 화면 요소
   * @param {{joy:HTMLElement, knob:HTMLElement, buttons:Record<string,HTMLElement>, canvas:HTMLElement}} els
   * @param {()=>number} getSensitivity
   */
  constructor(layer, els, getSensitivity) {
    this.layer = layer;
    this.els = els;
    this.getSensitivity = getSensitivity;
    this.move = { x: 0, y: 0 };
    this.look = { dx: 0, dy: 0 };
    this.held = {}; // 버튼 이름 -> 누르고 있는지
    this.pointers = new Map(); // pointerId -> { kind, name?, lastX, lastY }
    this.joyPointer = null;
    this.keys = new Set();
    this.mouseHeld = {};
    this.handlers = {}; // 버튼 이름 -> 눌렀을 때 콜백
    this.enabled = true;
    this.joyRadius = 60;
    this.listeners = [];

    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.listeners.push([target, type, fn, opts]);
    };

    on(layer, 'pointerdown', (e) => this.onDown(e), { passive: false });
    on(window, 'pointermove', (e) => this.onMove(e), { passive: false });
    on(window, 'pointerup', (e) => this.onUp(e));
    on(window, 'pointercancel', (e) => this.onUp(e));
    on(layer, 'contextmenu', (e) => e.preventDefault());
    on(layer, 'touchstart', (e) => {
      if (!e.target.closest('[data-ui]')) e.preventDefault();
    }, { passive: false });

    on(window, 'keydown', (e) => this.onKey(e, true));
    on(window, 'keyup', (e) => this.onKey(e, false));
    on(window, 'blur', () => this.releaseAll());
    on(document, 'mousemove', (e) => {
      if (document.pointerLockElement !== this.els.canvas) return;
      const s = MOUSE_LOOK * this.getSensitivity();
      this.look.dx += e.movementX * s;
      this.look.dy += e.movementY * s;
    });
    on(document, 'pointerlockchange', () => {
      if (document.pointerLockElement !== this.els.canvas) this.mouseHeld = {};
    });
  }

  /** 버튼이 눌렸을 때(손가락이 닿는 순간) 실행할 동작 */
  onPress(name, fn) {
    this.handlers[name] = fn;
  }

  isHeld(name) {
    return !!this.held[name] || !!this.mouseHeld[name] || this.keyHeld(name);
  }

  keyHeld(name) {
    const k = this.keys;
    // action: 달리기(생존자) / 덫(술래), main: 상호작용(생존자) / 공격(술래)
    if (name === 'action') return k.has('ShiftLeft') || k.has('ShiftRight');
    if (name === 'main') return k.has('KeyE') || k.has('KeyF');
    return false;
  }

  press(name) {
    this.handlers[name]?.();
  }

  buttonAt(x, y) {
    for (const [name, el] of Object.entries(this.els.buttons)) {
      if (!el || el.offsetParent === null || el.classList.contains('hidden')) continue;
      const r = el.getBoundingClientRect();
      const pad = 10;
      if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return name;
    }
    return null;
  }

  onDown(e) {
    if (!this.enabled) return;
    if (e.target.closest('[data-ui]')) return; // 설정 버튼 등 일반 UI
    if (e.pointerType === 'mouse') {
      this.onMouseDown(e);
      return;
    }
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    const btn = this.buttonAt(x, y);
    if (btn) {
      this.pointers.set(e.pointerId, { kind: 'button', name: btn, lastX: x, lastY: y });
      this.held[btn] = true;
      this.els.buttons[btn].classList.add('pressed');
      this.press(btn);
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.joyPointer === null && x < w * 0.45 && y > h * 0.3) {
      this.joyPointer = e.pointerId;
      this.pointers.set(e.pointerId, { kind: 'joy' });
      // 조이스틱은 왼쪽 아래 구역 안에서 손가락이 닿은 곳으로 옮겨진다
      const base = this.els.joy;
      const r = base.getBoundingClientRect();
      const cx = Math.max(r.width / 2 + 8, Math.min(x, w * 0.45));
      const cy = Math.max(h * 0.3, Math.min(y, h - r.height / 2 - 8));
      base.style.left = `${cx - r.width / 2}px`;
      base.style.top = `${cy - r.height / 2}px`;
      base.style.bottom = 'auto';
      base.classList.add('active');
      this.joyCenter = { x: cx, y: cy };
      this.joyRadius = r.width / 2;
      this.updateJoy(x, y);
      return;
    }
    this.pointers.set(e.pointerId, { kind: 'look', lastX: x, lastY: y });
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'joy') {
      this.updateJoy(e.clientX, e.clientY);
      return;
    }
    // 시점 손가락, 그리고 버튼을 누른 채 미는 손가락도 화면을 돌린다
    const s = TOUCH_LOOK * this.getSensitivity();
    this.look.dx += (e.clientX - p.lastX) * s;
    this.look.dy += (e.clientY - p.lastY) * s;
    p.lastX = e.clientX;
    p.lastY = e.clientY;
  }

  onUp(e) {
    if (e.pointerType === 'mouse') {
      const name = e.button === 2 ? 'action' : 'main';
      this.mouseHeld[name] = false;
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.kind === 'joy') this.resetJoy();
    else if (p.kind === 'button') {
      // 같은 버튼을 다른 손가락이 아직 누르고 있으면 유지
      const still = [...this.pointers.values()].some((q) => q.kind === 'button' && q.name === p.name);
      if (!still) {
        this.held[p.name] = false;
        this.els.buttons[p.name]?.classList.remove('pressed');
      }
    }
  }

  updateJoy(x, y) {
    let dx = x - this.joyCenter.x;
    let dy = y - this.joyCenter.y;
    const r = this.joyRadius;
    const d = Math.hypot(dx, dy);
    if (d > r) {
      dx = (dx / d) * r;
      dy = (dy / d) * r;
    }
    this.els.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / r;
    const ny = -dy / r;
    const mag = Math.hypot(nx, ny);
    if (mag < 0.18) this.move = { x: 0, y: 0 };
    else this.move = { x: nx / mag, y: ny / mag };
  }

  resetJoy() {
    this.joyPointer = null;
    this.move = { x: 0, y: 0 };
    this.els.knob.style.transform = 'translate(0px, 0px)';
    const base = this.els.joy;
    base.classList.remove('active');
    base.style.left = '';
    base.style.top = '';
    base.style.bottom = '';
  }

  onMouseDown(e) {
    const canvas = this.els.canvas;
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
      return;
    }
    const name = e.button === 2 ? 'action' : 'main';
    this.mouseHeld[name] = true;
    this.press(name);
  }

  onKey(e, down) {
    if (!this.enabled) return;
    if (e.target instanceof HTMLInputElement) return;
    const code = e.code;
    if (down) {
      if (this.keys.has(code)) return;
      this.keys.add(code);
      if (code === 'KeyQ') this.press('action');
      if (code === 'Space') {
        e.preventDefault();
        this.press('jump'); // 스페이스바 = 점프
      }
      if (code === 'KeyE' || code === 'KeyF') this.press('main');
    } else {
      this.keys.delete(code);
    }
  }

  /** 이번 프레임의 이동 벡터 (x: 오른쪽, y: 앞) */
  moveVector() {
    if (this.move.x || this.move.y) return this.move;
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    const m = Math.hypot(x, y);
    return m ? { x: x / m, y: y / m } : { x: 0, y: 0 };
  }

  consumeLook() {
    const l = this.look;
    this.look = { dx: 0, dy: 0 };
    return l;
  }

  releaseAll() {
    this.keys.clear();
    this.mouseHeld = {};
    for (const [name, el] of Object.entries(this.els.buttons)) {
      this.held[name] = false;
      el?.classList.remove('pressed');
    }
    this.pointers.clear();
    this.resetJoy();
  }

  dispose() {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners = [];
    if (document.pointerLockElement) document.exitPointerLock?.();
  }
}
