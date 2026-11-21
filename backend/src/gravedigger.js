// 파묘자: 패시브로 12초마다 맵에 무덤이 생기고(최대 10개), 스킬로 30m 안의 가장 가까운 무덤 2개를 파헤쳐 좀비를 꺼낸다.
// 좀비는 AI로 시속 10km로 돌아다니다 시야(20m, 정면 120°)에 생존자가 보이면 쫓아가 때린다(1.5m, 1.5초, 1칸).
// 좀비나 파묘자에게 잡힌 생존자는 그 자리에서 좀비가 된다. 판정은 모두 서버가 한다.

import { RULES, ROLE, STATUS, HUNTER_CLASS, GRAVEDIGGER, SOLDIER } from '../../shared/constants.js';
import { reachableCells } from './mapgen.js';
import { isCarriedOrThrown } from './palcheok.js';
import { removeClone } from './survivors.js';

const r2 = (v) => Math.round(v * 100) / 100;
const alive = (p) => p && p.status === STATUS.ALIVE;
const forward = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

/** 무덤·좀비가 설 수 있는 빈 칸 (술래 시작 위치에서 갈 수 있는 곳). 처음 필요할 때 한 번만 계산 */
function openCells(game) {
  if (!game.graveCells) {
    const h = [...game.players.values()].find((p) => p.role === ROLE.HUNTER) || { x: 0, z: 0 };
    game.graveCells = reachableCells(game.world, h.x, h.z).filter((c) => game.world.isFree(c.x, c.z, 0.8));
  }
  return game.graveCells;
}

/** 무작위 빈 곳에 무덤 하나 (다른 무덤과 3m 이상 떨어진 곳) */
export function addGrave(game, owner) {
  if (game.graves.length >= GRAVEDIGGER.GRAVE_MAX) return null;
  const cells = openCells(game);
  if (!cells.length) return null;
  for (let t = 0; t < 200; t++) {
    const c = cells[Math.floor(game.rand() * cells.length)];
    if (game.graves.some((g) => Math.hypot(g.x - c.x, g.z - c.z) < GRAVEDIGGER.GRAVE_MIN_GAP)) continue;
    const g = { id: ++game.graveSeq, owner: owner.id, x: c.x, z: c.z, rot: game.rand() * Math.PI * 2 };
    game.graves.push(g);
    game.emit(null, { t: 'event', kind: 'grave', gid: g.id, x: r2(g.x), z: r2(g.z) });
    return g;
  }
  return null;
}

/** 좀비를 만든다. from: 좀비가 된 생존자 (그 생존자의 모습으로 그려짐) */
export function spawnZombie(game, ownerId, x, z, from = null) {
  const zb = {
    id: ++game.zombieSeq,
    owner: ownerId,
    x,
    z,
    yaw: game.rand() * Math.PI * 2,
    mode: 'wander', // 'wander' 돌아다님 | 'chase' 쫓아감 | 'search' 마지막으로 본 자리로
    target: null, // { kind: 'p'|'c', id }
    lastSeen: null,
    goal: null,
    stuckT: 0,
    attackReadyAt: 0,
    stunUntil: 0,
    rifleSlowUntil: 0,
    from: from?.id ?? null,
    look: from?.scls ?? null,
  };
  game.zombies.push(zb);
  return zb;
}

/** 스킬: 30m 안의 가장 가까운 무덤 최대 2개를 파헤쳐 좀비를 꺼낸다. 무덤이 없으면 쓰이지 않음 (쿨타임 없음) */
export function skillGravedigger(game, p) {
  const near = game.graves
    .map((g) => ({ g, d: Math.hypot(g.x - p.x, g.z - p.z) }))
    .filter((o) => o.d <= GRAVEDIGGER.DIG_RANGE)
    .sort((a, b) => a.d - b.d)
    .slice(0, GRAVEDIGGER.DIG_COUNT)
    .map((o) => o.g);
  if (!near.length) {
    game.emit(p.id, { t: 'event', kind: 'digFail', id: p.id });
    return;
  }
  p.skillReadyAt = game.time + GRAVEDIGGER.SKILL_COOLDOWN;
  const zombies = [];
  for (const g of near) {
    game.graves.splice(game.graves.indexOf(g), 1);
    zombies.push(spawnZombie(game, p.id, g.x, g.z));
  }
  game.emit(null, {
    t: 'event',
    kind: 'dig',
    id: p.id,
    graves: near.map((g) => ({ gid: g.id, x: r2(g.x), z: r2(g.z) })),
    zombies: zombies.map((zb) => zb.id),
  });
}

