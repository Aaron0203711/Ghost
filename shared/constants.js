// 백엔드와 프론트엔드가 함께 사용하는 게임 규칙 상수.
// 속도 단위: m/s (km/h ÷ 3.6)

const kmh = (v) => v / 3.6;

export const RULES = Object.freeze({
  // 이동
  SURVIVOR_WALK_SPEED: kmh(16), // 4.44 m/s
  SURVIVOR_RUN_SPEED: kmh(23), // 6.39 m/s
  HUNTER_SPEED: kmh(20), // 5.56 m/s
  PLAYER_RADIUS: 0.35,
  EYE_HEIGHT: 1.6, // 생존자 시점 높이
  HUNTER_EYE_HEIGHT: 1.8, // 술래 시점 높이 (팔척귀신은 PALCHEOK.EYE_HEIGHT)

  // 점프 (술래·생존자 공통). 담장·물건은 넘을 수 없고, 공중에서는 덫만 피한다
  JUMP_HEIGHT: 0.6,
  JUMP_TIME: 0.5, // 공중에 떠 있는 시간(초). 착지하면 바로 다시 뛸 수 있음
  JUMP_STAMINA: 1, // 생존자는 점프마다 스태미나 1초분 사용 (부족하면 점프 불가)

  // 스태미나 (초 단위)
  STAMINA_MAX: 15, // 15초 동안 달릴 수 있음
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
  ATTACK_RANGE: 3.0,
  ATTACK_HALF_ANGLE: (55 * Math.PI) / 180,
  HITS_TO_CATCH: 3, // 4명 이하일 때 (5명 이상이면 matchRules 참고)
  HIT_INVULNERABLE: 1.5, // 맞은 뒤 1.5초 무적 (살덩이 점액은 무시)

  // 제한 시간: 7분 안에 아무도 탈출하지 못하면 술래 승리
  MATCH_TIME: 7 * 60,

  // 발전기 / 탈출
  GENERATOR_COUNT: 5, // 4명 이하일 때 (5명 이상이면 matchRules 참고)
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

/**
 * 스태미나 1틱 갱신. 서버와 클라이언트 예측이 같은 계산을 쓴다.
 * max: 최대 스태미나(초). 푸드파이터는 10초. 초당 회복량은 모두 같다 (15초분을 15초에)
 */
export function stepStamina(s, wantsRun, moving, dt, max = RULES.STAMINA_MAX, regen = RULES.STAMINA_MAX / RULES.STAMINA_FULL_REGEN_TIME) {
  const running = wantsRun && moving && s.stamina > 0;
  if (running) {
    s.stamina = Math.max(0, s.stamina - dt);
    s.regenWait = RULES.STAMINA_REGEN_DELAY;
  } else if (s.regenWait > 0) {
    s.regenWait = Math.max(0, s.regenWait - dt);
  } else {
    s.stamina = Math.min(max, s.stamina + regen * dt);
  }
  return running;
}

/**
 * 이동 속도 (m/s). 술래는 직업과 상태에 따라 달라진다.
 * mods: { cls, aiming(저격수 조준 → 절반), invisible(암살자 투명 → 1.25배),
 *         slowed(암살자 기습 후 → 절반), disguised(살가죽 변장 → 생존자 걷기 속도, 달리면 원래 술래 속도),
 *         scls(생존자 직업: 푸드파이터는 10% 느림),
 *         slowFactor(생존자 감속 배율: 덫이 풀린 뒤, 조준 저격, 실 함정), noRun(생존자 달리기 불가),
 *         rifleSlowed(군인 소총에 맞음 → 29.74% 감소, 곱해짐), boosted(마라토너 스킬 → 3% 증가) }
 * 질주자는 기본 10% 빠르고, 살덩이는 기본 5% 느리다.
 */
export function speedFor(role, running, mods = {}) {
  if (role === ROLE.HUNTER) {
    // 군인 소총에 맞은 술래: 그때 속도에서 29.74% 감소 (다른 속도 변화와 곱해짐)
    return hunterBaseSpeed({ ...mods, running }) * (mods.rifleSlowed ? SOLDIER.SLOW_FACTOR : 1);
  }
  const base = running && !mods.noRun ? RULES.SURVIVOR_RUN_SPEED : RULES.SURVIVOR_WALK_SPEED;
  const cls = mods.scls === SURVIVOR_CLASS.FOODFIGHTER ? FOODFIGHTER.SPEED_FACTOR : 1;
  const boost = mods.boosted ? MARATHONER.SPEED_FACTOR : 1; // 마라토너 스킬: 걷기·달리기 모두 3% 증가
  return base * cls * boost * (mods.slowFactor ?? 1);
}

function hunterBaseSpeed(mods) {
  if (mods.aiming) return RULES.HUNTER_SPEED * SNIPER.AIM_SPEED_FACTOR;
  if (mods.slowed) return RULES.HUNTER_SPEED * ASSASSIN.SLOW_FACTOR;
  if (mods.wallSlowed) return RULES.HUNTER_SPEED * GHOST.WALL_SLOW_FACTOR;
  if (mods.invisible) return RULES.HUNTER_SPEED * ASSASSIN.INVIS_SPEED_FACTOR;
  if (mods.disguised) return mods.running ? RULES.HUNTER_SPEED : RULES.SURVIVOR_WALK_SPEED; // 변장 중: 걷기 16km/h, 달리면 원래 술래 속도
  if (mods.cls === 'sprinter') return RULES.HUNTER_SPEED * SPRINTER.SPEED_FACTOR;
  if (mods.cls === 'flesh') return RULES.HUNTER_SPEED * FLESH.SPEED_FACTOR;
  return RULES.HUNTER_SPEED; // 파묘자도 20km/h
}

/** 딱 5명(술래 포함)이면 발전기 7개(모두 켜야 탈출구가 열림), 생존자 체력 2칸 */
export const LARGE_MATCH = Object.freeze({ PLAYERS: 5, GENERATORS: 7, HITS_TO_CATCH: 2 });

/** 6명 이상이면 술래 2명, 발전기 7개(모두 켜야 탈출구가 열림), 생존자 체력 3칸 */
export const DUO_MATCH = Object.freeze({ PLAYERS: 6, HUNTERS: 2, GENERATORS: 7, HITS_TO_CATCH: 3 });

/** 딱 2명(술래 1 + 생존자 1)이면 발전기 3개, 술래가 주는 모든 피해(기본 공격·스킬) 50% 감소 */
export const DUEL_MATCH = Object.freeze({ PLAYERS: 2, GENERATORS: 3, DAMAGE_FACTOR: 0.5 });

/** 인원 수에 따라 달라지는 한 판의 규칙. damageFactor: 술래가 주는 피해 배율 */
export function matchRules(playerCount) {
  if (playerCount >= DUO_MATCH.PLAYERS) {
    return { hunters: DUO_MATCH.HUNTERS, generators: DUO_MATCH.GENERATORS, hitsToCatch: DUO_MATCH.HITS_TO_CATCH, damageFactor: 1 };
  }
  if (playerCount === LARGE_MATCH.PLAYERS) {
    return { hunters: 1, generators: LARGE_MATCH.GENERATORS, hitsToCatch: LARGE_MATCH.HITS_TO_CATCH, damageFactor: 1 };
  }
  if (playerCount === DUEL_MATCH.PLAYERS) {
    return { hunters: 1, generators: DUEL_MATCH.GENERATORS, hitsToCatch: RULES.HITS_TO_CATCH, damageFactor: DUEL_MATCH.DAMAGE_FACTOR };
  }
  return { hunters: 1, generators: RULES.GENERATOR_COUNT, hitsToCatch: RULES.HITS_TO_CATCH, damageFactor: 1 };
}

// ───────────── 술래 직업 ─────────────

export const HUNTER_CLASS = Object.freeze({
  MANIAC: 'maniac',
  SNIPER: 'sniper',
  ASSASSIN: 'assassin',
  CAPTAIN: 'captain',
  GHOST: 'ghost',
  SKINWALKER: 'skinwalker',
  SPRINTER: 'sprinter',
  CLOWN: 'clown',
  DROWNED: 'drowned',
  PALCHEOK: 'palcheok',
  FLESH: 'flesh',
  GRAVEDIGGER: 'gravedigger',
});

/** 근접 공격 (사거리 m, 쿨타임 초). 모두 1칸, 벽 너머로는 안 됨 */
export const MELEE = Object.freeze({
  maniac: { range: 3.0, cooldown: 1 }, // 방망이
  assassin: { range: 3.0, cooldown: 1.5 }, // 쿠나이
  captain: { range: 3.0, cooldown: 0.5 }, // 후크
  ghost: { range: 3.0, cooldown: 0.5 }, // 할퀴기
  skinwalker: { range: 4.0, cooldown: 1.5 }, // 갈고리
  sprinter: { range: 4.0, cooldown: 2.7 }, // 발차기
  drowned: { range: 3.0, cooldown: 1.5 }, // 작살 (미치광이와 같은 사거리)
  palcheok: { range: 3.0, cooldown: 1.3 }, // 주먹
  gravedigger: { range: 2.3, cooldown: 2 }, // 삽
});

/** 직업별 설치형 스킬 개수와 충전 시간 (미치광이 덫, 광대 실) */
export function trapChargesFor(cls) {
  if (cls === HUNTER_CLASS.CLOWN) return { max: CLOWN.THREAD_MAX, cooldown: CLOWN.THREAD_COOLDOWN };
  return { max: RULES.TRAP_MAX_CHARGES, cooldown: RULES.TRAP_COOLDOWN };
}

/** 미치광이: 덫이 풀린 뒤 1.5초 동안 생존자 이동 속도 15% 감소 + 달리기 불가 */
export const MANIAC = Object.freeze({
  RELEASE_SLOW_TIME: 1.5,
  RELEASE_SLOW_FACTOR: 0.85,
});

/**
 * 광대: 공 던지기(0.75칸, 쿨타임 0.5초, 포물선, 수평 최대 11m)와 실 함정.
 * 실 함정은 좌우 양쪽 벽(담장 포함) 사이에 쳐지고(최대 10m), 최대 4개·23초마다 1개 충전.
 * 밟은 생존자는 4초 동안 몸이 빛나 벽 너머로도 보이고 이동 속도 50% 감소 (점프로 피함). 밟으면 사라짐
 */
export const CLOWN = Object.freeze({
  BALL_COOLDOWN: 0.5,
  BALL_DAMAGE: 0.75,
  BALL_SPEED: 15, // m/s, 바라보는 방향(위아래 포함)으로 던짐
  BALL_GRAVITY: 9.8,
  BALL_RANGE: 11, // 수평으로 11m 날아가면 사라짐
  BALL_RADIUS: 0.25,
  THREAD_MAX: 4,
  THREAD_COOLDOWN: 23, // 23초마다 1개 충전
  THREAD_MAX_LEN: 10, // 양쪽 벽 사이 거리
  THREAD_RADIUS: 0.12, // 실 굵기 (생존자 반경에 더해 판정)
  THREAD_VISIBLE_RANGE: 0.5, // 생존자에게 보이는 거리 (정신병원 시너지면 아예 안 보임)
  THREAD_SLOW_TIME: 4,
  THREAD_SLOW_FACTOR: 0.5,
  THREAD_REVEAL_TIME: 4, // 몸이 빛나 벽 너머로 보이는 시간
  // 실을 걸 수 있는 장애물: 담장·벽·건물·바깥 경계
  WALL_KINDS: ['wall', 'stonewall', 'boundary', 'house', 'hut', 'shed', 'shrine'],
});

/** 함정 듀오: 술래 2명이 미치광이와 광대일 때 */
export const TRAP_DUO = Object.freeze({
  HOMING_RANGE: 5, // 미치광이 덫: 5m 안의 생존자에게 다가간다 (벽에 막힘)
  HOMING_SPEED: kmh(15),
  THREAD_SPEED: kmh(7), // 광대 실: 벽의 끝에서 끝까지 왔다 갔다
  THREAD_SCAN_STEP: 0.25,
  THREAD_SCAN_MAX: 40,
});

/** 바다의 저주: 술래 2명이 선장과 익사자일 때. 닻 판정 반경 1.5m(닻도 커짐), 다이빙 지름 7m·거리 무제한 */
export const SEA_CURSE = Object.freeze({ ANCHOR_RADIUS: 1.5, DIVE_RADIUS: 3.5, DIVE_RANGE: Infinity });

/** 최고의 스파이들: 술래 2명이 저격수와 암살자일 때.
 *  저격수가 35m 밖에서 맞히면 생존자 즉사(무적 중이면 막힘), 암살자가 투명해지는 순간 0.5초 동안 모든 생존자 위치가 암살자에게 보임 */
export const SPIES = Object.freeze({ KILL_DISTANCE: 35, REVEAL_TIME: 0.5 });

/** 술래 2명의 직업 조합 시너지 */
export function synergiesFor(classes) {
  const out = [];
  const has = (c) => classes.includes(c);
  if (has(HUNTER_CLASS.MANIAC) && has(HUNTER_CLASS.CLOWN)) out.push('trapDuo');
  if (has(HUNTER_CLASS.CAPTAIN) && has(HUNTER_CLASS.DROWNED)) out.push('seaCurse');
  if (has(HUNTER_CLASS.SNIPER) && has(HUNTER_CLASS.ASSASSIN)) out.push('spies');
  if (has(HUNTER_CLASS.GHOST) && has(HUNTER_CLASS.PALCHEOK)) out.push('urbanLegend');
  return out;
}

export const SYNERGY_INFO = Object.freeze({
  trapDuo: { name: '정신병원', icon: '🪤🧵', desc: '미치광이 덫이 5m 안의 생존자를 따라가고, 광대 실이 벽 끝에서 끝까지 움직이며 생존자에게 보이지 않아요' },
  seaCurse: { name: '바다의 저주', icon: '⚓🌊', desc: '선장의 닻이 커지고 판정이 1.5m로, 익사자 다이빙이 지름 7m·거리 무제한이 돼요' },
  spies: { name: '최고의 스파이들', icon: '🎯🥷', desc: '저격수가 35m 밖에서 맞히면 즉사, 암살자가 투명해지면 0.5초 동안 모든 생존자 위치가 보여요' },
  urbanLegend: { name: '도시괴담', icon: '👻👒', desc: '처녀귀신 유도탄이 보이지 않는 생존자까지 모두 시속 14km로 쫓아가고, 팔척귀신이 던진 생존자가 떨어진 자리에 지름 5m로 땅이 갈라져 원 안 생존자 모두 1칸' },
});

/** 도시괴담: 술래 2명이 처녀귀신(ghost)과 팔척귀신일 때.
 *  처녀귀신 유도탄이 시야와 상관없이 살아 있는 모든 생존자에게 시속 14km로 5초 동안 날아간다.
 *  팔척귀신이 던진 생존자가 멈춘 자리(충돌·벽·착지 모두)에 지름 5m로 땅이 갈라져 원 안 생존자 모두 1칸 (맞은 뒤 1.5초 무적이면 막힘) */
export const URBAN_LEGEND = Object.freeze({ WISP_SPEED: kmh(14), CRACK_RADIUS: 2.5, CRACK_DAMAGE: 1 });

/** 익사자: 작살 근접 공격 + 다이빙.
 *  다이빙: 스킬 키를 누르고 있는 동안 조준점이 가리키는 땅(최대 25m)에 지름 4m 원이 보이고, 떼면 땅속으로 들어가
 *  0.5초 뒤 그 원 가운데에서 튀어나온다. 땅속에 있는 동안은 안 보이고 공격·테이저건에 맞지 않으며, 생존자에게도 도착 원이 보인다.
 *  튀어나올 때 원 안의 생존자는 피해 없이 바깥쪽으로 2m 튕겨 나가고(벽에 막히면 멈춤) 2초 동안 이동 속도 30% 감소. 쿨타임 20초(쓴 순간부터) */
export const DROWNED = Object.freeze({
  DIVE_RADIUS: 2, // 지름 4m
  DIVE_RANGE: 25,
  DIVE_TIME: 0.5,
  KNOCKBACK: 2,
  SLOW_FACTOR: 0.7,
  SLOW_TIME: 2,
  SKILL_COOLDOWN: 20,
});

/** 다이빙 원 반지름과 최대 거리 (바다의 저주면 커지고 무제한) */
export function diveStats(synergies = []) {
  return synergies.includes('seaCurse')
    ? { radius: SEA_CURSE.DIVE_RADIUS, range: SEA_CURSE.DIVE_RANGE }
    : { radius: DROWNED.DIVE_RADIUS, range: DROWNED.DIVE_RANGE };
}

/** 팔척귀신: 키가 커서(눈높이 2.3m) 담장(1.9m) 너머를 본다. 주먹 3m(쿨타임 1.3초).
 *  납치: 정면 3m 안 생존자를 피해 없이 최대 5초 들고 다닌다(그동안 주먹 불가, 이동 속도 그대로).
 *  다시 스킬 키를 누르면 보던 방향으로 초속 20m 일자로 최대 15m 던진다.
 *  날아가다 다른 생존자에게 맞으면 두 사람 모두 1칸, 벽에 부딪히면 던져진 생존자만 1칸, 15m를 다 날아가 떨어지면 피해 없음.
 *  5초 안에 안 던지면 발밑에 내려놓고 팔척귀신은 0.7초 기절. 테이저건에 맞으면 놓친다.
 *  빗나가도(잡을 생존자가 없어도) 쿨타임 9초. 잡은 경우 쿨타임은 던지거나 내려놓은 뒤부터 */
export const PALCHEOK = Object.freeze({
  EYE_HEIGHT: 2.3,
  GRAB_RANGE: 3,
  HOLD_TIME: 5,
  THROW_SPEED: 20,
  THROW_RANGE: 15,
  THROW_HIT_RADIUS: 0.8, // 날아가는 생존자와 다른 생존자 중심 사이 거리
  THROW_DAMAGE: 1,
  DROP_STUN: 0.7,
  SKILL_COOLDOWN: 9,
});

/**
 * 마을 맵의 해: 판마다 방향과 높이가 다르다. 서버가 맵을 만들 때 정해서 모든 플레이어가 같은 그림자를 본다.
 *  - 방향(azimuth): +z 축에서 +x 쪽으로 잰 각 (rad, 0 ~ 2π)
 *  - 높이(elevation): 지평선에서 잰 각 (rad). 해 질 녘이라 낮아서 그림자가 길다 (12°보다 낮으면 바닥 그림자가 거의 안 보임)
 *  - SHADOW: 그림자 속에서 햇빛을 얼마나 가릴지 (1 = 다 가림). 은은하게(화면 밝기 기준):
 *    바닥 그늘은 햇빛 받는 바닥의 약 80~88%, 해를 마주한 벽의 그늘은 약 60%. 그늘에서도 하늘빛으로 사람이 잘 보인다
 * 건물·담장·나무와 사람 모두 그림자를 드리운다 (보통·고품질 화질 공통)
 */
export const SUN = Object.freeze({
  ELEVATION_MIN: (12 * Math.PI) / 180,
  ELEVATION_MAX: (25 * Math.PI) / 180,
  SHADOW: 0.85,
});

/** 생존자 지도: 시야(바라보는 방향 ±60°, 맵 시야 거리 안, 벽에 가리지 않음)에 들어온 발전기를 표시 */
export const MAP_SIGHT = Object.freeze({ HALF_ANGLE: (60 * Math.PI) / 180, RANGE: { village: 75, mine: 60, backrooms: 75 } });

/** 시점 높이: 술래 직업(cls)이 있으면 1.8m(팔척귀신 2.3m), 생존자(cls 없음)는 1.6m */
export function eyeHeightFor(cls) {
  if (cls === HUNTER_CLASS.PALCHEOK) return PALCHEOK.EYE_HEIGHT;
  return Object.values(HUNTER_CLASS).includes(cls) ? RULES.HUNTER_EYE_HEIGHT : RULES.EYE_HEIGHT;
}

/** 선장: 닻을 던져 맞은 생존자를 1.5초 동안 자기 앞까지 끌고 온다 (피해 없음) */
export const CAPTAIN = Object.freeze({
  ANCHOR_SPEED: 50,
  ANCHOR_RANGE: 20,
  ANCHOR_RADIUS: 0.8,
  ROPE_RADIUS: 0.15, // 날아가는 닻과 선장 사이 밧줄. 닿아도 끌려온다
  PULL_TIME: 1.5,
  SKILL_COOLDOWN: 7.5,
});

/** 처녀귀신(ghost): 담장·벽 통과. 스킬로 보이는 생존자마다 작은 유령 유도탄 (5초, 맞으면 1칸) */
export const GHOST = Object.freeze({
  PASS_KINDS: ['wall', 'stonewall'], // 통과할 수 있는 장애물 종류
  WISP_SPEED: 5,
  WISP_LIFE: 5,
  WISP_RADIUS: 0.6,
  VIEW_RANGE: 75,
  VIEW_HALF_ANGLE: (60 * Math.PI) / 180,
  SKILL_COOLDOWN: 7,
  WALL_SLOW_TIME: 1, // 벽을 빠져나온 순간부터 1초 동안
  WALL_SLOW_FACTOR: 0.75, // 이동 속도 25% 감소 (20km/h → 15km/h)
});

/**
 * 유령 벽 통과 감지 (서버와 클라이언트 예측이 같은 계산을 쓴다).
 * wallWorld: 유령이 통과하는 담장·벽만 담은 충돌 세계. state.inWall을 기억해 두고,
 * (ox,oz)→(x,z) 이동이 벽을 지나갔거나 벽 안에 있으면 '벽 속', 벽 밖으로 완전히 나오면 true를 돌려준다
 */
export function ghostWallExit(state, wallWorld, ox, oz, x, z) {
  const inside = !wallWorld.isFree(x, z, 0.01);
  if (inside || wallWorld.segmentBlocked(ox, oz, x, z)) state.inWall = true;
  if (state.inWall && !inside) {
    state.inWall = false;
    return true;
  }
  return false;
}

/** 살가죽을 뒤집어 쓴 자: 생존자로 변장 (공격하면 바로 풀림, 풀린 뒤 5초 쿨타임).
 *  변장 중 발전기 옆에 멈춰 서 있으면 생존자처럼 수리하는 척 (진행도는 오르지 않음) */
export const SKINWALKER = Object.freeze({
  SKILL_COOLDOWN: 5,
  // 변장 중에만 달릴 수 있음 (원래 술래 속도). 스태미나 5초, 멈추고 1초 뒤부터 회복, 0 → 가득 5초
  STAMINA_MAX: 5,
  STAMINA_FULL_REGEN_TIME: 5,
});
export const SKINWALKER_STAMINA_REGEN = SKINWALKER.STAMINA_MAX / SKINWALKER.STAMINA_FULL_REGEN_TIME;

/** 질주자: 이동 속도 +10%, 0.5초 대기 후 1초 동안 30m 질주. 처음 부딪힌 생존자 1칸 */
export const SPRINTER = Object.freeze({
  SPEED_FACTOR: 1.1,
  WINDUP: 0.5,
  DASH_TIME: 1,
  DASH_DISTANCE: 30,
  HIT_RADIUS: 0.9,
  SKILL_COOLDOWN: 15,
});

/**
 * 살덩이: 기본 공격 없음. 패시브로 움직이는 동안 1초마다 발밑에 점액 웅덩이(처음 반경 2m)를 남긴다.
 * 웅덩이는 사라지지 않고 매초 반경이 0.05m씩 커진다(최대 없음). 웅덩이 안의 생존자는 매초 0.07칸
 * (여러 웅덩이에 걸쳐도 0.07칸, 점프 중에도 받음, 맞은 뒤 무적 시간을 무시하고 무적도 주지 않음).
 * 스킬: 발밑에 반경 6m 점액 웅덩이를 뿌린다(패시브 웅덩이와 똑같이 사라지지 않고 매초 0.05m씩 커지며 피해도 같음).
 * 쿨타임 20초. 이동 속도는 기본 5% 느리다(19km/h).
 */
export const FLESH = Object.freeze({
  SLIME_INTERVAL: 1, // 움직인 시간 1초마다 웅덩이 하나
  SLIME_RADIUS: 2,
  SLIME_GROWTH: 0.05, // 매초 반경 +0.05m
  SLIME_DAMAGE: 0.07, // 매초 0.07칸
  SLIME_TICK: 1,
  SPRAY_RADIUS: 6, // 스킬로 뿌리는 웅덩이의 처음 반경
  SKILL_COOLDOWN: 20,
  SPEED_FACTOR: 0.95, // 기본 이동 속도 5% 감소
});

/** 점액 웅덩이 반경: born은 생긴 시각, r0는 처음 반경(패시브 2m, 스킬 6m) */
export function slimeRadius(born, now, r0 = FLESH.SLIME_RADIUS) {
  return r0 + FLESH.SLIME_GROWTH * Math.max(0, now - born);
}

/**
 * 파묘자: 삽 근접 공격(2.3m, 쿨타임 2초, 1칸).
 * 패시브: 12초마다 맵의 무작위 빈 곳에 무덤이 생긴다(최대 10개, 모두에게 보임).
 * 스킬(쿨타임 10초): 파묘자에게서 30m 안의 가장 가까운 무덤 최대 2개를 파헤쳐 좀비를 꺼낸다(무덤은 사라짐).
 *   30m 안에 무덤이 없으면 쓰이지 않고 쿨타임도 안 돈다.
 * 좀비(AI, 영구, 수 제한 없음): 시속 10km로 맵을 돌아다니다 시야(20m, 정면 120°, 벽에 가리지 않음)에 생존자가 들어오면 쫓아간다.
 *   놓치면 마지막으로 본 자리까지 간 뒤 다시 돌아다닌다. 공격은 1.5m, 쿨타임 1.5초, 1칸.
 *   테이저건(4초 스턴)·군인 소총(2초 감속)은 술래와 똑같이 맞고, 닌자 분신도 쫓아가 때리면 분신이 사라진다.
 * 좀비나 파묘자에게 잡힌 생존자는 그 자리에서 바로 좀비가 된다(플레이어는 관전).
 */
export const GRAVEDIGGER = Object.freeze({
  GRAVE_INTERVAL: 12,
  GRAVE_MAX: 10,
  DIG_RANGE: 30,
  DIG_COUNT: 2,
  SKILL_COOLDOWN: 10,
  ZOMBIE_SPEED: kmh(10),
  ZOMBIE_SIGHT: 20,
  ZOMBIE_HALF_ANGLE: (60 * Math.PI) / 180, // 정면 120°
  ZOMBIE_ATTACK_RANGE: 1.5,
  ZOMBIE_ATTACK_COOLDOWN: 1.5,
  ZOMBIE_DAMAGE: 1,
  GRAVE_MIN_GAP: 3, // 무덤끼리 최소 거리
});

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
  AIM_HIT_SLOW_TIME: 2, // 조준한 상태로 맞히면 생존자 2초간
  AIM_HIT_SLOW_FACTOR: 0.9, // 이동 속도 10% 감소
  HIT_RADIUS: 0.45, // 총알이 생존자에게 맞는 판정 반경
  BODY_HEIGHT: 1.85,
});

