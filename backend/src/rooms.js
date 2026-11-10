// 방(로비) 관리: 방 만들기, 4자리 코드로 참가, 강퇴, 호스트 위임, 게임 시작/종료.

import { RULES, HUNTER_CLASS, CLASS_PICK_TIME, matchRules } from '../../shared/constants.js';
import { Game } from './game.js';
import { MAP_THEMES } from './mapgen.js';

const randomCode = (rand) => String(1000 + Math.floor(rand() * 9000));

export function sanitizeName(name, fallback) {
  const clean = String(name ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 12);
  return clean || fallback;
}

export class RoomManager {
  /**
   * @param {{rand?:()=>number, tickRate?:number, autoTick?:boolean, theme?:string}} opts
   */
  constructor(opts = {}) {
    this.rand = opts.rand || Math.random;
    this.tickRate = opts.tickRate || RULES.TICK_RATE;
    this.autoTick = opts.autoTick !== false;
    this.forceTheme = MAP_THEMES[opts.theme] ? opts.theme : null; // 개발용: 맵 고정
    this.rooms = new Map();
    this.clients = new Map(); // id -> client
    this.seq = 0;
  }

  /** @param {(msg:object)=>void} send */
  connect(send) {
    const id = `p${++this.seq}`;
    const client = { id, name: `플레이어${this.seq}`, room: null, send };
    this.clients.set(id, client);
    send({ t: 'welcome', id });
    return client;
  }

  disconnect(client) {
    this.leaveRoom(client);
    this.clients.delete(client.id);
  }

