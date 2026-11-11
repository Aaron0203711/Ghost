// 두 번째 대규모 업데이트: 밸런스 조정, 광대, 함정 듀오, 생존자 직업
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { mulberry32 } from '../src/mapgen.js';
import { RoomManager } from '../src/rooms.js';
import { RULES, STATUS, CLOWN, TRAP_DUO, POLICE, SOLDIER, NINJA, speedFor } from '../../shared/constants.js';

const DT = 1 / 20;
const run = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) game.tick(DT);
};

/** hunters: [{id, cls}], scls: 생존자 직업 목록 (p{hunters+1}부터) */
function makeGame({ n = 3, hunters = [{ id: 'p1', cls: 'maniac' }], scls = [], seed = 7 } = {}) {
  const events = [];
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  roster.slice(hunters.length).forEach((p, i) => (p.scls = scls[i]));
  const game = new Game(roster, { seed, hunters, rand: mulberry32(seed), emit: (to, msg) => events.push({ to, msg }) });
  const ev = (kind) => events.filter((e) => e.msg.kind === kind);
  return { game, events, ev, p: (id) => game.players.get(id) };
}

/** 장애물이 하나도 없는 맵 바깥 빈 땅의 한 점. 다른 플레이어는 멀리 치운다 */
function clearSpot(game, keep) {
  for (const p of game.players.values()) if (!keep.includes(p)) p.x = p.z = 1000;
  return { x: 500, z: 500 };
}

/** 원하는 곳에 담장 두 개를 세운다 (x0 ± half, z 방향으로 길이 len) */
function addWalls(game, x0, z0, half = 2, len = 6) {
  for (const s of [-1, 1]) game.world.add({ kind: 'wall', x: x0 + s * half, z: z0, w: 0.2, d: len, h: 1.9 });
}

const speedNow = (game, s) => {
  const sl = game.slowState(s);
  return speedFor('survivor', s.wantsRun, { slowFactor: sl.factor, noRun: sl.noRun });
};

// ───────────── 1. 밸런스 조정 ─────────────

test('미치광이: 덫이 풀린 뒤 1.5초 동안 이동 속도 15% 감소 + 달리기 불가', () => {
  const { game, p } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const spot = clearSpot(game, [h, s]);
  h.x = spot.x;
  h.z = spot.z;
  game.handleTrap('p1');
  s.x = spot.x;
  s.z = spot.z + 0.3;
  s.wantsRun = true;
  s.moving = true;
  game.tick(DT);
  assert.ok(game.isStunned(s));
  assert.equal(game.slowState(s).factor, 1, '덫에 걸린 동안은 아직 감속 표시 없음 (이동 불가)');
  run(game, 3.05);
  assert.ok(!game.isStunned(s));
  const sl = game.slowState(s);
  assert.equal(sl.factor, 0.85);
  assert.ok(sl.noRun);
  assert.ok(Math.abs(speedNow(game, s) - RULES.SURVIVOR_WALK_SPEED * 0.85) < 1e-9, '달리려 해도 걷기 속도의 85%');
  const stamina = s.stamina;
  run(game, 0.5);
  assert.ok(!s.running && s.stamina >= stamina, '달리기 불가라 스태미나도 안 닳음');
  run(game, 1.1);
  assert.equal(game.slowState(s).factor, 1, '1.5초 뒤 원래대로');
  assert.ok(!game.slowState(s).noRun);
});

function sniperShot(aim) {
  const { game, p } = makeGame({ hunters: [{ id: 'p1', cls: 'sniper' }] });
  const h = p('p1');
  const s = p('p2');
  // 총알은 맵 밖으로 나가면 사라지므로 맵 안의 탁 트인 바깥 도로에서
  const spot = { x: game.map.exits[0].x, z: game.map.exits[0].z + 3 };
  p('p3').x = p('p3').z = 1000;
  h.x = spot.x;
  h.z = spot.z;
  h.yaw = 0;
  h.pitch = -0.1;
  s.x = spot.x;
  s.z = spot.z - 5;
  h.aiming = aim;
  game.handleAttack('p1', { yaw: 0, pitch: -0.1 });
  run(game, 0.2);
  return { game, s };
}

