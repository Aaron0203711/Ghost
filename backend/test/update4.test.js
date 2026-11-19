// 네 번째 업데이트: 밸런스 패치(무적 1.5초, 질주자·선장·푸드파이터), 지도 시야, 살덩이
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { mulberry32 } from '../src/mapgen.js';
import { RULES, STATUS, FLESH, CAPTAIN, MELEE, FOODFIGHTER, CLASS_INFO, HUNTER_CLASS, speedFor, slimeRadius } from '../../shared/constants.js';

const DT = 1 / 20;
const run = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) game.tick(DT);
};

function makeGame({ n = 3, hunters = [{ id: 'p1', cls: 'flesh' }], scls = [], seed = 7 } = {}) {
  const events = [];
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  roster.slice(hunters.length).forEach((p, i) => (p.scls = scls[i]));
  const game = new Game(roster, { seed, hunters, theme: 'village', rand: mulberry32(seed), emit: (to, msg) => events.push({ to, msg }) });
  const ev = (kind) => events.filter((e) => e.msg.kind === kind);
  return { game, events, ev, p: (id) => game.players.get(id) };
}

/** 맵 밖 빈 땅: 다른 사람은 멀리 */
function clearSpot(game, keep) {
  for (const p of game.players.values()) if (!keep.includes(p)) p.x = p.z = 1000;
  return { x: 500, z: 500 };
}

/** 살덩이가 서버에 위치를 보내며 걷는 것처럼 */
function walk(game, h, seconds, dir = { x: 1, z: 0 }) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    game.handleInput(h.id, { x: h.x + dir.x * 0.2, z: h.z + dir.z * 0.2, moving: true, corr: h.corr });
    game.tick(DT);
  }
}

test('밸런스: 무적 1.5초, 질주자 발차기 2.7초, 선장 닻 초속 50m, 푸드파이터 -10%·스태미나 10초', () => {
  assert.equal(RULES.HIT_INVULNERABLE, 1.5);
  assert.equal(MELEE.sprinter.cooldown, 2.7);
  assert.equal(CAPTAIN.ANCHOR_SPEED, 50);
  assert.equal(FOODFIGHTER.SPEED_FACTOR, 0.9);
  assert.equal(FOODFIGHTER.STAMINA_MAX, 10);
  const { game, p } = makeGame({ hunters: [{ id: 'p1', cls: 'captain' }] });
  const h = p('p1');
  const spot = clearSpot(game, [h]);
  Object.assign(h, { x: spot.x, z: spot.z, yaw: 0 });
  game.handleSkill('p1', { yaw: 0 });
  run(game, 0.2);
  assert.ok(Math.abs(game.anchors[0].traveled - 10) < 0.5, `0.2초에 10m (${game.anchors[0].traveled})`);
});

test('지도: 생존자 시야(바라보는 방향, 벽에 가리지 않음)에 들어온 발전기만 표시', () => {
  const { game, p, ev } = makeGame({ hunters: [{ id: 'p1', cls: 'maniac' }] });
  const s = p('p2');
  const g = game.gens[0];
  for (const q of game.players.values()) if (q !== s) q.x = q.z = 1000;
  // 발전기와 생존자 사이를 맵에서 직접 비운 곳으로 옮긴다: 시야 판정용 세계를 새로 만든다
  game.sightWorld = new (game.world.constructor)([]);
  Object.assign(s, { x: g.x, z: g.z + 20, yaw: Math.PI }); // 등지고 있음 (yaw=π → +z를 봄)
  game.tick(DT);
  assert.ok(!game.foundGens.has(g.id), '뒤쪽은 안 보임');
  s.yaw = 0; // -z (발전기 쪽)
  game.sightWorld.add({ x: g.x, z: g.z + 10, w: 4, d: 0.3, h: 1.9 }); // 사이에 담장
  game.tick(DT);
  assert.ok(!game.foundGens.has(g.id), '벽에 가리면 안 보임');
  game.sightWorld = new (game.world.constructor)([]);
  game.tick(DT);
  assert.ok(game.foundGens.has(g.id), '보이면 표시');
  assert.equal(ev('genFound').filter((e) => e.msg.genId === g.id && e.to === 'p2').length, 1);
  // 시야 거리 밖
  const g2 = game.gens[1];
  Object.assign(s, { x: g2.x, z: g2.z + 80, yaw: 0 });
  game.tick(DT);
  assert.ok(!game.foundGens.has(g2.id), '75m 밖은 안 보임');
});

test('살덩이: 직업 목록에 있고 기본 공격 없음', () => {
  assert.equal(HUNTER_CLASS.FLESH, 'flesh');
  assert.ok(CLASS_INFO.flesh);
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const spot = clearSpot(game, [h, s]);
  Object.assign(h, { x: spot.x, z: spot.z, yaw: 0 });
  Object.assign(s, { x: spot.x, z: spot.z - 1.5 });
  game.handleAttack('p1');
  assert.equal(s.hits, 0);
  assert.equal(ev('swing').length, 0);
});

test('살덩이 점액: 움직이는 동안 1초마다 반경 2m 웅덩이, 사라지지 않고 매초 0.05m씩 커짐', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const spot = clearSpot(game, [h]);
  Object.assign(h, { x: spot.x, z: spot.z });
  run(game, 3);
  assert.equal(game.slimes.length, 0, '가만히 있으면 안 생김');
  walk(game, h, 1.05);
  assert.equal(game.slimes.length, 1, '1초 움직이면 하나');
  walk(game, h, 2);
  assert.equal(game.slimes.length, 3);
  assert.equal(ev('slime').length, 3);
  const w = game.slimes[0];
  assert.ok(Math.abs(slimeRadius(w.born, w.born) - 2) < 1e-9, '처음 반경 2m');
  run(game, 60);
  assert.equal(game.slimes.length, 3, '사라지지 않음');
  assert.ok(Math.abs(slimeRadius(w.born, game.time) - (2 + 0.05 * (game.time - w.born))) < 1e-9);
  assert.ok(slimeRadius(w.born, game.time) > 5, '1분 뒤 반경 5m 넘음');
});

