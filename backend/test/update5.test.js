// 다섯 번째 업데이트: 생존자 직업 마라토너, 술래 직업 파묘자(무덤·좀비)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { mulberry32 } from '../src/mapgen.js';
import { addGrave, spawnZombie } from '../src/gravedigger.js';
import {
  RULES,
  STATUS,
  MELEE,
  GRAVEDIGGER,
  MARATHONER,
  POLICE,
  SOLDIER,
  CLASS_INFO,
  SURVIVOR_CLASS_INFO,
  speedFor,
  survivorSkillCooldown,
} from '../../shared/constants.js';

const DT = 1 / 20;
const run = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) game.tick(DT);
};

function makeGame({ n = 3, hunters = [{ id: 'p1', cls: 'gravedigger' }], scls = [], seed = 11 } = {}) {
  const events = [];
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  roster.slice(hunters.length).forEach((p, i) => (p.scls = scls[i]));
  const game = new Game(roster, { seed, hunters, theme: 'village', rand: mulberry32(seed), emit: (to, msg) => events.push({ to, msg }) });
  const ev = (kind) => events.filter((e) => e.msg.kind === kind);
  return { game, events, ev, p: (id) => game.players.get(id) };
}

/** 모두 맵 밖 빈 땅(500, 500 근처)으로 옮긴다 */
function clear(game) {
  for (const p of game.players.values()) Object.assign(p, { x: 1000 + Math.random(), z: 1000 });
}

// ───────────── 마라토너 ─────────────

test('마라토너: 직업 정보, 쿨타임은 효과 5초가 끝난 뒤부터 20초', () => {
  assert.ok(SURVIVOR_CLASS_INFO.marathoner);
  assert.equal(MARATHONER.DURATION, 5);
  assert.equal(MARATHONER.COOLDOWN, 20);
  assert.equal(survivorSkillCooldown('marathoner'), 25);
  const { game, p, ev } = makeGame({ hunters: [{ id: 'p1', cls: 'maniac' }], scls: ['marathoner'] });
  const s = p('p2');
  game.handleSkill('p2', { yaw: 0 });
  assert.equal(ev('sprint').length, 1);
  assert.ok(Math.abs(s.boostUntil - (game.time + 5)) < 1e-9);
  assert.ok(Math.abs(s.sskillReadyAt - (game.time + 25)) < 1e-9);
  game.handleSkill('p2', { yaw: 0 });
  assert.equal(ev('sprint').length, 1, '쿨타임 중에는 다시 못 씀');
});

test('마라토너: 스퍼트 중 달려도 스태미나가 줄지 않고, 점프도 스태미나를 쓰지 않음', () => {
  const { game, p } = makeGame({ hunters: [{ id: 'p1', cls: 'maniac' }], scls: ['marathoner'] });
  const s = p('p2');
  s.stamina = 3;
  game.handleSkill('p2', { yaw: 0 });
  for (let i = 0; i < 80; i++) {
    game.handleInput('p2', { x: s.x, z: s.z, run: true, moving: true, corr: s.corr });
    game.tick(DT);
  }
  assert.ok(s.running, '스태미나가 적어도 달림');
  assert.ok(s.stamina >= 3 - 1e-9, `스태미나 유지 (${s.stamina})`);
  s.jumpUntil = 0;
  const before = s.stamina;
  game.handleJump('p2');
  assert.ok(s.jumpUntil > game.time, '점프함');
  assert.ok(Math.abs(s.stamina - before) < 1e-9, '점프에 스태미나를 쓰지 않음');
  // 5초가 지나면 다시 줄어든다
  run(game, 2);
  const left = s.stamina;
  for (let i = 0; i < 20; i++) {
    game.handleInput('p2', { x: s.x, z: s.z, run: true, moving: true, corr: s.corr });
    game.tick(DT);
  }
  assert.ok(s.stamina < left, '스퍼트가 끝나면 스태미나를 씀');
});

test('마라토너: 스퍼트 중 이동 속도 3% 증가 (걷기·달리기 모두)', () => {
  const walk = speedFor('survivor', false, { scls: 'marathoner', boosted: true });
  const runS = speedFor('survivor', true, { scls: 'marathoner', boosted: true });
  assert.ok(Math.abs(walk - RULES.SURVIVOR_WALK_SPEED * 1.03) < 1e-9);
  assert.ok(Math.abs(runS - RULES.SURVIVOR_RUN_SPEED * 1.03) < 1e-9);
  assert.ok(Math.abs(speedFor('survivor', true, { scls: 'marathoner' }) - RULES.SURVIVOR_RUN_SPEED) < 1e-9, '평소엔 보통 속도');
});

