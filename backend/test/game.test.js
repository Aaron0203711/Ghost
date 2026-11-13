import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { mulberry32 } from '../src/mapgen.js';
import { RULES, STATUS, matchRules, VOICE, voiceGain } from '../../shared/constants.js';
import { CollisionWorld } from '../../shared/collision.js';

const DT = 1 / 20;

function makeGame(n = 3, seed = 7, hunterClass = 'maniac') {
  const events = [];
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const game = new Game(roster, {
    seed,
    hunterId: 'p1',
    hunterClass,
    rand: mulberry32(seed),
    emit: (to, msg) => events.push({ to, msg }),
  });
  return { game, events, hunter: game.players.get('p1'), s1: game.players.get('p2'), s2: game.players.get('p3') };
}

const run = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) game.tick(DT);
};

/** 열린 교차로에 술래와 생존자를 마주 세운다 */
function faceOff(game, hunter, survivor, gap = 1.5) {
  const { x, z } = game.map.exits[0]; // 바깥 도로 위 (탁 트인 곳)
  const hz = z + 3;
  hunter.x = x;
  hunter.z = hz;
  hunter.yaw = 0; // -z 방향을 본다
  survivor.x = x;
  survivor.z = hz - gap;
  for (const p of game.players.values()) if (p !== hunter && p !== survivor) p.x = p.z = 1000;
}

test('충돌: 벽을 뚫고 지나갈 수 없고 벽을 따라 미끄러진다', () => {
  const w = new CollisionWorld([{ x: 0, z: 0, w: 0.3, d: 10 }]);
  const r = RULES.PLAYER_RADIUS;
  const p = w.move(-2, 0, 5, 0, r);
  assert.ok(p.x < -0.15 - r + 0.01, `벽 앞에서 멈춰야 함 (x=${p.x})`);
  const slide = w.move(-0.6, 0, 0.5, 2, r);
  assert.ok(slide.z > 1.9, '벽을 따라 미끄러져야 함');
  assert.ok(slide.x < -0.15 - r + 0.01);
  // 아주 빠르게 이동해도 뚫지 못함
  const fast = w.move(-1, 0, 50, 0, r);
  assert.ok(fast.x < 0);
});

test('덫: 기본 3개, 언제든 설치, 30초마다 1개 회복', () => {
  const { game, hunter } = makeGame();
  game.handleTrap('p1');
  game.handleTrap('p1');
  game.handleTrap('p1');
  game.handleTrap('p1'); // 4번째는 실패
  assert.equal(game.traps.length, 3);
  assert.equal(hunter.charges, 0);
  run(game, 29.9);
  assert.equal(hunter.charges, 0);
  run(game, 0.2);
  assert.equal(hunter.charges, 1);
  run(game, 60);
  assert.equal(hunter.charges, 3);
  run(game, 40);
  assert.equal(hunter.charges, 3, '최대 3개를 넘지 않음');
});

test('덫: 생존자가 밟으면 3초간 이동 불가, 그 뒤 다시 이동', () => {
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1, 4);
  game.handleTrap('p1');
  const trap = game.traps[0];
  s1.x = trap.x;
  s1.z = trap.z + 0.3;
  game.tick(DT);
  assert.equal(game.traps.length, 0, '밟은 덫은 사라짐');
  assert.ok(game.isStunned(s1));
  run(game, 1);
  game.handleInput('p2', { x: s1.x + 0.2, z: s1.z, moving: true, corr: s1.corr });
  assert.equal(s1.x, trap.x, '덫에 걸린 동안은 움직일 수 없음');
  run(game, 2.1);
  assert.ok(!game.isStunned(s1));
  run(game, 0.5);
  game.handleInput('p2', { x: s1.x + 0.2, z: s1.z, moving: true, corr: s1.corr });
  assert.ok(Math.abs(s1.x - (trap.x + 0.2)) < 0.01, '3초 뒤에는 이동 가능');
});

test('덫: 술래는 자기 덫을 밟지 않는다', () => {
  const { game, hunter } = makeGame();
  game.handleTrap('p1');
  run(game, 1);
  assert.equal(game.traps.length, 1);
  assert.ok(!game.isStunned(hunter));
});

test('방망이: 3번 맞으면 잡힘, 맞은 뒤 1초 무적, 공격 쿨타임 1초', () => {
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1);
  game.handleAttack('p1');
  assert.equal(s1.hits, 1);
  game.handleAttack('p1'); // 쿨타임 중
  assert.equal(s1.hits, 1);
  hunter.attackReadyAt = game.time + 0.5; // 쿨타임을 앞당겨 무적만 확인
  run(game, 0.55);
  game.handleAttack('p1'); // 쿨타임은 끝났지만 무적 1초
  assert.equal(s1.hits, 1);
  hunter.attackReadyAt = 0; // 헛스윙 쿨타임은 무시
  run(game, 0.5);
  game.handleAttack('p1');
  assert.equal(s1.hits, 2);
  run(game, 1.05);
  game.handleAttack('p1');
  assert.equal(s1.hits, 3);
  assert.equal(s1.status, STATUS.CAUGHT);
});

test('방망이: 사거리 밖, 등 뒤, 벽 너머는 맞지 않는다', () => {
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1, 4);
  game.handleAttack('p1');
  assert.equal(s1.hits, 0, '사거리 밖');
  run(game, 1.1);
  faceOff(game, hunter, s1, 1.5);
  hunter.yaw = Math.PI; // 반대 방향
  game.handleAttack('p1');
  assert.equal(s1.hits, 0, '등 뒤');
  run(game, 1.1);
  faceOff(game, hunter, s1, 1.5);
  game.world.add({ x: hunter.x, z: hunter.z - 0.75, w: 3, d: 0.2 });
  game.handleAttack('p1');
  assert.equal(s1.hits, 0, '벽 너머');
});

test('이동 검증: 순간이동은 속도 한도로 잘리고 보정 메시지를 받는다', () => {
  const { game, events, s1 } = makeGame();
  run(game, 1);
  const start = { x: s1.x, z: s1.z };
  game.handleInput('p2', { x: s1.x + 30, z: s1.z, moving: true, corr: s1.corr });
  const moved = Math.hypot(s1.x - start.x, s1.z - start.z);
  assert.ok(moved <= RULES.SURVIVOR_WALK_SPEED * 0.6 + 0.01, `이동 거리 ${moved}`);
  assert.ok(events.some((e) => e.to === 'p2' && e.msg.t === 'correct'));
});

test('스태미나: 10초 달리면 바닥, 달리지 않으면 15초에 가득', () => {
  const { game, s1 } = makeGame();
  s1.wantsRun = true;
  s1.moving = true;
  for (let i = 0; i < 199; i++) {
    game.tick(DT);
    s1.wantsRun = true;
    s1.moving = true;
  }
  assert.ok(s1.running);
  game.tick(DT);
  game.tick(DT);
  assert.equal(s1.stamina, 0);
  assert.ok(!s1.running);
  s1.wantsRun = false;
  run(game, RULES.STAMINA_REGEN_DELAY + 7.5);
  assert.ok(Math.abs(s1.stamina - 5) < 0.2, `반쯤 회복 (${s1.stamina})`);
  run(game, 8);
  assert.equal(s1.stamina, RULES.STAMINA_MAX);
});

test('발전기: 혼자 10초, 손을 떼도 진행도 유지, 둘이면 빨라짐', () => {
  const { game, hunter, s1, s2 } = makeGame();
  hunter.x = hunter.z = 900;
  const [g0, g1] = game.gens;
  s1.x = g0.x + 1.2;
  s1.z = g0.z;
  s1.interact = true;
  run(game, 4);
  assert.ok(Math.abs(g0.progress - 0.4) < 0.02);
  s1.interact = false;
  run(game, 3);
  assert.ok(Math.abs(g0.progress - 0.4) < 0.02, '진행도 유지');
  s1.interact = true;
  run(game, 6.05);
  assert.ok(g0.done);

  s1.x = g1.x + 1.2;
  s1.z = g1.z;
  s2.x = g1.x - 1.2;
  s2.z = g1.z;
  s2.interact = true;
  run(game, 5.05);
  assert.ok(g1.done, '두 명이면 5초');
  assert.equal(game.exit, null);
});

