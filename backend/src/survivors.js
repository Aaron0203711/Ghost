// 생존자 직업 스킬: 의사(회복), 경찰(테이저건), 군인(연막탄), 닌자(분신), 엔지니어(로봇).
// 푸드파이터는 패시브(체력 +4칸, 스태미나 5초)라 스킬이 없다. 판정은 모두 서버가 한다.

import {
  RULES,
  ROLE,
  STATUS,
  SURVIVOR_CLASS,
  DOCTOR,
  POLICE,
  SOLDIER,
  NINJA,
  ENGINEER,
  survivorSkillCooldown,
} from '../../shared/constants.js';
import { endDash } from './abilities.js';
import { dropCarried } from './palcheok.js';

const r2 = (v) => Math.round(v * 100) / 100;
const alive = (p) => p && p.status === STATUS.ALIVE;
const forward = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

function fail(game, p, reason) {
  game.emit(p.id, { t: 'event', kind: 'sskillFail', reason });
  return false;
}

/** 스킬 키 (Q / 수리 왼쪽 버튼). 쓰였으면 true */
export function useSurvivorSkill(game, p, msg = {}) {
  if (!alive(p) || p.role !== ROLE.SURVIVOR) return false;
  if (game.time < p.sskillReadyAt) return false;
  if (Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
  if (Number.isFinite(msg.pitch)) p.pitch = Math.max(-1.5, Math.min(1.5, msg.pitch));
  let ok = false;
  switch (p.scls) {
    case SURVIVOR_CLASS.DOCTOR:
      ok = heal(game, p);
      break;
    case SURVIVOR_CLASS.POLICE:
      ok = fireTaser(game, p);
      break;
    case SURVIVOR_CLASS.SOLDIER:
      ok = throwSmoke(game, p);
      break;
    case SURVIVOR_CLASS.NINJA:
      ok = summonClone(game, p);
      break;
    case SURVIVOR_CLASS.ENGINEER:
      ok = attachRobot(game, p);
      break;
    default:
      return false; // 푸드파이터: 패시브
  }
  if (ok) p.sskillReadyAt = game.time + survivorSkillCooldown(p.scls);
  return ok;
}

// ───────────── 의사 ─────────────

/** 5m 안에서 바라본 다친 생존자 → 없으면 자신 → 없으면 범위 안의 다른 다친 생존자. 아무도 없으면 안 쓰임 */
function heal(game, p) {
  const f = forward(p.yaw);
  let looked = null;
  let lookedCos = Math.cos(DOCTOR.AIM_HALF_ANGLE);
  let other = null;
  let otherCos = -2;
  for (const s of game.players.values()) {
    if (s === p || s.role !== ROLE.SURVIVOR || !alive(s) || s.hits <= 0) continue;
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > DOCTOR.RANGE + RULES.PLAYER_RADIUS) continue;
    if (game.world.segmentBlocked(p.x, p.z, s.x, s.z)) continue;
    const cos = d > 0.05 ? (dx * f.x + dz * f.z) / d : 1;
    if (cos >= lookedCos) {
      looked = s;
      lookedCos = cos;
    }
    if (cos > otherCos) {
      other = s;
      otherCos = cos;
    }
  }
  const target = looked || (p.hits > 0 ? p : other);
  if (!target) return fail(game, p, 'noTarget');
  target.hits = Math.max(0, target.hits - DOCTOR.HEAL);
  game.emit(null, { t: 'event', kind: 'healed', id: p.id, target: target.id, hits: target.hits, max: target.maxHits });
  return true;
}

// ───────────── 경찰 ─────────────

function fireTaser(game, p) {
  const dir = forward(p.yaw);
  const t = { id: ++game.taserSeq, owner: p.id, x: p.x + dir.x * 0.3, z: p.z + dir.z * 0.3, dir, traveled: 0 };
  game.tasers.push(t);
  game.emit(null, { t: 'event', kind: 'taser', id: p.id, tid: t.id, x: r2(t.x), z: r2(t.z), dx: r2(dir.x), dz: r2(dir.z) });
  return true;
}

export function stepTasers(game, dt) {
  const STEP = 0.25;
  for (const t of [...game.tasers]) {
    let remain = POLICE.SPEED * dt;
    let end = null;
    while (remain > 0 && !end) {
      const s = Math.min(STEP, remain);
      remain -= s;
      t.x += t.dir.x * s;
      t.z += t.dir.z * s;
      t.traveled += s;
      for (const h of game.players.values()) {
        if (h.role !== ROLE.HUNTER || !alive(h) || h.dive) continue; // 땅속의 익사자는 안 맞음
        if (Math.hypot(h.x - t.x, h.z - t.z) > POLICE.RADIUS + RULES.PLAYER_RADIUS) continue;
        stunHunter(game, h);
        end = { hit: h.id };
        break;
      }
      if (!end && game.world.pointBlocked(t.x, 1.0, t.z)) end = { hit: null };
      if (!end && t.traveled >= POLICE.RANGE) end = { hit: null };
    }
    if (end) {
      game.tasers.splice(game.tasers.indexOf(t), 1);
      game.emit(null, { t: 'event', kind: 'taserEnd', tid: t.id, id: t.owner, x: r2(t.x), z: r2(t.z), hit: end.hit });
    }
  }
}