// ───────────── 파묘자: 삽, 무덤 ─────────────

test('파묘자: 직업 정보와 삽(2.3m, 쿨타임 2초, 1칸), 이동 속도 20km/h', () => {
  assert.ok(CLASS_INFO.gravedigger);
  assert.deepEqual(MELEE.gravedigger, { range: 2.3, cooldown: 2 });
  assert.ok(Math.abs(speedFor('hunter', false, { cls: 'gravedigger' }) * 3.6 - 20) < 1e-9);
  const { game, p } = makeGame();
  const h = p('p1');
  const s = p('p2');
  clear(game);
  Object.assign(h, { x: 500, z: 500, yaw: 0 });
  Object.assign(s, { x: 500, z: 497.5 });
  game.handleAttack('p1', { yaw: 0 });
  assert.equal(s.hits, 1);
  s.invulnUntil = 0;
  game.handleAttack('p1', { yaw: 0 });
  assert.equal(s.hits, 1, '쿨타임 2초');
  Object.assign(s, { z: 497.2 }); // 2.8m: 사거리 밖
  run(game, 2);
  s.invulnUntil = 0;
  game.handleAttack('p1', { yaw: 0 });
  assert.equal(s.hits, 1, '2.3m 밖은 안 맞음');
});

test('파묘자: 12초마다 무덤이 하나씩 생기고 최대 10개', () => {
  const { game, ev } = makeGame();
  run(game, 11.9);
  assert.equal(game.graves.length, 0);
  run(game, 0.2);
  assert.equal(game.graves.length, 1);
  assert.equal(ev('grave').length, 1);
  run(game, 12 * 12);
  assert.equal(game.graves.length, GRAVEDIGGER.GRAVE_MAX);
  // 무덤은 서로 떨어져 있고 모두에게 보인다
  for (const a of game.graves) for (const b of game.graves) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 3);
  assert.equal(game.snapshotFor('p2').graves.length, GRAVEDIGGER.GRAVE_MAX);
});

test('파묘자 스킬: 30m 안 가장 가까운 무덤 2개에서 좀비, 무덤이 없으면 쿨타임 안 돎', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(ev('digFail').length, 1);
  assert.equal(h.skillReadyAt, 0, '무덤이 없으면 쿨타임 안 돎');
  game.graves.push(
    { id: 91, owner: 'p1', x: h.x + 5, z: h.z, rot: 0 },
    { id: 92, owner: 'p1', x: h.x + 10, z: h.z, rot: 0 },
    { id: 93, owner: 'p1', x: h.x + 3, z: h.z, rot: 0 },
    { id: 94, owner: 'p1', x: h.x + 35, z: h.z, rot: 0 },
  );
  game.handleSkill('p1', { yaw: 0 });
  assert.deepEqual(ev('dig')[0].msg.graves.map((g) => g.gid).sort(), [91, 93]);
  assert.equal(game.zombies.length, 2);
  assert.deepEqual(game.graves.map((g) => g.id).sort(), [92, 94]);
  assert.ok(Math.abs(h.skillReadyAt - (game.time + 10)) < 1e-9, '쿨타임 10초');
  // 30m 밖 무덤은 안 파짐
  game.graves = [{ id: 95, owner: 'p1', x: h.x + 31, z: h.z, rot: 0 }];
  h.skillReadyAt = 0;
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(game.zombies.length, 2);
  assert.equal(ev('digFail').length, 2);
});

test('무덤은 맵 안 빈 곳에 생긴다', () => {
  const { game, p } = makeGame();
  for (let i = 0; i < 10; i++) addGrave(game, p('p1'));
  for (const g of game.graves) {
    assert.ok(Math.abs(g.x) < 75 && Math.abs(g.z) < 75);
    assert.ok(game.world.isFree(g.x, g.z, 0.8));
  }
});

// ───────────── 좀비 ─────────────

