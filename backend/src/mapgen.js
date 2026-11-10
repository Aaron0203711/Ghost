// 일본 시골 마을 맵 생성기.
// 블록 담장(ブロック塀)으로 둘러싸인 집들, 좁은 골목길, 논, 신사로 이루어진 격자형 마을을 시드 기반으로 만든다.
// 모든 장애물은 충돌 박스(boxes)로 내보내며, 클라이언트는 같은 데이터로 렌더링과 충돌 예측을 한다.

import { CollisionWorld } from '../../shared/collision.js';
import { RULES } from '../../shared/constants.js';

export const MAP_SIZE = 150;
const HALF = MAP_SIZE / 2;
const ROAD = 6;
const N = 5;
const BLOCK = (MAP_SIZE - ROAD * (N + 1)) / N; // 22.8
const WALL_T = 0.3;
const WALL_H = 1.9;
const GATE = 2.4;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUSE_WALL_COLORS = ['#d8cfbd', '#c9b79a', '#e6e0d2', '#b9a27f', '#8c6e4f', '#cfc6b0'];
const ROOF_COLORS = ['#3b4250', '#2f3640', '#5a3a2e', '#44505c', '#6b2f2a', '#2c3e50'];

/** 도로 j(0..N)의 시작 좌표 */
const roadStart = (j) => -HALF + j * (BLOCK + ROAD);
/** 블록 i(0..N-1)의 시작 좌표 */
const blockStart = (i) => roadStart(i) + ROAD;
export const roadCenter = (j) => roadStart(j) + ROAD / 2;