/** 암살자: 쿠나이 근접 공격(1칸), 스킬로 15초 투명화. 생존자를 맞히면 바로 풀림 */
export const ASSASSIN = Object.freeze({
  ATTACK_COOLDOWN: 1.5,
  ATTACK_RANGE: 3.0,
  INVIS_TIME: 15,
  SKILL_COOLDOWN: 8, // 투명화가 끝난 뒤부터 셈
  INVIS_SPEED_FACTOR: 1.25, // 투명화 중 이동 속도 25% 증가 (20km/h → 25km/h)
  SLOW_TIME: 3.5, // 생존자를 맞혀 투명화가 풀리면 3.5초간
  SLOW_FACTOR: 0.5, // 이동 속도 50% 감소 (20km/h → 10km/h)
});

export const CLASS_INFO = Object.freeze({
  maniac: { name: '미치광이', icon: '👹', desc: '방망이 3m (쿨타임 1초) · 덫 3개' },
  assassin: { name: '암살자', icon: '🥷', desc: '쿠나이 3m (쿨타임 1.5초) · 15초 투명화·이동 속도 +25% (쿨타임 8초)' },
  sniper: { name: '저격수', icon: '🎯', desc: '저격총 원거리 공격 (쿨타임 2초) · 조준 확대 · 30m 밖 명중 시 2칸' },
  captain: { name: '선장', icon: '⚓', desc: '후크 3m (쿨타임 0.5초) · 닻이나 밧줄에 닿은 생존자를 끌고 옴 (쿨타임 7.5초)' },
  ghost: { name: '처녀귀신', icon: '👻', desc: '담장·벽 통과(빠져나오면 1초간 25% 감속) · 할퀴기 3m (쿨타임 0.5초) · 보이는 생존자에게 유도탄 (쿨타임 7초)' },
  skinwalker: { name: '살가죽을 뒤집어 쓴 자', icon: '🎭', desc: '갈고리 4m (쿨타임 1.5초) · 생존자로 변장(발전기 수리하는 척), 공격하면 풀림 (쿨타임 5초)' },
  sprinter: { name: '질주자', icon: '⚡', desc: '이동 속도 +10% · 발차기 4m (쿨타임 1초) · 30m 질주 (쿨타임 15초)' },
  clown: { name: '광대', icon: '🤡', desc: '공 던지기 0.75칸 (쿨타임 0.5초, 11m) · 벽 사이 실 함정 4개 (23초마다 충전)' },
  drowned: { name: '익사자', icon: '🤿', desc: '작살 3m (쿨타임 1.5초) · 다이빙: 25m 안 원하는 곳으로 잠수해 튀어나와 지름 4m 안 생존자를 튕기고 감속 (쿨타임 20초)' },
  flesh: { name: '살덩이', icon: '🫀', desc: '기본 공격 없음 · 움직이면 매초 점액 웅덩이(반경 2m, 계속 커짐), 안의 생존자 매초 0.07칸(무적 무시) · 스킬: 발밑에 반경 6m 점액 뿌리기 (쿨타임 20초) · 이동 속도 5% 느림' },
  gravedigger: { name: '파묘자', icon: '⚰️', desc: '삽 2.3m (쿨타임 2초) · 12초마다 맵에 무덤이 생김(최대 10개) · 스킬: 30m 안 가장 가까운 무덤 2개에서 좀비를 꺼냄 (쿨타임 10초) · 좀비·파묘자에게 잡힌 생존자는 좀비가 됨' },
  palcheok: { name: '팔척귀신', icon: '👒', desc: '키가 커서 담장 너머가 보임 · 주먹 3m (쿨타임 1.3초) · 생존자를 5초까지 들고 다니다 15m 던짐, 다른 생존자를 맞히면 둘 다 1칸 (쿨타임 9초)' },
});