test('탈출: 발전기 3개를 켜면 탈출구가 열리고, 남은 생존자가 모두 탈출하면 생존자 승리', () => {
  const { game, events, hunter, s1, s2 } = makeGame();
  hunter.x = hunter.z = 900;
  for (const g of game.gens) g.progress = 0.99;
  s1.x = game.gens[0].x + 1;
  s1.z = game.gens[0].z;
  s1.interact = true;
  for (const g of game.gens) g.progress = 1 - 1e-6;
  // 진행도를 직접 채우고 한 틱 돌려 완료 처리
  for (const g of game.gens) {
    s1.x = g.x + 1;
    s1.z = g.z;
    game.tick(DT);
  }
  assert.ok(game.exit, '탈출구 생성');
  assert.ok(game.map.exits.some((e) => e.x === game.exit.x && e.z === game.exit.z));
  s1.interact = false;
  s1.x = game.exit.x;
  s1.z = game.exit.z;
  game.tick(DT);
  assert.equal(s1.status, STATUS.ESCAPED);
  assert.ok(!game.ended, '아직 남은 생존자가 있음');
  s2.x = game.exit.x;
  s2.z = game.exit.z;
  game.tick(DT);
  assert.ok(game.ended);
  assert.equal(game.result.winner, 'survivors');
  assert.ok(events.some((e) => e.msg.t === 'end'));
});

test('승패: 일부 탈출 + 나머지 잡힘이면 생존자 승리, 전원 잡히면 술래 승리', () => {
  {
    const { game, hunter, s1, s2 } = makeGame();
    game.exit = { x: 0, z: 0 };
    s1.status = STATUS.ESCAPED;
    faceOff(game, hunter, s2);
    s2.hits = 2;
    game.handleAttack('p1');
    assert.equal(game.result.winner, 'survivors');
  }
  {
    const { game, hunter, s1, s2 } = makeGame();
    s1.status = STATUS.CAUGHT;
    faceOff(game, hunter, s2);
    s2.hits = 2;
    game.handleAttack('p1');
    assert.equal(game.result.winner, 'hunter');
  }
});

test('나가기: 술래가 나가면 생존자 승리', () => {
  const { game } = makeGame();
  game.removePlayer('p1');
  assert.equal(game.result.winner, 'survivors');
});

test('덫 가시성: 생존자에게는 4m 이내 덫만 보인다', () => {
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1, 3);
  game.handleTrap('p1');
  assert.equal(game.snapshotFor('p2').traps.length, 1);
  s1.z -= 3;
  assert.equal(game.snapshotFor('p2').traps.length, 0);
  assert.equal(game.snapshotFor('p1').traps.length, 1, '술래는 항상 보임');
});

test('맵: 모든 발전기와 생존자 시작점은 장애물과 겹치지 않는다', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { game } = makeGame(5, seed);
    for (const p of game.players.values()) {
      assert.ok(game.world.isFree(p.x, p.z, RULES.PLAYER_RADIUS * 0.9), `seed ${seed} ${p.id}`);
    }
  }
});

test('5인 규칙: 5명이면 발전기 7개, 4명이면 5개', () => {
  assert.equal(makeGame(5, 11).game.gens.length, 7);
  assert.equal(makeGame(4, 11).game.gens.length, 5);
  assert.equal(makeGame(3, 11).game.gens.length, 5);
  assert.equal(makeGame(2, 11).game.gens.length, 3, '2명이면 발전기 3개');
  const { game } = makeGame(5, 11);
  assert.deepEqual(game.startPayload('p2').rules, { hunters: 1, generators: 7, hitsToCatch: 2, damageFactor: 1 });
  assert.equal(game.startPayload('p2').generators.length, 7);
});

test('5인 규칙: 생존자는 2번 맞으면 잡힘 (4명 이하는 3번)', () => {
  {
    const { game, hunter, s1 } = makeGame(5, 11);
    faceOff(game, hunter, s1);
    game.handleAttack('p1');
    assert.equal(s1.status, STATUS.ALIVE);
    run(game, 2.05);
    game.handleAttack('p1');
    assert.equal(s1.hits, 2);
    assert.equal(s1.status, STATUS.CAUGHT);
  }
  {
    const { game, hunter, s1 } = makeGame(4, 11);
    faceOff(game, hunter, s1);
    game.handleAttack('p1');
    run(game, 2.05);
    game.handleAttack('p1');
    assert.equal(s1.status, STATUS.ALIVE, '4명이면 2번으로는 안 잡힘');
  }
});

test('5인 규칙: 발전기 5개를 모두 켜야 탈출구가 열림', () => {
  const { game, hunter, s1 } = makeGame(5, 11);
  hunter.x = hunter.z = 900;
  s1.interact = true;
  for (const [i, g] of game.gens.entries()) {
    g.progress = 1 - 1e-6;
    s1.x = g.x + 1;
    s1.z = g.z;
    game.tick(DT);
    assert.ok(g.done);
    if (i < 4) assert.equal(game.exit, null, `${i + 1}개만 켰을 때는 닫혀 있음`);
  }
  assert.ok(game.exit, '5개 모두 켜면 열림');
});

test('5인 규칙: 발전기 5개도 장애물과 겹치지 않고 서로 떨어져 있음', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { game } = makeGame(5, seed);
    for (const g of game.gens) {
      for (const o of game.gens) if (o !== g) assert.ok(Math.hypot(o.x - g.x, o.z - g.z) > 10, `seed ${seed}`);
    }
  }
});

test('제한 시간 7분: 아무도 탈출하지 못하면 술래 승리', () => {
  const { game, hunter } = makeGame();
  hunter.x = hunter.z = 900;
  run(game, RULES.MATCH_TIME - 1);
  assert.ok(!game.ended, '7분 전에는 끝나지 않음');
  run(game, 1.1);
  assert.ok(game.ended);
  assert.equal(game.result.winner, 'hunter');
  assert.equal(game.result.reason, 'timeUp');
});

test('제한 시간 7분: 이미 탈출한 생존자가 있으면 시간 종료 시 생존자 승리', () => {
  const { game, hunter, s1 } = makeGame();
  hunter.x = hunter.z = 900;
  s1.status = STATUS.ESCAPED;
  run(game, RULES.MATCH_TIME + 0.1);
  assert.ok(game.ended);
  assert.equal(game.result.winner, 'survivors');
  assert.equal(game.result.reason, 'timeUpEscaped');
});

// ───────────── 저격수 ─────────────

/** 장애물 없는 빈 공간에서 시험: 맵의 장애물을 모두 지운 세계 */
function openField(game) {
  game.world = new CollisionWorld([]);
}

test('저격수: 가까이서 맞히면 1칸, 총알은 날아가는 시간이 있음', () => {
  const { game, events, hunter, s1, s2 } = makeGame(3, 7, 'sniper');
  openField(game);
  hunter.x = 0;
  hunter.z = 0;
  s1.x = 0;
  s1.z = -15; // 15m 앞
  s2.x = s2.z = 500;
  game.handleAttack('p1', { yaw: 0, pitch: -0.007 });
  assert.equal(game.bullets.length, 1);
  assert.ok(events.some((e) => e.msg.kind === 'shot'));
  assert.equal(s1.hits, 0, '쏜 순간에는 아직 안 맞음');
  game.tick(DT); // 7.5m
  assert.equal(s1.hits, 0);
  game.tick(DT); // 15m
  game.tick(DT);
  assert.equal(s1.hits, 1);
  assert.equal(game.bullets.length, 0);
  const hit = events.find((e) => e.msg.kind === 'hit');
  assert.equal(hit.msg.dmg, 1);
});

test('저격수: 30m 밖에서 맞히면 2칸, 거리 제한 없음', () => {
  const { game, hunter, s1, s2 } = makeGame(4, 7, 'sniper');
  openField(game);
  hunter.x = 0;
  hunter.z = 70;
  s1.x = 0;
  s1.z = -70; // 140m 앞
  s2.x = s2.z = 500;
  game.players.get('p4').x = 600;
  game.handleAttack('p1', { yaw: 0, pitch: -0.001 });
  run(game, 1.2);
  assert.equal(s1.hits, 2);
  assert.equal(s1.status, STATUS.ALIVE, '3칸 중 2칸');
});

