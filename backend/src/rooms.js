// 방(로비) 관리: 방 만들기, 4자리 코드로 참가, 강퇴, 호스트 위임, 게임 시작/종료.

import { RULES } from '../../shared/constants.js';
import { Game } from './game.js';

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
   * @param {{rand?:()=>number, tickRate?:number, autoTick?:boolean}} opts
   */
  constructor(opts = {}) {
    this.rand = opts.rand || Math.random;
    this.tickRate = opts.tickRate || RULES.TICK_RATE;
    this.autoTick = opts.autoTick !== false;
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
        if (client.room?.game) client.room.game.handleAttack(client.id);
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
    const room = { code, hostId: client.id, members: [client], state: 'lobby', game: null, timer: null };
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

    const roster = room.members.map((m) => ({ id: m.id, name: m.name }));
    room.state = 'playing';
    room.game = new Game(roster, {
      rand: this.rand,
      emit: (toId, msg) => {
        if (toId === null) for (const m of room.members) m.send(msg);
        else room.members.find((m) => m.id === toId)?.send(msg);
      },
    });
    for (const m of room.members) m.send(room.game.startPayload(m.id));
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
