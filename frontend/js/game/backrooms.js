// 백룸 테마: 끝없이 이어지는 노란 벽지 사무실 방. 눅눅한 카펫, 천장 타일, 형광등.
import * as THREE from 'three';
import { Batch, texturedBox, place, groundPlane, lambert } from './world.js';
import { canvasTexture, noise } from './textures.js';

export const BACKROOMS_FOG = { color: '#cdbf86', near: 12, far: 78 }; // 시야 약 75m

// ───────────── 텍스처 ─────────────

/** 노란 벽지: 희미한 세로 무늬 + 아래쪽 얼룩. 1장 = 가로 1.2m × 세로 1.9m */
const wallpaper = () =>
  canvasTexture('br-wall', 128, 256, (g, w, h) => {
    g.fillStyle = '#d2c374';
    g.fillRect(0, 0, w, h);
    // 세로 줄무늬와 작은 마름모 무늬
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = 'rgba(150,130,50,0.12)';
      g.fillRect(x, 0, 2, h);
      for (let y = 8; y < h; y += 24) {
        g.fillStyle = 'rgba(160,140,60,0.18)';
        g.beginPath();
        g.moveTo(x + 8, y - 4);
        g.lineTo(x + 12, y);
        g.lineTo(x + 8, y + 4);
        g.lineTo(x + 4, y);
        g.fill();
      }
    }
    // 습기 얼룩 (아래로 갈수록 누렇게)
    const grd = g.createLinearGradient(0, h * 0.6, 0, h);
    grd.addColorStop(0, 'rgba(120,100,40,0)');
    grd.addColorStop(1, 'rgba(120,100,40,0.35)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.08, 1500);
    // 걸레받이
    g.fillStyle = '#8e7a45';
    g.fillRect(0, h - 10, w, 10);
  });

/** 겨자색 카펫 */
const carpet = () =>
  canvasTexture('br-carpet', 256, 256, (g, w, h) => {
    g.fillStyle = '#a69152';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? 'rgba(130,112,55,0.5)' : v < 0.85 ? 'rgba(185,165,95,0.45)' : 'rgba(90,78,40,0.5)';
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1 + Math.random() * 2);
    }
  });

/** 천장 타일 (0.6m 격자). 1장 = 1.2m */
const ceilingTiles = () =>
  canvasTexture('br-ceiling', 128, 128, (g, w, h) => {
    g.fillStyle = '#d9d2ae';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.12, 1800);
    g.fillStyle = '#9d957a';
    g.fillRect(0, 0, w, 3);
    g.fillRect(0, h / 2, w, 3);
    g.fillRect(0, 0, 3, h);
    g.fillRect(w / 2, 0, 3, h);
  });

/** 형광등 패널 */
const lightPanel = () =>
  canvasTexture(
    'br-light',
    64,
    128,
    (g, w, h) => {
      g.fillStyle = '#c9c4ad';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fffbe6';
      g.fillRect(6, 6, w - 12, h - 12);
      g.fillStyle = 'rgba(200,200,180,0.5)';
      for (let y = 10; y < h - 10; y += 8) g.fillRect(6, y, w - 12, 1);
    },
    { repeat: false },
  );

