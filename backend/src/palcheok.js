// 팔척귀신: 납치(생존자를 최대 5초 들고 다님) → 다시 누르면 던지기 (15m, 다른 생존자를 맞히면 둘 다 1칸).
// 판정은 모두 서버가 한다.

import { RULES, ROLE, STATUS, PALCHEOK, URBAN_LEGEND } from '../../shared/constants.js';

const r2 = (v) => Math.round(v * 100) / 100;
const alive = (p) => p && p.status === STATUS.ALIVE;
const forward = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

/** 생존자가 팔척귀신에게 들려 있거나 던져져 날아가는 중 (서버가 위치를 정함) */
export function isCarriedOrThrown(s) {
  return !!(s?.carriedBy || s?.thrown);
}

/** 스킬 키: 들고 있지 않으면 납치, 들고 있으면 던지기 */
export function skillPalcheok(game, p) {
  if (p.carrying) {
    throwCarried(game, p);
    return;
  }
  if (game.time < p.skillReadyAt) return;
  const target = grabTarget(game, p);
  if (!target) {
    // 빗나가도 쿨타임 9초
    p.skillReadyAt = game.time + PALCHEOK.SKILL_COOLDOWN;
    game.emit(null, { t: 'event', kind: 'grabMiss', id: p.id });
    return;
  }
  if (target.clone) {
    // 닌자 분신을 잡으면 분신만 사라지고 쿨타임
    game.hitCloneNear(target.x, target.z, 0.05, p.id);
    p.skillReadyAt = game.time + PALCHEOK.SKILL_COOLDOWN;
    game.emit(null, { t: 'event', kind: 'grabMiss', id: p.id, clone: 1 });
    return;
  }
  p.carrying = target.id;
  p.carryUntil = game.time + PALCHEOK.HOLD_TIME;
  // 쿨타임은 던지거나 내려놓은 뒤부터 돈다 (들고 있는 동안 스킬 키는 던지기)
  target.carriedBy = p.id;
  target.x = p.x;
  target.z = p.z;
  target.budget = 0;
  target.interact = false;
  target.repairing = false;
  game.emit(null, { t: 'event', kind: 'grab', id: p.id, target: target.id, time: PALCHEOK.HOLD_TIME });
}

