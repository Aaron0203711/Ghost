// 사용자 설정 (화면 감도 등). 브라우저에 저장된다.
const KEY = 'ghost.settings.v1';
// gyro: 자이로스코프 조준(패드/휴대폰에서만 동작), gyroSensitivity: 1.0 = 기기를 돌린 만큼 화면도 회전
const DEFAULTS = { sensitivity: 1.0, sound: true, name: '', gyro: true, gyroSensitivity: 1.0 };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export function saveSettings(patch) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* 저장 불가 환경(사생활 보호 모드 등)에서는 이번 세션 동안만 유지 */
  }
}

export const SENS_MIN = 0.2;
export const SENS_MAX = 3.0;
