// 훈련장: 혼자 들어가 술래·생존자 직업을 체험한다. 허수아비 배치와 명단을 만든다.

import { RULES, ROLE, TRAINING, HUNTER_CLASS, SURVIVOR_CLASS } from '../../shared/constants.js';
import { reachableCells } from './mapgen.js';

// 술래 체험 허수아비 옷: 직업 의상으로 구분만 한다 (체력은 모두 3칸이 되도록 푸드파이터는 뺌)
const DUMMY_LOOKS = [SURVIVOR_CLASS.DOCTOR, SURVIVOR_CLASS.POLICE, SURVIVOR_CLASS.SOLDIER, SURVIVOR_CLASS.NINJA, SURVIVOR_CLASS.ENGINEER];

/**
 * 훈련장 명단. mode: 'hunter'(내가 술래, 생존자 허수아비) | 'survivor'(내가 생존자, 술래 허수아비)
 * @returns {{roster:object[], hunters:{id:string,cls:string}[], dummies:{id:string,dist:number}[]}}
 */
export function trainingRoster(player, mode, cls) {
  const roster = [{ ...player }];
  const dummies = [];
  let hunters;
  if (mode === ROLE.HUNTER) {
    hunters = [{ id: player.id, cls: Object.values(HUNTER_CLASS).includes(cls) ? cls : HUNTER_CLASS.MANIAC }];
    TRAINING.DUMMY_DISTANCES.forEach((dist, i) => {
      const id = `d${i + 1}`;
      roster.push({ id, name: `허수아비 ${i + 1}`, scls: DUMMY_LOOKS[i % DUMMY_LOOKS.length], dummy: true });
      dummies.push({ id, dist });
    });
  } else {
    hunters = [];
    TRAINING.HUNTER_DUMMIES.forEach((d, i) => {
      const id = `d${i + 1}`;
      roster.push({ id, name: `허수아비 ${i + 1}`, dummy: true });
      hunters.push({ id, cls: d.cls });
      dummies.push({ id, dist: d.dist });
    });
  }
  return { roster, hunters, dummies };
}

/**
 * 허수아비 자리: 시작 위치에서 갈 수 있는 곳 중 원하는 거리쯤, 되도록 시작 위치에서 보이는 곳.
 * 서로 2.5m 이상 떨어진다.
 */
export function placeDummies(world, spawn, distances, rand = Math.random) {
  const cells = reachableCells(world, spawn.x, spawn.z).filter((c) => world.isFree(c.x, c.z, RULES.PLAYER_RADIUS + 0.3));
  const out = [];
  const far = (c) => out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 2.5) && Math.hypot(c.x - spawn.x, c.z - spawn.z) > 2;
  for (const dist of distances) {
    let best = null;
    let bestScore = Infinity;
    for (const c of cells) {
      if (!far(c)) continue;
      const base = Math.abs(Math.hypot(c.x - spawn.x, c.z - spawn.z) - dist);
      if (base >= bestScore) continue; // 벌점을 더하기 전에 이미 더 나쁨
      // 거리 차이 + 벽에 가리면 벌점, 같은 점수면 무작위
      const score = base + (world.segmentBlocked(spawn.x, spawn.z, c.x, c.z) ? 25 : 0) + rand() * 0.5;
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    out.push(best ? { x: best.x, z: best.z } : { x: spawn.x, z: spawn.z });
  }
  return out;
}