test('저격수: 조준한 상태로 맞히면 생존자 2초간 이동 속도 10% 감소', () => {
  const { game, s } = sniperShot(true);
  assert.equal(s.hits, 1);
  assert.equal(game.slowState(s).factor, 0.9);
  assert.ok(!game.slowState(s).noRun, '달리기는 가능');
  run(game, 2);
  assert.equal(game.slowState(s).factor, 1);
});

test('저격수: 조준하지 않고 맞히면 감속 없음', () => {
  const { game, s } = sniperShot(false);
  assert.equal(s.hits, 1);
  assert.equal(game.slowState(s).factor, 1);
});

// ───────────── 2. 광대 ─────────────

test('광대: 공은 반 칸, 쿨타임 0.5초, 포물선으로 떨어짐', () => {
  const { game, p, ev } = makeGame({ hunters: [{ id: 'p1', cls: 'clown' }] });
  const h = p('p1');
  const s = p('p2');
  const spot = clearSpot(game, [h, s]);
  Object.assign(h, { x: spot.x, z: spot.z, yaw: 0, pitch: 0 });
  s.x = spot.x;
  s.z = spot.z - 4;
  game.handleAttack('p1', { yaw: 0, pitch: 0 });
  game.handleAttack('p1', { yaw: 0, pitch: 0 }); // 쿨타임 중
  assert.equal(game.balls.length, 1);
  run(game, 0.5);
  assert.equal(s.hits, 0.5, '반 칸');
  assert.equal(ev('ballEnd')[0].msg.hit, 'p2');
  assert.equal(s.status, STATUS.ALIVE);
  // 반 칸씩 6번 맞으면 잡힘 (체력 3칸)
  for (let i = 0; i < 5; i++) {
    run(game, RULES.HIT_INVULNERABLE + 0.1);
    game.handleAttack('p1', { yaw: 0, pitch: 0 });
    run(game, 0.5);
  }
  assert.equal(s.hits, 3);
  assert.equal(s.status, STATUS.CAUGHT);
});

test('광대: 공은 최대 10m, 정면으로 던지면 땅에 먼저 떨어진다', () => {
  const { game, p, ev } = makeGame({ hunters: [{ id: 'p1', cls: 'clown' }] });
  const h = p('p1');
  const s = p('p2');
  const spot = clearSpot(game, [h]);
  Object.assign(h, { x: spot.x, z: spot.z, yaw: 0, pitch: 0 });
  game.handleAttack('p1', { yaw: 0, pitch: 0 });
  run(game, 2);
  const flat = ev('ballEnd')[0].msg;
  const flatDist = Math.hypot(flat.x - spot.x, flat.z - spot.z);
  assert.ok(flat.y < 0.05, '땅에 떨어짐');
  assert.ok(flatDist > 6 && flatDist < 10, `정면 던지기 ${flatDist.toFixed(1)}m`);
  run(game, 1);
  game.handleAttack('p1', { yaw: 0, pitch: 0.5 }); // 위로 던지면 더 멀리, 단 10m에서 사라짐
  run(game, 2);
  const up = ev('ballEnd')[1].msg;
  const upDist = Math.hypot(up.x - spot.x, up.z - spot.z);
  assert.ok(upDist <= CLOWN.BALL_RANGE + 0.3 && upDist >= CLOWN.BALL_RANGE - 0.3, `위로 던지기 ${upDist.toFixed(1)}m`);
  assert.equal(s.hits, 0);
});

function clownWithWalls() {
  const ctx = makeGame({ hunters: [{ id: 'p1', cls: 'clown' }] });
  const h = ctx.p('p1');
  const s = ctx.p('p2');
  const spot = clearSpot(ctx.game, [h, s]);
  addWalls(ctx.game, spot.x, spot.z);
  Object.assign(h, { x: spot.x, z: spot.z, yaw: 0 });
  return { ...ctx, h, s, spot };
}

