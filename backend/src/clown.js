// 광대(공 던지기·실 함정)와 함정 듀오(미치광이 덫 유도, 광대 실 왕복).
// Game 인스턴스(game)를 받아 상태를 바꾸는 함수들. 판정은 모두 서버가 한다.

import { RULES, ROLE, STATUS, HUNTER_CLASS, CLOWN, TRAP_DUO, SNIPER, aimDirection, eyeHeightFor } from '../../shared/constants.js';

const r2 = (v) => Math.round(v * 100) / 100;
const alive = (p) => p && p.status === STATUS.ALIVE;
const survivors = (game) => [...game.players.values()].filter((s) => s.role === ROLE.SURVIVOR && alive(s));

/** 점 (px,pz)에서 선분 a→b까지 거리 */
export function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2)) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/** 함정 듀오: 살아 있는 술래 중에 미치광이와 광대가 모두 있을 때 */
export function hasTrapDuo(game) {
  let maniac = false;
  let clown = false;
  for (const p of game.players.values()) {
    if (p.role !== ROLE.HUNTER) continue;
    if (p.cls === HUNTER_CLASS.MANIAC) maniac = true;
    if (p.cls === HUNTER_CLASS.CLOWN) clown = true;
  }
  return maniac && clown;
}

// ───────────── 공 던지기 ─────────────

/** 바라보는 방향(위아래 포함)으로 공을 던진다. 중력으로 포물선을 그린다 */
export function throwBall(game, p) {
  p.attackReadyAt = game.time + CLOWN.BALL_COOLDOWN;
  const dir = aimDirection(p.yaw, p.pitch);
  const b = {
    id: ++game.ballSeq,
    owner: p.id,
    ox: p.x,
    oz: p.z,
    x: p.x + dir.x * 0.3,
    y: eyeHeightFor(p.cls) - 0.1,
    z: p.z + dir.z * 0.3,
    vx: dir.x * CLOWN.BALL_SPEED,
    vy: dir.y * CLOWN.BALL_SPEED,
    vz: dir.z * CLOWN.BALL_SPEED,
  };
  game.balls.push(b);
  game.emit(null, {
    t: 'event',
    kind: 'ball',
    id: p.id,
    bid: b.id,
    x: r2(b.x),
    y: r2(b.y),
    z: r2(b.z),
    vx: r2(b.vx),
    vy: r2(b.vy),
    vz: r2(b.vz),
  });
  return b;
}

export function stepBalls(game, dt) {
  for (const b of [...game.balls]) {
    const n = Math.max(1, Math.ceil((CLOWN.BALL_SPEED * dt) / 0.2));
    const h = dt / n;
    let end = null;
    for (let i = 0; i < n && !end; i++) {
      b.vy -= CLOWN.BALL_GRAVITY * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.z += b.vz * h;
      const reach = CLOWN.BALL_RADIUS + RULES.PLAYER_RADIUS;
      for (const t of survivors(game)) {
        if (b.y < 0 || b.y > SNIPER.BODY_HEIGHT) continue;
        if (Math.hypot(t.x - b.x, t.z - b.z) > reach) continue;
        end = { hit: t.id };
        if (game.time >= t.invulnUntil) game.damage(t, b.owner, CLOWN.BALL_DAMAGE, { ball: 1 });
        else end.blocked = true;
        break;
      }
      if (!end && b.y <= SNIPER.BODY_HEIGHT && game.hitCloneNear(b.x, b.z, reach, b.owner)) end = { hit: null, clone: true };
      if (!end && (b.y <= 0 || game.world.pointBlocked(b.x, b.y, b.z))) end = { hit: null };
      if (!end && Math.hypot(b.x - b.ox, b.z - b.oz) >= CLOWN.BALL_RANGE) end = { hit: null, out: true };
    }
    if (end) {
      game.balls.splice(game.balls.indexOf(b), 1);
      game.emit(null, { t: 'event', kind: 'ballEnd', bid: b.id, x: r2(b.x), y: r2(Math.max(0, b.y)), z: r2(b.z), hit: end.hit });
    }
  }
}

// ───────────── 실 함정 ─────────────

const wallFilter = (b) => CLOWN.WALL_KINDS.includes(b.kind);

/** 중심 (x,z)에서 좌우(r 방향)로 벽까지 거리. 양쪽 다 닿고 합이 최대 길이 이하일 때만 */
function spanAt(game, x, z, rx, rz, maxLen) {
  const dl = game.world.rayDistance(x, z, -rx, -rz, maxLen, wallFilter);
  const dr = game.world.rayDistance(x, z, rx, rz, maxLen, wallFilter);
  if (!Number.isFinite(dl) || !Number.isFinite(dr) || dl + dr > maxLen) return null;
  return { ax: x - rx * dl, az: z - rz * dl, bx: x + rx * dr, bz: z + rz * dr };
}

