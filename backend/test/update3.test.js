// 세 번째 업데이트: 익사자, 시너지(바다의 저주, 최고의 스파이들), 함정 듀오 → 정신병원
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { mulberry32, reachableCells } from '../src/mapgen.js';
import { RULES, STATUS, DROWNED, SEA_CURSE, SPIES, SYNERGY_INFO, MELEE, CAPTAIN, POLICE, synergiesFor } from '../../shared/constants.js';

const DT = 1 / 20;
const run = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) game.tick(DT);
};

function makeGame({ n = 3, hunters = [{ id: 'p1', cls: 'drowned' }], scls = [], seed = 7 } = {}) {
  const events = [];
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  roster.slice(hunters.length).forEach((p, i) => (p.scls = scls[i]));
  const game = new Game(roster, { seed, hunters, theme: 'village', rand: mulberry32(seed), emit: (to, msg) => events.push({ to, msg }) });
  const ev = (kind) => events.filter((e) => e.msg.kind === kind);
  return { game, events, ev, p: (id) => game.players.get(id) };
}

/** 맵 안에서 반경 r만큼 비어 있는, 걸어서 갈 수 있는 곳 */
function openSpot(game, r = 5) {
  const h = game.players.get('p1');
  const c = reachableCells(game.world, h.x, h.z).find((c) => game.world.isFree(c.x, c.z, r));
  assert.ok(c, '넓은 빈 곳');
  return c;
}

test('익사자: 직업 목록에 있고 작살은 미치광이와 같은 사거리, 쿨타임 1.5초', () => {
  assert.equal(MELEE.drowned.range, MELEE.maniac.range);
  assert.equal(MELEE.drowned.cooldown, 1.5);
  const { game, p } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const spot = openSpot(game);
  Object.assign(h, { x: spot.x, z: spot.z, yaw: 0 });
  Object.assign(s, { x: spot.x, z: spot.z - 2.5 });
  game.handleAttack('p1');
  assert.equal(s.hits, 1);
  run(game, 1.2);
  game.handleAttack('p1');
  assert.equal(s.hits, 1, '쿨타임 1.5초');
  run(game, 0.4);
  game.handleAttack('p1');
  assert.equal(s.hits, 2);
});

test('익사자 다이빙: 0.5초 땅속(안 보임·이동 불가) 뒤 도착 지점에서 튀어나와 원 안 생존자를 2m 튕기고 2초 30% 감속', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const far = p('p3');
  const spot = openSpot(game, 6);
  Object.assign(h, { x: spot.x, z: spot.z + 12, yaw: 0 });
  Object.assign(s, { x: spot.x + 1.5, z: spot.z }); // 원(반지름 2m) 안
  Object.assign(far, { x: spot.x + 3, z: spot.z }); // 원(반지름 2m) 밖
  const farPos = { x: far.x, z: far.z };
  game.handleSkill('p1', { yaw: 0, tx: spot.x, tz: spot.z });
  assert.equal(ev('dive').length, 1);
  assert.equal(ev('dive')[0].msg.r, DROWNED.DIVE_RADIUS, '모두에게 도착 원');
  assert.equal(ev('dive')[0].to, null);
  // 땅속: 생존자에게 위치를 보내지 않고, 공격 불가
  const snap = game.snapshotFor('p2').players.find((q) => q.id === 'p1');
  assert.equal(snap.hidden, 1);
  game.handleAttack('p1');
  assert.equal(ev('swing').length, 0);
  run(game, 0.3);
  assert.ok(Math.hypot(h.x - spot.x, h.z - spot.z) > 5, '아직 땅속');
  run(game, 0.3);
  assert.ok(Math.hypot(h.x - spot.x, h.z - spot.z) < 0.6, '도착 지점에서 튀어나옴');
  assert.ok(Math.abs(s.x - (spot.x + 3.5)) < 0.05, `바깥으로 2m (${s.x - spot.x})`);
  assert.equal(s.hits, 0, '피해 없음');
  assert.equal(game.slowState(s).factor, DROWNED.SLOW_FACTOR);
  assert.deepEqual({ x: far.x, z: far.z }, farPos, '원 밖은 그대로');
  assert.equal(game.slowState(far).factor, 1);
  assert.deepEqual(ev('diveEnd')[0].msg.hits, ['p2']);
  run(game, DROWNED.SLOW_TIME);
  assert.equal(game.slowState(s).factor, 1, '2초 뒤 풀림');
  // 쿨타임 20초 (쓴 순간부터)
  game.handleSkill('p1', { yaw: 0, tx: spot.x, tz: spot.z });
  assert.equal(ev('dive').length, 1);
  run(game, DROWNED.SKILL_COOLDOWN - DROWNED.SLOW_TIME - 0.6 + 0.1);
  game.handleSkill('p1', { yaw: 0, tx: spot.x, tz: spot.z });
  assert.equal(ev('dive').length, 2);
});