test('광대: 실 함정은 좌우 벽 사이에 쳐지고, 벽이 없으면 개수를 쓰지 않는다', () => {
  const { game, h, ev, spot } = clownWithWalls();
  assert.equal(h.charges, 4);
  game.handleTrap('p1');
  assert.equal(game.threads.length, 1);
  const th = game.threads[0];
  assert.ok(Math.abs(th.ax - (spot.x - 1.9)) < 0.01 && Math.abs(th.bx - (spot.x + 1.9)) < 0.01, '양쪽 벽 면까지');
  assert.equal(h.charges, 3);
  // 벽에서 멀리 떨어진 곳 (같은 도로라도 옆으로 10m 안에 양쪽 벽이 없는 곳)
  h.x = 0;
  h.z = 0;
  h.yaw = 0;
  // 한쪽에만 벽이 있거나, 벽 아닌 장애물(자판기 등)뿐이면 실패
  h.x = 700;
  h.z = 700;
  game.world.add({ kind: 'wall', x: 698, z: 700, w: 0.2, d: 4, h: 1.9 });
  game.world.add({ kind: 'vending', x: 702, z: 700, w: 0.8, d: 0.8, h: 1.8 });
  const before = game.threads.length;
  game.handleTrap('p1');
  assert.equal(game.threads.length, before);
  assert.equal(h.charges, 3, '실패하면 개수 유지');
  assert.equal(ev('threadFail').length, 1);
});

test('광대: 실은 최대 4개, 23초마다 1개 충전', () => {
  const { game, h } = clownWithWalls();
  for (let i = 0; i < 5; i++) game.handleTrap('p1');
  assert.equal(game.threads.length, 4);
  assert.equal(h.charges, 0);
  run(game, 22.9);
  assert.equal(h.charges, 0);
  run(game, 0.2);
  assert.equal(h.charges, 1);
});

test('광대: 실을 밟으면 사라지고 2초간 몸이 빛나며 50% 감속, 점프로 피할 수 있음', () => {
  const { game, h, s, spot, ev } = clownWithWalls();
  game.handleTrap('p1');
  h.x = h.z = 1000;
  // 점프 중에는 안 걸림
  s.x = spot.x + 1;
  s.z = spot.z + 1;
  game.tick(DT);
  game.handleJump('p2');
  s.z = spot.z;
  game.tick(DT);
  assert.equal(game.threads.length, 1, '공중이면 안 걸림');
  s.z = spot.z + 1;
  run(game, RULES.JUMP_TIME);
  s.z = spot.z + 0.2;
  game.tick(DT);
  assert.equal(game.threads.length, 0, '밟으면 사라짐');
  assert.equal(ev('threaded').length, 1);
  assert.equal(game.slowState(s).factor, 0.5);
  assert.ok(game.isRevealed(s));
  const snap = game.snapshotFor('p1');
  assert.equal(snap.players.find((q) => q.id === 'p2').glow, 1, '술래에게 빛나는 상태 전달');
  run(game, 2.05);
  assert.equal(game.slowState(s).factor, 1);
  assert.ok(!game.isRevealed(s));
});

test('광대: 생존자에게는 4m 안의 실만 보인다', () => {
  const { game, h, s, spot } = clownWithWalls();
  game.handleTrap('p1');
  s.x = spot.x;
  s.z = spot.z + 6;
  assert.equal(game.snapshotFor('p2').threads.length, 0);
  assert.equal(game.snapshotFor('p1').threads.length, 1);
  s.z = spot.z + 3;
  assert.equal(game.snapshotFor('p2').threads.length, 1);
  assert.ok(h);
});

// ───────────── 3. 함정 듀오 ─────────────

function duo(classes = ['maniac', 'clown']) {
  const ctx = makeGame({
    n: 6,
    hunters: [
      { id: 'p1', cls: classes[0] },
      { id: 'p2', cls: classes[1] },
    ],
  });
  const m = ctx.p('p1');
  const c = ctx.p('p2');
  const s = ctx.p('p3');
  const spot = clearSpot(ctx.game, [m, c, s]);
  return { ...ctx, m, c, s, spot };
}

