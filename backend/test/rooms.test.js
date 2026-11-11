import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/rooms.js';
import { mulberry32 } from '../src/mapgen.js';
import { createServer } from '../src/server.js';
import { WebSocket } from 'ws';

function setup() {
  const mgr = new RoomManager({ rand: mulberry32(3), autoTick: false });
  const mk = (name) => {
    const inbox = [];
    const c = mgr.connect((m) => inbox.push(m));
    mgr.handle(c, { t: 'hello', name });
    c.inbox = inbox;
    c.last = (t) => [...inbox].reverse().find((m) => m.t === t);
    return c;
  };
  return { mgr, mk };
}

test('방 만들기: 4자리 숫자 코드, 대기실 정보', () => {
  const { mgr, mk } = setup();
  const a = mk('철수');
  mgr.handle(a, { t: 'create' });
  const room = a.last('room');
  assert.match(room.code, /^\d{4}$/);
  assert.equal(room.hostId, a.id);
  assert.deepEqual(room.players.map((p) => p.name), ['철수']);
});

test('방 참가: 올바른 코드로 참가, 틀린 코드는 오류', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  const b = mk('B');
  mgr.handle(a, { t: 'create' });
  const code = a.last('room').code;
  mgr.handle(b, { t: 'join', code: '12' });
  assert.equal(b.last('error').code, 'badCode');
  mgr.handle(b, { t: 'join', code: code === '9999' ? '1000' : '9999' });
  assert.equal(b.last('error').code, 'notFound');
  mgr.handle(b, { t: 'join', code });
  assert.equal(b.last('room').players.length, 2);
  assert.equal(a.last('room').players.length, 2);
});

test('최대 8명, 게임 중에는 참가 불가', () => {
  const { mgr, mk } = setup();
  const host = mk('H');
  mgr.handle(host, { t: 'create' });
  const code = host.last('room').code;
  const others = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => mk(`P${i}`));
  others.forEach((c) => mgr.handle(c, { t: 'join', code }));
  assert.equal(host.last('room').players.length, 8);
  assert.equal(host.last('room').maxPlayers, 8);
  assert.equal(others[7].last('error').code, 'full');
  mgr.handle(host, { t: 'start' });
  mgr.handle(others[7], { t: 'join', code });
  assert.equal(others[7].last('error').code, 'inGame');
});
test('강퇴: 방장만 가능, 강퇴된 사람은 kicked 메시지', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  const b = mk('B');
  const c = mk('C');
  mgr.handle(a, { t: 'create' });
  const code = a.last('room').code;
  mgr.handle(b, { t: 'join', code });
  mgr.handle(c, { t: 'join', code });
  mgr.handle(b, { t: 'kick', id: c.id });
  assert.equal(b.last('error').code, 'notHost');
  mgr.handle(a, { t: 'kick', id: c.id });
  assert.ok(c.last('kicked'));
  assert.equal(c.room, null);
  assert.deepEqual(a.last('room').players.map((p) => p.name), ['A', 'B']);
});

test('시작: 방장만, 2명 이상, 무작위 1명이 술래', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  mgr.handle(a, { t: 'create' });
  mgr.handle(a, { t: 'start' });
  assert.equal(a.last('error').code, 'notEnough');
  const code = a.last('room').code;
  const b = mk('B');
  const c = mk('C');
  mgr.handle(b, { t: 'join', code });
  mgr.handle(c, { t: 'join', code });
  mgr.handle(b, { t: 'start' });
  assert.equal(b.last('error').code, 'notHost');
  mgr.handle(a, { t: 'start' });
  // 술래가 정해지고 직업 선택 단계
  const sel = a.last('classSelect');
  assert.ok(sel, '직업 선택 메시지');
  assert.equal(b.last('classSelect').hunterIds[0], sel.hunterIds[0]);
  assert.equal(a.room.state, 'selecting');
  assert.equal(a.last('start'), undefined, '직업을 고르기 전에는 시작하지 않음');
  const hunter = [a, b, c].find((x) => x.id === sel.hunterIds[0]);
  const other = [a, b, c].find((x) => x.id !== sel.hunterIds[0]);
  mgr.handle(other, { t: 'pickClass', cls: 'sniper' });
  assert.equal(a.last('start'), undefined, '술래가 아닌 사람은 고를 수 없음');
  mgr.handle(hunter, { t: 'pickClass', cls: 'sniper' });
  const start = a.last('start');
  assert.equal(start.hunterClass, 'sniper');
  assert.equal(start.players.find((p) => p.role === 'hunter').id, sel.hunterIds[0]);
  assert.ok(start);
  const hunters = start.players.filter((p) => p.role === 'hunter');
  assert.equal(hunters.length, 1);
  assert.equal(start.players.length, 3);
  assert.equal(b.last('start').you, b.id);
});

