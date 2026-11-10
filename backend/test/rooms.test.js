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

test('최대 5명, 게임 중에는 참가 불가', () => {
  const { mgr, mk } = setup();
  const host = mk('H');
  mgr.handle(host, { t: 'create' });
  const code = host.last('room').code;
  const others = [1, 2, 3, 4, 5].map((i) => mk(`P${i}`));
  others.forEach((c) => mgr.handle(c, { t: 'join', code }));
  assert.equal(others[4].last('error').code, 'full');
  mgr.handle(host, { t: 'start' });
  const late = mk('late');
  mgr.handle(others[4], { t: 'join', code });
  assert.equal(others[4].last('error').code, 'inGame');
  void late;
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
  const start = a.last('start');
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
