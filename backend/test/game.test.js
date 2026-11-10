import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { mulberry32 } from '../src/mapgen.js';
import { RULES, STATUS } from '../../shared/constants.js';
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

test('방망이: 3번 맞으면 잡힘, 맞은 뒤 2초 무적, 공격 쿨타임 1초', () => {
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1);
  game.handleAttack('p1');
  assert.equal(s1.hits, 1);
  game.handleAttack('p1'); // 쿨타임 중
  assert.equal(s1.hits, 1);
  run(game, 1.05);
  game.handleAttack('p1'); // 쿨타임은 끝났지만 무적 2초
  assert.equal(s1.hits, 1);
  run(game, 1.0);
  game.handleAttack('p1');
  assert.equal(s1.hits, 2);
  run(game, 2.05);
  game.handleAttack('p1');
  assert.equal(s1.hits, 3);
  assert.equal(s1.status, STATUS.CAUGHT);
});

test('방망이: 사거리 밖, 등 뒤, 벽 너머는 맞지 않는다', () => {
  const { game, hunter, s1 } = makeGame();
  faceOff(game, hunter, s1, 3.5);
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

test('5인 규칙: 5명이면 발전기 5개, 4명이면 3개', () => {
  assert.equal(makeGame(5, 11).game.gens.length, 5);
  assert.equal(makeGame(4, 11).game.gens.length, 3);
  assert.equal(makeGame(2, 11).game.gens.length, 3);
  const { game } = makeGame(5, 11);
  assert.deepEqual(game.startPayload('p2').rules, { generators: 5, hitsToCatch: 2 });
  assert.equal(game.startPayload('p2').generators.length, 5);
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

test('저격수: 쿨타임 3초, 덫 없음', () => {
  const { game, hunter } = makeGame(3, 7, 'sniper');
  openField(game);
  game.handleAttack('p1', { yaw: 0, pitch: 0.3 });
  game.handleAttack('p1', { yaw: 0, pitch: 0.3 });
  assert.equal(game.bulletSeq, 1);
  run(game, 2.9);
  game.handleAttack('p1', { yaw: 0, pitch: 0.3 });
  assert.equal(game.bulletSeq, 1, '3초 전');
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