export function generateMap(seed = Date.now()) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const range = (a, b) => a + rand() * (b - a);

  const boxes = [];
  const decor = [];
  const roads = [];

  const box = (kind, x, z, w, d, h, extra = {}) => boxes.push({ kind, x, z, w, d, h, ...extra });

  // 바깥 경계 담장
  const B = 1;
  box('boundary', 0, -HALF - B / 2, MAP_SIZE + 2 * B, B, 2.6);
  box('boundary', 0, HALF + B / 2, MAP_SIZE + 2 * B, B, 2.6);
  box('boundary', -HALF - B / 2, 0, B, MAP_SIZE, 2.6);
  box('boundary', HALF + B / 2, 0, B, MAP_SIZE, 2.6);

  // 도로 (렌더링용)
  for (let j = 0; j <= N; j++) {
    roads.push({ x: roadCenter(j), z: 0, w: ROAD, d: MAP_SIZE });
    roads.push({ x: 0, z: roadCenter(j), w: MAP_SIZE, d: ROAD });
  }

  /**
   * 축 방향 담장 한 변을 만든다. openings: 구멍(문) 위치 비율 목록(0..1)
   * horizontal=true면 x축을 따라 (z 고정)
   */
  const wallLine = (kind, horizontal, fixed, a0, a1, openings, h = WALL_H) => {
    const len = a1 - a0;
    const holes = openings
      .map((t) => {
        const c = a0 + 0.9 + GATE / 2 + t * Math.max(0, len - 1.8 - GATE);
        return [c - GATE / 2, c + GATE / 2];
      })
      .sort((p, q) => p[0] - q[0]);
    let cur = a0 - WALL_T / 2;
    const end = a1 + WALL_T / 2;
    const segs = [];
    for (const [h0, h1] of holes) {
      if (h0 > cur) segs.push([cur, h0]);
      cur = Math.max(cur, h1);
    }
    if (end > cur) segs.push([cur, end]);
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 0.2) continue;
      const c = (s0 + s1) / 2;
      if (horizontal) box(kind, c, fixed, s1 - s0, WALL_T, h);
      else box(kind, fixed, c, WALL_T, s1 - s0, h);
    }
  };

  // 블록 종류 배정: 가운데는 신사, 나머지는 대부분 집
  const types = [];
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      let t;
      if (i === 2 && k === 2) t = 'shrine';
      else {
        const r = rand();
        t = r < 0.72 ? 'houses' : r < 0.86 ? 'paddy' : 'park';
      }
      types.push({ i, k, t });
    }
  }

  for (const { i, k, t } of types) {
    const x0 = blockStart(i);
    const z0 = blockStart(k);
    const x1 = x0 + BLOCK;
    const z1 = z0 + BLOCK;
    if (t === 'houses') buildHouses(x0, z0, x1, z1);
    else if (t === 'paddy') buildPaddy(x0, z0, x1, z1);
    else if (t === 'park') buildPark(x0, z0, x1, z1);
    else buildShrine(x0, z0, x1, z1);
  }

  function buildHouses(x0, z0, x1, z1) {
    const nx = rand() < 0.75 ? 2 : rand() < 0.5 ? 3 : 1;
    const nz = nx === 1 ? 2 : rand() < 0.8 ? 2 : nx === 3 ? 1 : 3;
    const pw = (x1 - x0) / nx;
    const pd = (z1 - z0) / nz;

    // 각 집터(plot)의 문 위치: 바깥 변 중 하나에 반드시 문
    const gates = new Map(); // edgeKey -> openings[]
    const addGate = (key, t) => {
      if (!gates.has(key)) gates.set(key, []);
      gates.get(key).push(t);
    };
    for (let a = 0; a < nx; a++) {
      for (let b = 0; b < nz; b++) {
        const ext = [];
        if (b === 0) ext.push(`h:${b}:${a}`);
        if (b === nz - 1) ext.push(`h:${b + 1}:${a}`);
        if (a === 0) ext.push(`v:${a}:${b}`);
        if (a === nx - 1) ext.push(`v:${a + 1}:${b}`);
        if (ext.length === 0) {
          // 바깥 변이 없는 가운데 집터: 이웃과 통하는 문
          ext.push(`v:${a}:${b}`);
        }
        const first = pick(ext);
        addGate(first, rand() * 0.6 + 0.2);
        if (rand() < 0.35) {
          const second = pick(ext);
          if (second !== first) addGate(second, rand());
        }
      }
    }

    // 가로 변 (z 고정)
    for (let b = 0; b <= nz; b++) {
      for (let a = 0; a < nx; a++) {
        const key = `h:${b}:${a}`;
        const internal = b > 0 && b < nz;
        const openings = gates.get(key) || [];
        if (internal && openings.length === 0 && rand() < 0.3) openings.push(rand());
        wallLine('wall', true, z0 + b * pd, x0 + a * pw, x0 + (a + 1) * pw, openings);
      }
    }
    // 세로 변 (x 고정)
    for (let a = 0; a <= nx; a++) {
      for (let b = 0; b < nz; b++) {
        const key = `v:${a}:${b}`;
        const internal = a > 0 && a < nx;
        const openings = gates.get(key) || [];
        if (internal && openings.length === 0 && rand() < 0.3) openings.push(rand());
        wallLine('wall', false, x0 + a * pw, z0 + b * pd, z0 + (b + 1) * pd, openings);
      }
    }

    // 집
    for (let a = 0; a < nx; a++) {
      for (let b = 0; b < nz; b++) {
        const px0 = x0 + a * pw;
        const pz0 = z0 + b * pd;
        const margin = 2.1;
        const hw = Math.max(3.5, pw - margin * 2 - range(0, 1.6));
        const hd = Math.max(3.5, pd - margin * 2 - range(0, 1.6));
        const cx = px0 + pw / 2 + range(-0.4, 0.4) * Math.max(0, pw - margin * 2 - hw);
        const cz = pz0 + pd / 2 + range(-0.4, 0.4) * Math.max(0, pd - margin * 2 - hd);
        const storeys = rand() < 0.35 ? 2 : 1;
        box('house', cx, cz, hw, hd, storeys === 2 ? 5.6 : 3.1, {
          wallColor: pick(HOUSE_WALL_COLORS),
          roofColor: pick(ROOF_COLORS),
          ridgeX: hw >= hd,
          storeys,
        });
        // 마당 구석의 나무
        if (rand() < 0.55) {
          const corner = Math.floor(rand() * 4);
          const tx = corner & 1 ? px0 + pw - 1.05 : px0 + 1.05;
          const tz = corner & 2 ? pz0 + pd - 1.05 : pz0 + 1.05;
          box('trunk', tx, tz, 0.4, 0.4, 2.2);
          decor.push({ kind: 'canopy', x: tx, z: tz, r: range(1.3, 2.0), y: range(2.6, 3.4), fruit: rand() < 0.4 });
        }
      }
    }
  }

  function buildPaddy(x0, z0, x1, z1) {
    const inset = 0.8;
    const halfW = (x1 - x0 - inset * 2) / 2;
    const halfD = (z1 - z0 - inset * 2) / 2;
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        decor.push({
          kind: 'paddy',
          x: x0 + inset + halfW * (a + 0.5),
          z: z0 + inset + halfD * (b + 0.5),
          w: halfW - 0.6,
          d: halfD - 0.6,
        });
      }
    }
    // 농기구 창고
    const hx = rand() < 0.5 ? x0 + 3 : x1 - 3;
    const hz = rand() < 0.5 ? z0 + 2.6 : z1 - 2.6;
    box('hut', hx, hz, 3.6, 3, 2.5);
    // 허수아비
    for (let s = 0; s < 3; s++) {
      box('scarecrow', range(x0 + 4, x1 - 4), range(z0 + 4, z1 - 4), 0.25, 0.25, 1.7);
    }
    // 짧은 담장 몇 개 (숨을 곳)
    for (let s = 0; s < 2; s++) {
      const horizontal = rand() < 0.5;
      const len = range(3, 6);
      const cx = range(x0 + 5, x1 - 5);
      const cz = range(z0 + 5, z1 - 5);
      if (horizontal) box('wall', cx, cz, len, WALL_T, WALL_H);
      else box('wall', cx, cz, WALL_T, len, WALL_H);
    }
  }

  function buildPark(x0, z0, x1, z1) {
    // 공터: 자유롭게 놓인 담장과 창고로 미로 같은 공간
    decor.push({ kind: 'dirt', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
    const count = 7 + Math.floor(rand() * 4);
    for (let s = 0; s < count; s++) {
      const horizontal = rand() < 0.5;
      const len = range(3.5, 8);
      const cx = range(x0 + 2.5, x1 - 2.5);
      const cz = range(z0 + 2.5, z1 - 2.5);
      if (horizontal) box('wall', cx, cz, len, WALL_T, WALL_H);
      else box('wall', cx, cz, WALL_T, len, WALL_H);
    }
    for (let s = 0; s < 2; s++) {
      box('shed', range(x0 + 3, x1 - 3), range(z0 + 3, z1 - 3), 2.2, 1.8, 2.2);
    }
  }

  function buildShrine(x0, z0, x1, z1) {
    decor.push({ kind: 'gravel', x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
    // 사방에 입구가 있는 돌담
    wallLine('stonewall', true, z0, x0, x1, [0.5], 1.4);
    wallLine('stonewall', true, z1, x0, x1, [0.5], 1.4);
    wallLine('stonewall', false, x0, z0, z1, [0.5], 1.4);
    wallLine('stonewall', false, x1, z0, z1, [0.5], 1.4);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    box('shrine', cx, cz - 2, 6, 5, 4.2);
    // 석등
    for (const dx of [-2.6, 2.6]) {
      box('lantern', cx + dx, cz + 3.5, 0.6, 0.6, 1.6);
      box('lantern', cx + dx, cz + 7, 0.6, 0.6, 1.6);
    }
    // 큰 나무
    for (const [tx, tz] of [
      [x0 + 2.5, z0 + 2.5],
      [x1 - 2.5, z0 + 2.5],
      [x0 + 2.5, z1 - 2.5],
      [x1 - 2.5, z1 - 2.5],
      [x0 + 3.2, cz + 2],
      [x1 - 3.2, cz + 2],
    ]) {
      box('trunk', tx, tz, 0.8, 0.8, 3.5);
      decor.push({ kind: 'canopy', x: tx, z: tz, r: range(2.4, 3.2), y: range(4, 5), fruit: false });
    }
  }

  // 도로 소품: 전봇대, 자판기, 경트럭
  const poles = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i < N; i++) {
      // 세로 도로 j 위, 블록 i 구간 (교차로 제외)
      const along0 = blockStart(i);
      for (const vertical of [true, false]) {
        const side = rand() < 0.5 ? -1 : 1;
        const off = roadCenter(j) + side * (ROAD / 2 - 0.45);
        const p = along0 + range(3, BLOCK - 3);
        if (vertical) {
          box('pole', off, p, 0.3, 0.3, 7.5);
          poles.push({ x: off, z: p });
        } else {
          box('pole', p, off, 0.3, 0.3, 7.5);
          poles.push({ x: p, z: off });
        }
        const r = rand();
        const off2 = roadCenter(j) - side * (ROAD / 2 - 0.6);
        const p2 = along0 + range(3, BLOCK - 3);
        if (r < 0.18) {
          if (vertical) box('vending', off2, p2, 0.8, 1.0, 1.85, { face: side > 0 ? 'x+' : 'x-' });
          else box('vending', p2, off2, 1.0, 0.8, 1.85, { face: side > 0 ? 'z+' : 'z-' });
        } else if (r < 0.3) {
          const off3 = roadCenter(j) - side * (ROAD / 2 - 1.0);
          if (vertical) box('truck', off3, p2, 1.5, 3.4, 1.9);
          else box('truck', p2, off3, 3.4, 1.5, 1.9);
        }
      }
    }
  }

  // 탈출구 후보: 안쪽 도로가 바깥 경계와 만나는 곳
  const exits = [];
  for (let j = 1; j < N; j++) {
    const c = roadCenter(j);
    exits.push({ x: c, z: -HALF + 2.2, rot: 0 });
    exits.push({ x: c, z: HALF - 2.2, rot: Math.PI });
    exits.push({ x: -HALF + 2.2, z: c, rot: Math.PI / 2 });
    exits.push({ x: HALF - 2.2, z: c, rot: -Math.PI / 2 });
  }

  for (const b of boxes) {
    b.x = round(b.x);
    b.z = round(b.z);
    b.w = round(b.w);
    b.d = round(b.d);
  }

  return { seed, size: MAP_SIZE, boxes, decor, roads, poles, exits };
}

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * 도달 가능한 칸 계산: 술래 시작점에서 플레이어가 걸어갈 수 있는 모든 칸(0.5m 격자).
 * 생존자/발전기/탈출구가 막힌 공간에 생기지 않도록 사용한다.
 */
export function reachableCells(world, startX, startZ) {
  const STEP = 0.5;
  const n = Math.round(MAP_SIZE / STEP);
  const free = new Uint8Array(n * n); // 0=미검사 1=통과 2=막힘
  const seen = new Uint8Array(n * n);
  const toIdx = (x, z) => {
    const cx = Math.floor((x + HALF) / STEP);
    const cz = Math.floor((z + HALF) / STEP);
    if (cx < 0 || cz < 0 || cx >= n || cz >= n) return -1;
    return cz * n + cx;
  };
  const center = (idx) => ({ x: -HALF + (idx % n) * STEP + STEP / 2, z: -HALF + Math.floor(idx / n) * STEP + STEP / 2 });
  const isFree = (idx) => {
    if (!free[idx]) {
      const c = center(idx);
      free[idx] = world.isFree(c.x, c.z, RULES.PLAYER_RADIUS + 0.02) ? 1 : 2;
    }
    return free[idx] === 1;
  };
  const start = toIdx(startX, startZ);
  const out = [];
  if (start < 0 || !isFree(start)) return out;
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const idx = queue.pop();
    out.push(idx);
    const cx = idx % n;
    const cz = Math.floor(idx / n);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const ni = nz * n + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      if (isFree(ni)) queue.push(ni);
    }
  }
  return out.map(center);
}

