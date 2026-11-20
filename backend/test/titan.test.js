// 입체기동 이벤트 모드: 전용 맵, 와이어·벽에 붙기·낙하 피해, 거인(체력 20칸) 잡기, 지붕 위 총, 승패, 방 모드 선택
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { RoomManager } from '../src/rooms.js';
import { mulberry32 } from '../src/mapgen.js';
import { generateTitanMap, randomRoofSpot } from '../src/titanmap.js';
import { CollisionWorld } from '../../shared/collision.js';
import { TITAN, RULES, speedFor, ROLE, eyeHeightFor, titanClasses, CAPTAIN } from '../../shared/constants.js';

const DT = 1 / 20;
const run = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) game.tick(DT);
};

function makeGame({ n = 3, cls = 'maniac', seed = 11, scls = [] } = {}) {
  const events = [];
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, scls: scls[i - 1] }));
  const game = new Game(roster, { seed, mode: 'titan', hunters: [{ id: 'p1', cls }], rand: mulberry32(seed), emit: (to, msg) => events.push({ to, msg }) });
  const ev = (kind) => events.filter((e) => e.msg.kind === kind);
  const p = (id) => game.players.get(id);
  return { game, events, ev, p };
}

/** 집 하나와 그 집 옆 큰길 쪽 빈 곳 (집 벽에서 dist m) */
function houseAndSpot(game, dist = 10) {
  for (const b of game.map.boxes) {
    if (b.kind !== 'thouse') continue;
    const x = b.x;
    const z = b.z + b.d / 2 + dist;
    let free = true;
    for (let d = 1; d <= dist; d += 0.5) if (!game.world.isFree(x, b.z + b.d / 2 + d, 0.6)) free = false;
    if (free) return { b, x, z };
  }
  throw new Error('빈 곳이 없음');
}

const toward = (from, to) => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = to.y - from.y;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
};

test('전용 맵: 400m, 둘레 50m 벽, 집 12~20m, 시계탑', () => {
  const map = generateTitanMap(3);
  assert.equal(map.theme, 'titan');
  assert.equal(map.size, 400);
  const walls = map.boxes.filter((b) => b.kind === 'titanWall');
  assert.equal(walls.length, 4);
  assert.ok(walls.every((w) => w.h === TITAN.WALL_HEIGHT));
  const houses = map.boxes.filter((b) => b.kind === 'thouse');
  assert.ok(houses.length > 80);
  assert.ok(houses.every((h) => h.h >= 12 && h.h <= 20));
  assert.ok(map.boxes.some((b) => b.kind === 'tower'));
  const spot = randomRoofSpot(map, mulberry32(1));
  const world = new CollisionWorld(map.boxes);
  assert.equal(world.supportAt(spot.x, spot.z), spot.y, '총은 지붕 위');
});

test('모드 규칙: 술래 1명(체력 20칸), 발전기 없음, 10분, 거인 속도 35km/h, 눈높이 23.5m', () => {
  const { game, p } = makeGame({ n: 7 });
  const hunters = [...game.players.values()].filter((q) => q.role === ROLE.HUNTER);
  assert.equal(hunters.length, 1);
  assert.equal(p('p1').maxHits, 20);
  assert.equal(game.gens.length, 0);
  assert.equal(game.matchTime, 600);
  assert.ok(Math.abs(speedFor(ROLE.HUNTER, false, { titan: true }) * 3.6 - 35) < 1e-6);
  assert.equal(eyeHeightFor('maniac', true), 23.5);
  assert.ok(!titanClasses().includes('flesh'), '살덩이 금지');
  const sp = game.startPayload('p2');
  assert.equal(sp.mode, 'titan');
  assert.equal(sp.matchTime, 600);
});

test('살덩이를 골라도 입체기동 모드에서는 쓸 수 없다', () => {
  const { p } = makeGame({ cls: 'flesh' });
  assert.notEqual(p('p1').cls, 'flesh');
});