/** 테이저건에 맞은 술래: 4초 동안 이동·공격·스킬 불가 (질주 중이면 멈춤, 팔척귀신은 들고 있던 생존자를 놓침) */
function stunHunter(game, h) {
  h.stunUntil = Math.max(h.stunUntil, game.time + POLICE.STUN);
  h.budget = 0;
  h.aiming = false;
  if (h.dashPhase) endDash(game, h, 'stun');
  if (h.carrying) dropCarried(game, h, 'taser'); // 팔척귀신: 들고 있던 생존자를 놓친다
}

// ───────────── 군인 ─────────────

function throwSmoke(game, p) {
  const s = { id: ++game.smokeSeq, owner: p.id, x: p.x, z: p.z, until: game.time + SOLDIER.DURATION };
  game.smokes.push(s);
  game.emit(null, { t: 'event', kind: 'smoke', id: p.id, sid: s.id, x: r2(s.x), z: r2(s.z) });
  return true;
}

/** 연막 안의 술래는 화면이 뿌옇게 되고, 나오면 1초 뒤 풀린다 */
export function stepSmokes(game) {
  game.smokes = game.smokes.filter((s) => game.time < s.until);
  for (const s of game.smokes) {
    for (const h of game.players.values()) {
      if (h.role !== ROLE.HUNTER || !alive(h)) continue;
      if (Math.hypot(h.x - s.x, h.z - s.z) <= SOLDIER.RADIUS) h.smokeUntil = game.time + SOLDIER.LINGER;
    }
  }
}

// ───────────── 닌자 ─────────────

function summonClone(game, p) {
  const c = { id: ++game.cloneSeq, owner: p.id, x: p.x, z: p.z, yaw: p.yaw, dir: forward(p.yaw), until: game.time + NINJA.LIFE };
  game.clones.push(c);
  game.emit(null, { t: 'event', kind: 'clone', id: p.id, cid: c.id });
  return true;
}

/** 분신은 걷기 속도로 직진한다. 벽에 막히면 벽을 따라 미끄러지거나 멈춘 채 남는다 */
export function stepClones(game, dt) {
  for (const c of [...game.clones]) {
    if (game.time >= c.until || !game.players.has(c.owner)) {
      removeClone(game, c, null);
      continue;
    }
    const step = RULES.SURVIVOR_WALK_SPEED * dt;
    const res = game.world.move(c.x, c.z, c.dir.x * step, c.dir.z * step, RULES.PLAYER_RADIUS);
    c.x = res.x;
    c.z = res.z;
  }
}

export function removeClone(game, c, byId) {
  const i = game.clones.indexOf(c);
  if (i === -1) return;
  game.clones.splice(i, 1);
  game.emit(null, { t: 'event', kind: 'cloneGone', cid: c.id, id: c.owner, by: byId, x: r2(c.x), z: r2(c.z) });
}

// ───────────── 엔지니어 ─────────────

function attachRobot(game, p) {
  let best = null;
  let bestD = ENGINEER.RANGE;
  for (const g of game.gens) {
    if (g.done) continue;
    const d = Math.hypot(g.x - p.x, g.z - p.z);
    if (d <= bestD) {
      best = g;
      bestD = d;
    }
  }
  if (!best) return fail(game, p, 'noGen');
  const r = { id: ++game.robotSeq, owner: p.id, genId: best.id, start: game.time, until: game.time + ENGINEER.DURATION };
  game.robots.push(r);
  game.emit(null, { t: 'event', kind: 'robot', id: p.id, rid: r.id, genId: best.id });
  return true;
}

/** 이번 틱에 로봇이 채우는 발전기 진행도 (발전기 id → 양). 끝났거나 켜진 발전기의 로봇은 떨어진다 */
export function stepRobots(game, dt) {
  const add = new Map();
  game.robots = game.robots.filter((r) => {
    const g = game.gens.find((x) => x.id === r.genId);
    if (!g || g.done) return false;
    // 이번 틱 중 로봇이 붙어 있던 시간만큼 (5초 동안 정확히 20%)
    const on = Math.min(game.time, r.until) - Math.max(game.time - dt, r.start);
    if (on > 0) add.set(g.id, (add.get(g.id) || 0) + ENGINEER.RATE * on);
    return game.time < r.until;
  });
  return add;
}