test('호스트가 나가면 다음 사람이 방장', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  const b = mk('B');
  mgr.handle(a, { t: 'create' });
  mgr.handle(b, { t: 'join', code: a.last('room').code });
  mgr.handle(a, { t: 'leave' });
  assert.equal(b.last('room').hostId, b.id);
});

test('게임이 끝나면 같은 방 대기실로 돌아간다', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  const b = mk('B');
  mgr.handle(a, { t: 'create' });
  const room = a.room;
  mgr.handle(b, { t: 'join', code: room.code });
  mgr.handle(a, { t: 'start' });
  mgr.selectTimeout(room); // 15초 동안 고르지 않음 → 무작위 직업
  assert.ok(['maniac', 'sniper', 'assassin', 'captain', 'ghost', 'skinwalker', 'sprinter'].includes(room.game.hunterClass));
  assert.equal(a.last('start').autoPicked, true);
  const hunterId = room.game.hunterId;
  const survivor = hunterId === a.id ? b : a;
  mgr.handle(survivor, { t: 'leave' });
  mgr.step(room, 0.05);
  assert.equal(room.state, 'lobby');
  const host = room.members[0];
  assert.equal(host.last('end').winner, 'hunter');
  assert.equal(host.last('room').state, 'lobby');
});

test('실제 WebSocket 서버: 방 만들기 → 참가 → 시작 → 상태 수신', async () => {
  const srv = await createServer({ port: 0, host: '127.0.0.1' });
  const open = () =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
      ws.msgs = [];
      ws.on('message', (d) => ws.msgs.push(JSON.parse(d)));
      ws.on('open', () => resolve(ws));
    });
  const waitFor = (ws, pred, ms = 3000) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const m = ws.msgs.find(pred);
        if (m) {
          clearInterval(iv);
          resolve(m);
        } else if (Date.now() - t0 > ms) {
          clearInterval(iv);
          reject(new Error('timeout'));
        }
      }, 10);
    });
  try {
    const a = await open();
    const b = await open();
    a.send(JSON.stringify({ t: 'create', name: 'A' }));
    const room = await waitFor(a, (m) => m.t === 'room');
    b.send(JSON.stringify({ t: 'join', code: room.code, name: 'B' }));
    await waitFor(a, (m) => m.t === 'room' && m.players.length === 2);
    a.send(JSON.stringify({ t: 'start' }));
    const sel = await waitFor(b, (m) => m.t === 'classSelect');
    // 술래 쪽 소켓으로 직업 선택
    const ids = await Promise.all([waitFor(a, (m) => m.t === 'welcome'), waitFor(b, (m) => m.t === 'welcome')]);
    (ids[0].id === sel.hunterIds[0] ? a : b).send(JSON.stringify({ t: 'pickClass', cls: 'maniac' }));
    const start = await waitFor(b, (m) => m.t === 'start');
    assert.ok(start.map.boxes.length > 100);
    const st = await waitFor(b, (m) => m.t === 'state');
    assert.equal(st.players.length, 2);

    const res = await fetch(`http://127.0.0.1:${srv.port}/`);
    assert.equal(res.status, 200);
    const shared = await fetch(`http://127.0.0.1:${srv.port}/shared/constants.js`);
    assert.equal(shared.status, 200);
    const bad = await fetch(`http://127.0.0.1:${srv.port}/..%2fbackend%2fsrc%2fserver.js`);
    assert.equal(bad.status, 404);
    a.close();
    b.close();
  } finally {
    await srv.close();
  }
});