/** 정면 부채꼴(주먹과 같은 각도) 3m 안에서 가장 가까운 생존자(닌자 분신 포함). 벽 너머는 안 됨 */
function grabTarget(game, p) {
  const f = forward(p.yaw);
  let best = null;
  let bestD = Infinity;
  const list = [...game.players.values(), ...game.clones.map((c) => ({ ...c, clone: c, role: ROLE.SURVIVOR, status: STATUS.ALIVE }))];
  for (const s of list) {
    if (s.role !== ROLE.SURVIVOR || !alive(s) || isCarriedOrThrown(s) || s.pulledBy) continue;
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > PALCHEOK.GRAB_RANGE + RULES.PLAYER_RADIUS) continue;
    if (d > 0.4 && (dx * f.x + dz * f.z) / d < Math.cos(RULES.ATTACK_HALF_ANGLE)) continue;
    if (game.world.segmentBlocked(p.x, p.z, s.x, s.z)) continue;
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** 보던 방향(수평)으로 일자로 던진다 */
function throwCarried(game, p) {
  const s = game.players.get(p.carrying);
  p.carrying = null;
  p.carryUntil = 0;
  p.skillReadyAt = game.time + PALCHEOK.SKILL_COOLDOWN;
  if (!alive(s) || s.carriedBy !== p.id) return;
  s.carriedBy = null;
  const dir = forward(p.yaw);
  s.x = p.x;
  s.z = p.z;
  s.thrown = { by: p.id, dir, traveled: 0 };
  s.budget = 0;
  game.emit(null, { t: 'event', kind: 'throw', id: p.id, target: s.id, x: r2(s.x), z: r2(s.z), dx: r2(dir.x), dz: r2(dir.z) });
}

/** 들고 있던 생존자를 발밑(앞 0.8m)에 피해 없이 내려놓는다. stun: 팔척귀신 기절 시간 */
export function dropCarried(game, p, reason, stun = 0) {
  if (!p.carrying) return;
  const s = game.players.get(p.carrying);
  p.carrying = null;
  p.carryUntil = 0;
  p.skillReadyAt = game.time + PALCHEOK.SKILL_COOLDOWN;
  if (stun > 0) {
    p.stunUntil = Math.max(p.stunUntil, game.time + stun);
    p.budget = 0;
  }
  if (s && s.carriedBy === p.id) {
    s.carriedBy = null;
    if (alive(s)) {
      const f = forward(p.yaw);
      const res = game.world.move(p.x, p.z, f.x * 0.8, f.z * 0.8, RULES.PLAYER_RADIUS);
      s.x = res.x;
      s.z = res.z;
      s.budget = 0;
      game.correct(s);
    }
  }
  game.emit(null, { t: 'event', kind: 'drop', id: p.id, target: s?.id ?? null, reason });
}

/** 매 틱: 들려 있는 생존자는 팔척귀신을 따라가고, 5초가 지나면 내려놓고 0.7초 기절. 던져진 생존자는 날아간다 */
export function stepPalcheok(game, dt) {
  for (const p of game.players.values()) {
    if (!p.carrying) continue;
    const s = game.players.get(p.carrying);
    if (!alive(p) || !alive(s) || s.carriedBy !== p.id) {
      if (s && s.carriedBy === p.id) s.carriedBy = null;
      p.carrying = null;
      p.carryUntil = 0;
      p.skillReadyAt = game.time + PALCHEOK.SKILL_COOLDOWN;
      game.emit(null, { t: 'event', kind: 'drop', id: p.id, target: s?.id ?? null, reason: 'lost' });
      continue;
    }
    if (game.time >= p.carryUntil) {
      dropCarried(game, p, 'timeout', PALCHEOK.DROP_STUN);
      continue;
    }
    s.x = p.x;
    s.z = p.z;
  }
  for (const s of game.players.values()) {
    if (s.thrown) stepThrown(game, s, dt);
  }
}

function stepThrown(game, s, dt) {
  const th = s.thrown;
  if (!alive(s)) {
    s.thrown = null;
    return;
  }
  const STEP = 0.25;
  let remain = PALCHEOK.THROW_SPEED * dt;
  let end = null;
  while (remain > 1e-6 && !end) {
    const step = Math.min(STEP, remain, PALCHEOK.THROW_RANGE - th.traveled);
    remain -= step;
    const res = game.world.move(s.x, s.z, th.dir.x * step, th.dir.z * step, RULES.PLAYER_RADIUS);
    const moved = Math.hypot(res.x - s.x, res.z - s.z);
    s.x = res.x;
    s.z = res.z;
    th.traveled += step;
    // 다른 생존자에게 맞으면 두 사람 모두 1칸
    for (const o of game.players.values()) {
      if (o === s || o.role !== ROLE.SURVIVOR || !alive(o) || isCarriedOrThrown(o)) continue;
      if (Math.hypot(o.x - s.x, o.z - s.z) > PALCHEOK.THROW_HIT_RADIUS) continue;
      end = { reason: 'hit', other: o.id };
      if (game.time >= o.invulnUntil) game.damage(o, th.by, PALCHEOK.THROW_DAMAGE, { thrown: 1 });
      if (game.time >= s.invulnUntil) game.damage(s, th.by, PALCHEOK.THROW_DAMAGE, { thrown: 1 });
      break;
    }
    if (end) break;
    // 벽에 부딪히면 던져진 생존자만 1칸
    if (moved < step * 0.5) {
      end = { reason: 'wall' };
      if (game.time >= s.invulnUntil) game.damage(s, th.by, PALCHEOK.THROW_DAMAGE, { thrown: 1, wall: 1 });
      break;
    }
    if (th.traveled >= PALCHEOK.THROW_RANGE - 1e-6) end = { reason: 'land' };
  }
  if (!end) return;
  s.thrown = null;
  s.budget = 0;
  if (alive(s)) game.correct(s);
  game.emit(null, { t: 'event', kind: 'thrownEnd', id: s.id, by: th.by, x: r2(s.x), z: r2(s.z), reason: end.reason, other: end.other ?? null });
  if (game.synergies.includes('urbanLegend')) crackGround(game, s.x, s.z, th.by);
}

/** 도시괴담: 던져진 생존자가 멈춘 자리에 지름 5m로 땅이 갈라져 원 안 생존자 모두 1칸 (무적 중이면 막힘) */
function crackGround(game, x, z, byId) {
  const hits = [];
  for (const o of [...game.players.values()]) {
    if (o.role !== ROLE.SURVIVOR || !alive(o) || o.carriedBy) continue;
    if (Math.hypot(o.x - x, o.z - z) > URBAN_LEGEND.CRACK_RADIUS + RULES.PLAYER_RADIUS) continue;
    hits.push(o.id);
    if (game.time >= o.invulnUntil) game.damage(o, byId, URBAN_LEGEND.CRACK_DAMAGE, { crack: 1 });
  }
  game.emit(null, { t: 'event', kind: 'crack', id: byId, x: r2(x), z: r2(z), r: URBAN_LEGEND.CRACK_RADIUS, hits });
}