test('와이어: 벽에 쏘면 시속 80km로 날아가 붙고, 0.5초 뒤 떨어진다. 10m 이상이면 0.5칸', () => {
  const { game, p, ev } = makeGame();
  const s = p('p2');
  const { b, x, z } = houseAndSpot(game, 12);
  Object.assign(s, { x, z, y: 0 });
  p('p1').x = 150;
  p('p1').z = 150;
  // 집 옆면 위쪽(높이 b.h - 1)을 겨눈다
  const target = { x: b.x, y: b.h - 1, z: b.z + b.d / 2 };
  const aim = toward({ x, y: RULES.EYE_HEIGHT, z }, target);
  game.handleWire('p2', aim);
  assert.equal(s.air, 'fly');
  assert.equal(ev('wire').length, 1);
  const dist = Math.hypot(target.x - x, target.y - 1.1 - 0, target.z - z);
  run(game, dist / TITAN.WIRE_SPEED + 0.15);
  assert.equal(s.air, 'stick', '벽에 붙음');
  assert.ok(s.y > 9, `높이 ${s.y}`);
  const yStick = s.y;
  run(game, 0.2);
  assert.equal(s.air, 'stick', '0.5초 동안 머문다');
  run(game, 0.35);
  assert.equal(s.air, 'fall');
  run(game, 3);
  assert.equal(s.air, null);
  assert.equal(s.y, 0);
  assert.equal(s.hits, yStick >= 10 ? 0.5 : 0, '10m 이상에서 떨어지면 0.5칸');
});

test('와이어: 낮은 곳(10m 미만)에서 떨어지면 피해 없음, 날아가는 중 다시 누르면 풀림', () => {
  const { game, p, ev } = makeGame();
  const s = p('p2');
  const { b, x, z } = houseAndSpot(game, 12);
  Object.assign(s, { x, z, y: 0 });
  p('p1').x = 150;
  const target = { x: b.x, y: 6, z: b.z + b.d / 2 };
  game.handleWire('p2', toward({ x, y: RULES.EYE_HEIGHT, z }, target));
  run(game, 0.2);
  game.handleWire('p2', {});
  assert.equal(s.air, 'fall');
  assert.equal(ev('wireOff').length, 1);
  run(game, 3);
  assert.equal(s.air, null);
  assert.equal(s.hits, 0);
});

test('와이어: 지붕 윗면에 쏘면 지붕 위에 내려서고, 지붕 끝에서 걸어 나가면 떨어진다', () => {
  const { game, p } = makeGame();
  const s = p('p2');
  const { b } = houseAndSpot(game, 12);
  // 집보다 높은 곳(공중)에서 지붕을 내려다보며 쏜다
  Object.assign(s, { x: b.x, z: b.z + b.d / 2 + 6, y: b.h + 3, air: 'stick', stickUntil: game.time + 5 });
  game.handleWire('p2', toward({ x: s.x, y: s.y + RULES.EYE_HEIGHT, z: s.z }, { x: b.x, y: b.h, z: b.z }));
  assert.equal(s.air, 'fly');
  run(game, 1.5);
  assert.equal(s.air, null, '지붕에 내려섬');
  assert.equal(s.y, b.h);
  // 지붕 위에서 걸어 다닐 수 있다 (그 집에 밀려나지 않음)
  s.budget = 5;
  game.handleInput('p2', { x: b.x + 1, z: b.z, corr: s.corr, moving: true });
  assert.ok(Math.abs(s.x - (b.x + 1)) < 0.01, '지붕 위 이동');
  // 지붕 끝 밖으로 옮기면 떨어진다
  Object.assign(s, { x: b.x, z: b.z + b.d / 2 + 2 });
  run(game, 0.1);
  assert.equal(s.air, 'fall');
  run(game, 4);
  assert.equal(s.y, 0);
  assert.equal(s.hits, b.h >= 10 ? 0.5 : 0);
});

test('와이어: 60m 밖이나 하늘에 쏘면 빗나감', () => {
  const { game, p, ev } = makeGame();
  const s = p('p2');
  const { x, z } = houseAndSpot(game, 12);
  Object.assign(s, { x, z, y: 0 });
  game.handleWire('p2', { yaw: 0, pitch: 1.4 });
  assert.equal(s.air, null);
  assert.equal(ev('wireMiss').length, 1);
});

test('거인 잡기: 8m 안(높이 25m까지) 생존자 1칸, 쿨타임 1.5초, 붙어 있던 생존자는 떨어진다', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  p('p3').x = -150;
  Object.assign(h, { yaw: 0 });
  Object.assign(s, { x: h.x, z: h.z - (TITAN.RADIUS + 7), y: 0 });
  game.handleAttack('p1', { yaw: 0 });
  assert.equal(s.hits, 1);
  assert.equal(ev('titanGrab').length, 1);
  run(game, 1.6);
  // 공중(높이 15m)에 붙어 있는 생존자도 잡힌다 → 떨어짐
  Object.assign(s, { y: 15, air: 'stick', stickUntil: game.time + 5 });
  game.handleAttack('p1', { yaw: 0 });
  assert.equal(s.hits, 2);
  assert.equal(s.air, 'fall');
  // 너무 멀면 안 잡힘
  run(game, 1.6);
  Object.assign(s, { x: h.x, z: h.z - (TITAN.RADIUS + 10), y: 0, air: null, invulnUntil: 0 });
  game.handleAttack('p1', { yaw: 0 });
  assert.equal(s.hits, 2);
});