// ───────────── 생존자 직업 (메인 화면에서 고름) ─────────────

export const SURVIVOR_CLASS = Object.freeze({
  DOCTOR: 'doctor',
  POLICE: 'police',
  SOLDIER: 'soldier',
  FOODFIGHTER: 'foodfighter',
  NINJA: 'ninja',
  ENGINEER: 'engineer',
  MARATHONER: 'marathoner',
});

/** 의사: 5m 안에서 바라본 다친 생존자(없으면 자신)를 한 칸 회복. 다친 사람이 없으면 안 쓰임 */
export const DOCTOR = Object.freeze({ COOLDOWN: 23, RANGE: 5, HEAL: 1, AIM_HALF_ANGLE: (45 * Math.PI) / 180 });

/** 경찰: 테이저건. 초속 30m로 10m까지, 벽에 막힘. 맞은 술래는 4초 스턴 (이동·공격·스킬 불가) */
export const POLICE = Object.freeze({ COOLDOWN: 24.5, RANGE: 10, SPEED: 30, RADIUS: 0.3, STUN: 4 });

/** 군인: 소총 10발. 0.5초마다 한 발, 총알은 초속 150m로 30m까지(벽에 막힘), 피해 없음.
 *  맞은 술래는 2초 동안 이동 속도 29.74% 감소(다시 맞으면 2초로 초기화). 10발을 다 쓰면 12초 동안 자동 장전(무제한) */