test('저격수: 5인 규칙(체력 2칸)에서 원거리 명중은 바로 잡힘', () => {
  const { game, hunter, s1 } = makeGame(5, 7, 'sniper');
  openField(game);
  for (const p of game.players.values()) if (p !== hunter && p !== s1) p.x = p.z = 600;
  hunter.x = 0;
  hunter.z = 20;
  s1.x = 0;
  s1.z = -20; // 40m
  game.handleAttack('p1', { yaw: 0, pitch: -0.002 });
  run(game, 0.5);
  assert.equal(s1.status, STATUS.CAUGHT);
});

test('저격수: 쿨타임 2초, 덫 없음', () => {
  const { game, hunter } = makeGame(3, 7, 'sniper');
  openField(game);
  game.handleAttack('p1', { yaw: 0, pitch: 0.3 });
  game.handleAttack('p1', { yaw: 0, pitch: 0.3 });
  assert.equal(game.bulletSeq, 1);
  run(game, 1.9);
  game.handleAttack('p1', { yaw: 0, pitch: 0.3 });
  assert.equal(game.bulletSeq, 1, '2초 전');
  run(game, 0.15);
  game.handleAttack('p1', { yaw: 0, pitch: 0.3 });
  assert.equal(game.bulletSeq, 2);
  game.handleTrap('p1');
  assert.equal(game.traps.length, 0);
  assert.equal(hunter.charges, RULES.TRAP_MAX_CHARGES);
});

test('저격수: 담장에 막히고, 맞은 생존자는 2초 무적', () => {
  const { game, hunter, s1, s2 } = makeGame(3, 7, 'sniper');
  openField(game);
  s2.x = s2.z = 500;
  hunter.x = 0;
  hunter.z = 0;
  s1.x = 0;
  s1.z = -10;
  game.world.add({ x: 0, z: -5, w: 4, d: 0.3, h: 1.9 });
  game.handleAttack('p1', { yaw: 0, pitch: 0 });
  run(game, 0.3);
  assert.equal(s1.hits, 0, '담장에 막힘');
  // 담장 제거 후 무적 확인
  game.world = new CollisionWorld([]);
  run(game, 3);
  game.handleAttack('p1', { yaw: 0, pitch: -0.01 });
  run(game, 0.3);
  assert.equal(s1.hits, 1);
  s1.invulnUntil = game.time + 1; // 무적 중
  run(game, 3);
  game.handleAttack('p1', { yaw: 0, pitch: -0.01 });
  s1.invulnUntil = game.time + 1;
  run(game, 0.3);
  assert.equal(s1.hits, 1, '무적 중에는 피해 없음');
  assert.equal(game.bullets.length, 0, '총알은 막혀서 사라짐');
});

test('저격수: 조준 중에는 이동 속도가 절반', () => {
  const { game, hunter } = makeGame(3, 7, 'sniper');
  game.handleInput('p1', { x: hunter.x, z: hunter.z, aim: true, moving: true, corr: hunter.corr });
  run(game, 2);
  assert.ok(Math.abs(hunter.budget - RULES.HUNTER_SPEED * 0.5 * 0.6) < 0.01, `budget ${hunter.budget}`);
  game.handleInput('p1', { x: hunter.x, z: hunter.z, aim: false, moving: true, corr: hunter.corr });
  run(game, 2);
  assert.ok(Math.abs(hunter.budget - RULES.HUNTER_SPEED * 0.6) < 0.01);
});

test('미치광이는 조준할 수 없음', () => {
  const { game, hunter } = makeGame(3, 7, 'maniac');
  game.handleInput('p1', { x: hunter.x, z: hunter.z, aim: true, corr: hunter.corr });
  assert.equal(hunter.aiming, false);
});

// ───────────── 6명 이상: 술래 2명 ─────────────

function duoGame(n = 6, classes = ['maniac', 'sniper'], seed = 5) {
  const events = [];
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const game = new Game(roster, {
    seed,
    rand: mulberry32(seed),
    hunters: [
      { id: 'p1', cls: classes[0] },
      { id: 'p2', cls: classes[1] },
    ],
    emit: (to, msg) => events.push({ to, msg }),
  });
  return { game, events };
}

test('6명 이상 규칙: 술래 2명, 발전기 7개, 체력 3칸', () => {
  for (const n of [6, 8]) {
    const { game } = duoGame(n);
    assert.equal([...game.players.values()].filter((p) => p.role === 'hunter').length, 2);
    assert.equal(game.gens.length, 7);
    assert.equal(game.rules.hitsToCatch, 3);
    const [h1, h2] = [game.players.get('p1'), game.players.get('p2')];
    assert.ok(Math.hypot(h1.x - h2.x, h1.z - h2.z) > 5, '두 술래는 다른 곳에서 시작');
    for (const p of game.players.values()) assert.ok(game.world.isFree(p.x, p.z, RULES.PLAYER_RADIUS * 0.9));
  }
  assert.deepEqual(matchRules(5), { hunters: 1, generators: 7, hitsToCatch: 2, damageFactor: 1 });
  assert.deepEqual(matchRules(4), { hunters: 1, generators: 5, hitsToCatch: 3, damageFactor: 1 });
  assert.deepEqual(matchRules(2), { hunters: 1, generators: 3, hitsToCatch: 3, damageFactor: 0.5 });
});

test('술래 2명: 술래 1명이 나가면 계속, 둘 다 나가면 생존자 승리', () => {
  const { game } = duoGame(6);
  game.removePlayer('p1');
  assert.ok(!game.ended);
  game.removePlayer('p2');
  assert.equal(game.result.winner, 'survivors');
  assert.equal(game.result.reason, 'hunterLeft');
});

test('술래 2명: 두 술래 모두 공격할 수 있고, 생존자를 모두 잡으면 술래 승리', () => {
  const { game } = duoGame(6, ['maniac', 'maniac']);
  const survivors = [...game.players.values()].filter((p) => p.role === 'survivor');
  for (const [i, s] of survivors.entries()) {
    const h = game.players.get(i % 2 === 0 ? 'p1' : 'p2');
    s.hits = 2;
    s.x = h.x;
    s.z = h.z - 1.2;
    h.yaw = 0;
    for (const o of survivors) if (o !== s && o.status === 'alive') o.x = o.z = 900 + survivors.indexOf(o);
    game.time += 2;
    game.handleAttack(h.id, { yaw: 0, pitch: 0 });
    assert.equal(s.status, STATUS.CAUGHT, `${h.id}가 잡음`);
  }
  assert.equal(game.result.winner, 'hunter');
});

test('저격수 총알은 동료 술래를 통과해 뒤의 생존자를 맞힌다', () => {
  const { game } = duoGame(6, ['sniper', 'maniac']);
  game.world = new CollisionWorld([]);
  const sniper = game.players.get('p1');
  const mate = game.players.get('p2');
  const survivors = [...game.players.values()].filter((p) => p.role === 'survivor');
  for (const s of survivors) s.x = s.z = 900;
  sniper.x = 0;
  sniper.z = 0;
  mate.x = 0;
  mate.z = -5; // 사이에 동료 술래
  survivors[0].x = 0;
  survivors[0].z = -12;
  game.handleAttack('p1', { yaw: 0, pitch: -0.01 });
  run(game, 0.3);
  assert.equal(survivors[0].hits, 1);
  assert.equal(mate.status, STATUS.ALIVE);
});

test('술래는 동료 술래의 덫을 밟지 않는다', () => {
  const { game } = duoGame(6, ['maniac', 'maniac']);
  const h1 = game.players.get('p1');
  const h2 = game.players.get('p2');
  game.handleTrap('p1');
  h2.x = h1.x;
  h2.z = h1.z;
  run(game, 0.5);
  assert.equal(game.traps.length, 1);
  assert.ok(!game.isStunned(h2));
});

// ───────────── 맵 테마 ─────────────

