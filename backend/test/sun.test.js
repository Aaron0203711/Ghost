// 마을 맵의 해: 판마다 다른 위치, 모든 플레이어가 같은 해를 받는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { generateMap, makeSun, mulberry32 } from '../src/mapgen.js';
import { SUN } from '../../shared/constants.js';

test('마을 맵에는 해 질 녘 범위 안의 해가 있다', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { sun } = generateMap(seed, 'village');
    assert.ok(sun, `seed ${seed}: 해가 있어야 함`);
    assert.ok(sun.azimuth >= 0 && sun.azimuth < Math.PI * 2 + 0.001, `방향 ${sun.azimuth}`);
    assert.ok(sun.elevation >= SUN.ELEVATION_MIN - 0.001 && sun.elevation <= SUN.ELEVATION_MAX + 0.001, `높이 ${sun.elevation}`);
  }
});

test('같은 판(시드)은 같은 해, 판이 바뀌면 해의 방향이 사방으로 달라진다', () => {
  assert.deepEqual(generateMap(42, 'village').sun, generateMap(42, 'village').sun);
  assert.deepEqual(generateMap(42, 'village').sun, makeSun(42));
  // 200판의 해 방향이 네 방위(90°씩)에 모두 고르게 나온다
  const quarters = [0, 0, 0, 0];
  for (let seed = 1; seed <= 200; seed++) quarters[Math.floor(generateMap(seed, 'village').sun.azimuth / (Math.PI / 2)) % 4]++;
  for (const q of quarters) assert.ok(q >= 25, `방위별 개수 ${quarters}`);
});

test('폐광산(땅속)과 백룸(실내)에는 해가 없다', () => {
  assert.equal(generateMap(7, 'mine').sun, undefined);
  assert.equal(generateMap(7, 'backrooms').sun, undefined);
});

test('해를 넣어도 마을 배치는 그대로 (폐광산과 같은 배치에서 갱도 버팀목만 다름)', () => {
  const village = generateMap(99, 'village');
  const mine = generateMap(99, 'mine');
  assert.deepEqual(
    village.boxes,
    mine.boxes.filter((b) => b.kind !== 'timber'),
  );
});

test('게임 시작 데이터로 모든 플레이어에게 같은 해가 간다', () => {
  const roster = [1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}` }));
  const game = new Game(roster, { seed: 11, hunters: [{ id: 'p1', cls: 'maniac' }], theme: 'village', rand: mulberry32(11), emit: () => {} });
  const suns = roster.map((p) => game.startPayload(p.id).map.sun);
  assert.ok(suns[0]);
  for (const s of suns) assert.deepEqual(s, suns[0]);
});