/** 이 피해로 잡힌 생존자가 좀비가 되는가: 좀비나 파묘자가 잡았을 때 */
export function zombifies(game, byId, extra = {}) {
  return !!extra.zombie || game.players.get(byId)?.cls === HUNTER_CLASS.GRAVEDIGGER;
}

/** 좀비 시야: 20m 안, 정면 120°, 벽에 가리지 않은 가장 가까운 생존자(닌자 분신 포함) */
function seeTarget(game, zb) {
  const f = forward(zb.yaw);
  let best = null;
  let bestD = Infinity;
  const consider = (kind, s) => {
    const dx = s.x - zb.x;
    const dz = s.z - zb.z;
    const d = Math.hypot(dx, dz);
    if (d > GRAVEDIGGER.ZOMBIE_SIGHT || d >= bestD) return;
    if (d > 0.4 && (dx * f.x + dz * f.z) / d < Math.cos(GRAVEDIGGER.ZOMBIE_HALF_ANGLE)) return;
    if (game.world.segmentBlocked(zb.x, zb.z, s.x, s.z)) return;
    best = { kind, id: s.id, x: s.x, z: s.z };
    bestD = d;
  };
  for (const s of game.players.values()) {
    if (s.role !== ROLE.SURVIVOR || !alive(s) || isCarriedOrThrown(s)) continue;
    consider('p', s);
  }
  for (const c of game.clones) consider('c', c);
  return best;
}

/** 지금 쫓는 대상이 아직 보이는가 (보이면 위치를 돌려줌). 쫓는 중에는 몸이 대상 쪽을 보고 있다 */
function targetPos(game, t) {
  if (!t) return null;
  if (t.kind === 'c') return game.clones.find((c) => c.id === t.id) || null;
  const s = game.players.get(t.id);
  return alive(s) && !isCarriedOrThrown(s) ? s : null;
}

/** 돌아다닐 곳: 지금 자리에서 벽에 가리지 않고 보이는 6~25m 떨어진 빈 곳 */
function pickWanderGoal(game, zb) {
  const cells = openCells(game);
  for (let t = 0; t < 40 && cells.length; t++) {
    const c = cells[Math.floor(game.rand() * cells.length)];
    const d = Math.hypot(c.x - zb.x, c.z - zb.z);
    if (d < 6 || d > 25) continue;
    if (game.world.segmentBlocked(zb.x, zb.z, c.x, c.z)) continue;
    return { x: c.x, z: c.z };
  }
  // 못 찾으면 무작위 방향으로 조금
  const a = game.rand() * Math.PI * 2;
  return { x: zb.x - Math.sin(a) * 8, z: zb.z - Math.cos(a) * 8 };
}

/** (gx,gz) 쪽으로 걸어간다. 벽에 막히면 미끄러진다. 실제로 움직인 거리 */
function stepToward(game, zb, gx, gz, dist) {
  const dx = gx - zb.x;
  const dz = gz - zb.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) return 0;
  const step = Math.min(d, dist);
  zb.yaw = yawTo(dx, dz);
  const res = game.world.move(zb.x, zb.z, (dx / d) * step, (dz / d) * step, RULES.PLAYER_RADIUS);
  const moved = Math.hypot(res.x - zb.x, res.z - zb.z);
  zb.x = res.x;
  zb.z = res.z;
  return moved;
}

/** 정면 1.5m 안(근접 공격 부채꼴, 벽 너머 불가)의 가장 가까운 생존자·분신을 때린다 */
function zombieAttack(game, zb) {
  if (game.time < zb.attackReadyAt) return;
  const f = forward(zb.yaw);
  const range = GRAVEDIGGER.ZOMBIE_ATTACK_RANGE + RULES.PLAYER_RADIUS;
  let best = null;
  let bestD = Infinity;
  const consider = (kind, s) => {
    const dx = s.x - zb.x;
    const dz = s.z - zb.z;
    const d = Math.hypot(dx, dz);
    if (d > range || d >= bestD) return;
    if (d > 0.4 && (dx * f.x + dz * f.z) / d < Math.cos(RULES.ATTACK_HALF_ANGLE)) return;
    if (game.world.segmentBlocked(zb.x, zb.z, s.x, s.z)) return;
    best = { kind, s };
    bestD = d;
  };
  for (const s of game.players.values()) {
    if (s.role !== ROLE.SURVIVOR || !alive(s) || isCarriedOrThrown(s) || game.time < s.invulnUntil) continue;
    consider('p', s);
  }
  for (const c of game.clones) consider('c', c);
  if (!best) return;
  zb.attackReadyAt = game.time + GRAVEDIGGER.ZOMBIE_ATTACK_COOLDOWN;
  game.emit(null, { t: 'event', kind: 'zswing', zid: zb.id });
  if (best.kind === 'c') removeClone(game, best.s, zb.owner);
  else game.damage(best.s, zb.owner, GRAVEDIGGER.ZOMBIE_DAMAGE, { zombie: 1, zid: zb.id });
}