test('함정 듀오: 미치광이+광대면 발동 (시작 정보에 표시)', () => {
  assert.deepEqual(duo().game.startPayload('p3').synergies, ['trapDuo']);
  assert.deepEqual(duo(['maniac', 'sniper']).game.startPayload('p3').synergies, []);
});

test('함정 듀오: 덫이 5m 안의 생존자에게 시속 15km로 다가간다', () => {
  const { game, m, c, s, spot } = duo();
  Object.assign(m, { x: spot.x, z: spot.z });
  c.x = c.z = 1000;
  game.handleTrap('p1');
  m.x = m.z = 1000;
  const trap = game.traps[0];
  s.x = spot.x;
  s.z = spot.z - 6; // 5m 밖: 그대로
  run(game, 1);
  assert.ok(Math.abs(trap.z - spot.z) < 1e-6, '5m 밖이면 안 움직임');
  s.z = spot.z - 4.9;
  run(game, 0.5);
  const moved = spot.z - trap.z;
  assert.ok(Math.abs(moved - TRAP_DUO.HOMING_SPEED * 0.5) < 0.05, `0.5초에 ${moved.toFixed(2)}m`);
  run(game, 2);
  assert.equal(game.traps.length, 0, '따라잡으면 걸림');
  assert.ok(game.isStunned(s));
});

test('함정 듀오가 아니면 덫은 움직이지 않는다', () => {
  const { game, m, s, spot } = duo(['maniac', 'sniper']);
  Object.assign(m, { x: spot.x, z: spot.z });
  game.handleTrap('p1');
  m.x = m.z = 1000;
  s.x = spot.x;
  s.z = spot.z - 3;
  run(game, 1);
  assert.equal(game.traps[0].z, spot.z);
});

test('함정 듀오: 광대 실이 벽의 끝에서 끝까지 시속 7km로 왔다 갔다 한다', () => {
  const { game, m, c, s, spot } = duo();
  addWalls(game, spot.x, spot.z, 2, 6); // 길이 6m 담장: 중심에서 앞뒤 3m
  Object.assign(c, { x: spot.x, z: spot.z, yaw: 0 });
  game.handleTrap('p2');
  c.x = c.z = m.x = m.z = 1000;
  s.x = s.z = 1000;
  const th = game.threads[0];
  assert.ok(th.tMax > 2.5 && th.tMax <= 3 && th.tMin < -2.5 && th.tMin >= -3, `구간 ${th.tMin}~${th.tMax}`);
  run(game, 1);
  assert.ok(Math.abs(th.t - TRAP_DUO.THREAD_SPEED) < 0.01, '앞으로 움직임');
  assert.ok(Math.abs(th.az - (spot.z - th.t)) < 0.01, '실 위치도 함께 움직임');
  run(game, 10);
  assert.ok(th.t >= th.tMin - 1e-6 && th.t <= th.tMax + 1e-6, '구간 안에서 왕복');
  assert.ok(th.dir === -1 || th.dir === 1);
});

// ───────────── 4. 생존자 직업 ─────────────

test('의사: 5m 안 바라본 다친 생존자를 한 칸 회복, 없으면 자신, 아무도 안 다쳤으면 안 쓰임', () => {
  const { game, p, ev } = makeGame({ n: 3, scls: ['doctor', 'police'] });
  const d = p('p2');
  const o = p('p3');
  const spot = clearSpot(game, [d, o]);
  Object.assign(d, { x: spot.x, z: spot.z, yaw: 0 });
  o.x = spot.x;
  o.z = spot.z - 3;
  game.handleSkill('p2', { yaw: 0 });
  assert.equal(ev('sskillFail').length, 1, '다친 사람 없음');
  assert.equal(d.sskillReadyAt, 0, '쿨타임 안 씀');
  o.hits = 2;
  d.hits = 1;
  game.handleSkill('p2', { yaw: 0 });
  assert.equal(o.hits, 1, '바라본 생존자 우선');
  assert.equal(d.hits, 1);
  game.handleSkill('p2', { yaw: 0 });
  assert.equal(o.hits, 1, '쿨타임 20초');
  run(game, 20.05);
  game.handleSkill('p2', { yaw: Math.PI }); // 뒤를 보면 자신
  assert.equal(d.hits, 0);
  run(game, 20.05);
  o.z = spot.z - 6; // 5m 밖
  game.handleSkill('p2', { yaw: 0 });
  assert.equal(o.hits, 1);
});

