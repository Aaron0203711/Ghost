// 폐광산 테마: 마을 맵과 같은 배치(충돌 박스)를 갱도 안의 폐광 분위기로 그린다.
// 암반 벽, 녹슨 함석 건물, 광차, 레일, 갱도 버팀목, 랜턴, 바위 천장.
import * as THREE from 'three';
import { Batch, texturedBox, place, gableRoof, groundPlane, lambert } from './world.js';
import { canvasTexture, noise, wood as woodTex } from './textures.js';

export const MINE_CEILING = 11;
export const MINE_FOG = { color: '#17120f', near: 6, far: 60 };

// ───────────── 텍스처 ─────────────

const rock = () =>
  canvasTexture('mine-rock', 256, 256, (g, w, h) => {
    g.fillStyle = '#5a5047';
    g.fillRect(0, 0, w, h);
    // 갈라진 암반 덩어리
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 14 + Math.random() * 34;
      const v = 60 + Math.floor(Math.random() * 45);
      g.fillStyle = `rgb(${v + 10},${v},${v - 8})`;
      g.beginPath();
      g.moveTo(x, y - r);
      for (let k = 1; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const rr = r * (0.6 + Math.random() * 0.5);
        g.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(20,15,10,0.7)';
      g.lineWidth = 2;
      g.stroke();
    }
    noise(g, w, h, 0.35, 4000);
    noise(g, w, h, 0.08, 1500, true);
    // 광맥(희미한 광물 줄)
    g.strokeStyle = 'rgba(180,140,70,0.25)';
    g.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      let x = 0;
      let y = Math.random() * h;
      g.moveTo(x, y);
      while (x < w) {
        x += 20;
        y += (Math.random() - 0.5) * 24;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });

const rustMetal = () =>
  canvasTexture('mine-rust', 256, 256, (g, w, h) => {
    g.fillStyle = '#c9c2b6';
    g.fillRect(0, 0, w, h);
    // 골함석 세로 주름
    for (let x = 0; x < w; x += 12) {
      const grd = g.createLinearGradient(x, 0, x + 12, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0.25)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.15)');
      grd.addColorStop(1, 'rgba(0,0,0,0.25)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 12, h);
    }
    // 녹 얼룩 (흘러내린 자국)
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h * 0.6;
      const grd = g.createLinearGradient(0, y, 0, y + 120);
      grd.addColorStop(0, 'rgba(140,60,20,0.7)');
      grd.addColorStop(1, 'rgba(140,60,20,0)');
      g.fillStyle = grd;
      g.fillRect(x, y, 6 + Math.random() * 26, 120);
    }
    noise(g, w, h, 0.3, 3000);
    // 판자로 막은 창문
    g.fillStyle = '#2a211a';
    g.fillRect(w * 0.3, h * 0.25, w * 0.4, h * 0.3);
    g.fillStyle = '#6b5236';
    for (let k = 0; k < 3; k++) {
      g.save();
      g.translate(w * 0.5, h * (0.3 + k * 0.1));
      g.rotate((k - 1) * 0.12);
      g.fillRect(-w * 0.23, -6, w * 0.46, 12);
      g.restore();
    }
  });

const oldPlank = () =>
  canvasTexture('mine-plank', 128, 128, (g, w, h) => {
    g.fillStyle = '#4a3828';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = `rgba(${30 + Math.random() * 30},${20 + Math.random() * 20},10,0.5)`;
      g.fillRect(0, y, w, 14);
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(0, y + 14, w, 2);
      // 못 (녹슨 어두운 점)
      g.fillStyle = 'rgba(70,60,50,0.9)';
      g.fillRect(6, y + 6, 2, 2);
      g.fillRect(w - 8, y + 6, 2, 2);
    }
    noise(g, w, h, 0.25, 900);
  });

const mineGround = () =>
  canvasTexture('mine-ground', 256, 256, (g, w, h) => {
    g.fillStyle = '#3a3029';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 30 + Math.floor(Math.random() * 50);
      g.fillStyle = `rgb(${v + 8},${v + 2},${v - 4})`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 3.5, 0, Math.PI * 2);
      g.fill();
    }
    noise(g, w, h, 0.3, 4000);
  });

