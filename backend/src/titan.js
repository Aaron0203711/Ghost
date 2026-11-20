// 입체기동 모드: 생존자 입체기동장치(와이어·벽에 붙기·떨어지기·낙하 피해), 거인 잡기, 지붕 위 총, 거인 체력.
// 판정은 모두 서버가 한다. 공중에 떠 있는 동안(날아감·붙음·떨어짐)에는 서버가 생존자 위치를 정한다.

import { RULES, ROLE, STATUS, TITAN, aimDirection } from '../../shared/constants.js';
import { randomRoofSpot } from './titanmap.js';
import { isCarriedOrThrown } from './palcheok.js';

const r2 = (v) => Math.round(v * 100) / 100;
const alive = (p) => p && p.status === STATUS.ALIVE;
const R = RULES.PLAYER_RADIUS;
const BODY = 1.7; // 생존자 몸 높이

/** 입체기동 모드 준비 (Game 생성자에서 부른다) */
export function initTitan(game) {
  game.guns = []; // 지붕 위 총 { id, x, y, z }
  game.gunSeq = 0;
  game.nextGunAt = randomGunDelay(game);
  game.tshots = []; // 날아가는 총알
  game.tshotSeq = 0;
  for (const p of game.players.values()) {
    p.y = 0;
    p.air = null; // 'fly'(와이어로 날아감) | 'stick'(벽에 붙음) | 'fall'(떨어짐)
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.peakY = 0;
    p.wire = null; // 와이어가 박힌 곳 { x, y, z }
    p.dest = null;
    p.stickUntil = 0;
    p.gun = false;
    p.grabbedAt = 0; // 거인 손에 잡힌 시각 (화면 연출용)
    if (p.role === ROLE.HUNTER) {
      p.maxHits = TITAN.HP;
      p.hits = 0;
    }
  }
}

function randomGunDelay(game) {
  return game.time + TITAN.GUN_INTERVAL_MIN + game.rand() * (TITAN.GUN_INTERVAL_MAX - TITAN.GUN_INTERVAL_MIN);
}

/** 생존자 몸(발 높이 y, 반경 R)이 (x,z)에서 장애물과 겹치는지 */
function bodyBlocked(game, x, y, z) {
  return !game.world.at(y).isFree(x, z, R);
}

// ───────────── 입체기동장치 ─────────────