export const SOLDIER = Object.freeze({
  MAG: 10,
  FIRE_INTERVAL: 0.5,
  RELOAD: 12,
  SPEED: 150,
  RANGE: 30,
  RADIUS: 0.2,
  SLOW_FACTOR: 1 - 0.2974,
  SLOW_TIME: 2,
});

/** 푸드파이터: 체력 +4칸 (보통 7칸, 5인 규칙이면 6칸), 스태미나 최대 10초, 이동 속도 10% 감소 */
export const FOODFIGHTER = Object.freeze({ BONUS_HP: 4, STAMINA_MAX: 10, SPEED_FACTOR: 0.9 });

/** 닌자: 분신이 5초 동안 소환한 방향으로 걷기 속도로 직진. 술래 공격에 맞으면 사라짐 */
export const NINJA = Object.freeze({ COOLDOWN: 13, LIFE: 5, HIT_RADIUS: 0.45 });

/** 엔지니어: 지름 3m 안의 발전기에 소형 로봇 부착, 5초 동안 매초 4% (총 20%) */
export const ENGINEER = Object.freeze({ COOLDOWN: 13, DURATION: 5, RATE: 0.04, RANGE: 1.5 });

/** 마라토너: 5초 동안 스태미나 무제한(달리기·점프에 쓰지 않음) + 이동 속도 3% 증가(걷기·달리기 모두). 쿨타임 20초(끝난 뒤부터) */
export const MARATHONER = Object.freeze({ DURATION: 5, COOLDOWN: 20, SPEED_FACTOR: 1.03 });