test('폐광산 맵: 마을과 구조가 같고 갱도 버팀목만 추가된다', async () => {
  const { generateMap, reachableCells, roadCenter } = await import('../src/mapgen.js');
  for (const seed of [1, 2, 3]) {
    const v = generateMap(seed, 'village');
    const m = generateMap(seed, 'mine');
    assert.equal(v.theme, 'village');
    assert.equal(m.theme, 'mine');
    const base = m.boxes.filter((b) => b.kind !== 'timber');
    assert.deepEqual(base, v.boxes, '버팀목을 빼면 마을 맵과 똑같은 배치');
    assert.ok(m.arches.length > 60, `버팀목 ${m.arches.length}개`);
    assert.equal(m.boxes.filter((b) => b.kind === 'timber').length, m.arches.length * 2);
    assert.equal(v.arches.length, 0);
    // 버팀목 때문에 막힌 곳이 생기지 않음: 걸어갈 수 있는 면적이 거의 같다
    const c = roadCenter(2); // 가운데 교차로
    const reachV = reachableCells(new CollisionWorld(v.boxes), c, c).length;
    const reachM = reachableCells(new CollisionWorld(m.boxes), c, c).length;
    assert.ok(reachV > 50000);
    assert.ok(reachM > reachV * 0.97, `${reachM} vs ${reachV}`);
  }
});

test('폐광산 맵으로 게임 시작: 시작 위치와 발전기가 장애물과 겹치지 않음', () => {
  for (const seed of [1, 2, 3, 4]) {
    const roster = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
    const game = new Game(roster, {
      seed,
      theme: 'mine',
      rand: mulberry32(seed),
      hunters: [
        { id: 'p1', cls: 'maniac' },
        { id: 'p2', cls: 'sniper' },
      ],
      emit: () => {},
    });
    assert.equal(game.startPayload('p3').map.theme, 'mine');
    for (const p of game.players.values()) assert.ok(game.world.isFree(p.x, p.z, RULES.PLAYER_RADIUS * 0.9), `seed ${seed}`);
  }
});

// ───────────── 암살자 ─────────────

test('암살자: 쿠나이 1칸, 쿨타임 1.5초, 사거리 3m', () => {
  const { game, hunter, s1 } = makeGame(3, 7, 'assassin');
  faceOff(game, hunter, s1, 1.8);
  game.handleAttack('p1', { yaw: 0, pitch: 0 });
  assert.equal(s1.hits, 1);
  run(game, 2.05); // 무적 끝
  hunter.attackReadyAt = game.time + 0.2;
  game.handleAttack('p1', { yaw: 0, pitch: 0 });
  assert.equal(s1.hits, 1, '쿨타임 중');
  run(game, 0.25);
  game.handleAttack('p1', { yaw: 0, pitch: 0 });
  assert.equal(s1.hits, 2);
  assert.ok(Math.abs(hunter.attackReadyAt - game.time - 1.5) < 1e-9, '쿨타임 1.5초');
  run(game, 2.05);
  faceOff(game, hunter, s1, 3.6);
  game.handleAttack('p1', { yaw: 0, pitch: 0 });
  assert.equal(s1.hits, 2, '사거리 밖');
  game.handleTrap('p1');
  assert.equal(game.traps.length, 0, '덫 없음');
});

test('암살자: 투명화 15초, 끝난 뒤 8초 쿨타임', () => {
  const { game, hunter, events } = makeGame(3, 7, 'assassin');
  game.handleSkill('p1');
  assert.ok(game.isInvisible(hunter));
  run(game, 14.9);
  assert.ok(game.isInvisible(hunter));
  run(game, 0.15);
  assert.ok(!game.isInvisible(hunter), '15초 뒤 풀림');
  assert.ok(events.some((e) => e.msg.kind === 'invis' && e.msg.on === false && e.msg.reason === 'timeout'));
  game.handleSkill('p1');
  assert.ok(!game.isInvisible(hunter), '쿨타임 중');
  run(game, 7.9);
  game.handleSkill('p1');
  assert.ok(!game.isInvisible(hunter), '8초 전');
  run(game, 0.15);
  game.handleSkill('p1');
  assert.ok(game.isInvisible(hunter), '8초 뒤 다시 사용');
});

test('암살자: 투명화 중 생존자를 맞히면 바로 풀리고, 그때부터 8초 쿨타임', () => {
  const { game, hunter, s1 } = makeGame(3, 7, 'assassin');
  game.handleSkill('p1');
  run(game, 3);
  faceOff(game, hunter, s1, 1.5);
  game.handleAttack('p1', { yaw: 0, pitch: 0 }); // 정면의 생존자를 맞힘
  assert.equal(s1.hits, 1);
  assert.ok(!game.isInvisible(hunter));
  assert.ok(Math.abs(hunter.skillReadyAt - (game.time + 8)) < 1e-9);
});

test('암살자: 헛치면 투명화 유지', () => {
  const { game, hunter, s1 } = makeGame(3, 7, 'assassin');
  game.handleSkill('p1');
  faceOff(game, hunter, s1, 1.5);
  hunter.yaw = Math.PI; // 반대 방향
  game.handleAttack('p1', { yaw: Math.PI, pitch: 0 });
  assert.equal(s1.hits, 0);
  assert.ok(game.isInvisible(hunter));
});

test('암살자: 투명화 중 생존자에게는 위치가 전혀 전달되지 않음 (동료 술래·관전자는 봄)', () => {
  const roster = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const events = [];
  const game = new Game(roster, {
    seed: 3,
    rand: mulberry32(3),
    hunters: [
      { id: 'p1', cls: 'assassin' },
      { id: 'p2', cls: 'maniac' },
    ],
    emit: (to, msg) => events.push({ to, msg }),
  });
  game.handleSkill('p1');
  const forSurvivor = game.snapshotFor('p3').players.find((p) => p.id === 'p1');
  assert.equal(forSurvivor.hidden, 1);
  assert.equal(forSurvivor.x, undefined);
  assert.equal(forSurvivor.z, undefined);
  const forMate = game.snapshotFor('p2').players.find((p) => p.id === 'p1');
  assert.equal(forMate.invis, 1);
  assert.ok(Number.isFinite(forMate.x));
  game.players.get('p4').status = STATUS.CAUGHT;
  assert.ok(Number.isFinite(game.snapshotFor('p4').players.find((p) => p.id === 'p1').x), '관전자는 봄');
  // 투명화 시작/휘두르기 이벤트도 생존자에게 가지 않는다
  assert.ok(!events.some((e) => e.msg.kind === 'invis' && (e.to === 'p3' || e.to === null)));
  events.length = 0;
  game.handleAttack('p1', { yaw: 0, pitch: 0 });
  assert.ok(!events.some((e) => e.msg.kind === 'swing' && (e.to === 'p3' || e.to === null)));
  assert.ok(events.some((e) => e.msg.kind === 'swing' && e.to === 'p2'));
});

test('미치광이·저격수는 투명화 스킬을 쓸 수 없음', () => {
  for (const cls of ['maniac', 'sniper']) {
    const { game, hunter } = makeGame(3, 7, cls);
    game.handleSkill('p1');
    assert.ok(!game.isInvisible(hunter));
  }
});

test('암살자: 투명화 중에는 이동 속도 50% 증가, 풀리면 원래대로', () => {
  const { game, hunter } = makeGame(3, 7, 'assassin');
  run(game, 2);
  const normal = RULES.HUNTER_SPEED * 0.6;
  assert.ok(Math.abs(hunter.budget - normal) < 0.01, '평소 20km/h');
  game.handleSkill('p1');
  run(game, 2);
  assert.ok(Math.abs(hunter.budget - normal * 1.5) < 0.01, `투명화 30km/h (${hunter.budget})`);
  // 실제로 1초에 30km/h(8.33m)까지 움직일 수 있는지: 열린 곳에서 이동 입력
  game.world = new CollisionWorld([]);
  const start = { x: hunter.x, z: hunter.z };
  for (let i = 0; i < 20; i++) {
    game.tick(DT);
    game.handleInput('p1', { x: hunter.x, z: hunter.z - (RULES.HUNTER_SPEED * 1.5) / 20, moving: true, corr: hunter.corr });
  }
  const moved = Math.hypot(hunter.x - start.x, hunter.z - start.z);
  assert.ok(Math.abs(moved - RULES.HUNTER_SPEED * 1.5) < 0.05, `1초 이동 ${moved.toFixed(2)}m`);
  run(game, 14);
  assert.ok(!game.isInvisible(hunter));
  run(game, 1);
  assert.ok(Math.abs(hunter.budget - normal) < 0.01, '풀리면 다시 20km/h');
});

