// 입체기동 모드: 거인 미치광이 덫·광대 실을 놓을 곳 (서버 판정과 화면 미리보기가 같은 계산을 쓴다)
import { TITAN, aimDirection } from './constants.js';

const maxReach = () => TITAN.RADIUS + TITAN.PLACE_RANGE;

/**
 * 미치광이 덫: 조준점이 처음 닿는 지붕 윗면 또는 땅 (거인 몸 바깥 25m 안). 벽 옆면을 가리키면 null
 * world: CollisionWorld, (x,z): 거인 위치. 반환 { x, y, z } 또는 null
 */
export function titanTrapSpot(world, x, z, yaw, pitch) {
  const d = aimDirection(yaw, pitch);
  const eye = TITAN.EYE_HEIGHT;
  const groundT = d.y < -1e-3 ? eye / -d.y : Infinity;
  const hit = world.ray3(x, eye, z, d.x, d.y, d.z, Math.min(200, groundT));
  let spot = null;
  if (hit && hit.t < groundT) {
    if (!(hit.ny > 0)) return null; // 벽 옆면
    spot = { x: hit.x, y: hit.y, z: hit.z };
  } else if (Number.isFinite(groundT)) spot = { x: x + d.x * groundT, y: 0, z: z + d.z * groundT };
  if (!spot || Math.hypot(spot.x - x, spot.z - z) > maxReach()) return null;
  return spot;
}

/**
 * 광대 실: 조준점이 닿는 벽·집 옆면(거인 몸 바깥 25m 안)에서, 그 높이 그대로 벽 바깥쪽으로 수평으로 맞은편 벽·집까지 (최대 60m).
 * 반환 { ax, az, bx, bz, y } 또는 null
 */
export function titanThreadSpan(world, x, z, yaw, pitch) {
  const d = aimDirection(yaw, pitch);
  const eye = TITAN.EYE_HEIGHT;
  const hit = world.ray3(x, eye, z, d.x, d.y, d.z, 200);
  if (!hit || hit.ny !== 0) return null; // 옆면만
  if (Math.hypot(hit.x - x, hit.z - z) > maxReach()) return null;
  const y = Math.max(0.5, hit.y);
  const ox = hit.x + hit.nx * 0.05;
  const oz = hit.z + hit.nz * 0.05;
  const opp = world.ray3(ox, y, oz, hit.nx, 0, hit.nz, TITAN.THREAD_MAX_LEN);
  if (!opp) return null;
  const r = (v) => Math.round(v * 100) / 100;
  return { ax: r(hit.x), az: r(hit.z), bx: r(opp.x), bz: r(opp.z), y: r(y) };
}