const coal = () =>
  canvasTexture('mine-coal', 256, 256, (g, w, h) => {
    g.fillStyle = '#16141a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const v = 15 + Math.floor(Math.random() * 40);
      g.fillStyle = `rgb(${v},${v},${v + 6})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 2 + Math.random() * 4);
    }
    noise(g, w, h, 0.25, 1500, true);
  });

const ore = () =>
  canvasTexture('mine-ore', 256, 256, (g, w, h) => {
    g.fillStyle = '#5e5348';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      const r = Math.random();
      g.fillStyle = r < 0.08 ? '#b7893a' : r < 0.15 ? '#7a8a8a' : `rgb(${70 + Math.random() * 50},${60 + Math.random() * 40},${50 + Math.random() * 30})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
  });

const water = () =>
  canvasTexture('mine-water', 128, 128, (g, w, h) => {
    g.fillStyle = '#1d2a2c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(120,150,150,0.18)';
    for (let i = 0; i < 20; i++) {
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h, 6 + Math.random() * 14, 2 + Math.random() * 4, 0, 0, Math.PI * 2);
      g.stroke();
    }
  });

const warningSign = () =>
  canvasTexture(
    'mine-sign',
    256,
    128,
    (g, w, h) => {
      g.fillStyle = '#e8c33a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#1b1b1b';
      for (let x = -h; x < w; x += 36) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 18, h);
        g.lineTo(x + 18 + h * 0.35, h * 0.65);
        g.lineTo(x + h * 0.35, h * 0.65);
        g.fill();
      }
      g.fillStyle = '#1b1b1b';
      g.font = 'bold 54px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('立入禁止', w / 2, 62);
      noise(g, w, h, 0.25, 900);
    },
    { repeat: false },
  );

const glowSprite = () =>
  canvasTexture(
    'mine-glow',
    64,
    64,
    (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,210,140,1)');
      grd.addColorStop(0.25, 'rgba(255,170,80,0.55)');
      grd.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    },
    { repeat: false },
  );