test('암살자: 맞혀서 투명화가 풀리면 3.5초간 이동 속도 50% 감소', () => {
  const { game, hunter, s1 } = makeGame(3, 7, 'assassin');
  game.handleSkill('p1');
  run(game, 1);
  faceOff(game, hunter, s1, 1.5);
  game.handleAttack('p1', { yaw: 0, pitch: 0 });
  assert.equal(s1.hits, 1);
  assert.ok(!game.isInvisible(hunter));
  run(game, 1);
  const normal = RULES.HUNTER_SPEED * 0.6;
  assert.ok(Math.abs(hunter.budget - normal * 0.5) < 0.01, `감속 중 10km/h (${hunter.budget})`);
  assert.ok(Math.abs(game.snapshotFor('p1').me.slowLeft - 2.5) < 0.06);
  run(game, 2.6); // 총 3.6초
  run(game, 1);
  assert.ok(Math.abs(hunter.budget - normal) < 0.01, '3.5초 뒤 원래 속도');
});

test('암살자: 시간이 다 돼서 풀리면 감속 없음', () => {
  const { game, hunter } = makeGame(3, 7, 'assassin');
  game.handleSkill('p1');
  run(game, 15.1);
  assert.ok(!game.isInvisible(hunter));
  assert.equal(game.snapshotFor('p1').me.slowLeft, 0);
  run(game, 1);
  assert.ok(Math.abs(hunter.budget - RULES.HUNTER_SPEED * 0.6) < 0.01);
});

// ───────────── 백룸 ─────────────

test('백룸 맵: 같은 크기, 모든 공간이 이어져 있고 시작 위치·발전기·탈출구가 막히지 않음', async () => {
  const { generateMap, reachableCells, MAP_SIZE } = await import('../src/mapgen.js');
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const map = generateMap(seed, 'backrooms');
    assert.equal(map.theme, 'backrooms');
    assert.equal(map.size, MAP_SIZE);
    const world = new CollisionWorld(map.boxes);
    const start = map.hunterSpawns[0];
    const reach = reachableCells(world, start.x, start.z);
    // 0.5m 격자에서 비어 있는 칸 수와 비교: 거의 전부 도달 가능해야 함
    let free = 0;
    for (let x = -74.75; x < 75; x += 0.5) for (let z = -74.75; z < 75; z += 0.5) if (world.isFree(x, z, RULES.PLAYER_RADIUS + 0.02)) free++;
    assert.ok(reach.length / free > 0.995, `seed ${seed}: ${reach.length}/${free}`);
    for (const e of map.exits) assert.ok(world.isFree(e.x, e.z, 1.0));
    assert.ok(map.exits.length >= 8);
    assert.ok(map.boxes.every((b) => b.kind !== 'wall' || b.h === 1.9), '벽 높이 1.9m');
  }
});

test('백룸 맵으로 8인 게임: 모든 시작 위치와 발전기가 비어 있음', () => {
  for (const seed of [1, 2, 3]) {
    const roster = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
    const game = new Game(roster, {
      seed,
      theme: 'backrooms',
      rand: mulberry32(seed),
      hunters: [
        { id: 'p1', cls: 'assassin' },
        { id: 'p2', cls: 'sniper' },
      ],
      emit: () => {},
    });
    assert.equal(game.map.theme, 'backrooms');
    for (const p of game.players.values()) assert.ok(game.world.isFree(p.x, p.z, RULES.PLAYER_RADIUS * 0.9), `seed ${seed} ${p.id}`);
    for (const g of game.gens) {
      for (const o of game.gens) if (o !== g) assert.ok(Math.hypot(o.x - g.x, o.z - g.z) > 10);
    }
  }
});

// ───────────── 점프 ─────────────

test('점프: 술래·생존자 모두 가능, 공중에서는 다시 못 뛰고 착지하면 바로 다시', () => {
  const { game, hunter, s1 } = makeGame();
  for (const p of [hunter, s1]) {
    game.handleJump(p.id);
    assert.ok(game.isAirborne(p));
    const until = p.jumpUntil;
    game.handleJump(p.id);
    assert.equal(p.jumpUntil, until, '공중에서는 무시');
  }
  run(game, RULES.JUMP_TIME + 0.05);
  assert.ok(!game.isAirborne(s1));
  game.handleJump('p2');
  assert.ok(game.isAirborne(s1), '착지 직후 바로 점프 (쿨타임 없음)');
});

test('점프: 생존자는 스태미나 1초분 사용, 부족하면 못 뜀', () => {
  const { game, s1 } = makeGame();
  game.handleJump('p2');
  assert.equal(s1.stamina, RULES.STAMINA_MAX - 1);
  run(game, RULES.JUMP_TIME + 0.05);
  s1.stamina = 0.9;
  game.handleJump('p2');
  assert.ok(!game.isAirborne(s1));
  assert.equal(s1.stamina, 0.9);
});

test('점프: 공중에서는 덫을 밟지 않고, 착지하면 걸린다', () => {
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1, 4);
  game.handleTrap('p1');
  const trap = game.traps[0];
  game.handleJump('p2');
  s1.x = trap.x;
  s1.z = trap.z;
  game.tick(DT);
  assert.equal(game.traps.length, 1, '공중에서는 안 걸림');
  assert.ok(!game.isStunned(s1));
  run(game, RULES.JUMP_TIME);
  assert.equal(game.traps.length, 0, '착지하면 걸림');
  assert.ok(game.isStunned(s1));
  game.handleJump('p2');
  assert.ok(!game.isAirborne(s1), '덫에 걸린 동안은 점프 불가');
});

test('점프: 공중에서도 방망이에는 맞는다', () => {
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1);
  game.handleJump('p2');
  game.handleAttack('p1', { yaw: 0, pitch: 0 });
  assert.equal(s1.hits, 1);
});

// ───────────── 새 직업: 선장 · 유령 · 살가죽 · 질주자 ─────────────

/** 장애물 없는 들판에서 술래를 (0,0)에 -z를 보게 세우고 나머지 생존자는 멀리 */
function field(cls, n = 3) {
  const g = makeGame(n, 7, cls);
  openField(g.game);
  g.game.ghostWorld = new CollisionWorld([]);
  g.hunter.x = 0;
  g.hunter.z = 0;
  g.hunter.yaw = 0;
  for (const p of g.game.players.values()) if (p !== g.hunter) p.x = p.z = 500 + Math.random();
  return g;
}

test('근접 공격 사거리·쿨타임: 미치광이 3m/1초, 선장 3m/0.5초, 유령 3m/0.5초, 살가죽 4m/1.5초, 질주자 4m/1초', () => {
  for (const [cls, range, cd] of [
    ['maniac', 3, 1],
    ['captain', 3, 0.5],
    ['ghost', 3, 0.5],
    ['skinwalker', 4, 1.5],
    ['sprinter', 4, 1],
  ]) {
    const { game, hunter, s1 } = field(cls);
    s1.x = 0;
    s1.z = -(range + 0.3); // 사거리 안 (몸 반경 포함)
    game.handleAttack('p1', { yaw: 0 });
    assert.equal(s1.hits, 1, `${cls} 사거리 안`);
    assert.ok(Math.abs(hunter.attackReadyAt - game.time - cd) < 1e-9, `${cls} 쿨타임 ${cd}`);
    run(game, 3);
    s1.z = -(range + 0.5); // 사거리 밖
    game.handleAttack('p1', { yaw: 0 });
    assert.equal(s1.hits, 1, `${cls} 사거리 밖`);
  }
});

