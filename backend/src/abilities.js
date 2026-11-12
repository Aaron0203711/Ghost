// 술래 직업 능력: 선장(닻·끌어오기), 유령(벽 통과·유도탄), 살가죽(변장), 질주자(질주).
// Game 인스턴스(game)를 받아 상태를 바꾸는 함수들. 판정은 모두 서버가 한다.

import { RULES, ROLE, STATUS, HUNTER_CLASS, CAPTAIN, GHOST, SKINWALKER, SPRINTER, SEA_CURSE } from '../../shared/constants.js';
import { skillDrowned } from './drowned.js';

const r2 = (v) => Math.round(v * 100) / 100;
const alive = (p) => p && p.status === STATUS.ALIVE;
const survivors = (game) => [...game.players.values()].filter((s) => s.role === ROLE.SURVIVOR && alive(s));

/** 서버가 위치를 직접 움직이는 중인가 (닻에 끌려옴, 질주 대기·질주, 익사자 다이빙) */
export function isForced(game, p) {
  return game.time < p.pullUntil || !!p.dashPhase || !!p.dive;
}

/** 유령은 담장·벽을 통과한다: 그 종류만 뺀 충돌 세계를 쓴다 */
export function worldFor(game, p) {
  return p.cls === HUNTER_CLASS.GHOST ? game.ghostWorld : game.world;
}

export function forward(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

// ───────────── 선장: 닻 ─────────────

function skillCaptain(game, p) {
  p.skillReadyAt = game.time + CAPTAIN.SKILL_COOLDOWN;
  const dir = forward(p.yaw);
  const a = { id: ++game.anchorSeq, owner: p.id, x: p.x + dir.x * 0.6, z: p.z + dir.z * 0.6, dir, traveled: 0 };
  game.anchors.push(a);
  game.emit(null, { t: 'event', kind: 'anchor', id: p.id, aid: a.id, x: r2(a.x), z: r2(a.z), dx: r2(dir.x), dz: r2(dir.z) });
}

/** 점 (px,pz)에서 선분 a→b 위 가장 가까운 점 */
function closestOnSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2)) : 0;
  return { x: ax + vx * t, z: az + vz * t };
}

function startPull(game, t, ownerId) {
  // 피해 없이 1.5초 동안 선장 앞까지 끌려온다
  t.pullUntil = game.time + CAPTAIN.PULL_TIME;
  t.pulledBy = ownerId;
  t.budget = 0;
}

export function stepAnchors(game, dt) {
  const STEP = 0.25;
  // 바다의 저주(선장 + 익사자): 닻이 커지고 판정 반경 1.5m
  const radius = game.synergies.includes('seaCurse') ? SEA_CURSE.ANCHOR_RADIUS : CAPTAIN.ANCHOR_RADIUS;
  for (const a of [...game.anchors]) {
    const owner = game.players.get(a.owner);
    let remain = CAPTAIN.ANCHOR_SPEED * dt;
    let end = null;
    while (remain > 0 && !end) {
      const s = Math.min(STEP, remain);
      remain -= s;
      a.x += a.dir.x * s;
      a.z += a.dir.z * s;
      a.traveled += s;
      for (const t of survivors(game)) {
        // 닻에 직접 맞으면 닻이 거기서 멈춘다
        if (Math.hypot(t.x - a.x, t.z - a.z) <= radius + RULES.PLAYER_RADIUS) {
          startPull(game, t, a.owner);
          end = { hit: t.id };
          break;
        }
        // 선장과 닻 사이 밧줄에 닿아도 끌려온다 (닻은 계속 날아감, 여러 명 가능)
        if (!owner || t.pulledBy) continue;
        const c = closestOnSegment(t.x, t.z, owner.x, owner.z, a.x, a.z);
        if (Math.hypot(t.x - c.x, t.z - c.z) > CAPTAIN.ROPE_RADIUS + RULES.PLAYER_RADIUS) continue;
        if (game.world.segmentBlocked(owner.x, owner.z, c.x, c.z)) continue; // 밧줄이 벽에 가린 부분은 무효
        startPull(game, t, a.owner);
        game.emit(null, { t: 'event', kind: 'ropeHit', aid: a.id, id: a.owner, hit: t.id });
      }
      if (!end && game.world.pointBlocked(a.x, 1.0, a.z)) end = { hit: null };
      if (!end && a.traveled >= CAPTAIN.ANCHOR_RANGE) end = { hit: null };
    }
    if (end) {
      game.anchors.splice(game.anchors.indexOf(a), 1);
      game.emit(null, { t: 'event', kind: 'anchorEnd', aid: a.id, id: a.owner, x: r2(a.x), z: r2(a.z), hit: end.hit });
    }
  }
}