export const SURVIVOR_CLASS_INFO = Object.freeze({
  doctor: { name: '의사', icon: '🩺', skill: '회복', desc: '5m 안의 생존자(없으면 자신)를 한 칸 회복 · 쿨타임 23초' },
  police: { name: '경찰', icon: '👮', skill: '테이저건', desc: '테이저건 10m · 맞은 술래 4초 스턴 · 쿨타임 24.5초' },
  soldier: { name: '군인', icon: '🪖', skill: '소총', desc: '소총 10발(0.5초마다, 30m) · 맞은 술래 2초간 이동 속도 -29.74% · 다 쓰면 12초 장전' },
  foodfighter: { name: '푸드파이터', icon: '🍔', skill: null, desc: '체력 +4칸 (보통 7칸) · 대신 스태미나 10초 · 이동 속도 -10%' },
  ninja: { name: '닌자', icon: '🌀', skill: '분신', desc: '5초 동안 앞으로 걸어가는 분신 소환 · 쿨타임 13초' },
  engineer: { name: '엔지니어', icon: '🔧', skill: '로봇', desc: '발전기에 로봇 부착, 5초간 20% 수리 · 쿨타임 13초' },
  marathoner: { name: '마라토너', icon: '🏃', skill: '스퍼트', desc: '5초 동안 스태미나 무제한 · 이동 속도 +3% · 쿨타임 20초(끝난 뒤부터)' },
});

