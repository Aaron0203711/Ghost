// 익사자: 다이빙 (원하는 곳으로 잠수했다가 0.5초 뒤 튀어나와 주변 생존자를 튕겨 냄)
// 판정은 모두 서버가 한다.

import { RULES, ROLE, STATUS, DROWNED, diveStats } from '../../shared/constants.js';
import { reachableCells, MAP_SIZE } from './mapgen.js';
import { isCarriedOrThrown } from './palcheok.js';

const r2 = (v) => Math.round(v * 100) / 100;
const HALF = MAP_SIZE / 2;
const STEP = 0.5; // reachableCells 격자

export function isDiving(p) {
  return !!p?.dive;
}

/** 걸어서 갈 수 있는 칸 (처음 한 번 계산). 담장에 둘러싸인 빈 곳에 갇히지 않도록 */
function reachableSet(game, from) {
  if (!game.diveCells?.size) {
    game.diveCells = new Set(reachableCells(game.world, from.x, from.z).map((c) => key(c.x, c.z)));
  }
  return game.diveCells;
}
const idx = (v) => Math.floor((v + HALF) / STEP);
const key = (x, z) => `${idx(x)},${idx(z)}`;
const center = (i) => -HALF + i * STEP + STEP / 2;

/** (x,z)에서 가장 가까운, 서 있을 수 있고 걸어서 닿는 곳 (10m 안). 없으면 null */
export function nearestLanding(game, x, z, from) {
  const cells = reachableSet(game, from);
  const ok = (cx, cz) => cells.has(`${cx},${cz}`) && game.world.isFree(center(cx), center(cz), RULES.PLAYER_RADIUS + 0.05);
  const ix = idx(x);
  const iz = idx(z);
  if (ok(ix, iz) && game.world.isFree(x, z, RULES.PLAYER_RADIUS + 0.05)) return { x, z };
  for (let r = 1; r <= 20; r++) {
    let best = null;
    let bestD = Infinity;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !ok(ix + dx, iz + dz)) continue;
        const d = Math.hypot(center(ix + dx) - x, center(iz + dz) - z);
        if (d < bestD) {
          bestD = d;
          best = { x: center(ix + dx), z: center(iz + dz) };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** 다이빙 도착 지점: 최대 거리로 줄이고, 맵 안·서 있을 수 있는 곳으로 옮긴다 */
export function diveTarget(game, p, tx, tz) {
  const { range } = diveStats(game.synergies);
  if (!Number.isFinite(tx) || !Number.isFinite(tz)) {
    const d = Number.isFinite(range) ? range : 10;
    tx = p.x - Math.sin(p.yaw) * d;
    tz = p.z - Math.cos(p.yaw) * d;
  }
  const dx = tx - p.x;
  const dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d > range) {
    tx = p.x + (dx / d) * range;
    tz = p.z + (dz / d) * range;
  }
  const lim = HALF - 1;
  tx = Math.max(-lim, Math.min(lim, tx));
  tz = Math.max(-lim, Math.min(lim, tz));
  return nearestLanding(game, tx, tz, p);
}

/** 스킬 키를 뗐을 때: msg.tx, msg.tz는 조준한 땅 */
export function skillDrowned(game, p, msg = {}) {
  const t = diveTarget(game, p, Number(msg.tx), Number(msg.tz));
  if (!t) {
    game.emit(p.id, { t: 'event', kind: 'diveFail', id: p.id });
    return;
  }
  const { radius } = diveStats(game.synergies);
  p.skillReadyAt = game.time + DROWNED.SKILL_COOLDOWN;
  p.dive = { x: t.x, z: t.z, fx: p.x, fz: p.z, until: game.time + DROWNED.DIVE_TIME, r: radius };
  p.budget = 0;
  // 모두에게 도착 원을 보여 준다 (생존자가 피할 수 있게)
  game.emit(null, { t: 'event', kind: 'dive', id: p.id, x: r2(t.x), z: r2(t.z), fx: r2(p.x), fz: r2(p.z), r: radius, time: DROWNED.DIVE_TIME });
}

/** 땅속 시간이 끝나면 도착 원 가운데에서 튀어나와 원 안 생존자를 바깥으로 2m 튕기고 2초 감속 */
export function stepDives(game) {
  for (const p of game.players.values()) {
    if (!p.dive) continue;
    if (p.status !== STATUS.ALIVE) {
      p.dive = null;
      continue;
    }
    if (game.time < p.dive.until) continue;
    const dv = p.dive;
    p.dive = null;
    p.x = dv.x;
    p.z = dv.z;
    p.budget = 0;
    const hits = [];
    for (const s of game.players.values()) {
      if (s.role !== ROLE.SURVIVOR || s.status !== STATUS.ALIVE || isCarriedOrThrown(s)) continue;
      let dx = s.x - dv.x;
      let dz = s.z - dv.z;
      let d = Math.hypot(dx, dz);
      if (d > dv.r + RULES.PLAYER_RADIUS) continue;
      if (d < 0.05) {
        // 한가운데면 들어온 방향으로 밀어낸다
        dx = dv.x - dv.fx;
        dz = dv.z - dv.fz;
        d = Math.hypot(dx, dz) || 1;
        if (Math.hypot(dx, dz) === 0) dx = 1;
      }
      const res = game.world.move(s.x, s.z, (dx / d) * DROWNED.KNOCKBACK, (dz / d) * DROWNED.KNOCKBACK, RULES.PLAYER_RADIUS);
      s.x = res.x;
      s.z = res.z;
      s.budget = 0;
      game.addSlow(s, DROWNED.SLOW_FACTOR, DROWNED.SLOW_TIME);
      game.correct(s);
      hits.push(s.id);
    }
    game.correct(p);
    game.emit(null, { t: 'event', kind: 'diveEnd', id: p.id, x: r2(dv.x), z: r2(dv.z), r: dv.r, hits });
  }
}