test('선장: 닻이 날아가 맞은 생존자를 피해 없이 1.5초 동안 선장 앞까지 끌고 옴', () => {
  const { game, hunter, s1 } = field('captain');
  s1.x = 0;
  s1.z = -12;
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(game.anchors.length, 1);
  game.tick(DT); // 날아가는 중 (초속 25m)
  assert.ok(!s1.pulledBy);
  run(game, 0.5);
  assert.equal(s1.pulledBy, 'p1', '맞으면 끌려옴');
  assert.equal(s1.hits, 0, '피해 없음');
  // 끌려오는 동안 생존자 입력은 무시
  game.handleInput('p2', { x: s1.x + 3, z: s1.z, moving: true, corr: s1.corr });
  run(game, 1.6);
  assert.ok(!s1.pulledBy, '1.5초 뒤 끝남');
  assert.ok(Math.hypot(s1.x - 0, s1.z - -1.3) < 0.3, `선장 앞 (${s1.x.toFixed(2)}, ${s1.z.toFixed(2)})`);
  // 쿨타임 7.5초
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(game.anchorSeq, 1, '쿨타임 중');
  run(game, 6);
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(game.anchorSeq, 2, '7.5초 뒤 다시');
});

test('선장: 닻은 최대 20m, 벽에 막힘. 끌려오다 벽에 막히면 멈춤', () => {
  {
    const { game, s1 } = field('captain');
    s1.x = 0;
    s1.z = -22;
    game.handleSkill('p1', { yaw: 0 });
    run(game, 1.5);
    assert.ok(!s1.pulledBy, '20m 밖은 안 닿음');
    assert.equal(game.anchors.length, 0);
  }
  {
    const { game, s1 } = field('captain');
    s1.x = 0;
    s1.z = -10;
    game.world.add({ x: 0, z: -5, w: 4, d: 0.3, h: 1.9 });
    game.handleSkill('p1', { yaw: 0 });
    run(game, 1);
    assert.ok(!s1.pulledBy, '벽에 막힘');
  }
  {
    const { game, s1 } = field('captain');
    s1.x = 0;
    s1.z = -10;
    game.handleSkill('p1', { yaw: 0 });
    run(game, 0.45);
    assert.equal(s1.pulledBy, 'p1');
    game.world.add({ x: 0, z: s1.z + 1.2, w: 4, d: 0.3, h: 1.9 }); // 끌려오는 길에 벽
    run(game, 1.5);
    assert.ok(!s1.pulledBy);
    assert.ok(s1.z < -5, `벽 앞에서 멈춤 (${s1.z.toFixed(2)})`);
  }
});

test('선장: 날아가는 닻의 밧줄에 닿아도 끌려옴 (닻은 계속 날아가고 여러 명 가능, 벽에 가린 밧줄은 무효)', () => {
  {
    const { game, events, s1, s2 } = field('captain');
    game.handleSkill('p1', { yaw: 0 });
    run(game, 0.3); // 닻이 약 8m 날아감
    assert.equal(game.anchors.length, 1);
    const az = game.anchors[0].z;
    assert.ok(az < -6, `닻 위치 ${az.toFixed(2)}`);
    // 닻이 이미 지나간 자리로 두 생존자가 들어와 밧줄을 건드림
    s1.x = 0.3;
    s1.z = -3;
    s2.x = -0.4;
    s2.z = -5;
    game.tick(DT);
    assert.equal(s1.pulledBy, 'p1', '밧줄에 닿아 끌려옴');
    assert.equal(s2.pulledBy, 'p1', '여러 명도 끌려옴');
    assert.equal(s1.hits, 0, '피해 없음');
    assert.equal(game.anchors.length, 1, '닻은 계속 날아감');
    assert.equal(events.filter((e) => e.msg.kind === 'ropeHit').length, 2);
    run(game, 1.6);
    assert.ok(!s1.pulledBy && !s2.pulledBy, '1.5초 뒤 끝남');
    assert.ok(Math.hypot(s1.x, s1.z + 1.3) < 0.6, `선장 앞 (${s1.x.toFixed(2)}, ${s1.z.toFixed(2)})`);
    assert.equal(game.anchors.length, 0, '20m 날아가면 닻과 밧줄이 사라짐');
    // 밧줄이 사라진 뒤에는 그 자리에 있어도 안 끌려옴
    s1.x = 0;
    s1.z = -6;
    run(game, 0.2);
    assert.ok(!s1.pulledBy, '닻이 사라진 뒤에는 무효');
  }
  {
    const { game, s1 } = field('captain');
    game.handleSkill('p1', { yaw: 0 });
    run(game, 0.3);
    s1.x = 1.2; // 밧줄에서 1.2m 옆: 안 닿음
    s1.z = -4;
    game.tick(DT);
    assert.ok(!s1.pulledBy, '밧줄에서 떨어져 있으면 안 끌려옴');
  }
  {
    const { game, hunter, s1 } = field('captain');
    game.handleSkill('p1', { yaw: 0 });
    run(game, 0.3);
    // 선장이 옆으로 비켜서 밧줄이 벽 너머를 지나게 됨
    hunter.x = 6;
    game.world.add({ x: 4, z: -1.5, w: 0.3, d: 6, h: 1.9 });
    const a = game.anchors[0];
    s1.x = (hunter.x + a.x) / 2;
    s1.z = (hunter.z + a.z) / 2;
    game.tick(DT);
    assert.ok(!s1.pulledBy, '벽에 가린 밧줄에는 안 걸림');
  }
});

test('유령: 담장·벽은 통과하지만 집·바깥 경계는 못 지나감', () => {
  const { game, hunter } = makeGame(3, 7, 'ghost');
  const wall = game.map.boxes.find((b) => b.kind === 'wall' && b.w > 3);
  const house = game.map.boxes.find((b) => b.kind === 'house');
  const tryCross = (b) => {
    // 상자 한쪽에서 반대쪽으로 이동 시도
    const along = b.w > b.d;
    hunter.x = along ? b.x : b.x - b.w / 2 - 0.6;
    hunter.z = along ? b.z - b.d / 2 - 0.6 : b.z;
    hunter.budget = 99;
    const tx = along ? b.x : b.x + b.w / 2 + 0.6;
    const tz = along ? b.z + b.d / 2 + 0.6 : b.z;
    game.handleInput('p1', { x: tx, z: tz, moving: true, corr: hunter.corr });
    return Math.hypot(hunter.x - tx, hunter.z - tz) < 0.05;
  };
  assert.ok(tryCross(wall), '담장 통과');
  assert.ok(!tryCross(house), '집은 막힘');
  hunter.x = 74;
  hunter.z = 0;
  hunter.budget = 99;
  game.handleInput('p1', { x: 78, z: 0, moving: true, corr: hunter.corr });
  assert.ok(hunter.x < 75, '맵 밖으로 못 나감');
  // 다른 직업은 담장 통과 불가
  const other = makeGame(3, 7, 'maniac');
  const h2 = other.hunter;
  h2.x = wall.w > wall.d ? wall.x : wall.x - wall.w / 2 - 0.6;
  h2.z = wall.w > wall.d ? wall.z - wall.d / 2 - 0.6 : wall.z;
  h2.budget = 99;
  const tx = wall.w > wall.d ? wall.x : wall.x + wall.w / 2 + 0.6;
  const tz = wall.w > wall.d ? wall.z + wall.d / 2 + 0.6 : wall.z;
  other.game.handleInput('p1', { x: tx, z: tz, moving: true, corr: h2.corr });
  assert.ok(Math.hypot(h2.x - tx, h2.z - tz) > 0.3, '미치광이는 막힘');
});

test('유령: 할퀴기는 벽 너머로는 안 됨', () => {
  const { game, s1 } = field('ghost');
  s1.x = 0;
  s1.z = -1.5;
  game.world.add({ x: 0, z: -0.7, w: 3, d: 0.3, h: 1.9 });
  game.handleAttack('p1', { yaw: 0 });
  assert.equal(s1.hits, 0);
});