test('좀비: 시속 10km, 정면 20m 안의 생존자를 쫓고 뒤쪽·20m 밖은 못 봄', () => {
  const { game, p } = makeGame({ n: 2 });
  const s = p('p2');
  clear(game);
  const zb = spawnZombie(game, 'p1', 500, 500);
  zb.yaw = 0; // -z를 봄
  Object.assign(s, { x: 500, z: 520.5 }); // 뒤쪽 20.5m
  zb.goal = { x: 500, z: 500 }; // 제자리 (돌아다니지 않게)
  game.tick(DT);
  assert.equal(zb.mode, 'wander', '뒤쪽은 안 보임');
  Object.assign(s, { x: 500, z: 479 }); // 정면 21m
  zb.yaw = 0;
  zb.goal = { x: 500, z: 500 };
  game.tick(DT);
  assert.notEqual(zb.mode, 'chase', '20m 밖은 안 보임');
  Object.assign(zb, { x: 500, z: 500, yaw: 0, goal: { x: 500, z: 500 } });
  Object.assign(s, { x: 500, z: 485 });
  game.tick(DT);
  assert.equal(zb.mode, 'chase');
  const z0 = zb.z;
  run(game, 1);
  assert.ok(Math.abs(z0 - zb.z - GRAVEDIGGER.ZOMBIE_SPEED) < 0.1, `1초에 약 2.78m (${z0 - zb.z})`);
});

test('좀비: 벽에 가린 생존자는 못 보고, 놓치면 마지막 자리로 갔다가 다시 돌아다님', () => {
  const { game, p } = makeGame({ n: 2 });
  const s = p('p2');
  clear(game);
  const zb = spawnZombie(game, 'p1', 500, 500);
  Object.assign(zb, { yaw: 0, goal: { x: 500, z: 500 } });
  game.world.add({ x: 500, z: 495, w: 6, d: 0.3, h: 1.9 }); // 사이에 담장
  Object.assign(s, { x: 500, z: 490 });
  game.tick(DT);
  assert.notEqual(zb.mode, 'chase', '벽 너머는 안 보임');
  Object.assign(s, { x: 510, z: 500 }); // 오른쪽 (yaw=0 기준 90°): 시야 밖
  Object.assign(zb, { yaw: -Math.PI / 2, goal: null }); // +x를 봄
  game.tick(DT);
  assert.equal(zb.mode, 'chase');
  s.x = 1000; // 사라짐
  game.tick(DT);
  assert.equal(zb.mode, 'search');
  run(game, 6);
  assert.equal(zb.mode, 'wander');
});

test('좀비 공격: 1.5m, 쿨타임 1.5초, 1칸 (무적 1.5초는 그대로)', () => {
  const { game, p, ev } = makeGame({ n: 3 });
  const s = p('p2');
  clear(game);
  const zb = spawnZombie(game, 'p1', 500, 500);
  Object.assign(zb, { yaw: 0 });
  Object.assign(s, { x: 500, z: 498.3 }); // 1.7m (반경 포함하면 사거리 안)
  game.tick(DT);
  assert.equal(s.hits, 1);
  assert.ok(ev('hit')[0].msg.zombie);
  run(game, 1.2);
  assert.equal(s.hits, 1, '쿨타임 1.5초');
  run(game, 0.5);
  assert.equal(s.hits, 2);
});

test('좀비 공격: 2인 규칙이면 술래 피해처럼 50% 감소', () => {
  const { game, p } = makeGame({ n: 2 });
  const s = p('p2');
  clear(game);
  Object.assign(spawnZombie(game, 'p1', 500, 500), { yaw: 0 });
  Object.assign(s, { x: 500, z: 498.3 });
  game.tick(DT);
  assert.equal(s.hits, 0.5);
});

