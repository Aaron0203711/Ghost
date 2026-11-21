// 생존자 직업 스킬: 의사(회복), 경찰(테이저건), 군인(소총), 닌자(분신), 엔지니어(로봇), 마라토너(스퍼트).
// 푸드파이터는 패시브(체력 +4칸, 스태미나 8초)라 스킬이 없다. 판정은 모두 서버가 한다.

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
  MARATHONER,
  survivorSkillCooldown,
} from '../../shared/constants.js';
import { endDash, worldFor } from './abilities.js';
import { dropCarried } from './palcheok.js';
import { zombieAt } from './gravedigger.js';
import { titanTaserHit } from './titan.js';

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
      ok = fireRifle(game, p);
      break;
    case SURVIVOR_CLASS.NINJA:
      ok = summonClone(game, p);
      break;
    case SURVIVOR_CLASS.ENGINEER:
      ok = attachRobot(game, p);
      break;
    case SURVIVOR_CLASS.MARATHONER:
      ok = sprint(game, p);
      break;
    default:
      return false; // 푸드파이터: 패시브
  }
  if (ok) p.sskillReadyAt = Math.max(game.time + survivorSkillCooldown(p.scls), p.reloadUntil); // 군인: 장전 중이면 장전이 끝난 뒤
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
    if (!game.lineOfSight(p, s)) continue;
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
  const t = { id: ++game.taserSeq, owner: p.id, x: p.x + dir.x * 0.3, y: (p.y || 0) + 1.0, z: p.z + dir.z * 0.3, dir, traveled: 0 };
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
        if (Math.hypot(h.x - t.x, h.z - t.z) > POLICE.RADIUS + game.hunterRadius) continue;
        if (game.titan && t.y > 25) continue; // 거인 키보다 높이 날아감
        // 입체기동 거인은 두 번 맞아야 스턴
        if (!game.titan || titanTaserHit(game, h)) stunHunter(game, h);
        end = { hit: h.id };
        break;
      }
      // 좀비도 술래처럼 4초 스턴
      const zb = !end && zombieAt(game, t.x, t.z, POLICE.RADIUS);
      if (zb) {
        zb.stunUntil = Math.max(zb.stunUntil, game.time + POLICE.STUN);
        end = { hit: null, zombie: zb.id };
      }
      if (!end && game.world.pointBlocked(t.x, t.y, t.z)) end = { hit: null };
      if (!end && t.traveled >= POLICE.RANGE) end = { hit: null };
    }
    if (end) {
      game.tasers.splice(game.tasers.indexOf(t), 1);
      game.emit(null, { t: 'event', kind: 'taserEnd', tid: t.id, id: t.owner, x: r2(t.x), z: r2(t.z), hit: end.hit, ...(end.zombie ? { zombie: end.zombie } : {}) });
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

/** 소총 한 발: 10발을 다 쓰면 12초 동안 자동 장전 (무제한). 장전 중이면 쏠 수 없다 */
function fireRifle(game, p) {
  if (game.time < p.reloadUntil || p.ammo <= 0) return false;
  p.ammo--;
  if (p.ammo === 0) p.reloadUntil = game.time + SOLDIER.RELOAD;
  const dir = forward(p.yaw);
  const b = { id: ++game.rifleSeq, owner: p.id, x: p.x + dir.x * 0.3, y: (p.y || 0) + 1.2, z: p.z + dir.z * 0.3, dir, traveled: 0 };
  game.rifleShots.push(b);
  game.emit(null, { t: 'event', kind: 'rifle', id: p.id, rid: b.id, x: r2(b.x), z: r2(b.z), dx: r2(dir.x), dz: r2(dir.z), ammo: p.ammo });
  return true;
}

/** 소총 탄: 초속 150m로 30m까지, 벽에 막힘. 맞은 술래는 2초 동안 29.74% 감속 (다시 맞으면 2초로 초기화). 장전 완료 처리 */
export function stepRifles(game, dt) {
  for (const p of game.players.values()) {
    if (p.reloadUntil > 0 && game.time >= p.reloadUntil) {
      p.reloadUntil = 0;
      p.ammo = SOLDIER.MAG;
      game.emit(p.id, { t: 'event', kind: 'reloaded', id: p.id, ammo: p.ammo });
    }
  }
  const STEP = 0.25;
  for (const b of [...game.rifleShots]) {
    let remain = SOLDIER.SPEED * dt;
    let end = null;
    while (remain > 0 && !end) {
      const s = Math.min(STEP, remain);
      remain -= s;
      b.x += b.dir.x * s;
      b.z += b.dir.z * s;
      b.traveled += s;
      for (const h of game.players.values()) {
        if (h.role !== ROLE.HUNTER || !alive(h) || h.dive) continue; // 땅속의 익사자는 안 맞음
        if (Math.hypot(h.x - b.x, h.z - b.z) > SOLDIER.RADIUS + game.hunterRadius) continue;
        if (game.titan && b.y > 25) continue;
        h.rifleSlowUntil = game.time + SOLDIER.SLOW_TIME;
        end = { hit: h.id };
        break;
      }
      // 좀비도 술래처럼 2초 감속
      const zb = !end && zombieAt(game, b.x, b.z, SOLDIER.RADIUS);
      if (zb) {
        zb.rifleSlowUntil = game.time + SOLDIER.SLOW_TIME;
        end = { hit: null, zombie: zb.id };
      }
      if (!end && game.world.pointBlocked(b.x, b.y, b.z)) end = { hit: null };
      if (!end && b.traveled >= SOLDIER.RANGE) end = { hit: null };
    }
    if (end) {
      game.rifleShots.splice(game.rifleShots.indexOf(b), 1);
      game.emit(null, { t: 'event', kind: 'rifleEnd', rid: b.id, id: b.owner, x: r2(b.x), z: r2(b.z), hit: end.hit, ...(end.zombie ? { zombie: end.zombie } : {}) });
    }
  }
}

// ───────────── 닌자 ─────────────

function summonClone(game, p) {
  const c = { id: ++game.cloneSeq, owner: p.id, x: p.x, z: p.z, yaw: p.yaw, dir: forward(p.yaw), until: game.time + NINJA.LIFE, ...(game.titan ? { y: p.y || 0 } : {}) };
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
    const res = worldFor(game, c).move(c.x, c.z, c.dir.x * step, c.dir.z * step, RULES.PLAYER_RADIUS);
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

// ───────────── 마라토너 ─────────────

/** 스퍼트: 5초 동안 스태미나 무제한 + 이동 속도 3% 증가. 쿨타임 20초는 끝난 뒤부터 (survivorSkillCooldown에 5초가 더해져 있음) */
function sprint(game, p) {
  p.boostUntil = game.time + MARATHONER.DURATION;
  game.emit(null, { t: 'event', kind: 'sprint', id: p.id, time: MARATHONER.DURATION });
  return true;
}