test('직업 선택 중 술래가 나가면 대기실로 돌아감', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  const b = mk('B');
  const c = mk('C');
  mgr.handle(a, { t: 'create' });
  const room = a.room;
  mgr.handle(b, { t: 'join', code: room.code });
  mgr.handle(c, { t: 'join', code: room.code });
  mgr.handle(a, { t: 'start' });
  const hunter = [a, b, c].find((x) => x.id === room.select.hunterIds[0]);
  const rest = [a, b, c].filter((x) => x !== hunter);
  mgr.handle(hunter, { t: 'leave' });
  assert.equal(room.state, 'lobby');
  assert.equal(room.game, null);
  assert.ok(rest[0].last('notice'));
  assert.equal(rest[0].last('room').state, 'lobby');
  // 다시 시작 가능
  mgr.handle(rest[0].id === room.hostId ? rest[0] : rest[1], { t: 'start' });
  assert.equal(room.state, 'selecting');
});

test('직업 선택 중에는 참가할 수 없음', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  const b = mk('B');
  mgr.handle(a, { t: 'create' });
  mgr.handle(b, { t: 'join', code: a.room.code });
  mgr.handle(a, { t: 'start' });
  const late = mk('late');
  mgr.handle(late, { t: 'join', code: a.room.code });
  assert.equal(late.last('error').code, 'inGame');
});

function fullRoom(n) {
  const { mgr, mk } = setup();
  const members = Array.from({ length: n }, (_, i) => mk(`P${i + 1}`));
  mgr.handle(members[0], { t: 'create' });
  const room = members[0].room;
  for (const m of members.slice(1)) mgr.handle(m, { t: 'join', code: room.code });
  return { mgr, mk, members, room };
}

test('6명 이상: 술래 2명이 각자 직업을 고르고, 둘 다 고르면 시작 (같은 직업 가능)', () => {
  for (const n of [6, 7, 8]) {
    const { mgr, members, room } = fullRoom(n);
    mgr.handle(members[0], { t: 'start' });
    const sel = members[0].last('classSelect');
    assert.equal(sel.hunterIds.length, 2, `${n}명`);
    assert.equal(new Set(sel.hunterIds).size, 2);
    const [h1, h2] = sel.hunterIds.map((id) => members.find((m) => m.id === id));
    mgr.handle(h1, { t: 'pickClass', cls: 'sniper' });
    assert.equal(room.state, 'selecting', '한 명만 고르면 아직 대기');
    assert.equal(h2.last('classPicked').cls, 'sniper', '동료 술래에게 알림');
    mgr.handle(h2, { t: 'pickClass', cls: 'sniper' });
    assert.equal(room.state, 'playing');
    const start = members[0].last('start');
    const hunters = start.players.filter((p) => p.role === 'hunter');
    assert.equal(hunters.length, 2);
    assert.deepEqual(hunters.map((h) => h.cls), ['sniper', 'sniper']);
    assert.deepEqual(start.rules, { hunters: 2, generators: 3, hitsToCatch: 3 });
    assert.equal(start.generators.length, 3);
  }
});

test('5명 이하는 술래 1명', () => {
  for (const n of [2, 4, 5]) {
    const { mgr, members } = fullRoom(n);
    mgr.handle(members[0], { t: 'start' });
    assert.equal(members[0].last('classSelect').hunterIds.length, 1, `${n}명`);
  }
});

test('술래 2명 중 1명만 고르고 시간이 지나면 나머지는 무작위', () => {
  const { mgr, members, room } = fullRoom(6);
  mgr.handle(members[0], { t: 'start' });
  const [id1, id2] = room.select.hunterIds;
  const h1 = members.find((m) => m.id === id1);
  const h2 = members.find((m) => m.id === id2);
  mgr.handle(h1, { t: 'pickClass', cls: 'maniac' });
  mgr.selectTimeout(room);
  assert.equal(room.state, 'playing');
  assert.equal(room.game.players.get(id1).cls, 'maniac');
  assert.ok(['maniac', 'sniper', 'assassin', 'captain', 'ghost', 'skinwalker', 'sprinter'].includes(room.game.players.get(id2).cls));
  assert.equal(h1.last('start').autoPicked, false);
  assert.equal(h2.last('start').autoPicked, true);
});

test('6명 선택 중 생존자가 나가 5명이 되면 술래 수가 달라져 대기실로', () => {
  const { mgr, members, room } = fullRoom(6);
  mgr.handle(members[0], { t: 'start' });
  const survivor = members.find((m) => !room.select.hunterIds.includes(m.id));
  mgr.handle(survivor, { t: 'leave' });
  assert.equal(room.state, 'lobby');
  // 7명 → 6명은 술래 수가 그대로라 계속
  const r2 = fullRoom(7);
  r2.mgr.handle(r2.members[0], { t: 'start' });
  const s2 = r2.members.find((m) => !r2.room.select.hunterIds.includes(m.id));
  r2.mgr.handle(s2, { t: 'leave' });
  assert.equal(r2.room.state, 'selecting');
});