// 같은 seed에서 매번 같은 모양이 나오도록 간단한 해시 난수
const hash = (x, z, k = 0) => {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

const RUST = ['#9a5a34', '#7d6a58', '#8b4a2b', '#6f6a62', '#a0703f', '#5f574f'];

// ───────────── 맵 ─────────────

export function buildMineWorld(scene, map) {
  const group = new THREE.Group();
  const size = map.size;
  const B = {
    ground: new Batch(),
    path: new Batch(),
    coal: new Batch(),
    ore: new Batch(),
    water: new Batch(),
    rock: new Batch(),
    rust: new Batch(),
    plank: new Batch(),
    wood: new Batch(),
    plain: new Batch(),
    glow: new Batch(),
    sign: new Batch(),
  };
  const glowPoints = [];

  // 바닥: 갱도 흙바닥, 길은 다져진 흙 + 레일
  B.ground.add(groundPlane(size + 80, size + 80, 7));
  for (const r of map.roads) {
    B.path.add(place(groundPlane(r.w, r.d, 5), r.x, 0.02, r.z), '#8a7c6c');
    addRails(B, r);
  }
  for (const d of map.decor) {
    if (d.kind === 'paddy') {
      // 논 → 고인 물웅덩이와 광석 더미
      B.water.add(place(groundPlane(d.w * 0.8, d.d * 0.8, 3), d.x, 0.03, d.z));
      B.ore.add(place(groundPlane(d.w + 0.6, d.d + 0.6, 4), d.x, 0.025, d.z));
    } else if (d.kind === 'dirt') {
      B.coal.add(place(groundPlane(d.w, d.d, 5), d.x, 0.025, d.z));
      // 석탄 무더기
      for (let i = 0; i < 5; i++) {
        const geo = new THREE.ConeGeometry(0.8 + hash(d.x, d.z, i) * 1.2, 0.6 + hash(d.z, d.x, i) * 0.8, 7);
        B.coal.add(place(geo, d.x + (hash(d.x, i) - 0.5) * d.w * 0.8, 0.4, d.z + (hash(d.z, i) - 0.5) * d.d * 0.8));
      }
    } else if (d.kind === 'gravel') {
      B.ore.add(place(groundPlane(d.w, d.d, 4), d.x, 0.025, d.z));
    }
    // canopy(나무)는 갱도에 없음
  }

  for (const b of map.boxes) {
    const t = hash(b.x, b.z);
    switch (b.kind) {
      case 'wall':
        // 거친 암반 벽 + 위쪽 나무 들보
        B.rock.add(place(texturedBox(b.w, b.h, b.d, 2, 2), b.x, b.h / 2, b.z), t < 0.5 ? '#c8bcae' : '#b3a898');
        B.wood.add(place(new THREE.BoxGeometry(b.w + 0.06, 0.16, b.d + 0.06), b.x, b.h + 0.08, b.z), '#5a4330');
        break;
      case 'boundary':
        // 바깥은 천장까지 이어지는 절벽
        B.rock.add(place(texturedBox(b.w, MINE_CEILING, b.d, 4, 4), b.x, MINE_CEILING / 2, b.z), '#8f8478');
        break;
      case 'stonewall':
        B.rock.add(place(texturedBox(b.w, b.h, b.d, 2, 2), b.x, b.h / 2, b.z), '#9d9284');
        break;
      case 'house':
        buildMineBuilding(B, b, t);
        break;
      case 'trunk':
        // 나무 → 굵은 갱목 기둥과 받침
        B.wood.add(place(new THREE.BoxGeometry(b.w * 0.9, MINE_CEILING, b.w * 0.9), b.x, MINE_CEILING / 2, b.z), '#5a4330');
        B.wood.add(place(new THREE.BoxGeometry(b.w * 2.4, 0.25, b.w * 2.4), b.x, MINE_CEILING - 0.6, b.z), '#4a3726');
        break;
      case 'pole':
        // 전봇대 → 랜턴 기둥
        B.wood.add(place(new THREE.BoxGeometry(0.22, 3.4, 0.22), b.x, 1.7, b.z), '#4f3b29');
        B.wood.add(place(new THREE.BoxGeometry(0.8, 0.1, 0.1), b.x + 0.3, 3.3, b.z), '#4f3b29');
        B.plain.add(place(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 4), b.x + 0.62, 3.1, b.z), '#222');
        B.glow.add(place(new THREE.BoxGeometry(0.18, 0.24, 0.18), b.x + 0.62, 2.85, b.z), '#ffc977');
        glowPoints.push(new THREE.Vector3(b.x + 0.62, 2.85, b.z));
        break;
      case 'vending':
        buildMinecart(B, b, t);
        break;
      case 'truck':
        buildHopper(B, b, t);
        break;
      case 'hut':
      case 'shed':
        B.plank.add(place(texturedBox(b.w, b.h, b.d, 1.6, 1.6), b.x, b.h / 2, b.z));
        B.rust.add(place(new THREE.BoxGeometry(b.w + 0.5, 0.08, b.d + 0.5), b.x, b.h + 0.04, b.z), '#7a5a40');
        break;
      case 'shrine':
        buildHeadframe(B, b);
        glowPoints.push(new THREE.Vector3(b.x, 4.6, b.z + b.d / 2 + 0.3));
        break;
      case 'lantern':
        // 석등 → 폭약 상자 더미 + 램프
        B.plank.add(place(texturedBox(0.6, 0.5, 0.6, 1, 1), b.x, 0.25, b.z));
        B.plank.add(place(texturedBox(0.5, 0.45, 0.5, 1, 1), b.x, 0.72, b.z, 0.4));
        B.plain.add(place(new THREE.BoxGeometry(0.52, 0.06, 0.52), b.x, 0.5, b.z), '#b0281f');
        B.glow.add(place(new THREE.BoxGeometry(0.16, 0.22, 0.16), b.x, 1.07, b.z), '#ffc977');
        glowPoints.push(new THREE.Vector3(b.x, 1.07, b.z));
        break;
      case 'scarecrow':
        // 허수아비 → 출입금지 표지판
        B.wood.add(place(new THREE.BoxGeometry(0.1, 1.6, 0.1), b.x, 0.8, b.z), '#4f3b29');
        B.sign.add(place(new THREE.BoxGeometry(0.9, 0.45, 0.04), b.x, 1.45, b.z, t * Math.PI));
        break;
      case 'timber':
        // 갱도 버팀목 기둥 (들보는 아래 arches에서)
        B.wood.add(place(new THREE.BoxGeometry(0.3, 3.4, 0.3), b.x, 1.7, b.z), '#5a4330');
        break;
      default:
        B.plain.add(place(new THREE.BoxGeometry(b.w, b.h, b.d), b.x, b.h / 2, b.z), '#666');
    }
  }

  // 버팀목 위 들보 + 매달린 랜턴
  for (const a of map.arches || []) {
    const len = 6.2;
    const beam = new THREE.BoxGeometry(a.alongX ? 0.32 : len, 0.32, a.alongX ? len : 0.32);
    B.wood.add(place(beam, a.x, 3.55, a.z), '#4a3726');
    for (const s of [-1, 1]) {
      // 대각 버팀
      const brace = new THREE.BoxGeometry(0.14, 1.0, 0.14);
      brace.rotateZ(a.alongX ? 0 : s * 0.7);
      brace.rotateX(a.alongX ? -s * 0.7 : 0);
      const off = 2.55;
      B.wood.add(place(brace, a.x + (a.alongX ? 0 : s * off), 3.05, a.z + (a.alongX ? s * off : 0)), '#4a3726');
    }
    if (hash(a.x, a.z, 3) < 0.45) {
      B.plain.add(place(new THREE.CylinderGeometry(0.01, 0.01, 0.35, 4), a.x, 3.22, a.z), '#222');
      B.glow.add(place(new THREE.BoxGeometry(0.16, 0.22, 0.16), a.x, 2.95, a.z), '#ffc977');
      glowPoints.push(new THREE.Vector3(a.x, 2.95, a.z));
    }
  }

  // 바위 천장 + 종유석
  const ceil = groundPlane(size + 20, size + 20, 9);
  ceil.rotateX(Math.PI);
  B.rock.add(place(ceil, 0, MINE_CEILING, 0), '#6d645b');
  for (let i = 0; i < 260; i++) {
    const x = (hash(i, 1, 9) - 0.5) * size;
    const z = (hash(i, 2, 9) - 0.5) * size;
    const hgt = 0.8 + hash(i, 3, 9) * 2.6;
    const geo = new THREE.ConeGeometry(0.25 + hash(i, 4, 9) * 0.6, hgt, 6);
    geo.rotateX(Math.PI);
    B.rock.add(place(geo, x, MINE_CEILING - hgt / 2, z), '#7a7066');
  }

  const meshes = [
    B.ground.mesh(lambert({ map: mineGround() })),
    B.path.mesh(lambert({ map: mineGround() })),
    B.coal.mesh(lambert({ map: coal() })),
    B.ore.mesh(lambert({ map: ore() })),
    B.water.mesh(new THREE.MeshPhongMaterial({ vertexColors: true, map: water(), shininess: 120, specular: 0x667777 })),
    B.rock.mesh(lambert({ map: rock(), side: THREE.DoubleSide })),
    B.rust.mesh(lambert({ map: rustMetal() })),
    B.plank.mesh(lambert({ map: oldPlank() })),
    B.wood.mesh(lambert({ map: woodTex() })),
    B.plain.mesh(lambert({})),
    B.glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })),
    B.sign.mesh(lambert({ map: warningSign() })),
  ];
  for (const m of meshes) if (m) group.add(m);

  // 랜턴 불빛 번짐 (가벼운 스프라이트)
  const glowMat = new THREE.SpriteMaterial({
    map: glowSprite(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.85,
  });
  for (const p of glowPoints) {
    const s = new THREE.Sprite(glowMat);
    s.position.copy(p);
    s.scale.setScalar(2.2);
    group.add(s);
  }
  group.userData.glowMat = glowMat;

  scene.add(group);
  return group;
}

