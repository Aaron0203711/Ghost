// 자이로스코프 시점 조작 (태블릿/휴대폰 전용).
// 기기의 회전 속도(devicemotion.rotationRate, 초당 각도)를 화면 기준 좌우/상하 회전으로 바꿔 더한다.
// 감도 1.0이면 기기를 돌린 각도만큼 화면도 똑같이 돈다.

const DEG = Math.PI / 180;
const DEADZONE = 0.6; // 초당 각도: 손떨림 수준의 작은 흔들림은 무시
const BASE_SIGN = -1; // 기본 반전

/** 자이로를 쓸 기기인가: 터치가 주 입력인 기기(패드, 휴대폰)만. 노트북은 제외 */
export function isGyroDevice() {
  return matchMedia('(pointer: coarse)').matches && 'DeviceMotionEvent' in window;
}

/** 자이로는 HTTPS(또는 localhost)에서만 브라우저가 허용한다 */
export function gyroBlockedByInsecure() {
  return !window.isSecureContext;
}

let permission = 'unknown'; // unknown | granted | denied

/**
 * iOS/iPadOS는 사용자가 버튼을 누른 순간에만 권한을 물을 수 있다.
 * 버튼을 누를 때마다 불러도 되며, 이미 결정됐으면 아무것도 하지 않는다.
 */
export async function requestGyroPermission() {
  if (!isGyroDevice() || permission !== 'unknown') return permission;
  const DME = window.DeviceMotionEvent;
  if (typeof DME?.requestPermission !== 'function') {
    permission = 'granted'; // 안드로이드: 별도 권한 창 없음
    return permission;
  }
  try {
    const res = await DME.requestPermission();
    // 'prompt'(아직 결정 안 됨)는 다음 버튼 탭에서 다시 묻는다
    if (res === 'granted' || res === 'denied') permission = res;
  } catch {
    // 사용자 동작 밖에서 호출되면 예외: 다음 버튼 탭에서 다시 시도
  }
  return permission;
}

export function gyroPermission() {
  return permission;
}

/** 화면 방향(0/90/180/270)에 따라 기기 축 회전 속도를 화면 기준 (좌우, 상하)로 바꾼다 */
export function screenRates(rate, angle) {
  const a = rate.alpha || 0; // 화면에 수직인 축 (사용 안 함)
  void a;
  const b = rate.beta || 0; // 기기 x축(세로 화면의 오른쪽)
  const g = rate.gamma || 0; // 기기 y축(세로 화면의 위쪽)
  switch (((angle % 360) + 360) % 360) {
    case 90: // 가로 (위쪽이 왼편)
      return { yaw: b, pitch: -g };
    case 270: // 가로 (위쪽이 오른편)
      return { yaw: -b, pitch: g };
    case 180:
      return { yaw: -g, pitch: -b };
    default: // 세로
      return { yaw: g, pitch: b };
  }
}

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}

export class Gyro {
  /** @param {()=>{enabled:boolean, sensitivity:number, invertX?:boolean, invertY?:boolean}} getSettings */
  constructor(getSettings) {
    this.getSettings = getSettings;
    this.yaw = 0;
    this.pitch = 0;
    this.last = 0;
    this.paused = false;
    this.receiving = false;
    this.onMotion = (e) => this.handle(e);
    if (isGyroDevice()) window.addEventListener('devicemotion', this.onMotion);
  }

  handle(e) {
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const rate = e.rotationRate;
    if (!rate || rate.beta == null) return;
    this.receiving = true;
    const s = this.getSettings();
    if (!s.enabled || this.paused || dt === 0) return;
    const r = screenRates(rate, screenAngle());
    const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : v);
    // 기본 방향: 좌우·상하 모두 반전 (실제 기기에서 반대로 돈다는 피드백 반영)
    // 설정의 좌우/상하 반전을 켜면 그 축을 한 번 더 뒤집는다
    const sx = BASE_SIGN * (s.invertX ? -1 : 1);
    const sy = BASE_SIGN * (s.invertY ? -1 : 1);
    this.yaw += sx * dz(r.yaw) * DEG * dt * s.sensitivity;
    this.pitch += sy * dz(r.pitch) * DEG * dt * s.sensitivity;
  }

  /** 마지막으로 꺼낸 뒤 쌓인 회전량 (라디안). 좌우: +면 왼쪽으로, 상하: +면 위로 */
  consume() {
    const out = { yaw: this.yaw, pitch: this.pitch };
    this.yaw = 0;
    this.pitch = 0;
    return out;
  }

  dispose() {
    window.removeEventListener('devicemotion', this.onMotion);
  }
}
