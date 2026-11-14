// 팔척귀신: 주먹, 납치(최대 5초 들기), 던지기(15m, 다른 생존자 맞히면 둘 다 1칸)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { mulberry32, reachableCells } from '../src/mapgen.js';
import { MELEE, PALCHEOK, POLICE, CLASS_INFO, HUNTER_CLASS, eyeHeightFor, RULES } from '../../shared/constants.js';

const DT = 1 / 20;
const run = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) game.tick(DT);
};

function makeGame({ n = 4, scls = [], seed = 7 } = {}) {
  const events = [];
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  roster.slice(1).forEach((p, i) => (p.scls = scls[i]));
  const game = new Game(roster, { seed, hunters: [{ id: 'p1', cls: 'palcheok' }], theme: 'village', rand: mulberry32(seed), emit: (to, msg) => events.push({ to, msg }) });
  const ev = (kind) => events.filter((e) => e.msg.kind === kind);
  const p = (id) => game.players.get(id);
  // 다른 생존자는 멀리 치워 둔다
  for (const id of ['p2', 'p3', 'p4']) if (p(id)) Object.assign(p(id), { x: 70, z: 70 });
  return { game, events, ev, p };
}

/** 앞(-z)으로 길게 비어 있는 곳 */
function openLane(game, len = 20, r = 1.5) {
  const h = game.players.get('p1');
  const c = reachableCells(game.world, h.x, h.z).find((c) => {
    for (let d = 0; d <= len; d += 1) if (!game.world.isFree(c.x, c.z - d, r)) return false;
    return true;
  });
  assert.ok(c, '길게 비어 있는 곳');
  return c;
}

test('팔척귀신: 직업 목록, 주먹 3m 쿨타임 1.3초, 눈높이 2.3m', () => {
  assert.equal(HUNTER_CLASS.PALCHEOK, 'palcheok');
  assert.ok(CLASS_INFO.palcheok);
  assert.deepEqual(MELEE.palcheok, { range: 3, cooldown: 1.3 });
  assert.equal(eyeHeightFor('palcheok'), 2.3);
  assert.equal(eyeHeightFor('maniac'), RULES.EYE_HEIGHT);
  const { game, p } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const c = openLane(game, 4);
  Object.assign(h, { x: c.x, z: c.z, yaw: 0 });
  Object.assign(s, { x: c.x, z: c.z - 2.8 });
  game.handleAttack('p1');
  assert.equal(s.hits, 1);
  run(game, 1.1);
  game.handleAttack('p1');
  assert.equal(s.hits, 1, '쿨타임 1.3초');
  run(game, 0.3);
  game.handleAttack('p1');
  assert.equal(s.hits, 2);
});

test('납치: 3m 안 생존자를 피해 없이 들고, 들고 있는 동안 주먹 불가·생존자는 따라다님', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const c = openLane(game, 10);
  Object.assign(h, { x: c.x, z: c.z, yaw: 0 });
  Object.assign(s, { x: c.x, z: c.z - 2.5 });
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(ev('grab').length, 1);
  assert.equal(h.carrying, 'p2');
  assert.equal(s.carriedBy, 'p1');
  assert.equal(s.hits, 0, '잡을 때 피해 없음');
  // 생존자는 조작 불가
  game.handleInput('p2', { x: s.x + 1, z: s.z, corr: s.corr, moving: true });
  assert.equal(s.x, h.x);
  // 주먹 불가
  game.handleAttack('p1');
  assert.equal(ev('swing').length, 0);
  // 팔척귀신이 움직이면 따라온다
  h.x += 1;
  run(game, 0.1);
  assert.equal(s.x, h.x);
  assert.equal(s.z, h.z);
  const snap = game.snapshotFor('p3');
  assert.equal(snap.players.find((q) => q.id === 'p2').carry, 'p1');
});

test('빗나가면(3m 안에 없으면) 쿨타임 9초', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const c = openLane(game, 10);
  Object.assign(h, { x: c.x, z: c.z, yaw: 0 });
  Object.assign(s, { x: c.x, z: c.z - 5 });
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(ev('grabMiss').length, 1);
  assert.ok(Math.abs(h.skillReadyAt - game.time - PALCHEOK.SKILL_COOLDOWN) < 1e-9);
  Object.assign(s, { x: c.x, z: c.z - 2 });
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(h.carrying, null, '쿨타임 중');
});

test('5초 안에 안 던지면 발밑에 피해 없이 내려놓고 0.7초 기절, 그때부터 쿨타임 9초', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const c = openLane(game, 10);
  Object.assign(h, { x: c.x, z: c.z, yaw: 0 });
  Object.assign(s, { x: c.x, z: c.z - 2 });
  game.handleSkill('p1', { yaw: 0 });
  run(game, 4.9);
  assert.equal(h.carrying, 'p2');
  run(game, 0.15);
  assert.equal(h.carrying, null);
  assert.equal(s.carriedBy, null);
  assert.equal(s.hits, 0);
  assert.equal(ev('drop')[0].msg.reason, 'timeout');
  assert.ok(Math.hypot(s.x - h.x, s.z - h.z) < 1.2, '발밑');
  assert.ok(game.isStunned(h));
  assert.ok(Math.abs(h.stunUntil - game.time - PALCHEOK.DROP_STUN) < 0.06);
  assert.ok(Math.abs(h.skillReadyAt - game.time - PALCHEOK.SKILL_COOLDOWN) < 0.06);
});