export const DEFAULT_SURVIVOR_CLASS = SURVIVOR_CLASS.DOCTOR;

export function validSurvivorClass(c) {
  return Object.values(SURVIVOR_CLASS).includes(c) ? c : DEFAULT_SURVIVOR_CLASS;
}

/** 생존자 직업 스킬 쿨타임 (푸드파이터는 패시브). 마라토너는 쓴 순간부터 다시 쓸 수 있을 때까지(효과 5초 + 쿨타임 20초) */
export function survivorSkillCooldown(cls) {
  return { doctor: DOCTOR.COOLDOWN, police: POLICE.COOLDOWN, soldier: SOLDIER.FIRE_INTERVAL, ninja: NINJA.COOLDOWN, engineer: ENGINEER.COOLDOWN, marathoner: MARATHONER.DURATION + MARATHONER.COOLDOWN }[cls] ?? 0;
}

/** 생존자 최대 체력(칸)과 스태미나(초) */
export function survivorStats(cls, baseHits) {
  const ff = cls === SURVIVOR_CLASS.FOODFIGHTER;
  return { maxHits: baseHits + (ff ? FOODFIGHTER.BONUS_HP : 0), staminaMax: ff ? FOODFIGHTER.STAMINA_MAX : RULES.STAMINA_MAX };
}

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