test('좀비화: 좀비나 파묘자에게 잡히면 그 자리에서 좀비가 됨 (그 생존자 모습)', () => {
  const { game, p, ev } = makeGame({ n: 4, scls: ['ninja', 'doctor', 'police'] });
  const h = p('p1');
  const a = p('p2');
  const b = p('p3');
  clear(game);
  // 파묘자 삽으로 잡음
  Object.assign(h, { x: 500, z: 500, yaw: 0 });
  Object.assign(a, { x: 500, z: 498, hits: 2 });
  game.handleAttack('p1', { yaw: 0 });
  assert.equal(a.status, STATUS.CAUGHT);
  assert.equal(game.zombies.length, 1);
  assert.equal(game.zombies[0].from, 'p2');
  assert.equal(game.zombies[0].look, 'ninja');
  assert.equal(ev('caught')[0].msg.zombified, game.zombies[0].id);
  // 좀비로 잡음 → 또 좀비
  Object.assign(h, { x: 2000, z: 2000 });
  const zb = game.zombies[0];
  Object.assign(zb, { x: 600, z: 600, yaw: 0 });
  Object.assign(b, { x: 600, z: 598.5, hits: 2 });
  game.tick(DT);
  assert.equal(b.status, STATUS.CAUGHT);
  assert.equal(game.zombies.length, 2);
  assert.equal(game.zombies[1].from, 'p3');
  // 스냅샷: 좀비 모습 정보
  const snap = game.snapshotFor('p4');
  assert.equal(snap.zombies.find((x) => x.f === 'p3').lk, 'doctor');
});

test('좀비화: 다른 술래(동료)에게 잡히면 좀비가 되지 않음', () => {
  const { game, p } = makeGame({ n: 6, hunters: [{ id: 'p1', cls: 'gravedigger' }, { id: 'p2', cls: 'maniac' }] });
  const m = p('p2');
  const s = p('p3');
  clear(game);
  Object.assign(m, { x: 500, z: 500, yaw: 0 });
  Object.assign(s, { x: 500, z: 498, hits: 2 });
  game.handleAttack('p2', { yaw: 0 });
  assert.equal(s.status, STATUS.CAUGHT);
  assert.equal(game.zombies.length, 0);
});

test('좀비: 테이저건에 맞으면 4초 스턴, 소총에 맞으면 2초 감속', () => {
  const { game, p, ev } = makeGame({ n: 3, scls: ['police', 'soldier'] });
  const cop = p('p2');
  const sol = p('p3');
  clear(game);
  const zb = spawnZombie(game, 'p1', 500, 495);
  zb.goal = { x: 500, z: 495 };
  Object.assign(cop, { x: 500, z: 500, yaw: 0 }); // 좀비를 바라봄, 좀비는 -z를 봐서 경찰을 못 봄
  zb.yaw = 0;
  game.handleSkill('p2', { yaw: 0 });
  run(game, 0.3);
  assert.equal(ev('taserEnd')[0].msg.zombie, zb.id);
  assert.ok(zb.stunUntil > game.time + POLICE.STUN - 0.5);
  // 스턴 중에는 움직이지 않는다
  Object.assign(cop, { x: 1000 });
  zb.mode = 'chase';
  const z0 = { x: zb.x, z: zb.z };
  run(game, 1);
  assert.deepEqual({ x: zb.x, z: zb.z }, z0);
  zb.stunUntil = 0;
  Object.assign(sol, { x: 500, z: 500, yaw: 0 });
  game.handleSkill('p3', { yaw: 0 });
  run(game, 0.2);
  assert.equal(ev('rifleEnd')[0].msg.zombie, zb.id);
  assert.ok(zb.rifleSlowUntil > game.time + SOLDIER.SLOW_TIME - 0.5);
});

test('좀비: 닌자 분신도 쫓아가 때리면 분신이 사라짐', () => {
  const { game, p, ev } = makeGame({ n: 2, scls: ['ninja'] });
  const s = p('p2');
  clear(game);
  const zb = spawnZombie(game, 'p1', 500, 500);
  Object.assign(zb, { yaw: 0 });
  game.clones.push({ id: 7, owner: 'p2', x: 500, z: 498.5, yaw: 0, dir: { x: 0, z: 0 }, until: 99 });
  s.x = 1000;
  game.tick(DT);
  assert.equal(game.clones.length, 0);
  assert.equal(ev('cloneGone')[0].msg.cid, 7);
  assert.equal(s.hits, 0);
});

test('파묘자 훈련장: 허수아비는 잡혀도 좀비가 되지 않음', () => {
  const events = [];
  const game = new Game([{ id: 'me', name: '나' }], { training: { mode: 'hunter', cls: 'gravedigger' }, seed: 3, rand: mulberry32(3), emit: (to, msg) => events.push(msg) });
  const d = game.players.get('d1');
  spawnZombie(game, 'me', d.x, d.z + 1.2).yaw = 0;
  d.hits = 2;
  game.tick(DT);
  assert.equal(d.status, STATUS.CAUGHT);
  assert.equal(game.zombies.length, 1);
});