test('던지기: 아무것도 안 맞고 15m 날아가 떨어지면 피해 없음, 쿨타임은 던진 뒤부터', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const c = openLane(game, 18);
  Object.assign(h, { x: c.x, z: c.z, yaw: 0 });
  Object.assign(s, { x: c.x, z: c.z - 2 });
  game.handleSkill('p1', { yaw: 0 });
  run(game, 1);
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(ev('throw').length, 1);
  assert.ok(Math.abs(h.skillReadyAt - game.time - PALCHEOK.SKILL_COOLDOWN) < 1e-9);
  run(game, 0.5);
  assert.ok(s.thrown, '초속 20m: 0.5초면 아직 날아가는 중');
  run(game, 0.5);
  assert.equal(s.thrown, null);
  assert.equal(ev('thrownEnd')[0].msg.reason, 'land');
  assert.ok(Math.abs(Math.hypot(s.x - c.x, s.z - c.z) - PALCHEOK.THROW_RANGE) < 0.05);
  assert.equal(s.hits, 0);
});

test('던지기: 다른 생존자를 맞히면 두 사람 모두 1칸', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const o = p('p3');
  const c = openLane(game, 18);
  Object.assign(h, { x: c.x, z: c.z, yaw: 0 });
  Object.assign(s, { x: c.x, z: c.z - 2 });
  game.handleSkill('p1', { yaw: 0 });
  Object.assign(o, { x: c.x, z: c.z - 8 });
  game.handleSkill('p1', { yaw: 0 });
  run(game, 1);
  assert.equal(ev('thrownEnd')[0].msg.reason, 'hit');
  assert.equal(s.hits, 1);
  assert.equal(o.hits, 1);
});

test('던지기: 벽에 부딪히면 던져진 생존자만 1칸', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const cells = reachableCells(game.world, h.x, h.z);
  // 앞(-z) 3~10m 사이에 벽이 있는 곳
  const c = cells.find((c) => {
    if (!game.world.isFree(c.x, c.z, 1)) return false;
    let d = 1;
    while (d < 12 && game.world.isFree(c.x, c.z - d, 0.4)) d += 0.25;
    return d > 3 && d < 10;
  });
  assert.ok(c);
  Object.assign(h, { x: c.x, z: c.z, yaw: 0 });
  Object.assign(s, { x: c.x, z: c.z - 0.5 });
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(h.carrying, 'p2');
  game.handleSkill('p1', { yaw: 0 });
  run(game, 1);
  assert.equal(ev('thrownEnd')[0].msg.reason, 'wall');
  assert.equal(s.hits, 1);
  assert.ok(game.world.isFree(s.x, s.z, RULES.PLAYER_RADIUS - 0.01), '벽 안에 박히지 않음');
});

test('테이저건에 맞으면 들고 있던 생존자를 놓친다', () => {
  const { game, p, ev } = makeGame({ scls: ['doctor', 'police'] });
  const h = p('p1');
  const s = p('p2');
  const cop = p('p3');
  const c = openLane(game, 12);
  Object.assign(h, { x: c.x, z: c.z, yaw: 0 });
  Object.assign(s, { x: c.x, z: c.z - 2 });
  game.handleSkill('p1', { yaw: 0 });
  Object.assign(cop, { x: c.x, z: c.z - 6, yaw: Math.PI }); // +z(팔척귀신 쪽)을 봄
  game.handleSkill('p3', { yaw: Math.PI });
  run(game, 0.5);
  assert.equal(ev('drop')[0]?.msg.reason, 'taser');
  assert.equal(h.carrying, null);
  assert.equal(s.carriedBy, null);
  assert.ok(h.stunUntil - game.time > POLICE.STUN - 1);
});

test('들려 있는 동안에는 발전기 수리·탈출 불가', () => {
  const { game, p } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const g = game.gens[0];
  const c = openLane(game, 4);
  Object.assign(h, { x: c.x, z: c.z, yaw: 0 });
  Object.assign(s, { x: c.x, z: c.z - 2 });
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(h.carrying, 'p2');
  Object.assign(h, { x: g.x + 1.3, z: g.z });
  run(game, 0.05);
  assert.ok(Math.hypot(s.x - g.x, s.z - g.z) <= RULES.GENERATOR_INTERACT_RANGE);
  s.interact = true;
  run(game, 0.5);
  assert.equal(g.progress, 0);
  game.exit = { x: h.x, z: h.z, rot: 0 };
  run(game, 0.1);
  assert.equal(s.status, 'alive');
});