/** 카펫 얼룩 (투명 원) */
const stain = () =>
  canvasTexture(
    'br-stain',
    64,
    64,
    (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(70,58,25,0.55)');
      grd.addColorStop(0.7, 'rgba(70,58,25,0.3)');
      grd.addColorStop(1, 'rgba(70,58,25,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    },
    { repeat: false },
  );

// ───────────── 맵 ─────────────

export function buildBackroomsWorld(scene, map) {
  const group = new THREE.Group();
  const size = map.size;
  const ceil = map.ceiling || 3.6;
  const B = {
    floor: new Batch(),
    wall: new Batch(),
    ceiling: new Batch(),
    light: new Batch(),
    flicker: new Batch(),
    stain: new Batch(),
    trim: new Batch(),
  };

  B.floor.add(groundPlane(size + 4, size + 4, 2.5));

  // 천장
  const c = groundPlane(size + 4, size + 4, 1.2);
  c.rotateX(Math.PI);
  B.ceiling.add(place(c, 0, ceil, 0));

  for (const b of map.boxes) {
    if (b.kind === 'wall') {
      B.wall.add(place(texturedBox(b.w, b.h, b.d, 1.2, 1.9), b.x, b.h / 2, b.z));
      // 칸막이 위 마감
      B.trim.add(place(new THREE.BoxGeometry(b.w + 0.02, 0.05, b.d + 0.02), b.x, b.h + 0.025, b.z), '#a8975c');
    } else if (b.kind === 'pillar' || b.kind === 'boundary') {
      B.wall.add(place(texturedBox(b.w, ceil, b.d, 1.2, 1.9), b.x, ceil / 2, b.z));
    }
  }

  // 형광등: 칸마다 하나, 일부는 깜빡임
  for (const l of map.lights || []) {
    const geo = new THREE.PlaneGeometry(1.2, 0.6);
    geo.rotateX(Math.PI / 2); // 아래를 향함
    (l.flicker ? B.flicker : B.light).add(place(geo, l.x, ceil - 0.01, l.z));
  }

  for (const d of map.decor) {
    if (d.kind !== 'stain') continue;
    B.stain.add(place(groundPlane(d.r * 2, d.r * 2, d.r * 2), d.x, 0.015, d.z));
  }

  const flickerMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: lightPanel() });
  const meshes = [
    B.floor.mesh(lambert({ map: carpet() })),
    B.wall.mesh(lambert({ map: wallpaper() })),
    // 천장은 아래(카펫)에서 오는 빛만 받아 칙칙해지므로 스스로 조금 밝힌다
    B.ceiling.mesh(lambert({ map: ceilingTiles(), emissive: '#8a8364', emissiveMap: ceilingTiles() })),
    B.light.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, map: lightPanel() })),
    B.flicker.mesh(flickerMat),
    B.stain.mesh(lambert({ map: stain(), transparent: true, depthWrite: false })),
    B.trim.mesh(lambert({})),
  ];
  for (const m of meshes) if (m) group.add(m);

  // 깜빡이는 형광등: 불규칙하게 꺼졌다 켜짐
  let t = 0;
  let next = 0;
  group.userData.update = (dt) => {
    t += dt;
    if (t < next) return;
    const off = Math.random() < 0.35;
    flickerMat.color.setScalar(off ? 0.25 : 1);
    next = t + (off ? 0.04 + Math.random() * 0.12 : 0.1 + Math.random() * 1.6);
  };

  scene.add(group);
  return group;
}

export function buildBackroomsSky(scene) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(190, 12, 6),
    new THREE.MeshBasicMaterial({ color: BACKROOMS_FOG.color, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

/** 탈출구: 하얀 빛이 새어 나오는 문과 초록 EXIT 표지 */
export function makeBackroomsExit(exit) {
  const g = new THREE.Group();
  g.position.set(exit.x, 0, exit.z);
  g.rotation.y = exit.rot;
  const frameMat = new THREE.MeshLambertMaterial({ color: '#8e7a45' });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.3, 0.2), frameMat);
    post.position.set(0.62 * s, 1.15, 0);
    g.add(post);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 0.2), frameMat);
  top.position.y = 2.33;
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 2.25),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  door.position.y = 1.13;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), new THREE.MeshBasicMaterial({ map: exitSign(), side: THREE.DoubleSide }));
  sign.position.y = 2.7;
  // 바닥에 번지는 빛
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 24),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  const light = new THREE.PointLight('#ffffff', 10, 16, 1.4);
  light.position.set(0, 1.6, 0.3);
  g.add(top, door, sign, glow, light);
  g.userData.portal = door;
  return g;
}

const exitSign = () =>
  canvasTexture(
    'br-exit-sign',
    192,
    64,
    (g, w, h) => {
      g.fillStyle = '#123d1c';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#5dff7a';
      g.font = 'bold 44px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('EXIT', w / 2, h / 2 + 2);
    },
    { repeat: false },
  );
