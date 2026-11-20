// 입체기동 모드 전용 맵: 높이 50m 거대한 벽에 둘러싸인 400m×400m 성곽 도시.
// 큰길(14m) 격자 사이 블록마다 높이 12~20m 집이 들어서고, 가운데 광장에는 시계탑이 있다.
// 집은 지붕이 평평해서 올라설 수 있고(총이 생기는 곳), 거인(반경 3m)은 큰길로만 다닌다.

import { CollisionWorld } from '../../shared/collision.js';
import { TITAN } from '../../shared/constants.js';
import { mulberry32 } from './mapgen.js';

export const TITAN_MAP = Object.freeze({ id: 'titan', name: '거인의 성벽 도시', icon: '🏰' });

const SIZE = TITAN.MAP_SIZE;
const HALF = SIZE / 2;
const ROAD = 14;
const N = 7;
const BLOCK = (SIZE - ROAD * (N + 1)) / N; // 약 41.1m
const roadStart = (j) => -HALF + j * (BLOCK + ROAD);
const blockStart = (i) => roadStart(i) + ROAD;
export const titanRoadCenter = (j) => roadStart(j) + ROAD / 2;
const round = (v) => Math.round(v * 1000) / 1000;

const WALL_COLORS = ['#e8dcc4', '#d9c9a8', '#efe6d2', '#cbb994', '#ddd2bb', '#c7b59a'];
const ROOF_COLORS = ['#8a3b2a', '#6e4a3a', '#5a3328', '#7c5b44', '#93492f', '#4f4038'];

export function generateTitanMap(seed) {
  const rand = mulberry32(seed);
  const range = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const boxes = [];
  const box = (kind, x, z, w, d, h, extra = {}) => boxes.push({ kind, x: round(x), z: round(z), w: round(w), d: round(d), h: round(h), ...extra });

  // 둘레의 거대한 벽 (두께 6m, 높이 50m)
  const T = 6;
  box('titanWall', 0, -HALF - T / 2, SIZE + 2 * T, T, TITAN.WALL_HEIGHT);
  box('titanWall', 0, HALF + T / 2, SIZE + 2 * T, T, TITAN.WALL_HEIGHT);
  box('titanWall', -HALF - T / 2, 0, T, SIZE, TITAN.WALL_HEIGHT);
  box('titanWall', HALF + T / 2, 0, T, SIZE, TITAN.WALL_HEIGHT);

  const roads = [];
  for (let j = 0; j <= N; j++) {
    roads.push({ x: titanRoadCenter(j), z: 0, w: ROAD, d: SIZE });
    roads.push({ x: 0, z: titanRoadCenter(j), w: SIZE, d: ROAD });
  }

  const mid = Math.floor(N / 2);
  const plazas = [];
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      const bx = blockStart(i);
      const bz = blockStart(k);
      if (i === mid && k === mid) {
        // 가운데 광장: 시계탑 (높이 34m)
        const cx = bx + BLOCK / 2;
        const cz = bz + BLOCK / 2;
        box('tower', cx, cz, 9, 9, 34, { color: '#cfc2a6', roof: '#4b3a30' });
        plazas.push({ x: cx, z: cz, w: BLOCK, d: BLOCK });
        continue;
      }
      // 블록을 2×2 필지로 나눈다. 가끔 두 필지를 합친 큰 집, 가끔 빈 마당
      const lot = BLOCK / 2;
      const merged = rand() < 0.25 ? (rand() < 0.5 ? 'x' : 'z') : null;
      const lots = merged === 'x'
        ? [[0, 0, 2, 1], [0, 1, 2, 1]]
        : merged === 'z'
          ? [[0, 0, 1, 2], [1, 0, 1, 2]]
          : [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]];
      for (const [lx, lz, sw, sd] of lots) {
        if (rand() < 0.1) continue; // 빈 마당
        const gap = range(1.8, 3.4); // 집 사이 골목
        const w = lot * sw - gap;
        const d = lot * sd - gap;
        const cx = bx + lot * lx + (lot * sw) / 2;
        const cz = bz + lot * lz + (lot * sd) / 2;
        const h = round(range(TITAN.HOUSE_MIN_H, TITAN.HOUSE_MAX_H));
        box('thouse', cx, cz, w, d, h, { color: pick(WALL_COLORS), roof: pick(ROOF_COLORS), floors: Math.max(3, Math.round(h / 3.6)) });
      }
    }
  }

  // 해: 방향은 판마다 다르고, 높이는 오후(약 35~45°)라 큰길에도 빛이 든다
  const sr = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const sun = { azimuth: round(sr() * Math.PI * 2), elevation: round(0.6 + sr() * 0.18) };
  return { seed, theme: 'titan', size: SIZE, boxes, decor: [], roads, plazas, poles: [], arches: [], exits: [], sun };
}

/** 지붕 위 무작위 지점 (총이 생기는 곳) */
export function randomRoofSpot(map, rand) {
  const roofs = map.boxes.filter((b) => b.kind === 'thouse' || b.kind === 'tower');
  const b = roofs[Math.floor(rand() * roofs.length)];
  const m = 1.5;
  return {
    x: round(b.x + (rand() - 0.5) * Math.max(0, b.w - 2 * m)),
    y: b.h,
    z: round(b.z + (rand() - 0.5) * Math.max(0, b.d - 2 * m)),
  };
}

/** 시작 위치: 거인은 가운데 광장 옆 큰길, 생존자는 거인에게서 80m 이상 떨어진 큰길 위 */
export function planTitanMatch(map, survivorCount, rand) {
  const world = new CollisionWorld(map.boxes);
  const mid = Math.floor(N / 2);
  const hunterSpawn = { x: titanRoadCenter(mid), z: titanRoadCenter(mid + 1) };
  const survivorSpawns = [];
  for (let s = 0; s < survivorCount; s++) {
    let pos = null;
    for (let tries = 0; tries < 400 && !pos; tries++) {
      const j = Math.floor(rand() * (N + 1));
      const along = -HALF + 10 + rand() * (SIZE - 20);
      const c = { x: titanRoadCenter(j) + (rand() - 0.5) * (ROAD - 3), z: along };
      if (rand() < 0.5) [c.x, c.z] = [c.z, c.x];
      const minFar = tries < 300 ? 80 : 30;
      if (Math.hypot(c.x - hunterSpawn.x, c.z - hunterSpawn.z) < minFar) continue;
      if (!world.isFree(c.x, c.z, 0.6)) continue;
      if (survivorSpawns.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 12)) continue;
      pos = { x: round(c.x), z: round(c.z) };
    }
    survivorSpawns.push(pos || { x: titanRoadCenter(0), z: titanRoadCenter(s % (N + 1)) });
  }
  return { hunterSpawn, hunterSpawns: [hunterSpawn], survivorSpawns, generators: [] };
}
