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

  // 점프 (술래·생존자 공통). 담장·물건은 넘을 수 없고, 공중에서는 덫만 피한다
  JUMP_HEIGHT: 0.6,
  JUMP_TIME: 0.5, // 공중에 떠 있는 시간(초). 착지하면 바로 다시 뛸 수 있음
  JUMP_STAMINA: 1, // 생존자는 점프마다 스태미나 1초분 사용 (부족하면 점프 불가)

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
  MAX_PLAYERS: 8,

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

/**
 * aiming: 저격수 조준 중이면 절반 속도, invisible: 암살자 투명화 중이면 1.5배,
 * slowed: 암살자가 기습으로 투명화가 풀린 직후면 절반 속도
 */
export function speedFor(role, running, aiming = false, invisible = false, slowed = false) {
  if (role === ROLE.HUNTER) {
    if (aiming) return RULES.HUNTER_SPEED * SNIPER.AIM_SPEED_FACTOR;
    if (slowed) return RULES.HUNTER_SPEED * ASSASSIN.SLOW_FACTOR;
    if (invisible) return RULES.HUNTER_SPEED * ASSASSIN.INVIS_SPEED_FACTOR;
    return RULES.HUNTER_SPEED;
  }
  return running ? RULES.SURVIVOR_RUN_SPEED : RULES.SURVIVOR_WALK_SPEED;
}

/** 딱 5명(술래 포함)이면 발전기 5개(모두 켜야 탈출구가 열림), 생존자 체력 2칸 */
export const LARGE_MATCH = Object.freeze({ PLAYERS: 5, GENERATORS: 5, HITS_TO_CATCH: 2 });

/** 6명 이상이면 술래 2명, 발전기 3개, 생존자 체력 3칸 */
export const DUO_MATCH = Object.freeze({ PLAYERS: 6, HUNTERS: 2, GENERATORS: 3, HITS_TO_CATCH: 3 });

/** 인원 수에 따라 달라지는 한 판의 규칙 */
export function matchRules(playerCount) {
  if (playerCount >= DUO_MATCH.PLAYERS) {
    return { hunters: DUO_MATCH.HUNTERS, generators: DUO_MATCH.GENERATORS, hitsToCatch: DUO_MATCH.HITS_TO_CATCH };
  }
  if (playerCount === LARGE_MATCH.PLAYERS) {
    return { hunters: 1, generators: LARGE_MATCH.GENERATORS, hitsToCatch: LARGE_MATCH.HITS_TO_CATCH };
  }
  return { hunters: 1, generators: RULES.GENERATOR_COUNT, hitsToCatch: RULES.HITS_TO_CATCH };
}

// ───────────── 술래 직업 ─────────────

export const HUNTER_CLASS = Object.freeze({ MANIAC: 'maniac', SNIPER: 'sniper', ASSASSIN: 'assassin' });

/** 시작 시 술래가 직업을 고르는 시간(초). 못 고르면 무작위 */
export const CLASS_PICK_TIME = 15;

/** 저격수: 저격총(거리 무제한, 날아가는 시간 있음), 조준 키(확대), 덫 없음 */
export const SNIPER = Object.freeze({
  SHOT_COOLDOWN: 2,
  BULLET_SPEED: 150, // m/s
  FAR_DISTANCE: 30, // 이 거리(m) 밖에서 맞히면 2칸
  NEAR_DAMAGE: 1,
  FAR_DAMAGE: 2,
  AIM_SPEED_FACTOR: 0.5, // 조준 중 이동 속도 배율 (20km/h → 10km/h)
  AIM_FOV: 24, // 조준 시 시야각(확대)
  HIT_RADIUS: 0.45, // 총알이 생존자에게 맞는 판정 반경
  BODY_HEIGHT: 1.85,
});

/** 암살자: 쿠나이 근접 공격(1칸), 스킬로 15초 투명화. 생존자를 맞히면 바로 풀림 */
export const ASSASSIN = Object.freeze({
  ATTACK_COOLDOWN: 1.5,
  ATTACK_RANGE: 2.0,
  INVIS_TIME: 15,
  SKILL_COOLDOWN: 8, // 투명화가 끝난 뒤부터 셈
  INVIS_SPEED_FACTOR: 1.5, // 투명화 중 이동 속도 50% 증가 (20km/h → 30km/h)
  SLOW_TIME: 3.5, // 생존자를 맞혀 투명화가 풀리면 3.5초간
  SLOW_FACTOR: 0.5, // 이동 속도 50% 감소 (20km/h → 10km/h)
});

export const CLASS_INFO = Object.freeze({
  maniac: { name: '미치광이', icon: '👹', desc: '방망이 근접 공격 (쿨타임 1초) · 덫 3개' },
  assassin: { name: '암살자', icon: '🥷', desc: '쿠나이 근접 공격 (쿨타임 1.5초) · 15초 투명화·이동 속도 +50% (쿨타임 8초)' },
  sniper: { name: '저격수', icon: '🎯', desc: '저격총 원거리 공격 (쿨타임 2초) · 조준 확대 · 30m 밖 명중 시 2칸' },
});

/** 총알 방향 (yaw=0, pitch=0이면 -z) */
export function aimDirection(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** 점프 시작 후 t초일 때 높이 (포물선, 0 ~ JUMP_HEIGHT) */
export function jumpHeight(t) {
  if (t <= 0 || t >= RULES.JUMP_TIME) return 0;
  const k = t / RULES.JUMP_TIME;
  return 4 * RULES.JUMP_HEIGHT * k * (1 - k);
}