test('익사자 다이빙: 25m 넘게 조준하면 25m로 줄고, 땅속에서는 테이저건에 맞지 않는다', () => {
  const { game, p, ev } = makeGame({ scls: ['police'] });
  const h = p('p1');
  const cop = p('p2');
  p('p3').x = 1000;
  const spot = openSpot(game, 2);
  Object.assign(h, { x: spot.x, z: spot.z, yaw: 0 });
  game.handleSkill('p1', { yaw: 0, tx: spot.x, tz: spot.z - 60 });
  const d = ev('dive')[0].msg;
  assert.ok(Math.hypot(d.x - spot.x, d.z - spot.z) <= DROWNED.DIVE_RANGE + 0.5, `${Math.hypot(d.x - spot.x, d.z - spot.z)}m`);
  assert.ok(game.world.isFree(d.x, d.z, RULES.PLAYER_RADIUS), '서 있을 수 있는 곳');
  // 테이저건이 땅속 익사자를 지나간다
  Object.assign(cop, { x: h.x, z: h.z + 3, yaw: 0 });
  game.handleSkill('p2', { yaw: 0 });
  run(game, 0.3);
  assert.ok(!game.isStunned(h));
  assert.notEqual(ev('taserEnd')[0]?.msg.hit, 'p1');
});

test('시너지 이름과 조합', () => {
  assert.equal(SYNERGY_INFO.trapDuo.name, '정신병원');
  assert.deepEqual(synergiesFor(['captain', 'drowned']), ['seaCurse']);
  assert.deepEqual(synergiesFor(['assassin', 'sniper']), ['spies']);
  assert.deepEqual(synergiesFor(['captain', 'sniper']), []);
});

/** 앞(-z)으로 len m가 트인 줄 (저격 시험용) */
function openLine(game, len) {
  const h = game.players.get('p1');
  const c = reachableCells(game.world, h.x, h.z).find(
    (c) => game.world.isFree(c.x, c.z, 0.6) && game.world.isFree(c.x, c.z - len, 0.6) && !game.world.segmentBlocked(c.x, c.z, c.x, c.z - len) &&
      !game.world.segmentBlocked(c.x - 0.5, c.z, c.x - 0.5, c.z - len) && !game.world.segmentBlocked(c.x + 0.5, c.z, c.x + 0.5, c.z - len),
  );
  assert.ok(c, '트인 줄');
  return c;
}

function duo(classes) {
  const ctx = makeGame({ n: 6, hunters: classes.map((cls, i) => ({ id: `p${i + 1}`, cls })) });
  return { ...ctx, a: ctx.p('p1'), b: ctx.p('p2'), s: ctx.p('p3') };
}

