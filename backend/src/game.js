// 서버 권한 게임 시뮬레이션.
// 이동은 클라이언트가 예측해 위치를 보내고, 서버가 속도/충돌/덫 상태를 검증한다.
// 공격, 덫, 발전기, 탈출, 승패 판정은 모두 서버가 결정한다.

import { CollisionWorld } from '../../shared/collision.js';
import {
  RULES,
  ROLE,
  STATUS,
  stepStamina,
  speedFor,
  matchRules,
  HUNTER_CLASS,
  SNIPER,
  ASSASSIN,
  MELEE,
  GHOST,
  aimDirection,
} from '../../shared/constants.js';
import {
  isForced,
  worldFor,
  useSkill,
  endDisguise,
  endPull,
  stepAnchors,
  stepPulls,
  stepWisps,
  stepDashes,
} from './abilities.js';
import { generateMap, planMatch, generatorBox } from './mapgen.js';

const r2 = (v) => Math.round(v * 100) / 100;

export class Game {
  /**
   * @param {{id:string,name:string}[]} roster
   * @param {{hunterId?:string, hunterClass?:string, hunters?:{id:string,cls:string}[], theme?:string, seed?:number, rand?:()=>number, emit:(toId:string|null,msg:object)=>void}} opts
   *   hunters: 술래 목록과 각자의 직업 (6명 이상이면 2명). 없으면 hunterId/hunterClass 하나
   *   theme: 맵 테마 ('village' | 'mine')
   *   emit(null, msg)는 전체 방송, emit(id, msg)는 한 명에게 전송
   */
  constructor(roster, opts) {
    this.rand = opts.rand || Math.random;
    this.emit = opts.emit;
    this.seed = opts.seed ?? Math.floor(this.rand() * 2 ** 31);
    this.map = generateMap(this.seed, opts.theme);

    this.rules = matchRules(roster.length);
    const validCls = (c) => (Object.values(HUNTER_CLASS).includes(c) ? c : HUNTER_CLASS.MANIAC);
    let hunters = opts.hunters;
    if (!hunters) {
      const id = opts.hunterId ?? roster[Math.floor(this.rand() * roster.length)].id;
      hunters = [{ id, cls: opts.hunterClass }];
    }
    hunters = hunters.filter((h) => roster.some((p) => p.id === h.id)).map((h) => ({ id: h.id, cls: validCls(h.cls) }));
    const hunterCls = new Map(hunters.map((h) => [h.id, h.cls]));
    this.hunterIds = hunters.map((h) => h.id);
    this.hunterClass = hunters[0].cls; // 첫 번째 술래의 직업 (호환용)
    const survivors = roster.filter((p) => !hunterCls.has(p.id));
    const plan = planMatch(this.map, survivors.length, this.rand, this.rules.generators, hunters.length);

    this.world = new CollisionWorld(this.map.boxes);
    // 유령 전용: 담장·벽을 뺀 충돌 세계
    this.ghostWorld = new CollisionWorld(this.map.boxes.filter((b) => !GHOST.PASS_KINDS.includes(b.kind)));
    this.gens = plan.generators.map((g) => ({ ...g, progress: 0, done: false, repairers: 0 }));
    for (const g of this.gens) {
      this.world.add(generatorBox(g));
      this.ghostWorld.add(generatorBox(g));
    }

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
        aiming: false,
        invisUntil: 0, // 암살자 투명화 끝나는 시각
        skillReadyAt: 0,
        slowUntil: 0, // 기습 후 감속 끝나는 시각
        jumpUntil: 0, // 점프 착지 시각
        pullUntil: 0, // 선장 닻에 끌려오는 중
        pulledBy: null,
        disguiseAs: null, // 살가죽: 변장한 생존자 id
        dashPhase: null, // 질주자: 'windup' | 'dash'
        dashT: 0,
        dashDir: null,
        cls: role === ROLE.HUNTER ? hunterCls.get(p.id) : null,
      });
    };
    hunters.forEach((h, i) => make(roster.find((p) => p.id === h.id), ROLE.HUNTER, plan.hunterSpawns[i]));
    survivors.forEach((p, i) => make(p, ROLE.SURVIVOR, plan.survivorSpawns[i]));

    this.hunterId = this.hunterIds[0];
    this.traps = [];
    this.trapSeq = 0;
    this.bullets = [];
    this.bulletSeq = 0;
    this.anchors = [];
    this.anchorSeq = 0;
    this.wisps = [];
    this.wispSeq = 0;
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
      hunterClass: this.players.get(forId)?.cls ?? this.hunterClass,
      map: this.map,
      generators: this.gens.map((g) => ({ id: g.id, x: g.x, z: g.z, rot: g.rot })),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        cls: p.cls,
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
    p.aiming = p.cls === HUNTER_CLASS.SNIPER && !!msg.aim;

    // 서버가 위치를 보정한 뒤에 도착한 옛 입력은 위치를 무시한다
    if (msg.corr !== p.corr) return;
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;

    if (this.isStunned(p)) {
      if (Math.hypot(msg.x - p.x, msg.z - p.z) > 0.05) this.correct(p);
      return;
    }
    // 닻에 끌려오거나 질주 중에는 서버가 위치를 정한다 (끝날 때 위치 보정을 보냄)
    if (isForced(this, p)) return;

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
    const res = worldFor(this, p).move(p.x, p.z, tx - p.x, tz - p.z, RULES.PLAYER_RADIUS);
    p.budget = Math.max(0, p.budget - Math.hypot(res.x - p.x, res.z - p.z));
    p.x = res.x;
    p.z = res.z;
    if (clamped || Math.hypot(res.x - msg.x, res.z - msg.z) > 0.15) this.correct(p);
  }

  correct(p) {
    p.corr++;
    this.emit(p.id, { t: 'correct', x: r2(p.x), z: r2(p.z), corr: p.corr });
  }

  /** 공격 키: 미치광이는 방망이, 저격수는 저격총. msg.yaw/pitch는 누른 순간의 시점 */
  handleAttack(id, msg = {}) {
    const p = this.players.get(id);
    if (!p || this.ended || p.role !== ROLE.HUNTER || p.status !== STATUS.ALIVE) return;
    if (this.time < p.attackReadyAt || isForced(this, p)) return;
    if (Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
    if (Number.isFinite(msg.pitch)) p.pitch = Math.max(-1.5, Math.min(1.5, msg.pitch));
    if (p.cls === HUNTER_CLASS.SNIPER) {
      this.fire(p);
      return;
    }
    // 근접 공격: 직업마다 사거리·쿨타임이 다르다 (방망이, 쿠나이, 후크, 할퀴기, 갈고리, 발차기)
    const melee = MELEE[p.cls] || MELEE.maniac;
    const range = melee.range;
    p.attackReadyAt = this.time + melee.cooldown;
    // 살가죽: 공격 키를 누르면 명중과 상관없이 변장이 풀린다
    if (p.disguiseAs) endDisguise(this, p);
    // 투명한 암살자의 휘두르기는 생존자에게 알리지 않는다
    if (this.isInvisible(p)) this.emitToSeers({ t: 'event', kind: 'swing', id });
    else this.emit(null, { t: 'event', kind: 'swing', id });

    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    let best = null;
    let bestDist = Infinity;
    for (const s of this.players.values()) {
      if (s.role !== ROLE.SURVIVOR || s.status !== STATUS.ALIVE) continue;
      const dx = s.x - p.x;
      const dz = s.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > range + RULES.PLAYER_RADIUS) continue;
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
    this.damage(best, id, 1);
    // 투명화 중 생존자를 맞히면 바로 풀린다
    if (this.isInvisible(p)) this.endInvis(p, 'hit');
  }

  isInvisible(p) {
    return p.cls === HUNTER_CLASS.ASSASSIN && this.time < p.invisUntil;
  }

  /** 생존자가 아닌 사람(술래, 관전자)에게만 보낸다 */
  emitToSeers(msg) {
    for (const q of this.players.values()) {
      if (q.role !== ROLE.SURVIVOR || q.status !== STATUS.ALIVE) this.emit(q.id, msg);
    }
  }

  isAirborne(p) {
    return this.time < p.jumpUntil;
  }

  /** 점프: 땅에 있을 때만. 생존자는 스태미나 1초분이 있어야 한다. 덫에 걸린 동안은 못 뜀 */
  handleJump(id) {
    const p = this.players.get(id);
    if (!p || this.ended || p.status !== STATUS.ALIVE) return;
    if (this.isAirborne(p) || this.isStunned(p)) return;
    if (p.role === ROLE.SURVIVOR) {
      if (p.stamina < RULES.JUMP_STAMINA) return;
      p.stamina -= RULES.JUMP_STAMINA;
      p.regenWait = RULES.STAMINA_REGEN_DELAY;
    }
    p.jumpUntil = this.time + RULES.JUMP_TIME;
  }

  /** 스킬 키: 직업마다 다르다. msg.yaw는 누른 순간의 시점 */
  handleSkill(id, msg = {}) {
    const p = this.players.get(id);
    if (!p || this.ended || p.role !== ROLE.HUNTER || p.status !== STATUS.ALIVE) return;
    if (Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
    if (p.cls !== HUNTER_CLASS.ASSASSIN) {
      useSkill(this, p); // 선장·유령·살가죽·질주자
      return;
    }
    // 암살자 투명화 (15초, 끝난 뒤 쿨타임 8초)
    if (this.isInvisible(p) || this.time < p.skillReadyAt) return;
    p.invisUntil = this.time + ASSASSIN.INVIS_TIME;
    this.emitToSeers({ t: 'event', kind: 'invis', id, on: true });
  }

  endInvis(p, reason) {
    p.invisUntil = 0;
    p.skillReadyAt = this.time + ASSASSIN.SKILL_COOLDOWN;
    // 생존자를 맞혀서 풀렸을 때만 3.5초간 감속 (시간이 다 돼서 풀리면 감속 없음)
    if (reason === 'hit') p.slowUntil = this.time + ASSASSIN.SLOW_TIME;
    this.emit(null, { t: 'event', kind: 'invis', id: p.id, on: false, reason });
  }

  /** 생존자에게 피해. 맞으면 2초 무적, 체력이 다 닳으면 잡힘 */
  damage(s, byId, amount, extra = {}) {
    s.hits = Math.min(this.rules.hitsToCatch, s.hits + amount);
    s.invulnUntil = this.time + RULES.HIT_INVULNERABLE;
    if (s.hits >= this.rules.hitsToCatch) {
      s.status = STATUS.CAUGHT;
      s.repairing = false;
      this.emit(null, { t: 'event', kind: 'caught', id: s.id, by: byId, name: s.name, dmg: amount, ...extra });
      this.checkEnd();
    } else {
      this.emit(null, {
        t: 'event',
        kind: 'hit',
        id: s.id,
        by: byId,
        hits: s.hits,
        max: this.rules.hitsToCatch,
        dmg: amount,
        ...extra,
      });
    }
  }

  /** 저격총 발사: 총알은 초속 150m로 날아가며 장애물에 막힌다 (거리 제한 없음) */
  fire(p) {
    p.attackReadyAt = this.time + SNIPER.SHOT_COOLDOWN;
    const dir = aimDirection(p.yaw, p.pitch);
    const b = {
      id: ++this.bulletSeq,
      owner: p.id,
      ox: p.x,
      oy: RULES.EYE_HEIGHT,
      oz: p.z,
      x: p.x,
      y: RULES.EYE_HEIGHT,
      z: p.z,
      dir,
      traveled: 0,
    };
    this.bullets.push(b);
    this.emit(null, {
      t: 'event',
      kind: 'shot',
      id: p.id,
      bid: b.id,
      x: r2(b.x),
      y: r2(b.y),
      z: r2(b.z),
      dx: Math.round(dir.x * 1e4) / 1e4,
      dy: Math.round(dir.y * 1e4) / 1e4,
      dz: Math.round(dir.z * 1e4) / 1e4,
    });
    return b;
  }

  /** 총알을 dt만큼 진행. 작은 간격으로 나눠 생존자 → 장애물 순으로 검사 */
  stepBullets(dt) {
    const STEP = 0.25;
    const LIMIT = 100; // 맵(±75) 밖으로 나가면 사라짐
    for (const b of [...this.bullets]) {
      let remain = SNIPER.BULLET_SPEED * dt;
      let end = null;
      while (remain > 0 && !end) {
        const s = Math.min(STEP, remain);
        remain -= s;
        b.x += b.dir.x * s;
        b.y += b.dir.y * s;
        b.z += b.dir.z * s;
        b.traveled += s;
        for (const t of this.players.values()) {
          if (t.role !== ROLE.SURVIVOR || t.status !== STATUS.ALIVE) continue;
          if (b.y < 0 || b.y > SNIPER.BODY_HEIGHT) continue;
          if (Math.hypot(t.x - b.x, t.z - b.z) > SNIPER.HIT_RADIUS) continue;
          end = { hit: t.id };
          // 무적 중이면 피해 없이 막힌다
          if (this.time >= t.invulnUntil) {
            const far = Math.hypot(b.x - b.ox, b.z - b.oz) >= SNIPER.FAR_DISTANCE;
            const dist = Math.round(Math.hypot(b.x - b.ox, b.z - b.oz));
            this.damage(t, b.owner, far ? SNIPER.FAR_DAMAGE : SNIPER.NEAR_DAMAGE, { far, dist });
          } else end.blocked = true;
          break;
        }
        if (!end && this.world.pointBlocked(b.x, b.y, b.z)) end = { hit: null };
        if (!end && (Math.abs(b.x) > LIMIT || Math.abs(b.z) > LIMIT || b.y > 80)) end = { hit: null, out: true };
      }
      if (end) {
        this.bullets.splice(this.bullets.indexOf(b), 1);
        this.emit(null, { t: 'event', kind: 'bulletEnd', bid: b.id, x: r2(b.x), y: r2(b.y), z: r2(b.z), hit: end.hit, out: !!end.out });
      }
    }
  }

  handleTrap(id) {
    const p = this.players.get(id);
    if (!p || this.ended || p.role !== ROLE.HUNTER || p.cls !== HUNTER_CLASS.MANIAC) return;
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
    // 그 선장에게 끌려오던 생존자는 풀어 준다
    for (const s of this.players.values()) if (s.pulledBy === id) endPull(this, s);
    this.wisps = this.wisps.filter((w) => w.target !== id);
    if (this.ended) return;
    const huntersLeft = [...this.players.values()].some((q) => q.role === ROLE.HUNTER);
    if (p.role === ROLE.HUNTER && !huntersLeft) {
      // 술래가 모두 나가면 생존자 승리
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
      const speed = speedFor(p.role, p.running || (p.wantsRun && p.stamina > 0), {
        cls: p.cls,
        aiming: p.aiming,
        invisible: this.isInvisible(p),
        slowed: this.time < p.slowUntil,
        disguised: !!p.disguiseAs,
      });
      if (stunned || isForced(this, p)) p.budget = 0;
      else p.budget = Math.min(p.budget + speed * dt * 1.2, speed * 0.6);
    }

    this.stepBullets(dt);
    stepAnchors(this, dt);
    stepPulls(this, dt);
    stepWisps(this, dt);
    stepDashes(this, dt);
    if (this.ended) return;

    // 투명화 시간 종료
    for (const p of this.players.values()) {
      if (p.cls === HUNTER_CLASS.ASSASSIN && p.invisUntil > 0 && this.time >= p.invisUntil) this.endInvis(p, 'timeout');
    }

    // 덫 밟기
    for (const s of this.players.values()) {
      if (s.role !== ROLE.SURVIVOR || s.status !== STATUS.ALIVE) continue;
      if (this.isAirborne(s)) continue; // 공중에서는 덫을 밟지 않는다
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
      if (s.role !== ROLE.SURVIVOR || s.status !== STATUS.ALIVE || !s.interact || s.pulledBy) continue;
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
    if (!this.ended && this.time >= RULES.MATCH_TIME) this.timeUp();
  }

  /** 제한 시간 종료: 탈출한 생존자가 1명이라도 있으면 생존자 승리, 아무도 없으면 술래 승리 */
  timeUp() {
    const escaped = [...this.players.values()].filter(
      (p) => p.role === ROLE.SURVIVOR && p.status === STATUS.ESCAPED,
    ).length;
    if (escaped > 0) this.finish('survivors', 'timeUpEscaped');
    else this.finish('hunter', 'timeUp');
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
      hunterClass: this.hunterClass,
      theme: this.map.theme,
      hunterClasses: [...this.players.values()].filter((p) => p.role === ROLE.HUNTER).map((p) => p.cls),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        cls: p.cls,
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
    // 살아 있는 생존자에게는 투명한 암살자의 위치를 아예 보내지 않는다
    const hideInvis = !spectator && me.role === ROLE.SURVIVOR;
    const snap = {
      t: 'state',
      time: r2(this.time),
      players: [...this.players.values()].map((p) => {
        const invis = this.isInvisible(p);
        if (invis && hideInvis) return { id: p.id, hidden: 1, st: p.status, hits: p.hits };
        return {
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
          aim: p.aiming ? 1 : 0,
          invis: invis ? 1 : 0,
          jmp: this.isAirborne(p) ? r2(RULES.JUMP_TIME - (p.jumpUntil - this.time)) : 0, // 점프 경과 시간
          // 살가죽 변장: 살아 있는 생존자에게는 "그 생존자처럼 그려라"만, 같은 편·관전자에게는 변장 중 표시
          ...(p.disguiseAs ? (hideInvis ? { look: p.disguiseAs } : { disg: p.disguiseAs }) : {}),
          ...(p.pulledBy ? { pull: p.pulledBy } : {}), // 선장 닻에 끌려오는 중
          ...(p.dashPhase ? { dash: p.dashPhase } : {}), // 질주자
        };
      }),
      anchors: this.anchors.map((a) => ({ id: a.id, x: r2(a.x), z: r2(a.z) })),
      wisps: this.wisps.map((w) => ({ id: w.id, x: r2(w.x), z: r2(w.z) })),
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
        invisLeft: this.isInvisible(me) ? r2(me.invisUntil - this.time) : 0,
        skillLeft: r2(Math.max(0, me.skillReadyAt - this.time)),
        slowLeft: r2(Math.max(0, me.slowUntil - this.time)),
        forced: isForced(this, me) ? 1 : 0, // 서버가 내 위치를 움직이는 중
        disguised: me.disguiseAs ? 1 : 0,
      };
    }
    return snap;
  }
}
