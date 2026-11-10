// 백엔드와 프론트엔드가 함께 사용하는 게임 규칙 상수.
// 속도 단위: m/s (km/h ÷ 3.6)

const kmh = (v) => v / 3.6;

export const RULES = Object.freeze({
  // 이동
  SURVIVOR_WALK_SPEED: kmh(16), // 4.44 m/s
  SURVIVOR_RUN_SPEED: kmh(23), // 6.39 m/s
  HUNTER_SPEED: kmh(20), // 5.56 m/s
  PLAYER_RADIUS: 0.35,
  EYE_HEIGHT: 1.6,

  // 스태미나 (초 단위)
  STAMINA_MAX: 10, // 10초 동안 달릴 수 있음
  STAMINA_REGEN_DELAY: 1, // 달리기를 멈추고 1초 뒤부터 회복
  STAMINA_FULL_REGEN_TIME: 15, // 0 → 가득 15초

  // 술래 덫
  TRAP_MAX_CHARGES: 3,
  TRAP_COOLDOWN: 30, // 30초마다 1개 충전
  TRAP_STUN: 3, // 밟으면 3초 이동 불가
  TRAP_TRIGGER_RADIUS: 0.7,
  TRAP_VISIBLE_RANGE: 4, // 생존자에게 보이는 거리

  // 술래 방망이
  ATTACK_COOLDOWN: 1,
  ATTACK_RANGE: 2.0,
  ATTACK_HALF_ANGLE: (55 * Math.PI) / 180,
  HITS_TO_CATCH: 3, // 4명 이하일 때 (5명 이상이면 matchRules 참고)
  HIT_INVULNERABLE: 2,

  // 제한 시간: 7분 안에 아무도 탈출하지 못하면 술래 승리
  MATCH_TIME: 7 * 60,

  // 발전기 / 탈출
  GENERATOR_COUNT: 3, // 4명 이하일 때 (5명 이상이면 matchRules 참고)
  GENERATOR_REPAIR_TIME: 10, // 혼자서 10초. 여럿이면 합산되어 빨라짐
  GENERATOR_INTERACT_RANGE: 1.9,
  EXIT_RADIUS: 2.4,

  // 방
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 5,

  // 네트워크
  TICK_RATE: 20,
  INPUT_RATE: 20,
});

export const ROLE = Object.freeze({ HUNTER: 'hunter', SURVIVOR: 'survivor' });

export const STATUS = Object.freeze({
  ALIVE: 'alive',
  CAUGHT: 'caught',
  ESCAPED: 'escaped',
});

/** 스태미나 1틱 갱신. 서버와 클라이언트 예측이 같은 계산을 쓴다. */
export function stepStamina(s, wantsRun, moving, dt) {
  const running = wantsRun && moving && s.stamina > 0;
  if (running) {
    s.stamina = Math.max(0, s.stamina - dt);
    s.regenWait = RULES.STAMINA_REGEN_DELAY;
  } else if (s.regenWait > 0) {
    s.regenWait = Math.max(0, s.regenWait - dt);
  } else {
    s.stamina = Math.min(
      RULES.STAMINA_MAX,
      s.stamina + (RULES.STAMINA_MAX / RULES.STAMINA_FULL_REGEN_TIME) * dt,
    );
  }
  return running;
}

/** aiming: 저격수가 조준 중이면 절반 속도 */
export function speedFor(role, running, aiming = false) {
  if (role === ROLE.HUNTER) return aiming ? RULES.HUNTER_SPEED * SNIPER.AIM_SPEED_FACTOR : RULES.HUNTER_SPEED;
  return running ? RULES.SURVIVOR_RUN_SPEED : RULES.SURVIVOR_WALK_SPEED;
}

/** 5명 이상(술래 포함)이면 발전기 5개(모두 켜야 탈출구가 열림), 생존자 체력 2칸 */
export const LARGE_MATCH = Object.freeze({ PLAYERS: 5, GENERATORS: 5, HITS_TO_CATCH: 2 });

/** 인원 수에 따라 달라지는 한 판의 규칙 */
export function matchRules(playerCount) {
  const large = playerCount >= LARGE_MATCH.PLAYERS;
  return {
    generators: large ? LARGE_MATCH.GENERATORS : RULES.GENERATOR_COUNT,
    hitsToCatch: large ? LARGE_MATCH.HITS_TO_CATCH : RULES.HITS_TO_CATCH,
  };
}

// ───────────── 술래 직업 ─────────────

export const HUNTER_CLASS = Object.freeze({ MANIAC: 'maniac', SNIPER: 'sniper' });

/** 시작 시 술래가 직업을 고르는 시간(초). 못 고르면 무작위 */
export const CLASS_PICK_TIME = 15;

/** 저격수: 저격총(거리 무제한, 날아가는 시간 있음), 조준 키(확대), 덫 없음 */
export const SNIPER = Object.freeze({
  SHOT_COOLDOWN: 3,
  BULLET_SPEED: 150, // m/s
  FAR_DISTANCE: 30, // 이 거리(m) 밖에서 맞히면 2칸
  NEAR_DAMAGE: 1,
  FAR_DAMAGE: 2,
  AIM_SPEED_FACTOR: 0.5, // 조준 중 이동 속도 배율 (20km/h → 10km/h)
  AIM_FOV: 24, // 조준 시 시야각(확대)
  HIT_RADIUS: 0.45, // 총알이 생존자에게 맞는 판정 반경
  BODY_HEIGHT: 1.85,
});

export const CLASS_INFO = Object.freeze({
  maniac: { name: '미치광이', icon: '👹', desc: '방망이 근접 공격 (쿨타임 1초) · 덫 3개' },
  sniper: { name: '저격수', icon: '🎯', desc: '저격총 원거리 공격 (쿨타임 3초) · 조준 확대 · 30m 밖 명중 시 2칸' },
});

/** 총알 방향 (yaw=0, pitch=0이면 -z) */
export function aimDirection(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}