test('유령: 보이는 생존자에게만 유도탄, 초속 5m로 벽을 통과해 따라가 1칸, 5초 뒤 사라짐', () => {
  const { game, s1, s2 } = field('ghost', 4);
  const s3 = game.players.get('p4');
  s1.x = 0;
  s1.z = -8; // 정면, 보임
  s2.x = 0;
  s2.z = 8; // 등 뒤
  s3.x = 3;
  s3.z = -15; // 정면이지만 벽 뒤
  game.world.add({ x: 3, z: -12, w: 3, d: 0.3, h: 1.9 });
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(game.wisps.length, 1, '보이는 1명에게만');
  assert.equal(game.wisps[0].target, 'p2');
  // 대상과 유도탄 사이에 벽이 생겨도 통과해서 따라간다
  game.world.add({ x: 0, z: -4, w: 3, d: 0.3, h: 1.9 });
  run(game, 1);
  assert.ok(Math.abs(game.wisps[0].z - -5) < 0.3, `초속 5m (${game.wisps[0].z})`);
  run(game, 0.6);
  assert.equal(s1.hits, 1, '맞으면 1칸');
  assert.equal(game.wisps.length, 0);
  // 달려서 5초 동안 도망치면 사라짐 (시야를 가리던 벽은 치운다)
  game.world = new CollisionWorld([]);
  run(game, 7);
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(game.wisps.filter((w) => w.target === 'p2').length, 1, '다시 보이는 생존자에게 발사');
  for (let i = 0; i < 120; i++) {
    s1.z -= RULES.SURVIVOR_RUN_SPEED * DT;
    game.tick(DT);
  }
  assert.equal(game.wisps.filter((w) => w.target === 'p2').length, 0, '5초 뒤 사라짐');
  assert.equal(s1.hits, 1, '달리면 따돌림');
});

test('살가죽: 무작위 생존자로 변장 (생존자에게는 그 모습으로만 전달), 16km/h, 공격 키를 누르면 바로 풀림', () => {
  const { game, hunter, s1, events } = field('skinwalker');
  game.handleSkill('p1', {});
  assert.ok(['p2', 'p3'].includes(hunter.disguiseAs));
  const forSurvivor = game.snapshotFor('p2').players.find((p) => p.id === 'p1');
  assert.equal(forSurvivor.look, hunter.disguiseAs);
  assert.equal(forSurvivor.disg, undefined);
  assert.ok(!events.some((e) => e.msg.kind === 'disguise' && e.msg.on && (e.to === 'p2' || e.to === null)), '생존자에게 알리지 않음');
  run(game, 2);
  assert.ok(Math.abs(hunter.budget - RULES.SURVIVOR_WALK_SPEED * 0.6) < 0.01, '생존자 걷기 속도');
  // 빗나가도 공격 키를 누르면 풀림
  s1.x = 0;
  s1.z = 30;
  game.handleAttack('p1', { yaw: 0 });
  assert.equal(hunter.disguiseAs, null);
  assert.ok(Math.abs(hunter.skillReadyAt - (game.time + 5)) < 1e-9, '풀린 뒤 5초 쿨타임');
  game.handleSkill('p1', {});
  assert.equal(hunter.disguiseAs, null, '쿨타임 중');
  run(game, 5.05);
  game.handleSkill('p1', {});
  assert.ok(hunter.disguiseAs, '5초 뒤 다시');
});

test('질주자: 평소 22km/h, 0.5초 대기 후 보던 방향으로 1초에 30m, 첫 생존자에게 1칸 주고 멈춤', () => {
  {
    const { game, hunter } = field('sprinter');
    run(game, 2);
    assert.ok(Math.abs(hunter.budget - RULES.HUNTER_SPEED * 1.1 * 0.6) < 0.01, '+10%');
    game.handleSkill('p1', { yaw: 0 });
    hunter.yaw = Math.PI / 2; // 대기 중에 돌아봐도 방향은 고정
    run(game, 0.45);
    assert.equal(hunter.dashPhase, 'windup');
    assert.ok(Math.abs(hunter.z) < 1e-6, '대기 중 정지');
    run(game, 1.1);
    assert.equal(hunter.dashPhase, null);
    assert.ok(Math.abs(hunter.z - -30) < 0.8 && Math.abs(hunter.x) < 0.01, `30m 질주 (${hunter.z.toFixed(2)})`);
    assert.ok(Math.abs(hunter.skillReadyAt - game.time - 15) < 0.06, '쿨타임 15초');
  }
  {
    const { game, hunter, s1, s2 } = field('sprinter');
    s1.x = 0;
    s1.z = -10;
    s2.x = 0;
    s2.z = -15;
    game.handleSkill('p1', { yaw: 0 });
    run(game, 1.6);
    assert.equal(s1.hits, 1, '첫 생존자 1칸');
    assert.equal(s2.hits, 0, '멈춰서 다음 생존자는 안 맞음');
    assert.ok(hunter.z > -11, `부딪힌 곳에서 멈춤 (${hunter.z.toFixed(2)})`);
  }
  {
    const { game, hunter } = field('sprinter');
    game.world.add({ x: 0, z: -8, w: 4, d: 0.3, h: 1.9 });
    game.handleSkill('p1', { yaw: 0 });
    run(game, 1.6);
    assert.ok(hunter.z > -8, `벽에 막혀 멈춤 (${hunter.z.toFixed(2)})`);
    assert.equal(hunter.dashPhase, null);
  }
});

test('유령: 보이는 생존자가 없어도 스킬 쿨타임은 소모됨', () => {
  const { game, hunter, events } = field('ghost');
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(game.wisps.length, 0);
  assert.ok(Math.abs(hunter.skillReadyAt - game.time - 7) < 1e-9);
  assert.equal(events.find((e) => e.msg.kind === 'wisps').msg.count, 0);
});

// ───────────── 생존자 지도 ─────────────

test('지도: 생존자가 수리 거리까지 다가간 발전기만 표시되고 모든 생존자에게 공유, 술래는 받지 않음', () => {
  const { game, hunter, s1, s2 } = makeGame();
  hunter.x = hunter.z = 900;
  s1.x = s1.z = 800;
  s2.x = s2.z = 700;
  game.tick(DT);
  assert.deepEqual(game.snapshotFor('p2').map.found, [], '처음엔 아무것도 없음');
  const g = game.gens[1];
  s1.x = g.x + 5;
  s1.z = g.z;
  game.tick(DT);
  assert.deepEqual(game.snapshotFor('p2').map.found, [], '5m 밖은 아직');
  s1.x = g.x + 1.5;
  game.tick(DT);
  assert.deepEqual(game.snapshotFor('p2').map.found, [g.id]);
  assert.deepEqual(game.snapshotFor('p3').map.found, [g.id], '다른 생존자에게도 공유');
  assert.equal(game.snapshotFor('p1').map, undefined, '술래는 지도 정보를 받지 않음');
});

test('지도: 생존자가 잡힌 자리가 기록됨', () => {
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1);
  s1.hits = 2;
  const at = { x: s1.x, z: s1.z };
  game.handleAttack('p1', { yaw: 0 });
  assert.equal(s1.status, STATUS.CAUGHT);
  const deaths = game.snapshotFor('p3').map.deaths;
  assert.equal(deaths.length, 1);
  assert.ok(Math.abs(deaths[0].x - at.x) < 0.01 && Math.abs(deaths[0].z - at.z) < 0.01);
  assert.equal(game.snapshotFor('p2').map.deaths.length, 1, '잡힌 본인(관전)도 봄');
});

test('음성: 2m 안은 최대, 35m부터 무음, 그 사이는 멀수록 작아진다', () => {
  assert.equal(voiceGain(0), 1);
  assert.equal(voiceGain(2), 1);
  assert.equal(voiceGain(35), 0);
  assert.equal(voiceGain(50), 0);
  assert.ok(voiceGain(10) > voiceGain(20) && voiceGain(20) > 0);
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1, 1.5);
  assert.deepEqual(game.voiceFor('p2').p1, [1, 0]);
  assert.deepEqual(game.snapshotFor('p1').voice.p2, [1, 0]);
  faceOff(game, hunter, s1, 10);
  const [g] = game.voiceFor('p2').p1;
  assert.ok(g > 0 && g < 1);
  s1.x = hunter.x + 40;
  assert.equal(game.voiceFor('p2').p1[0], 0, '35m 밖');
});

