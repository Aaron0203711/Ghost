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

export function speedFor(role, running) {
  if (role === ROLE.HUNTER) return RULES.HUNTER_SPEED;
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