test('맵은 직업 선택 단계에서 무작위로 정해지고 그 맵으로 게임이 시작됨', () => {
  const seen = new Set();
  const { mgr, members, room } = fullRoom(2);
  for (let k = 0; k < 24; k++) {
    mgr.handle(members[0], { t: 'start' });
    const sel = members[1].last('classSelect');
    assert.ok(['village', 'mine', 'backrooms'].includes(sel.map.id));
    assert.ok(sel.map.name);
    seen.add(sel.map.id);
    mgr.selectTimeout(room);
    assert.equal(members[1].last('start').map.theme, sel.map.id);
    mgr.endGame(room); // 다음 판
  }
  assert.equal(seen.size, 3, '세 맵 모두 나올 수 있음');
});

test('방 목록: 대기 중인 공개 방만 보이고, 바뀌면 보고 있는 사람에게 다시 보냄', () => {
  const { mgr, mk } = setup();
  const a = mk('철수');
  const b = mk('영희');
  const viewer = mk('구경');
  mgr.handle(viewer, { t: 'rooms' });
  assert.deepEqual(viewer.last('roomList').rooms, []);
  mgr.handle(a, { t: 'create' });
  const code = a.last('room').code;
  assert.equal(a.last('room').private, false, '새 방은 기본 공개');
  assert.deepEqual(viewer.last('roomList').rooms, [{ code, host: '철수', count: 1, max: 8 }]);
  mgr.handle(b, { t: 'join', code });
  assert.equal(viewer.last('roomList').rooms[0].count, 2);
  // 게임이 시작되면 목록에서 빠지고, 끝나면 다시 보인다
  mgr.handle(a, { t: 'start' });
  assert.deepEqual(viewer.last('roomList').rooms, []);
  const room = mgr.rooms.get(code);
  mgr.handle(room.members.find((m) => m.id === room.select.hunterIds[0]), { t: 'pickClass', cls: 'maniac' });
  assert.equal(room.state, 'playing');
  room.game.timeUp();
  mgr.step(room, 1 / 20);
  assert.equal(viewer.last('roomList').rooms.length, 1);
  // 모두 나가면 방이 사라진다
  mgr.handle(a, { t: 'leave' });
  mgr.handle(b, { t: 'leave' });
  assert.deepEqual(viewer.last('roomList').rooms, []);
  // 그만 보면 더 이상 받지 않는다
  mgr.handle(viewer, { t: 'rooms', watch: false });
  const before = viewer.inbox.length;
  mgr.handle(a, { t: 'create' });
  assert.equal(viewer.inbox.length, before);
});

test('비공개 방: 목록에 안 보이고 코드로만 참가, 방장만 바꿀 수 있음', () => {
  const { mgr, mk } = setup();
  const a = mk('A');
  const b = mk('B');
  const viewer = mk('V');
  mgr.handle(a, { t: 'create' });
  const code = a.last('room').code;
  mgr.handle(viewer, { t: 'rooms' });
  assert.equal(viewer.last('roomList').rooms.length, 1);
  mgr.handle(a, { t: 'setPrivate', on: true });
  assert.equal(a.last('room').private, true);
  assert.deepEqual(viewer.last('roomList').rooms, [], '비공개로 바꾸면 목록에서 사라짐');
  mgr.handle(b, { t: 'join', code });
  assert.equal(b.last('room').players.length, 2, '코드로는 들어올 수 있음');
  assert.equal(b.last('room').private, true);
  mgr.handle(b, { t: 'setPrivate', on: false });
  assert.equal(b.last('error').code, 'notHost');
  assert.equal(mgr.rooms.get(code).private, true);
  mgr.handle(a, { t: 'setPrivate', on: false });
  assert.equal(viewer.last('roomList').rooms.length, 1, '다시 공개하면 목록에 보임');
  // 만들 때부터 비공개로 만들 수도 있다
  const c = mk('C');
  mgr.handle(c, { t: 'create', private: true });
  assert.equal(c.last('room').private, true);
  assert.equal(viewer.last('roomList').rooms.length, 1);
});