test('바다의 저주: 닻 판정 1.5m, 다이빙 지름 7m·거리 무제한', () => {
  const { game, a, b, s, ev } = duo(['captain', 'drowned']);
  assert.deepEqual(game.synergies, ['seaCurse']);
  for (const q of game.players.values()) if (q.role === 'survivor') q.x = 1000;
  const spot = openSpot(game, 6);
  // 닻: 1.3m 옆을 지나가도 맞는다 (보통은 0.8m)
  Object.assign(a, { x: spot.x, z: spot.z + 4, yaw: 0 });
  b.x = 1000;
  Object.assign(s, { x: spot.x + 1.3 + RULES.PLAYER_RADIUS - 0.1, z: spot.z - 2 });
  game.handleSkill('p1', { yaw: 0 });
  run(game, 0.5);
  assert.equal(ev('anchorEnd')[0].msg.hit, 'p3');
  assert.ok(SEA_CURSE.ANCHOR_RADIUS > CAPTAIN.ANCHOR_RADIUS);
  run(game, 2);
  a.x = 1000;
  // 다이빙: 3.5m 떨어진 생존자도 튕김(보통은 2m), 멀리도 감
  Object.assign(b, { x: spot.x, z: spot.z, yaw: 0 });
  const target = reachableCells(game.world, spot.x, spot.z).find((c) => Math.hypot(c.x - spot.x, c.z - spot.z) > 45 && game.world.isFree(c.x, c.z, 1));
  game.handleSkill('p2', { yaw: 0, tx: target.x, tz: target.z });
  const d = ev('dive')[0].msg;
  assert.equal(d.r, SEA_CURSE.DIVE_RADIUS);
  assert.ok(Math.hypot(d.x - target.x, d.z - target.z) < 1, '거리 제한 없음');
  Object.assign(s, { x: d.x + 3.5, z: d.z });
  run(game, 0.6);
  assert.deepEqual(ev('diveEnd')[0].msg.hits, ['p3']);
});

test('최고의 스파이들: 저격수가 35m 밖에서 맞히면 즉사(푸드파이터도), 35m 안은 보통', () => {
  const { game, a, s, ev } = duo(['sniper', 'assassin']);
  s.maxHits = 7; // 푸드파이터
  const L = openLine(game, 42);
  for (const q of game.players.values()) if (q !== a && q !== s) q.x = 1000;
  Object.assign(a, { x: L.x, z: L.z, yaw: 0, pitch: 0 });
  Object.assign(s, { x: L.x, z: L.z - 33 });
  game.handleAttack('p1');
  run(game, 0.5);
  assert.equal(s.hits, 2, '35m 안은 원거리 2칸');
  run(game, 2);
  s.z = L.z - 36;
  game.handleAttack('p1');
  run(game, 0.5);
  assert.equal(s.status, STATUS.CAUGHT);
  assert.equal(ev('caught')[0].msg.spyKill, 1);
});

test('최고의 스파이들: 무적 중이면 즉사도 막힌다', () => {
  const { game, a, s } = duo(['sniper', 'assassin']);
  const L = openLine(game, 42);
  for (const q of game.players.values()) if (q !== a && q !== s) q.x = 1000;
  Object.assign(a, { x: L.x, z: L.z, yaw: 0, pitch: 0 });
  Object.assign(s, { x: L.x, z: L.z - 40 });
  s.invulnUntil = game.time + 5;
  game.handleAttack('p1');
  run(game, 0.5);
  assert.equal(s.status, STATUS.ALIVE);
  assert.equal(s.hits, 0);
});

test('최고의 스파이들: 암살자가 투명해지면 암살자에게만 0.5초 위치 공개 알림', () => {
  const { game, ev } = duo(['sniper', 'assassin']);
  game.handleSkill('p2');
  const r = ev('spyReveal');
  assert.equal(r.length, 1);
  assert.equal(r[0].to, 'p2');
  assert.equal(r[0].msg.time, SPIES.REVEAL_TIME);
  const { game: g2, ev: ev2 } = duo(['maniac', 'assassin']);
  g2.handleSkill('p2');
  assert.equal(ev2('spyReveal').length, 0, '시너지가 없으면 없음');
});