/** 길을 따라 두 줄 레일과 침목 */
function addRails(B, r) {
  const alongX = r.w > r.d;
  const len = alongX ? r.w : r.d;
  for (const s of [-0.55, 0.55]) {
    const rail = new THREE.BoxGeometry(alongX ? len : 0.07, 0.09, alongX ? 0.07 : len);
    B.plain.add(place(rail, r.x + (alongX ? 0 : s), 0.13, r.z + (alongX ? s : 0)), '#5b5550');
  }
  const n = Math.floor(len / 0.9);
  for (let i = 0; i < n; i++) {
    const a = -len / 2 + (i + 0.5) * 0.9;
    const sleeper = new THREE.BoxGeometry(alongX ? 0.2 : 1.6, 0.08, alongX ? 1.6 : 0.2);
    B.wood.add(place(sleeper, r.x + (alongX ? a : 0), 0.06, r.z + (alongX ? 0 : a)), '#3d2e21');
  }
}

/** 집 → 녹슨 함석 광산 건물 (2층집은 선광장처럼 높게) */
function buildMineBuilding(B, b, t) {
  const color = RUST[Math.floor(t * RUST.length)];
  B.rust.add(place(texturedBox(b.w, b.h, b.d, 3, b.h / (b.storeys || 1)), b.x, b.h / 2, b.z), color);
  B.plain.add(place(new THREE.BoxGeometry(b.w + 0.1, 0.3, b.d + 0.1), b.x, 0.15, b.z), '#4a443d');
  const span = b.ridgeX ? b.d : b.w;
  const len = b.ridgeX ? b.w : b.d;
  const rh = Math.min(1.6, span * 0.22);
  const roof = gableRoof(len + 0.6, span + 0.6, rh);
  if (!b.ridgeX) roof.rotateY(Math.PI / 2);
  B.rust.add(place(roof, b.x, b.h, b.z), '#6b4a33');
  if ((b.storeys || 1) === 2) {
    // 경사 컨베이어 슈트
    const chute = new THREE.BoxGeometry(0.9, 0.5, 5);
    chute.rotateX(0.5);
    B.rust.add(place(chute, b.x + (b.ridgeX ? b.w / 2 - 0.6 : 0), b.h * 0.6, b.z + (b.ridgeX ? 0 : b.d / 2 - 0.6)), '#5c4636');
  }
  // 문틀 위 작은 등
  if (t > 0.55) {
    B.glow.add(place(new THREE.BoxGeometry(0.14, 0.14, 0.14), b.x, 2.5, b.z + b.d / 2 + 0.08), '#ffb85c');
  }
}