  handle(client, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'hello':
        client.name = sanitizeName(msg.name, client.name);
        if (client.room) this.broadcastRoom(client.room);
        break;
      case 'create':
        this.create(client, msg.name);
        break;
      case 'join':
        this.join(client, msg.code, msg.name);
        break;
      case 'leave':
        this.leaveRoom(client);
        client.send({ t: 'left' });
        break;
      case 'kick':
        this.kick(client, msg.id);
        break;
      case 'start':
        this.start(client);
        break;
      case 'input':
        if (client.room?.game) client.room.game.handleInput(client.id, msg);
        break;
      case 'attack':
        if (client.room?.game) client.room.game.handleAttack(client.id, msg);
        break;
      case 'pickClass':
        this.pickClass(client, msg.cls);
        break;
      case 'trap':
        if (client.room?.game) client.room.game.handleTrap(client.id);
        break;
      case 'ping':
        client.send({ t: 'pong', at: msg.at });
        break;
      default:
        break;
    }
  }

  error(client, code, message) {
    client.send({ t: 'error', code, message });
  }

  create(client, name) {
    if (name !== undefined) client.name = sanitizeName(name, client.name);
    this.leaveRoom(client);
    let code;
    do code = randomCode(this.rand);
    while (this.rooms.has(code));
    const room = { code, hostId: client.id, members: [client], state: 'lobby', game: null, timer: null, select: null };
    this.rooms.set(code, room);
    client.room = room;
    this.broadcastRoom(room);
    return room;
  }

  join(client, code, name) {
    if (name !== undefined) client.name = sanitizeName(name, client.name);
    code = String(code ?? '').trim();
    if (!/^\d{4}$/.test(code)) return this.error(client, 'badCode', '참가 코드는 숫자 4자리예요.');
    const room = this.rooms.get(code);
    if (!room) return this.error(client, 'notFound', '그 코드의 방을 찾을 수 없어요.');
    if (room === client.room) return this.broadcastRoom(room);
    if (room.state !== 'lobby') return this.error(client, 'inGame', '이미 게임이 진행 중인 방이에요.');
    if (room.members.length >= RULES.MAX_PLAYERS)
      return this.error(client, 'full', `방이 가득 찼어요. (최대 ${RULES.MAX_PLAYERS}명)`);
    this.leaveRoom(client);
    room.members.push(client);
    client.room = room;
    this.broadcastRoom(room);
  }

  leaveRoom(client) {
    const room = client.room;
    if (!room) return;
    room.members = room.members.filter((m) => m !== client);
    client.room = null;
    if (room.game) room.game.removePlayer(client.id);
    if (room.select) {
      // 술래가 나가거나, 인원이 바뀌어 술래 수 규칙이 달라지면 대기실로
      if (room.select.hunterIds.includes(client.id)) this.cancelSelect(room, '술래가 나가서 대기실로 돌아왔어요.');
      else if (room.members.length < RULES.MIN_PLAYERS) this.cancelSelect(room, '인원이 부족해서 대기실로 돌아왔어요.');
      else if (matchRules(room.members.length).hunters !== room.select.hunterIds.length)
        this.cancelSelect(room, '인원이 바뀌어 술래 수가 달라졌어요. 다시 시작해 주세요.');
    }
    if (room.members.length === 0) {
      this.closeRoom(room);
      return;
    }
    if (room.hostId === client.id) room.hostId = room.members[0].id;
    this.broadcastRoom(room);
  }

  kick(client, targetId) {
    const room = client.room;
    if (!room) return;
    if (room.hostId !== client.id) return this.error(client, 'notHost', '방장만 강퇴할 수 있어요.');
    if (room.state !== 'lobby') return this.error(client, 'inGame', '게임 중에는 강퇴할 수 없어요.');
    const target = room.members.find((m) => m.id === targetId);
    if (!target || target === client) return;
    this.leaveRoom(target);
    target.send({ t: 'kicked', code: room.code });
  }

  start(client) {
    const room = client.room;
    if (!room) return;
    if (room.hostId !== client.id) return this.error(client, 'notHost', '방장만 시작할 수 있어요.');
    if (room.state !== 'lobby') return;
    if (room.members.length < RULES.MIN_PLAYERS)
      return this.error(client, 'notEnough', `최소 ${RULES.MIN_PLAYERS}명이 있어야 시작할 수 있어요.`);

    // 1) 무작위로 술래를 정하고(6명 이상이면 2명), 술래가 직업을 고르는 동안 생존자는 대기
    const count = matchRules(room.members.length).hunters;
    const pool = [...room.members];
    const hunters = [];
    while (hunters.length < count) hunters.push(pool.splice(Math.floor(this.rand() * pool.length), 1)[0]);
    room.state = 'selecting';
    // 맵은 술래가 직업을 고르는 동안 무작위로 정해진다
    const themes = Object.keys(MAP_THEMES);
    const theme = this.forceTheme ?? themes[Math.floor(this.rand() * themes.length)];
    room.select = { hunterIds: hunters.map((h) => h.id), picks: {}, timer: null, theme };
    const msg = {
      t: 'classSelect',
      hunterIds: hunters.map((h) => h.id),
      hunterNames: hunters.map((h) => h.name),
      time: CLASS_PICK_TIME,
      classes: Object.values(HUNTER_CLASS),
      map: MAP_THEMES[theme],
    };
    for (const m of room.members) m.send(msg);
    this.broadcastRoom(room);
    if (this.autoTick) room.select.timer = setTimeout(() => this.selectTimeout(room), CLASS_PICK_TIME * 1000);
  }

  /** 술래가 직업을 골랐을 때. 술래가 모두 고르면 바로 시작 (같은 직업도 가능) */
  pickClass(client, cls) {
    const room = client.room;
    const sel = room?.select;
    if (!sel || !sel.hunterIds.includes(client.id) || sel.picks[client.id]) return;
    if (!Object.values(HUNTER_CLASS).includes(cls)) return;
    sel.picks[client.id] = cls;
    // 다른 술래에게 알려 준다
    for (const id of sel.hunterIds) {
      if (id !== client.id) room.members.find((m) => m.id === id)?.send({ t: 'classPicked', id: client.id, name: client.name, cls });
    }
    if (sel.hunterIds.every((id) => sel.picks[id])) this.beginGame(room);
  }

  /** 15초 안에 고르지 않은 술래는 무작위 직업 */
  selectTimeout(room) {
    const sel = room.select;
    if (!sel) return;
    const list = Object.values(HUNTER_CLASS);
    const auto = [];
    for (const id of sel.hunterIds) {
      if (sel.picks[id]) continue;
      sel.picks[id] = list[Math.floor(this.rand() * list.length)];
      auto.push(id);
    }
    this.beginGame(room, auto);
  }

  cancelSelect(room, message) {
    if (room.select?.timer) clearTimeout(room.select.timer);
    room.select = null;
    room.state = 'lobby';
    for (const m of room.members) m.send({ t: 'notice', message });
  }

  /** 2) 직업이 정해지면 게임 시작 */
  beginGame(room, autoPicked = []) {
    const sel = room.select;
    if (sel.timer) clearTimeout(sel.timer);
    room.select = null;
    const hunters = sel.hunterIds.map((id) => ({ id, cls: sel.picks[id] }));
    const roster = room.members.map((m) => ({ id: m.id, name: m.name }));
    room.state = 'playing';
    room.game = new Game(roster, {
      hunters,
      theme: sel.theme,
      rand: this.rand,
      emit: (toId, msg) => {
        if (toId === null) for (const m of room.members) m.send(msg);
        else room.members.find((m) => m.id === toId)?.send(msg);
      },
    });
    for (const m of room.members) m.send({ ...room.game.startPayload(m.id), autoPicked: autoPicked.includes(m.id) });
    this.broadcastRoom(room);

    if (this.autoTick) {
      const dt = 1 / this.tickRate;
      room.timer = setInterval(() => this.step(room, dt), 1000 / this.tickRate);
    }
  }

  /** 게임 한 틱 진행 + 상태 전송. 테스트에서는 직접 호출한다. */
  step(room, dt) {
    const game = room.game;
    if (!game) return;
    game.tick(dt);
    for (const m of room.members) m.send(game.snapshotFor(m.id));
    if (game.ended) this.endGame(room);
  }

  endGame(room) {
    if (room.timer) clearInterval(room.timer);
    room.timer = null;
    room.game = null;
    room.state = 'lobby';
    if (room.members.length === 0) this.closeRoom(room);
    else this.broadcastRoom(room);
  }

  closeRoom(room) {
    if (room.select?.timer) clearTimeout(room.select.timer);
    room.select = null;
    if (room.timer) clearInterval(room.timer);
    room.timer = null;
    room.game = null;
    this.rooms.delete(room.code);
  }

  broadcastRoom(room) {
    const msg = {
      t: 'room',
      code: room.code,
      hostId: room.hostId,
      state: room.state,
      maxPlayers: RULES.MAX_PLAYERS,
      minPlayers: RULES.MIN_PLAYERS,
      players: room.members.map((m) => ({ id: m.id, name: m.name })),
    };
    for (const m of room.members) m.send(msg);
  }
}