test('음성: 벽 너머면 70% 크기 + 먹먹하게', () => {
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1, 1.5);
  game.world.add({ x: hunter.x, z: hunter.z - 0.75, w: 3, d: 0.2 });
  assert.deepEqual(game.voiceFor('p2').p1, [VOICE.WALL_FACTOR, 1]);
  assert.deepEqual(game.voiceFor('p1').p2, [VOICE.WALL_FACTOR, 1]);
});

test('음성: 관전자끼리만 들리고, 살아 있는 사람과는 서로 안 들린다', () => {
  const { game, hunter, s1, s2 } = makeGame(4);
  faceOff(game, hunter, s1, 1.5);
  s2.x = s1.x;
  s2.z = s1.z;
  s1.status = STATUS.CAUGHT;
  game.players.get('p4').status = STATUS.ESCAPED;
  assert.deepEqual(game.voiceFor('p2').p4, [1, 0], '관전자끼리는 거리 상관없이 최대');
  assert.equal(game.voiceFor('p2').p1[0], 0, '관전자는 살아 있는 술래 목소리를 못 들음');
  assert.equal(game.voiceFor('p1').p2[0], 0, '살아 있는 술래는 관전자 목소리를 못 들음');
  assert.equal(game.voiceFor('p3').p2[0], 0);
  assert.equal(game.voiceFor('p3').p1[0], 1, '살아 있는 사람끼리는 들림');
});

test('음성: 투명화 중인 암살자는 생존자에게 안 들리고 동료 술래에게는 들린다', () => {
  const roster = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  const game = new Game(roster, {
    seed: 7,
    hunters: [
      { id: 'p1', cls: 'assassin' },
      { id: 'p2', cls: 'maniac' },
    ],
    rand: mulberry32(7),
    emit: () => {},
  });
  const a = game.players.get('p1');
  for (const id of ['p2', 'p3']) {
    const q = game.players.get(id);
    q.x = a.x + 1;
    q.z = a.z;
  }
  game.handleSkill('p1', {});
  assert.ok(game.isInvisible(a));
  assert.equal(game.voiceFor('p3').p1[0], 0, '생존자에게 안 들림');
  assert.ok(game.voiceFor('p2').p1[0] > 0, '동료 술래에게는 들림');
  assert.ok(game.voiceFor('p1').p3[0] > 0, '암살자는 생존자 목소리를 들음');
});

test('밸런스: 술래 20km/h, 생존자 1초 무적', () => {
  assert.ok(Math.abs(RULES.HUNTER_SPEED - 20 / 3.6) < 1e-9);
  assert.equal(RULES.HIT_INVULNERABLE, 1);
  const { game, hunter } = field('maniac');
  run(game, 2);
  assert.ok(Math.abs(hunter.budget - (20 / 3.6) * 0.6) < 0.01, '술래 이동 허용량');
});

test('푸드파이터: 걷기·달리기 모두 이동 속도 20% 감소', () => {
  const { game, s1, s2 } = makeGame();
  s1.scls = 'foodfighter';
  run(game, 2);
  assert.ok(Math.abs(s1.budget - RULES.SURVIVOR_WALK_SPEED * 0.8 * 0.6) < 0.01, '걷기 -20%');
  assert.ok(Math.abs(s2.budget - RULES.SURVIVOR_WALK_SPEED * 0.6) < 0.01, '다른 직업은 그대로');
  s1.wantsRun = true;
  s1.stamina = 5;
  run(game, 1);
  assert.ok(Math.abs(s1.budget - RULES.SURVIVOR_RUN_SPEED * 0.8 * 0.6) < 0.01, '달리기 -20%');
});

test('살가죽: 변장 중 발전기 옆에 멈춰 서 있으면 수리하는 척 (진행도는 그대로)', () => {
  const { game, hunter } = makeGame(3, 7, 'skinwalker');
  const g = game.gens[0];
  hunter.x = g.x + 1.2;
  hunter.z = g.z;
  hunter.moving = false;
  game.tick(DT);
  assert.equal(hunter.repairing, false, '변장 안 하면 안 함');
  game.handleSkill('p1', {});
  assert.ok(hunter.disguiseAs);
  run(game, 1);
  assert.equal(hunter.repairing, true);
  assert.equal(g.progress, 0, '진행도는 오르지 않음');
  const seen = game.snapshotFor('p2').players.find((p) => p.id === 'p1');
  assert.equal(seen.rep, 1, '생존자에게 수리 동작이 보임');
  assert.equal(game.snapshotFor('p2').gens.find((x) => x.id === g.id).rep, 1, '발전기 노란 불빛도 켜짐');
  hunter.moving = true;
  game.tick(DT);
  assert.equal(hunter.repairing, false, '움직이면 멈춤');
  hunter.moving = false;
  hunter.x = g.x + 5;
  game.tick(DT);
  assert.equal(hunter.repairing, false, '발전기에서 멀면 안 함');
});

test('발전기: 누군가 수리 중이면 노란 불빛(rep), 손을 떼면 꺼짐', () => {
  const { game, s1 } = makeGame();
  const g = game.gens[0];
  s1.x = g.x + 1.2;
  s1.z = g.z;
  const genOf = () => game.snapshotFor('p1').gens.find((x) => x.id === g.id);
  game.tick(DT);
  assert.equal(genOf().rep, undefined, '평소엔 꺼짐');
  s1.interact = true;
  game.tick(DT);
  assert.equal(genOf().rep, 1, '수리 중 노란 불빛 (술래에게도 보임)');
  s1.interact = false;
  game.tick(DT);
  assert.equal(genOf().rep, undefined);
});

test('선장: 닻 판정 반경 0.8m (옆으로 1.1m 비켜 있어도 맞음, 1.3m는 안 맞음)', () => {
  for (const [off, hit] of [
    [1.1, true],
    [1.3, false],
  ]) {
    const { game, s1 } = field('captain');
    s1.x = off;
    s1.z = -10;
    game.handleSkill('p1', { yaw: 0 });
    run(game, 0.8);
    assert.equal(s1.pulledBy === 'p1', hit, `옆으로 ${off}m`);
  }
});

test('발전기 수리 중에는 움직이거나 점프할 수 없고, 손을 떼면 다시 움직인다', () => {
  const { game, s1 } = makeGame();
  const g = game.gens[0];
  s1.x = g.x + 1.2;
  s1.z = g.z;
  s1.stamina = 5;
  run(game, 1);
  const send = (extra) => game.handleInput('p2', { yaw: 0, pitch: 0, moving: true, corr: s1.corr, ...extra });
  send({ interact: true, x: s1.x, z: s1.z });
  run(game, 1);
  assert.equal(s1.repairing, true);
  assert.equal(s1.budget, 0, '수리 중에는 이동 허용량이 없음');
  const before = { x: s1.x, z: s1.z };
  send({ interact: true, x: s1.x + 0.3, z: s1.z });
  assert.deepEqual({ x: s1.x, z: s1.z }, before, '수리 중 이동 입력은 무시');
  game.handleJump('p2');
  assert.equal(game.isAirborne(s1), false, '수리 중 점프 불가');
  assert.ok(g.progress > 0, '수리는 계속 진행');

  send({ interact: false, x: s1.x, z: s1.z });
  run(game, 0.5);
  send({ interact: false, x: s1.x + 0.3, z: s1.z });
  assert.ok(s1.x > before.x, '손을 떼면 움직일 수 있음');
  game.handleJump('p2');
  assert.equal(game.isAirborne(s1), true, '손을 떼면 점프 가능');
});

test('발전기에서 멀면 수리 키를 눌러도 움직일 수 있다', () => {
  const { game, s1 } = makeGame();
  const g = game.gens[0];
  s1.x = g.x + 5;
  s1.z = g.z;
  game.handleInput('p2', { moving: true, interact: true, corr: s1.corr, x: s1.x, z: s1.z });
  run(game, 1);
  assert.ok(s1.budget > 0);
  assert.equal(game.isRepairing(s1), false);
});