/** 자판기 → 광석을 실은 광차 */
function buildMinecart(B, b, t) {
  const alongX = b.w > b.d;
  const parts = [
    [new THREE.BoxGeometry(1.0, 0.7, 0.8), 0, 0.65, 0, RUST[Math.floor(t * 3)]],
    [new THREE.BoxGeometry(0.9, 0.12, 0.7), 0, 0.98, 0, '#2c2620'],
  ];
  for (const wx of [-0.32, 0.32]) {
    for (const wz of [-0.42, 0.42]) {
      const w = new THREE.CylinderGeometry(0.17, 0.17, 0.08, 10);
      w.rotateX(Math.PI / 2);
      parts.push([w, wx, 0.18, wz, '#1f1c1a']);
    }
  }
  for (let i = 0; i < 5; i++) {
    parts.push([new THREE.DodecahedronGeometry(0.13 + hash(b.x, i) * 0.08), (hash(b.z, i) - 0.5) * 0.6, 1.05, (hash(i, b.x) - 0.5) * 0.4, i % 2 ? '#2a2a30' : '#8a6a3a']);
  }
  for (const [geo, x, y, z, c] of parts) {
    geo.translate(x, y, z);
    if (!alongX) geo.rotateY(Math.PI / 2);
    geo.translate(b.x, 0, b.z);
    B.plain.add(geo, c);
  }
}

/** 경트럭 → 버려진 광석 호퍼(깔때기 화차) */
function buildHopper(B, b, t) {
  const alongX = b.w > b.d;
  const L = alongX ? b.w : b.d;
  const W = alongX ? b.d : b.w;
  const parts = [
    [new THREE.BoxGeometry(L, 0.25, W), 0, 0.45, 0, '#3a3530'],
    [new THREE.BoxGeometry(L * 0.95, 1.1, W * 0.95), 0, 1.15, 0, RUST[Math.floor(t * RUST.length)]],
    [new THREE.BoxGeometry(L * 0.9, 0.1, W * 0.85), 0, 1.72, 0, '#2a2620'],
  ];
  for (const wx of [-L * 0.32, L * 0.32]) {
    for (const wz of [-W / 2, W / 2]) {
      const w = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12);
      w.rotateX(Math.PI / 2);
      parts.push([w, wx, 0.3, wz, '#1d1b19']);
    }
  }
  for (const [geo, x, y, z, c] of parts) {
    geo.translate(x, y, z);
    if (!alongX) geo.rotateY(Math.PI / 2);
    geo.translate(b.x, 0, b.z);
    B.rust.add(geo, c);
  }
}

