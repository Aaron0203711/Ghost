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
