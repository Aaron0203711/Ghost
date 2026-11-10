// 2D(XZ 평면) 충돌 처리: 플레이어는 원, 장애물은 축 정렬 박스(AABB).
// 서버 검증과 클라이언트 예측이 같은 코드를 사용해서 결과가 일치한다.

const CELL = 8;

export class CollisionWorld {
  /** @param {{x:number,z:number,w:number,d:number}[]} boxes 중심 좌표 + 폭(w, x축) + 깊이(d, z축) */
  constructor(boxes = []) {
    this.boxes = [];
    this.grid = new Map();
    for (const b of boxes) this.add(b);
  }

  add(b) {
    const box = {
      minX: b.x - b.w / 2,
      maxX: b.x + b.w / 2,
      minZ: b.z - b.d / 2,
      maxZ: b.z + b.d / 2,
      h: b.h ?? Infinity,
    };
    const idx = this.boxes.length;
    this.boxes.push(box);
    for (let cx = Math.floor(box.minX / CELL); cx <= Math.floor(box.maxX / CELL); cx++) {
      for (let cz = Math.floor(box.minZ / CELL); cz <= Math.floor(box.maxZ / CELL); cz++) {
        const key = cx * 100003 + cz;
        let list = this.grid.get(key);
        if (!list) this.grid.set(key, (list = []));
        list.push(idx);
      }
    }
    return idx;
  }

  /** 영역 [minX,maxX]x[minZ,maxZ]와 겹칠 수 있는 박스 목록 */
  query(minX, minZ, maxX, maxZ) {
    const seen = new Set();
    const out = [];
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const list = this.grid.get(cx * 100003 + cz);
        if (!list) continue;
        for (const i of list) {
          if (seen.has(i)) continue;
          seen.add(i);
          out.push(this.boxes[i]);
        }
      }
    }
    return out;
  }

  /** 원이 박스와 겹치면 바깥으로 밀어낸다. */
  resolve(x, z, r) {
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const b of this.query(x - r, z - r, x + r, z + r)) {
        const cx = Math.max(b.minX, Math.min(x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
        const dx = x - cx;
        const dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = r - d + 1e-4;
          x += (dx / d) * push;
          z += (dz / d) * push;
        } else {
          // 중심이 박스 안: 가장 얕은 축으로 빼낸다
          const left = x - b.minX;
          const right = b.maxX - x;
          const top = z - b.minZ;
          const bottom = b.maxZ - z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) x = b.minX - r - 1e-4;
          else if (m === right) x = b.maxX + r + 1e-4;
          else if (m === top) z = b.minZ - r - 1e-4;
          else z = b.maxZ + r + 1e-4;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return { x, z };
  }

  /** (x,z)에서 (dx,dz)만큼 이동. 벽을 뚫지 않도록 작은 단계로 나눠 처리하고 벽을 따라 미끄러진다. */
  move(x, z, dx, dz, r) {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
    const sx = dx / steps;
    const sz = dz / steps;
    let p = { x, z };
    for (let i = 0; i < steps; i++) p = this.resolve(p.x + sx, p.z + sz, r);
    return p;
  }

  /** 원이 어떤 박스와도 겹치지 않는지 */
  isFree(x, z, r) {
    for (const b of this.query(x - r, z - r, x + r, z + r)) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return false;
    }
    return true;
  }

  /** 두 점 사이 선분이 박스에 막히는지 (방망이 공격 판정용) */
  segmentBlocked(x1, z1, x2, z2) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);
    const dx = x2 - x1;
    const dz = z2 - z1;
    for (const b of this.query(minX, minZ, maxX, maxZ)) {
      let t0 = 0;
      let t1 = 1;
      let hit = true;
      for (const [p, d, lo, hi] of [
        [x1, dx, b.minX, b.maxX],
        [z1, dz, b.minZ, b.maxZ],
      ]) {
        if (Math.abs(d) < 1e-9) {
          if (p < lo || p > hi) {
            hit = false;
            break;
          }
        } else {
          let ta = (lo - p) / d;
          let tb = (hi - p) / d;
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) {
            hit = false;
            break;
          }
        }
      }
      if (hit) return true;
    }
    return false;
  }

  /** 3D 점이 장애물 안에 있는지 (총알 판정용, 장애물 높이 고려) */
  pointBlocked(x, y, z) {
    if (y <= 0) return true;
    for (const b of this.query(x, z, x, z)) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && y <= b.h) return true;
    }
    return false;
  }
}