/** 신사 → 수직갱 권양탑(헤드프레임) */
function buildHeadframe(B, b) {
  B.plank.add(place(texturedBox(b.w, b.h * 0.7, b.d, 1.6, 1.6), b.x, (b.h * 0.7) / 2, b.z));
  B.rust.add(place(gableRoof(b.w + 0.8, b.d + 0.8, 1.2), b.x, b.h * 0.7, b.z), '#6b4a33');
  const top = 9.6;
  // A자 철골 탑
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.BoxGeometry(0.22, top, 0.22);
      leg.rotateZ(sx * 0.12);
      leg.rotateX(-sz * 0.08);
      B.rust.add(place(leg, b.x + sx * 1.6, top / 2, b.z + sz * 1.2), '#4b3f37');
    }
  }
  for (let y = 2.5; y < top; y += 2.2) {
    B.rust.add(place(new THREE.BoxGeometry(3.4 - y * 0.2, 0.14, 0.14), b.x, y, b.z - 1.2 + y * 0.02), '#4b3f37');
    B.rust.add(place(new THREE.BoxGeometry(3.4 - y * 0.2, 0.14, 0.14), b.x, y, b.z + 1.2 - y * 0.02), '#4b3f37');
  }
  // 권양 바퀴
  const wheel = new THREE.TorusGeometry(1.0, 0.09, 6, 20);
  B.rust.add(place(wheel, b.x, top - 0.2, b.z), '#5a4a3e');
  const hub = new THREE.CylinderGeometry(0.14, 0.14, 0.4, 8);
  hub.rotateX(Math.PI / 2);
  B.rust.add(place(hub, b.x, top - 0.2, b.z), '#3a312a');
  B.glow.add(place(new THREE.BoxGeometry(0.2, 0.2, 0.2), b.x, 4.6, b.z + b.d / 2 + 0.3), '#ffc977');
}

/** 바위 동굴 하늘 (천장 너머로 보이는 곳은 거의 검정) */
export function buildMineSky(scene) {
  const geo = new THREE.SphereGeometry(190, 16, 8);
  const mat = new THREE.MeshBasicMaterial({ color: '#0d0a09', side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

const dustDot = () =>
  canvasTexture(
    'mine-dust',
    32,
    32,
    (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    },
    { repeat: false },
  );

/** 공중에 떠다니는 먼지 (카메라 주변) */
export class Dust {
  constructor(scene, count = 350) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 24;
      pos[i * 3 + 1] = 0.3 + Math.random() * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 24;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: '#d8c7a8',
        map: dustDot(),
        size: 0.035,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    scene.add(this.points);
    this.t = 0;
  }

  update(dt, cam) {
    this.t += dt;
    const p = this.points;
    // 카메라 근처 24m 칸 단위로 따라다닌다
    p.position.set(Math.round(cam.x / 24) * 24, 0, Math.round(cam.z / 24) * 24);
    p.rotation.y = Math.sin(this.t * 0.05) * 0.2;
    p.position.y = Math.sin(this.t * 0.3) * 0.15;
  }
}

/** 갱도 출구: 빛이 새어 나오는 나무 갱구 */
export function makeMineExit(exit) {
  const g = new THREE.Group();
  g.position.set(exit.x, 0, exit.z);
  g.rotation.y = exit.rot;
  const wood = new THREE.MeshLambertMaterial({ color: '#6a4c32' });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), wood);
    post.position.set(1.7 * s, 2, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.45, 0.5), wood);
  beam.position.y = 4.1;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.5),
    new THREE.MeshBasicMaterial({ map: exitSign(), transparent: true }),
  );
  sign.position.set(0, 4.1, 0.27);
  sign.rotation.y = Math.PI; // 맵 안쪽(+z 회전 기준 앞)에서 읽히게
  const sign2 = sign.clone();
  sign2.position.z = -0.27;
  sign2.rotation.y = 0;
  const portal = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 3.8),
    new THREE.MeshBasicMaterial({ color: '#fff4d6', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
  );
  portal.position.y = 1.95;
  const beamLight = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.8, MINE_CEILING, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: '#ffe9b8', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  );
  beamLight.position.y = MINE_CEILING / 2;
  const light = new THREE.PointLight('#fff0cc', 14, 22, 1.4);
  light.position.set(0, 2.2, 0);
  g.add(beam, sign, sign2, portal, beamLight, light);
  g.userData.portal = portal;
  return g;
}

const exitSign = () =>
  canvasTexture(
    'mine-exit-sign',
    256,
    80,
    (g, w, h) => {
      g.fillStyle = '#1d6a2e';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.font = 'bold 50px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('出口 EXIT', w / 2, h / 2 + 2);
    },
    { repeat: false },
  );

