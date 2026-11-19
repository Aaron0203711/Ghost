// 살덩이: 기본 공격 없음. 움직이는 동안 1초마다 발밑에 점액 웅덩이를 남기고(사라지지 않고 매초 0.05m씩 커짐),
// 웅덩이 안의 생존자는 매초 0.05칸 피해(무적 시간 무시). 스킬은 발밑에 반경 6m 웅덩이를 뿌린다(쿨타임 20초).
// 판정은 모두 서버가 한다.

import { ROLE, STATUS, HUNTER_CLASS, FLESH, slimeRadius } from '../../shared/constants.js';
import { isCarriedOrThrown } from './palcheok.js';

const r2 = (v) => Math.round(v * 100) / 100;
const alive = (p) => p && p.status === STATUS.ALIVE;

/** 이번 틱에 실제로 움직였다고 볼 수 있는가 (서버가 받은 위치가 최근에 바뀜) */
const MOVE_GRACE = 0.15;

/** 점액 웅덩이를 새로 만든다 (r0: 처음 반경) */
function addSlime(game, p, r0, spray = false) {
  const s = { id: ++game.slimeSeq, owner: p.id, x: p.x, z: p.z, born: game.time, r0 };
  game.slimes.push(s);
  game.emit(null, { t: 'event', kind: 'slime', sid: s.id, id: p.id, x: r2(s.x), z: r2(s.z), born: r2(s.born), r0, ...(spray ? { spray: 1 } : {}) });
}

/** 스킬: 발밑에 반경 6m 점액을 뿌린다. 쿨타임 20초 */
export function skillFlesh(game, p) {
  p.skillReadyAt = game.time + FLESH.SKILL_COOLDOWN;
  addSlime(game, p, FLESH.SPRAY_RADIUS, true);
}

/** 움직인 시간이 1초 쌓일 때마다 웅덩이 하나 */
function dropSlime(game, p, dt) {
  const moved = game.time - p.lastMovedAt <= MOVE_GRACE;
  if (!moved) return;
  p.slimeTimer += dt;
  if (p.slimeTimer < FLESH.SLIME_INTERVAL) return;
  p.slimeTimer -= FLESH.SLIME_INTERVAL;
  addSlime(game, p, FLESH.SLIME_RADIUS);
}

export function stepSlime(game, dt) {
  for (const p of game.players.values()) {
    if (p.cls !== HUNTER_CLASS.FLESH || !alive(p)) continue;
    dropSlime(game, p, dt);
  }
  if (!game.slimes.length) return;
  for (const s of game.players.values()) {
    if (s.role !== ROLE.SURVIVOR || !alive(s) || isCarriedOrThrown(s)) continue;
    if (game.time < s.slimeNextAt) continue;
    // 여러 웅덩이에 걸쳐도 매초 0.05칸 (점프 중에도 받음)
    const puddle = game.slimes.find((w) => Math.hypot(w.x - s.x, w.z - s.z) <= slimeRadius(w.born, game.time, w.r0));
    if (!puddle) continue;
    s.slimeNextAt = game.time + FLESH.SLIME_TICK;
    // 무적 시간을 무시하고, 맞아도 무적이 생기지 않는다
    game.damage(s, puddle.owner, FLESH.SLIME_DAMAGE, { slime: 1 }, { invuln: false });
    if (game.ended) return;
  }
}
