// 서버 권한 게임 시뮬레이션.
// 이동은 클라이언트가 예측해 위치를 보내고, 서버가 속도/충돌/덫 상태를 검증한다.
// 공격, 덫, 발전기, 탈출, 승패 판정은 모두 서버가 결정한다.

import { CollisionWorld } from '../../shared/collision.js';
import { RULES, ROLE, STATUS, stepStamina, speedFor, matchRules } from '../../shared/constants.js';
import { generateMap, planMatch, generatorBox } from './mapgen.js';

const r2 = (v) => Math.round(v * 100) / 100;

export class Game {
  /**
   * @param {{id:string,name:string}[]} roster
   * @param {{hunterId?:string, seed?:number, rand?:()=>number, emit:(toId:string|null,msg:object)=>void}} opts
   *   emit(null, msg)는 전체 방송, emit(id, msg)는 한 명에게 전송
   */
  constructor(roster, opts) {
    this.rand = opts.rand || Math.random;
    this.emit = opts.emit;
    this.seed = opts.seed ?? Math.floor(this.rand() * 2 ** 31);
    this.map = generateMap(this.seed);

    const hunterId = opts.hunterId ?? roster[Math.floor(this.rand() * roster.length)].id;
    const survivors = roster.filter((p) => p.id !== hunterId);
    this.rules = matchRules(roster.length);
    const plan = planMatch(this.map, survivors.length, this.rand, this.rules.generators);

    this.world = new CollisionWorld(this.map.boxes);
    this.gens = plan.generators.map((g) => ({ ...g, progress: 0, done: false, repairers: 0 }));
    for (const g of this.gens) this.world.add(generatorBox(g));

    this.players = new Map();
    const make = (p, role, spawn) => {
      const yaw = this.rand() * Math.PI * 2;
      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        role,
        x: spawn.x,
        z: spawn.z,
        yaw,
        pitch: 0,
        status: STATUS.ALIVE,
        hits: 0,
        invulnUntil: 0,
        stunUntil: 0,
        stamina: RULES.STAMINA_MAX,
        regenWait: 0,
        wantsRun: false,
        moving: false,
        running: false,
        interact: false,
        repairing: false,
        budget: 0,
        corr: 0,
        charges: RULES.TRAP_MAX_CHARGES,
        chargeTimer: 0,
        attackReadyAt: 0,
      });
    };
    const hunter = roster.find((p) => p.id === hunterId);
    make(hunter, ROLE.HUNTER, plan.hunterSpawn);
    survivors.forEach((p, i) => make(p, ROLE.SURVIVOR, plan.survivorSpawns[i]));

    this.hunterId = hunterId;
    this.traps = [];
    this.trapSeq = 0;
    this.exit = null;
    this.time = 0;
    this.ended = false;
    this.result = null;
  }

  /** 게임 시작 시 각 플레이어에게 보낼 데이터 */
  startPayload(forId) {
    return {
      t: 'start',
      you: forId,
      rules: this.rules,
      map: this.map,
      generators: this.gens.map((g) => ({ id: g.id, x: g.x, z: g.z, rot: g.rot })),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        x: r2(p.x),
        z: r2(p.z),
        yaw: r2(p.yaw),
      })),
    };
  }

  isStunned(p) {
    return this.time < p.stunUntil;
  }

  /** 클라이언트 입력: 위치/시점/달리기/상호작용 */
  handleInput(id, msg) {
    const p = this.players.get(id);
    if (!p || this.ended || p.status !== STATUS.ALIVE) return;
    if (typeof msg.yaw === 'number' && Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
    if (typeof msg.pitch === 'number' && Number.isFinite(msg.pitch)) p.pitch = Math.max(-1.5, Math.min(1.5, msg.pitch));
    p.wantsRun = p.role === ROLE.SURVIVOR && !!msg.run;
    p.moving = !!msg.moving;
    p.interact = p.role === ROLE.SURVIVOR && !!msg.interact;

    // 서버가 위치를 보정한 뒤에 도착한 옛 입력은 위치를 무시한다
    if (msg.corr !== p.corr) return;
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;

    if (this.isStunned(p)) {
      if (Math.hypot(msg.x - p.x, msg.z - p.z) > 0.05) this.correct(p);
      return;
    }

    let tx = msg.x;
    let tz = msg.z;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    let clamped = false;
    if (dist > p.budget) {
      const k = p.budget / dist;
      tx = p.x + dx * k;
      tz = p.z + dz * k;
      clamped = true;
    }
    const res = this.world.move(p.x, p.z, tx - p.x, tz - p.z, RULES.PLAYER_RADIUS);
    p.budget = Math.max(0, p.budget - Math.hypot(res.x - p.x, res.z - p.z));
    p.x = res.x;
    p.z = res.z;
    if (clamped || Math.hypot(res.x - msg.x, res.z - msg.z) > 0.15) this.correct(p);
  }

  correct(p) {
    p.corr++;
    this.emit(p.id, { t: 'correct', x: r2(p.x), z: r2(p.z), corr: p.corr });
  }

  handleAttack(id) {
    const p = this.players.get(id);
    if (!p || this.ended || p.role !== ROLE.HUNTER) return;
    if (this.time < p.attackReadyAt) return;
    p.attackReadyAt = this.time + RULES.ATTACK_COOLDOWN;
    this.emit(null, { t: 'event', kind: 'swing', id });

    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    let best = null;
    let bestDist = Infinity;
    for (const s of this.players.values()) {
      if (s.role !== ROLE.SURVIVOR || s.status !== STATUS.ALIVE) continue;
      const dx = s.x - p.x;
      const dz = s.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > RULES.ATTACK_RANGE + RULES.PLAYER_RADIUS) continue;
      if (d > 0.4) {
        const cos = (dx * fx + dz * fz) / d;
        if (cos < Math.cos(RULES.ATTACK_HALF_ANGLE)) continue;
      }
      if (this.world.segmentBlocked(p.x, p.z, s.x, s.z)) continue;
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    if (!best || this.time < best.invulnUntil) return;

    best.hits++;
    best.invulnUntil = this.time + RULES.HIT_INVULNERABLE;
    if (best.hits >= this.rules.hitsToCatch) {
      best.status = STATUS.CAUGHT;
      best.repairing = false;
      this.emit(null, { t: 'event', kind: 'caught', id: best.id, by: id, name: best.name });
      this.checkEnd();
    } else {
      this.emit(null, { t: 'event', kind: 'hit', id: best.id, by: id, hits: best.hits, max: this.rules.hitsToCatch });
    }
  }

  handleTrap(id) {
    const p = this.players.get(id);
    if (!p || this.ended || p.role !== ROLE.HUNTER) return;
    if (p.charges <= 0) return;
    p.charges--;
    const trap = { id: ++this.trapSeq, x: p.x, z: p.z, owner: id };
    this.traps.push(trap);
    this.emit(id, { t: 'event', kind: 'trapPlaced', trapId: trap.id });
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.ended) return;
    if (p.role === ROLE.HUNTER) {
      this.finish('survivors', 'hunterLeft');
    } else {
      this.emit(null, { t: 'event', kind: 'left', id, name: p.name });
      this.checkEnd();
    }
  }

  tick(dt) {
    if (this.ended) return;
    this.time += dt;

    for (const p of this.players.values()) {
      if (p.status !== STATUS.ALIVE) continue;
      const stunned = this.isStunned(p);
      if (p.role === ROLE.SURVIVOR) {
        p.running = stepStamina(p, p.wantsRun && !stunned, p.moving && !stunned, dt);
      } else {
        p.running = false;
        // 덫 충전: 최대치보다 적으면 30초마다 1개 회복
        if (p.charges < RULES.TRAP_MAX_CHARGES) {
          p.chargeTimer += dt;
          if (p.chargeTimer >= RULES.TRAP_COOLDOWN) {
            p.charges++;
            p.chargeTimer -= RULES.TRAP_COOLDOWN;
          }
        }
        if (p.charges >= RULES.TRAP_MAX_CHARGES) p.chargeTimer = 0;
      }
      // 이동 허용량(속도 × 시간, 네트워크 지연을 위해 약간의 여유)
      const speed = speedFor(p.role, p.running || (p.wantsRun && p.stamina > 0));
      if (stunned) p.budget = 0;
      else p.budget = Math.min(p.budget + speed * dt * 1.2, speed * 0.6);
    }

    // 덫 밟기
    for (const s of this.players.values()) {
      if (s.role !== ROLE.SURVIVOR || s.status !== STATUS.ALIVE) continue;
      const idx = this.traps.findIndex(
        (t) => Math.hypot(t.x - s.x, t.z - s.z) < RULES.TRAP_TRIGGER_RADIUS,
      );
      if (idx === -1) continue;
      const [trap] = this.traps.splice(idx, 1);
      s.stunUntil = this.time + RULES.TRAP_STUN;
      s.x = trap.x;
      s.z = trap.z;
      s.budget = 0;
      this.correct(s);
      this.emit(null, { t: 'event', kind: 'trapped', id: s.id, name: s.name, x: r2(trap.x), z: r2(trap.z) });
    }

    // 발전기 수리: 범위 안에서 상호작용 키를 누르고 있는 생존자 수만큼 빨라진다
    for (const g of this.gens) g.repairers = 0;
    for (const s of this.players.values()) {
      s.repairing = false;
      if (s.role !== ROLE.SURVIVOR || s.status !== STATUS.ALIVE || !s.interact) continue;
      const g = this.nearestGen(s);
      if (!g) continue;
      g.repairers++;
      s.repairing = true;
    }
    for (const g of this.gens) {
      if (g.done || g.repairers === 0) continue;
      g.progress = Math.min(1, g.progress + (g.repairers * dt) / RULES.GENERATOR_REPAIR_TIME);
      if (g.progress >= 1) {
        g.done = true;
        const doneCount = this.gens.filter((x) => x.done).length;
        this.emit(null, { t: 'event', kind: 'genDone', genId: g.id, done: doneCount });
        if (doneCount >= this.gens.length) this.openExit();
      }
    }

    // 탈출
    if (this.exit) {
      for (const s of this.players.values()) {
        if (s.role !== ROLE.SURVIVOR || s.status !== STATUS.ALIVE) continue;
        if (Math.hypot(s.x - this.exit.x, s.z - this.exit.z) < RULES.EXIT_RADIUS) {
          s.status = STATUS.ESCAPED;
          s.repairing = false;
          this.emit(null, { t: 'event', kind: 'escaped', id: s.id, name: s.name });
        }
      }
    }

    this.checkEnd();
  }

  nearestGen(s) {
    let best = null;
    let bestD = RULES.GENERATOR_INTERACT_RANGE;
    for (const g of this.gens) {
      if (g.done) continue;
      const d = Math.hypot(g.x - s.x, g.z - s.z);
      if (d <= bestD) {
        best = g;
        bestD = d;
      }
    }
    return best;
  }

  openExit() {
    if (this.exit) return;
    const list = this.map.exits;
    // 생존자 평균 위치와 너무 가깝지 않은 곳 중 무작위
    const e = list[Math.floor(this.rand() * list.length)];
    this.exit = { x: e.x, z: e.z, rot: e.rot };
    this.emit(null, { t: 'event', kind: 'exitOpen', exit: this.exit });
  }

  checkEnd() {
    if (this.ended) return;
    const survivors = [...this.players.values()].filter((p) => p.role === ROLE.SURVIVOR);
    const alive = survivors.filter((p) => p.status === STATUS.ALIVE).length;
    if (alive > 0) return;
    const escaped = survivors.filter((p) => p.status === STATUS.ESCAPED).length;
    if (survivors.length === 0) this.finish('hunter', 'survivorsLeft');
    else this.finish(escaped > 0 ? 'survivors' : 'hunter', escaped > 0 ? 'escaped' : 'allCaught');
  }

  finish(winner, reason) {
    if (this.ended) return;
    this.ended = true;
    this.result = {
      t: 'end',
      winner,
      reason,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        status: p.status,
        hits: p.hits,
      })),
    };
    this.emit(null, this.result);
  }

  snapshotFor(id) {
    const me = this.players.get(id);
    const spectator = !me || me.status !== STATUS.ALIVE;
    const seesAllTraps = spectator || me.role === ROLE.HUNTER;
    const traps = this.traps
      .filter((t) => seesAllTraps || Math.hypot(t.x - me.x, t.z - me.z) <= RULES.TRAP_VISIBLE_RANGE)
      .map((t) => ({ id: t.id, x: r2(t.x), z: r2(t.z) }));
    const snap = {
      t: 'state',
      time: r2(this.time),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        x: r2(p.x),
        z: r2(p.z),
        yaw: r2(p.yaw),
        pitch: r2(p.pitch),
        st: p.status,
        hits: p.hits,
        stun: this.isStunned(p) ? r2(p.stunUntil - this.time) : 0,
        inv: this.time < p.invulnUntil ? 1 : 0,
        run: p.running ? 1 : 0,
        rep: p.repairing ? 1 : 0,
      })),
      gens: this.gens.map((g) => ({ id: g.id, p: r2(g.progress), done: g.done ? 1 : 0 })),
      traps,
      exit: this.exit,
    };
    if (me) {
      snap.me = {
        stamina: r2(me.stamina),
        charges: me.charges,
        chargeLeft: me.charges < RULES.TRAP_MAX_CHARGES ? r2(RULES.TRAP_COOLDOWN - me.chargeTimer) : 0,
        attackLeft: r2(Math.max(0, me.attackReadyAt - this.time)),
      };
    }
    return snap;
  }
}