test('살덩이 점액 피해: 매초 0.05칸, 여러 웅덩이에 걸쳐도 0.05칸, 점프 중에도, 무적 무시·무적 안 줌', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const spot = clearSpot(game, [h, s]);
  Object.assign(h, { x: spot.x, z: spot.z });
  walk(game, h, 2.05, { x: 0.05, z: 0 }); // 거의 같은 자리에 두 개
  assert.equal(game.slimes.length, 2);
  h.x = h.z = 900; // 살덩이는 멀리 (더 안 만듦)
  Object.assign(s, { x: game.slimes[0].x, z: game.slimes[0].z, invulnUntil: game.time + 10 }); // 무적 중
  s.jumpUntil = game.time + 0.5; // 점프 중
  game.tick(DT);
  assert.ok(Math.abs(s.hits - 0.05) < 1e-9, '들어가자마자 0.05칸 (무적·점프 무시)');
  assert.equal(ev('hit').at(-1).msg.slime, 1);
  run(game, 0.9);
  assert.ok(Math.abs(s.hits - 0.05) < 1e-9, '1초에 한 번');
  run(game, 0.15);
  assert.ok(Math.abs(s.hits - 0.1) < 1e-9, '두 웅덩이에 걸쳐도 0.05칸');
  // 점액 피해는 무적을 주지 않는다
  s.invulnUntil = 0;
  run(game, 1);
  assert.equal(s.invulnUntil, 0);
  // 밖으로 나가면 피해 없음
  s.x += 30;
  const before = s.hits;
  run(game, 3);
  assert.equal(s.hits, before);
  // 체력이 다 닳으면 잡힘 (3칸 = 60번)
  s.x -= 30;
  run(game, 60);
  assert.equal(s.status, STATUS.CAUGHT);
});

test('살덩이 점액: 2인 규칙이면 50% 감소(0.025칸)', () => {
  const { game, p } = makeGame({ n: 2 });
  const h = p('p1');
  const s = p('p2');
  const spot = clearSpot(game, [h, s]);
  Object.assign(h, { x: spot.x, z: spot.z });
  walk(game, h, 1.05, { x: 0.05, z: 0 });
  h.x = h.z = 900;
  Object.assign(s, { x: game.slimes[0].x, z: game.slimes[0].z });
  game.tick(DT);
  assert.ok(Math.abs(s.hits - 0.025) < 1e-9);
});

test('살덩이 이동 속도: 기본 5% 느림 (19km/h)', () => {
  assert.ok(Math.abs(speedFor('hunter', false, { cls: 'flesh' }) - RULES.HUNTER_SPEED * 0.95) < 1e-9);
  const { game, p } = makeGame();
  const h = p('p1');
  const spot = clearSpot(game, [h]);
  Object.assign(h, { x: spot.x, z: spot.z });
  run(game, 1);
  assert.ok(Math.abs(h.budget - RULES.HUNTER_SPEED * 0.95 * 0.6) < 0.01);
});

test('살덩이 스킬: 발밑에 반경 6m 점액, 패시브처럼 커지고 쿨타임 20초', () => {
  const { game, p, ev } = makeGame();
  const h = p('p1');
  const s = p('p2');
  const spot = clearSpot(game, [h, s]);
  Object.assign(h, { x: spot.x, z: spot.z });
  s.x = s.z = 900;
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(game.slimes.length, 1);
  const w = game.slimes[0];
  assert.equal(w.r0, FLESH.SPRAY_RADIUS);
  assert.equal(ev('slime')[0].msg.spray, 1);
  assert.equal(ev('slime')[0].msg.r0, 6);
  assert.ok(Math.abs(w.x - spot.x) < 1e-9 && Math.abs(w.z - spot.z) < 1e-9, '발밑');
  assert.ok(Math.abs(slimeRadius(w.born, w.born, w.r0) - 6) < 1e-9, '처음 반경 6m');
  // 5.5m 떨어진 생존자는 점액 피해
  h.x = h.z = 900;
  Object.assign(s, { x: w.x + 5.5, z: w.z });
  game.tick(DT);
  assert.ok(Math.abs(s.hits - FLESH.SLIME_DAMAGE) < 1e-9);
  run(game, 10);
  assert.ok(Math.abs(slimeRadius(w.born, game.time, w.r0) - (6 + 0.05 * (game.time - w.born))) < 1e-9, '매초 0.05m씩 커짐');
  // 쿨타임 20초
  Object.assign(s, { x: 900, z: 900 });
  h.x = spot.x; h.z = spot.z;
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(ev('slime').filter((e) => e.msg.spray).length, 1, '쿨타임 중');
  run(game, FLESH.SKILL_COOLDOWN - 10);
  game.handleSkill('p1', { yaw: 0 });
  assert.equal(ev('slime').filter((e) => e.msg.spray).length, 2, '20초 뒤 다시 사용');
});

test('군인 소총 감속은 다른 속도 변화와 곱해짐 (살덩이 19 → 약 13.3km/h)', () => {
  const v = speedFor('hunter', false, { cls: 'flesh', rifleSlowed: true }) * 3.6;
  assert.ok(Math.abs(v - 19 * 0.7026) < 1e-6);
});