test('지붕 위 총: 10~20초마다 생김(최대 6개), 주워서 거인을 맞히면 1칸, 한 발뿐', () => {
  const { game, p, ev } = makeGame();
  run(game, 9.9);
  assert.equal(game.guns.length, 0);
  run(game, 10.2);
  assert.ok(game.guns.length >= 1);
  run(game, 200);
  assert.equal(game.guns.length, TITAN.GUN_MAX, '최대 6개');
  const g = game.guns[0];
  const s = p('p2');
  Object.assign(s, { x: g.x, z: g.z, y: g.y, air: null });
  run(game, DT);
  assert.equal(s.gun, true);
  assert.equal(ev('gunPick').length, 1);
  // 거인을 총 앞 20m에 세우고 쏜다
  const h = p('p1');
  Object.assign(h, { x: s.x, z: s.z - 20 });
  game.world = new CollisionWorld([]); // 가리는 것 없이
  game.handleAttack('p2', toward({ x: s.x, y: s.y + 1.5, z: s.z }, { x: h.x, y: 10, z: h.z }));
  assert.equal(s.gun, false);
  run(game, 0.3);
  assert.equal(h.hits, 1);
  assert.equal(ev('titanHit').length, 1);
  game.handleAttack('p2', { yaw: 0, pitch: 0 });
  assert.equal(ev('tshot').length, 1, '총알은 한 발');
});

test('승패: 거인 체력 20칸을 다 깎으면 생존자 승리, 10분이 지나면 술래 승리', async () => {
  const { damageTitan } = await import('../src/titan.js');
  const a = makeGame();
  for (let i = 0; i < 20; i++) damageTitan(a.game, a.p('p1'), 'p2', 1);
  assert.equal(a.game.result.winner, 'survivors');
  assert.equal(a.game.result.reason, 'titanDown');
  assert.equal(a.game.result.mode, 'titan');
  const b = makeGame();
  b.game.world = new CollisionWorld([]);
  run(b.game, 600.1);
  assert.equal(b.game.result.winner, 'hunter');
  assert.equal(b.game.result.reason, 'titanTimeUp');
});

test('거인 스킬은 5배: 선장 닻 사거리 100m', () => {
  const { game, p, ev } = makeGame({ cls: 'captain' });
  const h = p('p1');
  game.world = new CollisionWorld([]);
  Object.assign(h, { x: 0, z: 0, yaw: 0 });
  Object.assign(p('p2'), { x: 0, z: -(CAPTAIN.ANCHOR_RANGE * 5 - 5), y: 0 });
  Object.assign(p('p3'), { x: 100, z: 100 });
  game.handleSkill('p1', { yaw: 0 });
  run(game, 1);
  assert.equal(ev('anchorEnd')[0].msg.hit, 'p2');
});

test('방: 방장이 입체기동 모드를 고르면 전용 맵, 술래 1명, 살덩이 제외', () => {
  const sent = [];
  const rm = new RoomManager({ autoTick: false, rand: mulberry32(2) });
  const clients = Array.from({ length: 7 }, () => rm.connect((m) => sent.push(m)));
  rm.handle(clients[0], { t: 'create' });
  const code = clients[0].room.code;
  for (const c of clients.slice(1)) rm.handle(c, { t: 'join', code });
  rm.handle(clients[1], { t: 'setMode', mode: 'titan' });
  assert.equal(clients[0].room.mode, 'normal', '방장만');
  rm.handle(clients[0], { t: 'setMode', mode: 'titan' });
  assert.equal(clients[0].room.mode, 'titan');
  rm.handle(clients[0], { t: 'start' });
  const sel = sent.filter((m) => m.t === 'classSelect').at(-1);
  assert.equal(sel.hunterIds.length, 1, '7명이어도 술래 1명');
  assert.equal(sel.map.id, 'titan');
  assert.ok(!sel.classes.includes('flesh'));
  const hunter = clients.find((c) => c.id === sel.hunterIds[0]);
  rm.handle(hunter, { t: 'pickClass', cls: 'flesh' });
  assert.equal(clients[0].room.state, 'selecting', '살덩이는 못 고름');
  rm.handle(hunter, { t: 'pickClass', cls: 'ghost' });
  const game = clients[0].room.game;
  assert.ok(game.titan);
  assert.equal(game.map.theme, 'titan');
});