/**
 * 한 판에 필요한 배치를 정한다: 술래/생존자 시작 위치, 발전기 위치.
 */
export function planMatch(map, survivorCount, rand = Math.random) {
  const world = new CollisionWorld(map.boxes);
  // 술래는 가운데 근처 교차로에서 시작
  const hj = [2, 3];
  const hunterSpawn = {
    x: roadCenter(hj[Math.floor(rand() * 2)]),
    z: roadCenter(hj[Math.floor(rand() * 2)]),
  };
  const cells = reachableCells(world, hunterSpawn.x, hunterSpawn.z);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const sample = (filter, tries = 4000) => {
    for (let t = 0; t < tries; t++) {
      const c = cells[Math.floor(rand() * cells.length)];
      if (filter(c)) return { x: c.x, z: c.z };
    }
    return null;
  };

  const generators = [];
  for (let g = 0; g < RULES.GENERATOR_COUNT; g++) {
    let minGap = 38;
    let pos = null;
    while (!pos && minGap > 5) {
      pos = sample(
        (c) =>
          world.isFree(c.x, c.z, 1.7) &&
          dist(c, hunterSpawn) > 14 &&
          Math.abs(c.x) < HALF - 4 &&
          Math.abs(c.z) < HALF - 4 &&
          generators.every((o) => dist(o, c) > minGap),
      );
      minGap -= 6;
    }
    if (!pos) pos = sample(() => true);
    generators.push({ id: g, x: pos.x, z: pos.z, rot: Math.floor(rand() * 4) * (Math.PI / 2) });
  }

  // 발전기도 장애물이므로 충돌 세계에 넣은 뒤 생존자 위치를 고른다
  for (const g of generators) world.add(generatorBox(g));

  const survivorSpawns = [];
  for (let s = 0; s < survivorCount; s++) {
    let minFromHunter = 40;
    let pos = null;
    while (!pos && minFromHunter > 0) {
      pos = sample(
        (c) =>
          world.isFree(c.x, c.z, RULES.PLAYER_RADIUS + 0.1) &&
          dist(c, hunterSpawn) > minFromHunter &&
          survivorSpawns.every((o) => dist(o, c) > 10),
      );
      minFromHunter -= 10;
    }
    survivorSpawns.push(pos || { ...hunterSpawn });
  }

  return { hunterSpawn, survivorSpawns, generators };
}

export function generatorBox(g) {
  const rotated = Math.abs(Math.sin(g.rot)) > 0.5;
  return { kind: 'generator', x: g.x, z: g.z, w: rotated ? 0.8 : 1.2, d: rotated ? 1.2 : 0.8, h: 1.1 };
}