/** 끌려오는 생존자: 남은 시간 동안 선장 앞(1.3m)으로 다가간다. 벽에 막히면 멈춘다 */
export function stepPulls(game, dt) {
  for (const s of game.players.values()) {
    if (!s.pulledBy) continue;
    const c = game.players.get(s.pulledBy);
    const remaining = s.pullUntil - game.time;
    if (!c || !alive(s) || remaining <= 0) {
      endPull(game, s);
      continue;
    }
    const f = forward(c.yaw);
    const dest = { x: c.x + f.x * 1.3, z: c.z + f.z * 1.3 };
    const dx = dest.x - s.x;
    const dz = dest.z - s.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) continue;
    const step = dist * Math.min(1, dt / remaining);
    const res = game.world.move(s.x, s.z, (dx / dist) * step, (dz / dist) * step, RULES.PLAYER_RADIUS);
    const moved = Math.hypot(res.x - s.x, res.z - s.z);
    s.x = res.x;
    s.z = res.z;
    if (step > 0.05 && moved < step * 0.3) endPull(game, s); // 벽에 막힘
  }
}

export function endPull(game, s) {
  if (!s.pulledBy) return;
  s.pulledBy = null;
  s.pullUntil = 0;
  s.budget = 0;
  if (alive(s)) game.correct(s);
  game.emit(null, { t: 'event', kind: 'pullEnd', id: s.id });
}

// ───────────── 유령: 유도탄 ─────────────

/** 유령 시야 안(화면 각도·안개 거리)에 있고 벽에 가리지 않은 생존자 */
export function visibleSurvivors(game, p) {
  const f = forward(p.yaw);
  return survivors(game).filter((s) => {
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > GHOST.VIEW_RANGE) return false;
    if (d > 0.5 && (dx * f.x + dz * f.z) / d < Math.cos(GHOST.VIEW_HALF_ANGLE)) return false;
    return !game.world.segmentBlocked(p.x, p.z, s.x, s.z);
  });
}

function skillGhost(game, p) {
  p.skillReadyAt = game.time + GHOST.SKILL_COOLDOWN;
  const targets = visibleSurvivors(game, p);
  for (const t of targets) {
    game.wisps.push({ id: ++game.wispSeq, owner: p.id, target: t.id, x: p.x, z: p.z, life: GHOST.WISP_LIFE });
  }
  game.emit(null, { t: 'event', kind: 'wisps', id: p.id, count: targets.length });
}

export function stepWisps(game, dt) {
  for (const w of [...game.wisps]) {
    const t = game.players.get(w.target);
    w.life -= dt;
    if (!alive(t) || w.life <= 0) {
      game.wisps.splice(game.wisps.indexOf(w), 1);
      continue;
    }
    // 벽을 통과해 대상에게 곧장 날아간다
    const dx = t.x - w.x;
    const dz = t.z - w.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, GHOST.WISP_SPEED * dt);
    if (d > 0) {
      w.x += (dx / d) * step;
      w.z += (dz / d) * step;
    }
    if (Math.hypot(t.x - w.x, t.z - w.z) <= GHOST.WISP_RADIUS) {
      game.wisps.splice(game.wisps.indexOf(w), 1);
      if (game.time >= t.invulnUntil) game.damage(t, w.owner, 1, { wisp: 1 });
    }
  }
}

// ───────────── 살가죽을 뒤집어 쓴 자: 변장 ─────────────

function skillSkinwalker(game, p) {
  if (p.disguiseAs) return;
  const list = survivors(game);
  if (!list.length) return;
  p.disguiseAs = list[Math.floor(game.rand() * list.length)].id;
  // 생존자에게는 알리지 않는다 (같은 편·관전자만)
  game.emitToSeers({ t: 'event', kind: 'disguise', id: p.id, as: p.disguiseAs, on: true });
}

