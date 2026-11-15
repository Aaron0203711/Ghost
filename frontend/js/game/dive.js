// 익사자 다이빙 화면 요소: 조준 원(내 화면), 도착 경고 원(모두), 물보라
import * as THREE from 'three';

/** 땅에 깔리는 원: 테두리 + 옅은 안쪽 */
export function makeDiveRing(radius, color = '#3fd8c8') {
  const g = new THREE.Group();
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(0.1, radius - 0.15), radius, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
  );
  for (const m of [edge, fill]) {
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 2;
    g.add(m);
  }
  edge.position.y = 0.06;
  fill.position.y = 0.05;
  g.userData = { edge, fill };
  return g;
}

export function disposeRing(scene, g) {
  scene.remove(g);
  g.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
}

/** 도착 경고: time초 동안 안쪽이 차오르며 깜빡이고, 끝나면 사라진다 (effects 함수) */
export function makeDiveWarning(scene, x, z, radius, time) {
  const g = makeDiveRing(radius, '#2fb4ff');
  g.position.set(x, 0, z);
  scene.add(g);
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({ color: '#2fb4ff', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.07;
  g.add(inner);
  let t = 0;
  return (dt) => {
    t += dt;
    const k = Math.min(1, t / time);
    inner.scale.setScalar(Math.max(0.01, k));
    g.userData.edge.material.opacity = 0.6 + Math.sin(t * 30) * 0.3;
    if (t > time + 0.1) {
      disposeRing(scene, g);
      return false;
    }
    return true;
  };
}

/** 물보라: 위로 솟았다 떨어지는 물방울들 (effects 함수) */
export function makeSplash(scene, x, z, size = 1) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const mat = new THREE.MeshBasicMaterial({ color: '#9fe6ff', transparent: true, opacity: 0.85 });
  const geo = new THREE.SphereGeometry(0.08 * size, 6, 4);
  const drops = [];
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(geo, mat);
    const a = Math.random() * Math.PI * 2;
    const sp = (1 + Math.random() * 2.5) * size;
    drops.push({ m, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: (3 + Math.random() * 3) * size });
    m.position.y = 0.1;
    group.add(m);
  }
  scene.add(group);
  let t = 0;
  return (dt) => {
    t += dt;
    for (const d of drops) {
      d.vy -= 9.8 * dt;
      d.m.position.x += d.vx * dt;
      d.m.position.z += d.vz * dt;
      d.m.position.y = Math.max(0.05, d.m.position.y + d.vy * dt);
    }
    mat.opacity = Math.max(0, 0.85 - t * 0.8);
    if (t > 1.1) {
      scene.remove(group);
      geo.dispose();
      mat.dispose();
      return false;
    }
    return true;
  };
}

/**
 * 도시괴담: 팔척귀신이 던진 생존자가 떨어진 자리에 땅이 갈라진다 (effects 함수).
 * 지름 2×radius의 검붉은 원 + 가운데서 뻗어 나가는 금 + 튀어 오르는 흙덩이
 */
export function makeCrack(scene, x, z, radius) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({ color: '#2a0d0a', transparent: true, opacity: 0.7, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.05;
  g.add(disc);
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.12, radius, 48),
    new THREE.MeshBasicMaterial({ color: '#ff4a2a', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.06;
  g.add(edge);
  // 가운데서 뻗어 나가는 갈라진 금 (붉게 빛남)
  const glow = new THREE.MeshBasicMaterial({ color: '#ff6a2a', transparent: true, opacity: 0.95, depthWrite: false });
  const cracks = [];
  // 금 하나는 3마디로 꺾이며 뻗어 나간다 (곧은 바퀴살처럼 보이지 않게)
  for (let i = 0; i < 8; i++) {
    let ang = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    let px = 0;
    let pz = 0;
    const seg = (radius * (0.75 + Math.random() * 0.25)) / 3;
    for (let k = 0; k < 3; k++) {
      ang += (Math.random() - 0.5) * 0.9;
      const nx = px + Math.sin(ang) * seg;
      const nz = pz + Math.cos(ang) * seg;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1 - k * 0.025, seg * 1.05), glow);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = ang; // 평면의 긴 축(y)이 (sin, cos) 방향을 향하도록
      m.position.set((px + nx) / 2, 0.07, (pz + nz) / 2);
      g.add(m);
      cracks.push(m);
      px = nx;
      pz = nz;
    }
  }
  // 흙덩이
  const rockMat = new THREE.MeshLambertMaterial({ color: '#4a3a30' });
  const rockGeo = new THREE.BoxGeometry(0.16, 0.12, 0.16);
  const rocks = [];
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius;
    const m = new THREE.Mesh(rockGeo, rockMat);
    m.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    g.add(m);
    rocks.push({ m, vy: 3 + Math.random() * 3, vx: Math.cos(a) * 1.5, vz: Math.sin(a) * 1.5 });
  }
  scene.add(g);
  let t = 0;
  const LIFE = 2.2;
  return (dt) => {
    t += dt;
    const grow = Math.min(1, t / 0.15);
    for (const c of cracks) c.scale.y = grow;
    for (const r of rocks) {
      r.vy -= 9.8 * dt;
      r.m.position.x += r.vx * dt;
      r.m.position.z += r.vz * dt;
      r.m.position.y = Math.max(0.06, r.m.position.y + r.vy * dt);
      r.m.rotation.x += dt * 6;
    }
    const fade = Math.max(0, 1 - Math.max(0, t - 1.2) / (LIFE - 1.2));
    disc.material.opacity = 0.7 * fade;
    edge.material.opacity = 0.85 * fade;
    glow.opacity = 0.95 * fade;
    if (t > LIFE) {
      scene.remove(g);
      g.traverse((o) => {
        if (o.geometry && o.geometry !== rockGeo) o.geometry.dispose();
      });
      rockGeo.dispose();
      for (const m of [disc.material, edge.material, glow, rockMat]) m.dispose();
      return false;
    }
    return true;
  };
}
