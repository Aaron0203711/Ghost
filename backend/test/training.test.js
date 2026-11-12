// 훈련장: 혼자 들어가 허수아비로 술래·생존자 직업을 체험
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/rooms.js';
import { Game } from '../src/game.js';
import { mulberry32 } from '../src/mapgen.js';
import { RULES, STATUS, TRAINING } from '../../shared/constants.js';

const DT = 1 / 20;

function setup() {
  const mgr = new RoomManager({ rand: mulberry32(5), autoTick: false });
  const mk = (name) => {
    const inbox = [];
    const c = mgr.connect((m) => inbox.push(m));
    mgr.handle(c, { t: 'hello', name });
    c.inbox = inbox;
    c.last = (t) => [...inbox].reverse().find((m) => m.t === t);
    c.events = (kind) => inbox.filter((m) => m.t === 'event' && m.kind === kind);
    return c;
  };
  return { mgr, mk };
}

function trainingGame(mode, cls = 'maniac', seed = 9) {
  const events = [];
  const game = new Game([{ id: 'p1', name: '나', scls: 'police' }], {
    training: { mode, cls },
    seed,
    theme: 'village',
    rand: mulberry32(seed),
    emit: (to, msg) => events.push(msg),
  });
  return { game, events, me: game.players.get('p1') };
}

const run = (game, s) => {
  for (let i = 0; i < Math.round(s / DT); i++) game.tick(DT);
};

test('훈련장 술래 체험: 생존자 허수아비 6개가 정해진 거리쯤에 서 있다', () => {
  const { game, me } = trainingGame('hunter', 'sniper');
  assert.equal(me.role, 'hunter');
  assert.equal(me.cls, 'sniper');
  const dummies = [...game.players.values()].filter((p) => p.dummy);
  assert.equal(dummies.length, TRAINING.DUMMY_DISTANCES.length);
  for (const [i, d] of dummies.entries()) {
    assert.equal(d.role, 'survivor');
    assert.equal(d.maxHits, 3);
    assert.ok(game.world.isFree(d.x, d.z, RULES.PLAYER_RADIUS), '막힌 곳에 서지 않음');
    const dist = Math.hypot(d.x - me.x, d.z - me.z);
    assert.ok(Math.abs(dist - TRAINING.DUMMY_DISTANCES[i]) < 6, `거리 ${dist}`);
  }
  const start = game.startPayload('p1');
  assert.deepEqual(start.training, { mode: 'hunter' });
  assert.equal(start.players.filter((p) => p.dummy).length, 6);
  assert.equal(start.rules.damageFactor, 1, '훈련장은 피해 감소 없음');
});

test('훈련장: 허수아비는 쓰러지면 3초 뒤 제자리에서 다시 일어나고, 게임은 끝나지 않는다', () => {
  const { game, events } = trainingGame('hunter');
  const d = game.players.get('d1');
  const home = { x: d.x, z: d.z };
  for (let i = 0; i < 3; i++) {
    game.damage(d, 'p1', 1);
    run(game, 1.1);
  }
  assert.equal(d.status, STATUS.CAUGHT);
  d.x += 3; // 끌려갔다고 치고
  run(game, TRAINING.REVIVE_TIME - 1.1 + 0.1);
  assert.equal(d.status, STATUS.ALIVE);
  assert.equal(d.hits, 0);
  assert.deepEqual({ x: d.x, z: d.z }, home);
  assert.ok(events.some((e) => e.kind === 'revived'));
  // 모든 허수아비를 쓰러뜨려도, 7분이 지나도 끝나지 않음
  for (const q of game.players.values()) if (q.dummy) game.damage(q, 'p1', 3);
  run(game, 0.1);
  assert.equal(game.ended, false);
  game.time = RULES.MATCH_TIME + 1;
  run(game, 0.1);
  assert.equal(game.ended, false);
});

test('훈련장 생존자 체험: 공격하지 않는 술래 허수아비 2개, 발전기 5개, 탈출하면 처음부터', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  mgr.handle(a, { t: 'training', role: 'survivor', scls: 'police', map: 'village' });
  const start = a.last('start');
  assert.equal(start.training.mode, 'survivor');
  const me = start.players.find((p) => p.id === a.id);
  assert.equal(me.role, 'survivor');
  assert.equal(me.scls, 'police');
  assert.equal(start.players.filter((p) => p.dummy && p.role === 'hunter').length, TRAINING.HUNTER_DUMMIES.length);
  assert.equal(start.generators.length, 5);
  assert.equal(a.last('room'), undefined, '대기실 정보는 보내지 않음');

  const room = a.room;
  const game = room.game;
  for (const g of game.gens) g.progress = 1, g.done = true;
  game.openExit();
  const p = game.players.get(a.id);
  p.x = game.exit.x;
  p.z = game.exit.z;
  const before = a.inbox.filter((m) => m.t === 'start').length;
  mgr.step(room, DT);
  assert.equal(a.inbox.filter((m) => m.t === 'start').length, before + 1, '새로 시작');
  assert.equal(a.last('start').restarted, true);
  assert.notEqual(room.game, game);
  assert.equal(room.game.gens.every((g) => g.progress === 0), true);
});

test('훈련장: 방 목록에 안 보이고 코드로 참가할 수 없으며, 안에서 직업을 바꾸면 같은 맵으로 다시 시작', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  const b = mk('B');
  mgr.handle(b, { t: 'rooms' });
  mgr.handle(a, { t: 'training', role: 'hunter', cls: 'clown', map: 'mine' });
  assert.equal(a.last('start').map.theme, 'mine');
  assert.equal(a.last('start').hunterClass, 'clown');
  assert.deepEqual(mgr.roomList(), []);
  mgr.handle(b, { t: 'join', code: a.room.code });
  assert.equal(b.last('error').code, 'badCode');

  // 술래 공격이 허수아비에게 들어간다
  mgr.handle(a, { t: 'training', role: 'hunter', cls: 'maniac' });
  assert.equal(a.last('start').hunterClass, 'maniac');
  assert.equal(a.last('start').map.theme, 'mine', '맵 유지');
  const game = a.room.game;
  const me = game.players.get(a.id);
  const d = game.players.get('d1');
  Object.assign(d, { x: me.x, z: me.z - 1.5 });
  me.yaw = 0;
  mgr.handle(a, { t: 'attack', yaw: 0, pitch: 0 });
  assert.equal(d.hits, 1);

  mgr.handle(a, { t: 'training', role: 'survivor', scls: 'ninja' });
  assert.equal(a.last('start').players.find((p) => p.id === a.id).scls, 'ninja');
  assert.equal(mgr.rooms.size, 1, '방은 하나만');

  // 나가면 방이 사라진다
  mgr.handle(a, { t: 'leave' });
  assert.equal(mgr.rooms.size, 0);
  assert.equal(a.room, null);
});

test('훈련장에서 방 만들기를 하면 훈련장은 닫힌다', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  mgr.handle(a, { t: 'training', role: 'hunter', cls: 'ghost' });
  mgr.handle(a, { t: 'create' });
  assert.equal(mgr.rooms.size, 1);
  assert.match(a.room.code, /^\d{4}$/);
});