/** 공격 키를 누르면 (명중과 상관없이) 바로 풀리고, 그때부터 5초 쿨타임 */
export function endDisguise(game, p) {
  if (!p.disguiseAs) return;
  p.disguiseAs = null;
  p.skillReadyAt = game.time + SKINWALKER.SKILL_COOLDOWN;
  game.emit(null, { t: 'event', kind: 'disguise', id: p.id, on: false });
}

// ───────────── 질주자: 질주 ─────────────

function skillSprinter(game, p) {
  p.dashPhase = 'windup';
  p.dashT = 0;
  p.dashDir = forward(p.yaw); // 누른 순간 보던 방향으로 고정
  p.budget = 0;
  game.emit(null, { t: 'event', kind: 'dash', id: p.id, phase: 'windup' });
}

export function stepDashes(game, dt) {
  for (const p of game.players.values()) {
    if (!p.dashPhase || !alive(p)) continue;
    p.dashT += dt;
    if (p.dashPhase === 'windup') {
      if (p.dashT >= SPRINTER.WINDUP) {
        p.dashPhase = 'dash';
        p.dashT = 0;
        game.emit(null, { t: 'event', kind: 'dash', id: p.id, phase: 'dash' });
      }
      continue;
    }
    // 1초 동안 30m: 작은 간격으로 나눠 벽·생존자를 검사
    const speed = SPRINTER.DASH_DISTANCE / SPRINTER.DASH_TIME;
    let remain = speed * Math.min(dt, SPRINTER.DASH_TIME - (p.dashT - dt));
    let reason = null;
    while (remain > 1e-6 && !reason) {
      const s = Math.min(0.3, remain);
      remain -= s;
      const res = game.world.move(p.x, p.z, p.dashDir.x * s, p.dashDir.z * s, RULES.PLAYER_RADIUS);
      const moved = Math.hypot(res.x - p.x, res.z - p.z);
      p.x = res.x;
      p.z = res.z;
      if (moved < s * 0.5) reason = 'wall';
      for (const t of survivors(game)) {
        if (Math.hypot(t.x - p.x, t.z - p.z) > SPRINTER.HIT_RADIUS) continue;
        if (game.time < t.invulnUntil) continue; // 무적인 생존자는 지나친다
        game.damage(t, p.id, 1, { dash: 1 });
        reason = 'hit';
        break;
      }
      if (!reason && game.hitCloneNear(p.x, p.z, SPRINTER.HIT_RADIUS, p.id)) reason = 'clone'; // 닌자 분신에 부딪힘
    }
    if (!reason && p.dashT >= SPRINTER.DASH_TIME) reason = 'done';
    if (reason) endDash(game, p, reason);
  }
}

export function endDash(game, p, reason) {
  if (!p.dashPhase) return;
  p.dashPhase = null;
  p.dashT = 0;
  p.skillReadyAt = game.time + SPRINTER.SKILL_COOLDOWN;
  p.budget = 0;
  if (alive(p)) game.correct(p);
  game.emit(null, { t: 'event', kind: 'dash', id: p.id, phase: 'end', reason });
}

// ───────────── 스킬 키 처리 ─────────────

/** 선장·유령·살가죽·질주자·익사자 스킬. 처리했으면 true. msg: 익사자 다이빙 도착 지점(tx, tz) */
export function useSkill(game, p, msg = {}) {
  if (isForced(game, p)) return true;
  if (game.time < p.skillReadyAt) return true;
  switch (p.cls) {
    case HUNTER_CLASS.CAPTAIN:
      skillCaptain(game, p);
      return true;
    case HUNTER_CLASS.GHOST:
      skillGhost(game, p);
      return true;
    case HUNTER_CLASS.SKINWALKER:
      skillSkinwalker(game, p);
      return true;
    case HUNTER_CLASS.SPRINTER:
      skillSprinter(game, p);
      return true;
    case HUNTER_CLASS.DROWNED:
      skillDrowned(game, p, msg);
      return true;
    default:
      return false;
  }
}