function stepZombie(game, zb, dt) {
  if (game.time < zb.stunUntil) return; // 테이저건: 이동·공격 불가
  const speed = GRAVEDIGGER.ZOMBIE_SPEED * (game.time < zb.rifleSlowUntil ? SOLDIER.SLOW_FACTOR : 1);
  const move = speed * dt;

  // 쫓던 대상이 아직 시야 안이면 계속, 아니면 새로 찾는다
  let tp = zb.mode === 'chase' ? targetPos(game, zb.target) : null;
  if (tp) {
    const d = Math.hypot(tp.x - zb.x, tp.z - zb.z);
    if (d > GRAVEDIGGER.ZOMBIE_SIGHT || game.world.segmentBlocked(zb.x, zb.z, tp.x, tp.z)) tp = null;
  }
  if (!tp) {
    const seen = seeTarget(game, zb);
    if (seen) {
      zb.target = { kind: seen.kind, id: seen.id };
      tp = seen;
    }
  }
  if (tp) {
    zb.mode = 'chase';
    zb.lastSeen = { x: tp.x, z: tp.z };
    const d = Math.hypot(tp.x - zb.x, tp.z - zb.z);
    zb.yaw = yawTo(tp.x - zb.x, tp.z - zb.z);
    // 붙어 서면 더 다가가지 않는다 (몸이 겹치지 않게)
    if (d > RULES.PLAYER_RADIUS * 2) stepToward(game, zb, tp.x, tp.z, Math.min(move, d - RULES.PLAYER_RADIUS * 2));
  } else if (zb.mode === 'chase' || zb.mode === 'search') {
    // 놓쳤다: 마지막으로 본 자리까지 간 뒤 다시 돌아다닌다
    zb.mode = 'search';
    zb.target = null;
    const g = zb.lastSeen;
    const moved = g ? stepToward(game, zb, g.x, g.z, move) : 0;
    if (!g || Math.hypot(g.x - zb.x, g.z - zb.z) < 0.5 || moved < move * 0.3) {
      zb.mode = 'wander';
      zb.lastSeen = null;
      zb.goal = null;
    }
  } else {
    // 돌아다님: 보이는 곳을 하나 골라 걸어가고, 닿거나 막히면 다른 곳으로
    if (!zb.goal) zb.goal = pickWanderGoal(game, zb);
    const moved = stepToward(game, zb, zb.goal.x, zb.goal.z, move);
    zb.stuckT = moved < move * 0.3 ? zb.stuckT + dt : 0;
    if (Math.hypot(zb.goal.x - zb.x, zb.goal.z - zb.z) < 0.5 || zb.stuckT > 0.6) {
      zb.goal = null;
      zb.stuckT = 0;
    }
  }
  zombieAttack(game, zb);
}

export function stepGravedigger(game, dt) {
  // 패시브: 파묘자마다 12초마다 무덤 하나 (맵 전체 최대 10개)
  for (const p of game.players.values()) {
    if (p.cls !== HUNTER_CLASS.GRAVEDIGGER || !alive(p)) continue;
    p.graveTimer += dt;
    if (p.graveTimer < GRAVEDIGGER.GRAVE_INTERVAL) continue;
    p.graveTimer -= GRAVEDIGGER.GRAVE_INTERVAL;
    addGrave(game, p);
  }
  for (const zb of game.zombies) {
    stepZombie(game, zb, dt);
    if (game.ended) return;
  }
}

/** 테이저건·소총 탄이 맞은 좀비 (없으면 null) */
export function zombieAt(game, x, z, radius) {
  return game.zombies.find((zb) => Math.hypot(zb.x - x, zb.z - z) <= radius + RULES.PLAYER_RADIUS) || null;
}