test('경찰: 테이저건은 10m까지, 맞은 술래는 4초간 이동·공격·스킬 불가, 쿨타임 21.5초', () => {
  const { game, p, ev } = makeGame({ n: 2, scls: ['police'] });
  const h = p('p1');
  const c = p('p2');
  const spot = clearSpot(game, [h, c]);
  Object.assign(c, { x: spot.x, z: spot.z, yaw: 0 });
  h.x = spot.x;
  h.z = spot.z - 12; // 10m 밖
  game.handleSkill('p2', { yaw: 0 });
  run(game, 1);
  assert.equal(ev('taserEnd')[0].msg.hit, null, '10m 밖은 안 닿음');
  assert.ok(!game.isStunned(h));
  run(game, POLICE.COOLDOWN);
  h.z = spot.z - 8;
  game.handleSkill('p2', { yaw: 0 });
  run(game, 0.4);
  assert.equal(ev('taserEnd')[1].msg.hit, 'p1');
  assert.ok(game.isStunned(h));
  c.z = h.z - 1; // 술래 바로 앞
  c.x = h.x;
  h.yaw = 0;
  game.handleAttack('p1');
  assert.equal(c.hits, 0, '스턴 중 공격 불가');
  run(game, POLICE.STUN);
  assert.ok(!game.isStunned(h));
  game.handleAttack('p1');
  assert.equal(c.hits, 1);
});

test('군인: 지름 3m 연막이 5초 유지, 안에 있는 술래는 화면이 뿌옇고 나오면 1초 뒤 풀림 (쿨타임 25초)', () => {
  const { game, p } = makeGame({ n: 2, scls: ['soldier'] });
  const h = p('p1');
  const so = p('p2');
  const spot = clearSpot(game, [h, so]);
  Object.assign(so, { x: spot.x, z: spot.z });
  h.x = spot.x + 1;
  h.z = spot.z;
  game.handleSkill('p2');
  game.tick(DT);
  assert.equal(game.snapshotFor('p1').me.smoke, 1);
  h.x = spot.x + 3;
  run(game, 0.9);
  assert.equal(game.snapshotFor('p1').me.smoke, 1, '나와도 1초간 유지');
  run(game, 0.2);
  assert.equal(game.snapshotFor('p1').me.smoke, 0);
  h.x = spot.x + 1;
  run(game, SOLDIER.DURATION);
  assert.equal(game.smokes.length, 0, '5초 뒤 사라짐');
  run(game, 1.1);
  assert.equal(game.snapshotFor('p1').me.smoke, 0);
  game.handleSkill('p2');
  assert.equal(game.smokes.length, 0, '쿨타임 25초');
});

test('푸드파이터: 체력 +4칸(7칸, 5인 규칙이면 6칸), 스태미나 5초, 7.5초에 가득', () => {
  const { game, p } = makeGame({ n: 3, scls: ['foodfighter', 'doctor'] });
  const f = p('p2');
  assert.equal(f.maxHits, 7);
  assert.equal(p('p3').maxHits, 3);
  assert.equal(f.stamina, 5);
  f.wantsRun = true;
  f.moving = true;
  run(game, 6);
  assert.equal(f.stamina, 0);
  f.wantsRun = false;
  run(game, 1 + 7.5 + 0.1);
  assert.equal(f.stamina, 5);
  f.hits = 6;
  f.invulnUntil = 0;
  game.damage(f, 'p1', 1);
  assert.equal(f.status, STATUS.CAUGHT, '7칸째에 잡힘');
  const five = makeGame({ n: 5, scls: ['foodfighter'] });
  assert.equal(five.p('p2').maxHits, 6);
});