// 음성 채팅 (거리에 따라 크기가 달라짐). 소리 크기는 서버가 정해서 각자에게 보낸다
export const VOICE = Object.freeze({
  FULL_RANGE: 2, // 2m 안은 최대 크기
  MAX_RANGE: 35, // 35m부터는 안 들림
  WALL_FACTOR: 0.7, // 벽·담장·건물 너머는 70% 크기 + 먹먹하게
});

/** 거리에 따른 목소리 크기 (0~1): 2m까지 1, 35m에서 0, 그 사이는 부드럽게 줄어든다 */
export function voiceGain(dist) {
  if (dist <= VOICE.FULL_RANGE) return 1;
  if (dist >= VOICE.MAX_RANGE) return 0;
  const t = (dist - VOICE.FULL_RANGE) / (VOICE.MAX_RANGE - VOICE.FULL_RANGE);
  return (1 - t) * (1 - t);
}

// ───────────── 훈련장 (혼자 연습) ─────────────

/**
 * 훈련장: 혼자 들어가 술래나 생존자 직업을 체험한다. 제한 시간·승패 없음, 판 규칙은 기본(체력 3칸, 발전기 5개, 피해 감소 없음).
 * - 술래 체험: 생존자 모양 허수아비가 내 시작 위치 주변 여러 거리에 제자리로 서 있다. 체력을 다 깎으면 쓰러졌다가 3초 뒤 제자리에서 다시 일어남
 * - 생존자 체험: 공격하지 않는 술래 허수아비(테이저건·소총 대상)와 발전기. 발전기를 다 켜고 탈출하면 처음부터 다시
 */
export const TRAINING = Object.freeze({
  DUMMY_DISTANCES: [4, 7, 11, 16, 24, 35], // 술래 체험: 허수아비 6개 (저격 30m 연습용으로 먼 것도)
  HUNTER_DUMMIES: [
    { cls: 'maniac', dist: 6 },
    { cls: 'ghost', dist: 11 },
  ],
  REVIVE_TIME: 3,
});