/** 와이어 키: 날아가는 중이면 풀고, 아니면 조준점이 가리키는 벽·집(60m 안)에 쏜다 */
export function handleWire(game, p, msg = {}) {
  if (!game.titan || p.role !== ROLE.SURVIVOR || !alive(p) || p.dummy) return;
  if (isCarriedOrThrown(p) || p.pulledBy || game.isStunned(p)) return;
  if (p.air === 'fly') {
    // 날아가던 속도 그대로 떨어진다
    p.air = 'fall';
    p.peakY = p.y;
    p.wire = null;
    p.dest = null;
    game.emit(null, { t: 'event', kind: 'wireOff', id: p.id });
    return;
  }
  if (Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
  if (Number.isFinite(msg.pitch)) p.pitch = Math.max(-1.5, Math.min(1.5, msg.pitch));
  const dir = aimDirection(p.yaw, p.pitch);
  const eye = p.y + RULES.EYE_HEIGHT;
  const hit = game.world.ray3(p.x, eye, p.z, dir.x, dir.y, dir.z, TITAN.WIRE_RANGE);
  if (!hit) {
    game.emit(p.id, { t: 'event', kind: 'wireMiss', id: p.id });
    return;
  }
  let dest;
  if (hit.ny > 0) {
    // 지붕(윗면)에 박히면 지붕 위에 내려선다
    dest = { x: hit.x, y: hit.y, z: hit.z, top: true };
  } else {
    // 옆면: 벽에서 몸 반경만큼 떨어진 곳에 매달린다 (와이어는 허리 높이)
    dest = { x: hit.x + hit.nx * (R + 0.05), y: Math.max(0, hit.y - 1.1), z: hit.z + hit.nz * (R + 0.05), top: false };
  }
  p.air = 'fly';
  p.wire = { x: r2(hit.x), y: r2(hit.y), z: r2(hit.z) };
  p.dest = dest;
  p.budget = 0;
  p.interact = false;
  p.jumpUntil = 0;
  game.emit(null, { t: 'event', kind: 'wire', id: p.id, x: p.wire.x, y: p.wire.y, z: p.wire.z });
}

/** 땅(또는 지붕)에 내려섬. 10m 이상 높이에서 떨어졌으면 0.5칸 */
function land(game, p, y) {
  const drop = (p.air === 'fall' ? p.peakY : p.y) - y;
  p.y = y;
  p.air = null;
  p.vx = p.vy = p.vz = 0;
  p.wire = null;
  p.dest = null;
  p.budget = 0;
  game.correct(p);
  game.emit(null, { t: 'event', kind: 'land', id: p.id, drop: r2(drop) });
  if (drop >= TITAN.FALL_DAMAGE_HEIGHT - 1e-6) game.damage(p, null, TITAN.FALL_DAMAGE, { fall: 1, drop: r2(drop) }, { invuln: false, raw: true });
}

function stick(game, p) {
  p.air = 'stick';
  p.stickUntil = game.time + TITAN.STICK_TIME;
  p.vx = p.vy = p.vz = 0;
  p.dest = null;
  game.emit(null, { t: 'event', kind: 'stick', id: p.id });
}

function startFall(game, p, vx = 0, vy = 0, vz = 0) {
  p.air = 'fall';
  p.vx = vx;
  p.vy = vy;
  p.vz = vz;
  p.peakY = p.y;
  p.wire = null;
  p.dest = null;
  p.budget = 0;
}

/** 와이어로 날아가기: 박힌 곳까지 일자로. 도중에 벽에 닿으면 붙고, 지붕 끝 2.2m 안이면 올라선다 */
function stepFly(game, p, dt) {
  const d = p.dest;
  let remain = TITAN.WIRE_SPEED * dt;
  while (remain > 1e-6 && p.air === 'fly') {
    const dx = d.x - p.x;
    const dy = d.y - p.y;
    const dz = d.z - p.z;
    const dist = Math.hypot(dx, dy, dz);
    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;
    const uz = dist > 0 ? dz / dist : 0;
    p.vx = ux * TITAN.WIRE_SPEED;
    p.vy = uy * TITAN.WIRE_SPEED;
    p.vz = uz * TITAN.WIRE_SPEED;
    const s = Math.min(0.5, remain, dist);
    remain -= s;
    const nx = p.x + ux * s;
    const ny = Math.max(0, p.y + uy * s);
    const nz = p.z + uz * s;
    if (bodyBlocked(game, nx, ny, nz)) {
      // 지붕 끝이 가까우면 올라선다
      const top = game.world.supportAt(nx, nz, ny + 2.2, R);
      if (top > ny && top - ny <= 2.2 && !bodyBlocked(game, nx, top, nz)) {
        p.x = nx;
        p.z = nz;
        land(game, p, top);
        return;
      }
      if (p.y <= 0.05) {
        land(game, p, 0);
        return;
      }
      stick(game, p);
      return;
    }
    p.x = nx;
    p.y = ny;
    p.z = nz;
    if (dist - s <= 1e-4) {
      if (d.top) land(game, p, game.world.supportAt(p.x, p.z, p.y + 0.3) || d.y);
      else if (p.y <= 0.05) land(game, p, 0);
      else stick(game, p);
      return;
    }
  }
}

/** 떨어지기: 중력, 수평 속도는 벽에 막히면 멈춤. 발밑(땅·지붕)에 닿으면 착지 */
function stepFall(game, p, dt) {
  p.vy = Math.max(-TITAN.MAX_FALL_SPEED, p.vy - TITAN.GRAVITY * dt);
  if (p.vx || p.vz) {
    const res = game.world.at(p.y).move(p.x, p.z, p.vx * dt, p.vz * dt, R);
    const want = Math.hypot(p.vx * dt, p.vz * dt);
    const got = Math.hypot(res.x - p.x, res.z - p.z);
    if (got < want * 0.5) {
      p.vx = 0;
      p.vz = 0;
    }
    p.x = res.x;
    p.z = res.z;
  }
  const ny = p.y + p.vy * dt;
  if (ny > p.peakY) p.peakY = ny;
  const ground = game.world.supportAt(p.x, p.z, p.y, R * 0.5);
  if (ny <= ground) {
    land(game, p, ground);
    return;
  }
  p.y = ny;
}

// ───────────── 거인: 잡기 ─────────────

/** 거인 잡기: 정면 부채꼴, 몸 바깥 8m 안, 높이 25m까지의 가장 가까운 생존자(닌자 분신 포함) 1칸. 벽 너머는 안 됨 */
export function titanGrab(game, p) {
  p.attackReadyAt = game.time + TITAN.GRAB_COOLDOWN;
  game.emit(null, { t: 'event', kind: 'swing', id: p.id });
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  let best = null;
  let bestD = Infinity;
  const list = [...game.players.values(), ...game.clones.map((c) => ({ ...c, clone: c, role: ROLE.SURVIVOR, status: STATUS.ALIVE }))];
  for (const s of list) {
    if (s.role !== ROLE.SURVIVOR || !alive(s)) continue;
    const y = s.y || 0;
    if (y > TITAN.HEIGHT) continue;
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > TITAN.GRAB_RANGE + TITAN.RADIUS + R) continue;
    if (d > TITAN.RADIUS && (dx * fx + dz * fz) / d < Math.cos(RULES.ATTACK_HALF_ANGLE)) continue;
    if (!grabReach(game, p, s.x, y + 0.9, s.z)) continue;
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  if (!best) return;
  if (best.clone) {
    game.hitCloneNear(best.x, best.z, 0.05, p.id);
    return;
  }
  if (game.time < best.invulnUntil) return;
  game.emit(null, { t: 'event', kind: 'titanGrab', id: p.id, target: best.id });
  // 잡혔다 놓이면 와이어가 풀려 그 자리에서 떨어진다
  if (best.air === 'fly' || best.air === 'stick') startFall(game, best);
  game.damage(best, p.id, TITAN.GRAB_DAMAGE, { grab: 1 });
}

/** 거인 손이 닿는지: 머리·가슴·발 높이 중 한 곳에서라도 가리지 않으면 */
function grabReach(game, p, x, y, z) {
  for (const oy of [TITAN.HEIGHT * 0.9, TITAN.HEIGHT * 0.55, 2]) {
    if (!game.world.segmentBlocked3(p.x, oy, p.z, x, y, z)) return true;
  }
  return false;
}

// ───────────── 총 ─────────────

/** 공격 키(생존자): 총을 들고 있으면 조준점 방향으로 한 발 */
export function titanShoot(game, p, msg = {}) {
  if (!p.gun) return;
  if (Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
  if (Number.isFinite(msg.pitch)) p.pitch = Math.max(-1.5, Math.min(1.5, msg.pitch));
  p.gun = false;
  const dir = aimDirection(p.yaw, p.pitch);
  const b = { id: ++game.tshotSeq, owner: p.id, x: p.x, y: p.y + RULES.EYE_HEIGHT - 0.1, z: p.z, dir, traveled: 0 };
  game.tshots.push(b);
  game.emit(null, { t: 'event', kind: 'tshot', id: p.id, bid: b.id, x: r2(b.x), y: r2(b.y), z: r2(b.z), dx: r2(dir.x), dy: r2(dir.y), dz: r2(dir.z) });
}

function stepShots(game, dt) {
  for (const b of [...game.tshots]) {
    let remain = TITAN.BULLET_SPEED * dt;
    let end = null;
    while (remain > 0 && !end) {
      const s = Math.min(0.4, remain);
      remain -= s;
      b.x += b.dir.x * s;
      b.y += b.dir.y * s;
      b.z += b.dir.z * s;
      b.traveled += s;
      for (const h of game.players.values()) {
        if (h.role !== ROLE.HUNTER || !alive(h) || h.dive) continue;
        if (b.y < 0 || b.y > TITAN.HEIGHT) continue;
        if (Math.hypot(h.x - b.x, h.z - b.z) > TITAN.RADIUS + 0.2) continue;
        end = { hit: h.id };
        damageTitan(game, h, b.owner, TITAN.GUN_DAMAGE);
        break;
      }
      if (!end && game.world.pointBlocked(b.x, b.y, b.z)) end = { hit: null };
      if (!end && b.traveled >= TITAN.BULLET_RANGE) end = { hit: null, out: true };
    }
    if (end) {
      game.tshots.splice(game.tshots.indexOf(b), 1);
      game.emit(null, { t: 'event', kind: 'tshotEnd', bid: b.id, x: r2(b.x), y: r2(b.y), z: r2(b.z), hit: end.hit, out: !!end.out });
    }
  }
}

/** 거인 체력을 깎는다. 0이 되면 쓰러지고 생존자 승리 */
export function damageTitan(game, h, byId, amount) {
  h.hits = Math.min(h.maxHits, h.hits + amount);
  const by = game.players.get(byId);
  game.emit(null, { t: 'event', kind: 'titanHit', id: h.id, by: byId, byName: by?.name ?? '', hits: h.hits, max: h.maxHits, dmg: amount });
  if (h.hits >= h.maxHits) {
    h.status = STATUS.CAUGHT;
    game.finish('survivors', 'titanDown');
  }
}

function stepGuns(game) {
  if (game.time >= game.nextGunAt) {
    game.nextGunAt = randomGunDelay(game);
    if (game.guns.length < TITAN.GUN_MAX) {
      const spot = randomRoofSpot(game.map, game.rand);
      const g = { id: ++game.gunSeq, ...spot };
      game.guns.push(g);
      game.emit(null, { t: 'event', kind: 'gunSpawn', gid: g.id, x: g.x, y: g.y, z: g.z });
    }
  }
  // 줍기: 총 1.5m 안, 같은 높이(지붕 위)에 선 생존자. 한 자루만
  for (const s of game.players.values()) {
    if (s.role !== ROLE.SURVIVOR || !alive(s) || s.gun || s.dummy || isCarriedOrThrown(s)) continue;
    const g = game.guns.find((g) => Math.hypot(g.x - s.x, g.z - s.z) <= TITAN.GUN_PICKUP_RANGE && Math.abs(g.y - s.y) <= 1.5);
    if (!g) continue;
    game.guns.splice(game.guns.indexOf(g), 1);
    s.gun = true;
    game.emit(null, { t: 'event', kind: 'gunPick', gid: g.id, id: s.id, name: s.name });
  }
}

/** 매 틱: 공중 상태, 발밑 확인(지붕 끝에서 걸어 나가면 떨어짐), 총, 총알 */
export function stepTitan(game, dt) {
  for (const p of game.players.values()) {
    if (p.role !== ROLE.SURVIVOR || !alive(p)) continue;
    if (p.carriedBy) {
      p.y = TITAN.HEIGHT * 0.85; // 거인(팔척귀신)이 머리 위로 들고 있음
      p.air = null;
      continue;
    }
    if (p.thrown || p.pulledBy || p.dummy) continue; // 서버가 2D로 움직이는 중: 끝나면 발밑을 확인
    if (p.air === 'fly') stepFly(game, p, dt);
    else if (p.air === 'stick') {
      if (game.time >= p.stickUntil) startFall(game, p);
    } else if (p.air === 'fall') stepFall(game, p, dt);
    else {
      const ground = game.world.supportAt(p.x, p.z, p.y, R * 0.5);
      if (ground < p.y - 0.05) startFall(game, p);
      else if (ground > p.y) p.y = ground;
    }
    if (game.ended) return;
  }
  for (const c of game.clones) {
    if (c.y === undefined) continue;
    c.y = game.world.supportAt(c.x, c.z, c.y, R * 0.5); // 분신은 지붕 끝에서 바로 떨어진다
  }
  stepGuns(game);
  stepShots(game, dt);
}

/** 화면에 보낼 내 입체기동 상태 */
export function titanSnapshot(p) {
  return {
    y: r2(p.y || 0),
    ...(p.air ? { air: p.air } : {}),
    ...(p.wire ? { w: [p.wire.x, p.wire.y, p.wire.z] } : {}),
    ...(p.gun ? { gun: 1 } : {}),
  };
}