/** 함정 듀오에서 실이 움직일 수 있는 구간: 양쪽 벽이 이어지는 끝에서 끝까지 */
function sweepRange(game, th) {
  const step = TRAP_DUO.THREAD_SCAN_STEP;
  const maxLen = CLOWN.THREAD_MAX_LEN + 0.5; // 벽이 조금 넓어져도 이어지게
  const scan = (sign) => {
    let t = 0;
    while (Math.abs(t) + step <= TRAP_DUO.THREAD_SCAN_MAX) {
      const nt = t + sign * step;
      const x = th.cx + th.fx * nt;
      const z = th.cz + th.fz * nt;
      if (!game.world.isFree(x, z, 0.05) || !spanAt(game, x, z, th.rx, th.rz, maxLen)) break;
      t = nt;
    }
    return t;
  };
  return { tMin: scan(-1), tMax: scan(1) };
}

/** 광대 스킬: 좌우 양쪽 벽 사이에 실을 친다. 벽이 없으면 실패 (개수도 안 씀) */
export function placeThread(game, p) {
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  const span = spanAt(game, p.x, p.z, rx, rz, CLOWN.THREAD_MAX_LEN);
  if (!span) {
    game.emit(p.id, { t: 'event', kind: 'threadFail' });
    return null;
  }
  p.charges--;
  const th = {
    id: ++game.threadSeq,
    owner: p.id,
    cx: p.x,
    cz: p.z,
    fx: -Math.sin(p.yaw),
    fz: -Math.cos(p.yaw),
    rx,
    rz,
    t: 0,
    dir: 1,
    ...span,
  };
  Object.assign(th, sweepRange(game, th));
  game.threads.push(th);
  game.emit(p.id, { t: 'event', kind: 'threadPlaced', threadId: th.id });
  return th;
}

/** 실 이동(함정 듀오) + 밟기 판정 */
export function stepThreads(game, dt) {
  if (hasTrapDuo(game)) {
    for (const th of game.threads) {
      if (th.tMax - th.tMin < 0.01) continue;
      th.t += th.dir * TRAP_DUO.THREAD_SPEED * dt;
      if (th.t >= th.tMax) {
        th.t = th.tMax;
        th.dir = -1;
      } else if (th.t <= th.tMin) {
        th.t = th.tMin;
        th.dir = 1;
      }
      const x = th.cx + th.fx * th.t;
      const z = th.cz + th.fz * th.t;
      const span = spanAt(game, x, z, th.rx, th.rz, CLOWN.THREAD_MAX_LEN + 0.5);
      if (span) Object.assign(th, span);
    }
  }
  for (const s of survivors(game)) {
    if (game.isAirborne(s) || s.carriedBy || s.thrown) continue; // 점프로 피할 수 있다 (팔척귀신에게 들림·던져짐도)
    const idx = game.threads.findIndex(
      (th) => distToSegment(s.x, s.z, th.ax, th.az, th.bx, th.bz) <= RULES.PLAYER_RADIUS + CLOWN.THREAD_RADIUS,
    );
    if (idx === -1) continue;
    const [th] = game.threads.splice(idx, 1);
    game.addSlow(s, CLOWN.THREAD_SLOW_FACTOR, CLOWN.THREAD_SLOW_TIME);
    s.revealUntil = game.time + CLOWN.THREAD_REVEAL_TIME;
    game.emit(null, { t: 'event', kind: 'threaded', id: s.id, by: th.owner, name: s.name });
  }
}

// ───────────── 함정 듀오: 미치광이 덫 유도 ─────────────

/** 5m 안에 벽에 가리지 않은 생존자가 있으면 덫이 시속 15km로 다가간다 (벽을 따라 미끄러짐) */
export function stepHomingTraps(game, dt) {
  if (!hasTrapDuo(game)) return;
  for (const trap of game.traps) {
    let best = null;
    let bestD = TRAP_DUO.HOMING_RANGE;
    for (const s of survivors(game)) {
      const d = Math.hypot(s.x - trap.x, s.z - trap.z);
      if (d > bestD || game.world.segmentBlocked(trap.x, trap.z, s.x, s.z)) continue;
      best = s;
      bestD = d;
    }
    if (!best || bestD < 0.01) continue;
    const step = Math.min(bestD, TRAP_DUO.HOMING_SPEED * dt);
    const res = game.world.move(trap.x, trap.z, ((best.x - trap.x) / bestD) * step, ((best.z - trap.z) / bestD) * step, 0.3);
    trap.x = res.x;
    trap.z = res.z;
  }
}