test('닌자: 분신이 5초 동안 보던 방향으로 걷고, 술래 공격에 맞으면 사라진다 (본체는 무사)', () => {
  const { game, p, ev } = makeGame({ n: 2, scls: ['ninja'] });
  const h = p('p1');
  const nj = p('p2');
  const spot = clearSpot(game, [h, nj]);
  Object.assign(nj, { x: spot.x, z: spot.z, yaw: 0 });
  h.x = h.z = 1000;
  game.handleSkill('p2', { yaw: 0 });
  assert.equal(game.clones.length, 1);
  run(game, 1);
  const c = game.clones[0];
  assert.ok(Math.abs(spot.z - c.z - RULES.SURVIVOR_WALK_SPEED) < 0.05, '걷기 속도로 직진');
  assert.equal(game.snapshotFor('p1').clones.length, 1, '술래에게도 보임');
  run(game, 4.05);
  assert.equal(game.clones.length, 0, '5초 뒤 사라짐');
  run(game, NINJA.COOLDOWN - 5);
  game.handleSkill('p2', { yaw: 0 });
  run(game, 0.5);
  const c2 = game.clones[0];
  Object.assign(h, { x: c2.x, z: c2.z + 1.2, yaw: 0 });
  nj.x = nj.z = 900;
  game.handleAttack('p1');
  assert.equal(game.clones.length, 0, '맞으면 사라짐');
  assert.equal(ev('cloneGone').at(-1).msg.by, 'p1');
  assert.equal(nj.hits, 0);
});

test('엔지니어: 지름 3m 안의 발전기에 로봇을 붙이면 5초 동안 20% (쿨타임 10초)', () => {
  const { game, p, ev } = makeGame({ n: 2, scls: ['engineer'] });
  const e = p('p2');
  const g = game.gens[0];
  p('p1').x = p('p1').z = 1000;
  e.x = g.x + 5;
  e.z = g.z;
  game.handleSkill('p2');
  assert.equal(ev('sskillFail').at(-1).msg.reason, 'noGen');
  e.x = g.x + 1.4;
  game.handleSkill('p2');
  assert.equal(game.robots.length, 1);
  e.x = g.x + 50;
  run(game, 2.5);
  assert.ok(Math.abs(g.progress - 0.1) < 1e-6, `2.5초 ${g.progress}`);
  run(game, 3);
  assert.ok(Math.abs(g.progress - 0.2) < 1e-6, `5초 ${g.progress}`);
  assert.equal(game.robots.length, 0);
  e.x = g.x + 1.4;
  game.handleSkill('p2');
  assert.equal(game.robots.length, 0, '쿨타임 10초 (사용 시점부터)');
  run(game, 4.6);
  game.handleSkill('p2');
  assert.equal(game.robots.length, 1);
});

test('생존자 직업: 대기실에서 받은 직업이 게임에 들어가고, 이상한 값은 의사로', () => {
  const mgr = new RoomManager({ rand: mulberry32(3), autoTick: false });
  const mk = (name, scls) => {
    const inbox = [];
    const c = mgr.connect((m) => inbox.push(m));
    mgr.handle(c, { t: 'hello', name, scls });
    c.last = (t) => [...inbox].reverse().find((m) => m.t === t);
    return c;
  };
  const a = mk('A', 'ninja');
  const b = mk('B', 'hacker');
  mgr.handle(a, { t: 'create' });
  mgr.handle(b, { t: 'join', code: a.room.code, scls: 'engineer' });
  assert.deepEqual(a.last('room').players.map((q) => q.scls), ['ninja', 'engineer']);
  mgr.handle(a, { t: 'start' });
  const hunterId = a.last('classSelect').hunterIds[0];
  const hunter = [a, b].find((c) => c.id === hunterId);
  mgr.handle(hunter, { t: 'pickClass', cls: 'clown' });
  const start = a.last('start');
  const surv = start.players.find((q) => q.role === 'survivor');
  assert.equal(surv.scls, surv.id === a.id ? 'ninja' : 'engineer');
  assert.equal(start.players.find((q) => q.role === 'hunter').cls, 'clown');
  const c = mk('C', 'hacker');
  assert.equal(c.scls, 'doctor');
});
