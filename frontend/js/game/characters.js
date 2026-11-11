// 사람 모양 캐릭터 모델 (절차적 생성). 실제 사람 비율(약 1.75m)에
// 관절(어깨·팔꿈치·손목, 엉덩이·무릎)과 얼굴(눈·눈썹·코·귀·입), 머리 모양, 옷 디테일을 갖춘다.
// 생존자 5명은 피부·머리·옷이 서로 다르고, 술래는 직업마다 의상과 소품이 다르다.
import * as THREE from 'three';
import { canvasTexture, noise } from './textures.js';

// ───────────── 재질 ─────────────

/** 옷감 질감 (색은 재질 색으로 곱해진다) */
const fabricTex = () =>
  canvasTexture('fabric', 64, 64, (g, w, h) => {
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.05})`;
      g.fillRect(0, y, w, 1);
    }
    for (let x = 0; x < w; x += 2) {
      g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.04})`;
      g.fillRect(x, 0, 1, h);
    }
    noise(g, w, h, 0.12, 300);
  });

const cloth = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, map: fabricTex() });
const skinMat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0 });
const solid = (color, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

const capsule = (r, len, seg = 8) => new THREE.CapsuleGeometry(r, len, 4, seg);
const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};

// ───────────── 생존자 외형 5가지 ─────────────

export const SURVIVOR_LOOKS = [
  // 파란 후드티, 짧은 검은 머리
  { skin: '#e8c4a0', hair: '#1d1712', hairStyle: 'short', top: 'hoodie', topColor: '#3566b8', pants: '#2b3140', shoes: '#e9e9e9' },
  // 노란 우비 같은 재킷, 단발
  { skin: '#f0d1b4', hair: '#5a3a22', hairStyle: 'bob', top: 'jacket', topColor: '#d9a21f', pants: '#3a3f4b', shoes: '#4a2f22' },
  // 초록 티셔츠, 야구모자
  { skin: '#c99a73', hair: '#141110', hairStyle: 'cap', top: 'tshirt', topColor: '#3c9a60', pants: '#5a4a3a', shoes: '#2a2a2a', capColor: '#1f2a44' },
  // 분홍 셔츠, 포니테일
  { skin: '#f3d6be', hair: '#7a4a2a', hairStyle: 'ponytail', top: 'shirt', topColor: '#c85a9c', pants: '#22273a', shoes: '#f0f0f0' },
  // 보라 재킷, 곱슬머리
  { skin: '#8d5f45', hair: '#0f0c0b', hairStyle: 'curly', top: 'jacket', topColor: '#7a52c8', pants: '#33302e', shoes: '#b23a3a' },
];

// ───────────── 기본 인체 ─────────────

/**
 * 사람 모델을 만든다. 발바닥이 원점, 얼굴이 -z 방향.
 * spec: { skin, topColor, pants, shoes, sleeves('short'|'long'), hairStyle, hair, ... }
 * 반환: { root, parts } — parts에는 관절 피벗(armL/armR 어깨, elbowL/R, handL/R, legL/R 엉덩이, kneeL/R, head, chest)
 */
export function buildHumanoid(spec) {
  const root = new THREE.Group();
  const P = {};
  const skin = skinMat(spec.skin);
  const top = cloth(spec.topColor);
  const pants = cloth(spec.pants, 0.95);
  const shoes = solid(spec.shoes || '#222', 0.7);
  const sole = solid('#1a1a1a', 0.9);
  const longSleeves = spec.sleeves !== 'short';

  // 골반과 몸통 (허리→가슴→어깨 곡선)
  const hips = mesh(new THREE.SphereGeometry(0.17, 14, 10), pants, 0, 0.95, 0);
  hips.scale.set(1.05, 0.55, 0.7);
  root.add(hips);
  const torsoProfile = [
    [0.0, 0.0],
    [0.155, 0.0],
    [0.15, 0.08],
    [0.155, 0.18],
    [0.185, 0.32],
    [0.195, 0.4],
    [0.17, 0.47],
    [0.1, 0.52],
    [0.0, 0.53],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = mesh(new THREE.LatheGeometry(torsoProfile, 18), top, 0, 0.95, 0);
  torso.scale.z = 0.68;
  root.add(torso);
  P.chest = torso;

  // 목과 머리
  root.add(mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.12, 10), skin, 0, 1.51, 0));
  const head = new THREE.Group();
  head.position.set(0, 1.56, 0);
  root.add(head);
  P.head = head;
  const skull = mesh(new THREE.SphereGeometry(0.105, 18, 14), skin, 0, 0.09, 0);
  skull.scale.set(0.92, 1.13, 1.0);
  const jaw = mesh(new THREE.SphereGeometry(0.08, 14, 10), skin, 0, 0.035, -0.022);
  jaw.scale.set(0.95, 0.85, 1.0);
  head.add(skull, jaw);
  if (!spec.noFace) addFace(head, spec);
  addHair(head, spec);

  // 팔: 어깨 피벗 → 위팔 → 팔꿈치 → 아래팔 → 손목 → 손
  const arm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.215 * side, 1.4, 0);
    const deltoid = mesh(new THREE.SphereGeometry(0.054, 10, 8), top, 0, -0.015, 0);
    const upper = mesh(capsule(0.048, 0.2), top, 0, -0.14, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -0.28;
    const forearm = mesh(capsule(0.04, 0.19), longSleeves ? top : skin, 0, -0.13, 0);
    if (longSleeves) elbow.add(mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.035, 10), top, 0, -0.24, 0)); // 소매 끝
    const hand = new THREE.Group();
    hand.position.y = -0.27;
    const palm = mesh(new THREE.BoxGeometry(0.075, 0.09, 0.03), skin, 0, -0.045, 0);
    const fingers = mesh(new THREE.BoxGeometry(0.07, 0.05, 0.026), skin, 0, -0.11, -0.004);
    fingers.rotation.x = 0.25;
    const thumb = mesh(capsule(0.012, 0.035), skin, -0.04 * side, -0.04, -0.015);
    thumb.rotation.z = 0.5 * side;
    hand.add(palm, fingers, thumb);
    elbow.add(forearm, hand);
    shoulder.add(deltoid, upper, elbow);
    root.add(shoulder);
    return { shoulder, elbow, hand };
  };
  const L = arm(-1);
  const R = arm(1);
  Object.assign(P, { armL: L.shoulder, armR: R.shoulder, elbowL: L.elbow, elbowR: R.elbow, handL: L.hand, handR: R.hand });

  // 다리: 엉덩이 피벗 → 허벅지 → 무릎 → 정강이 → 신발
  const leg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.095 * side, 0.92, 0);
    const thigh = mesh(capsule(0.072, 0.3), pants, 0, -0.21, 0);
    const knee = new THREE.Group();
    knee.position.y = -0.43;
    const shin = mesh(capsule(0.056, 0.32), pants, 0, -0.2, 0);
    const shoe = mesh(new THREE.BoxGeometry(0.105, 0.075, 0.25), shoes, 0, -0.43, -0.045);
    const toe = mesh(new THREE.SphereGeometry(0.053, 10, 8), shoes, 0, -0.44, -0.16);
    toe.scale.set(1, 0.7, 1);
    const soleM = mesh(new THREE.BoxGeometry(0.11, 0.02, 0.27), sole, 0, -0.47, -0.05);
    knee.add(shin, shoe, toe, soleM);
    hip.add(thigh, knee);
    root.add(hip);
    return { hip, knee };
  };
  const LL = leg(-1);
  const RL = leg(1);
  Object.assign(P, { legL: LL.hip, legR: RL.hip, kneeL: LL.knee, kneeR: RL.knee });

  // 옷 디테일
  const belt = mesh(new THREE.TorusGeometry(0.155, 0.014, 6, 24), solid('#2a2420', 0.6), 0, 0.98, 0);
  belt.rotation.x = Math.PI / 2;
  belt.scale.y = 0.68;
  root.add(belt);
  addTopDetails(root, spec, top);

  return { root, parts: P, materials: { skin, top, pants } };
}

function addFace(head, spec) {
  const white = solid('#f4f1ea', 0.3);
  const iris = solid(spec.eyes || '#3a2a1e', 0.2);
  const brow = solid(spec.hair || '#222', 0.9);
  for (const s of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.017, 10, 8), white, 0.037 * s, 0.105, -0.088);
    const pupil = mesh(new THREE.SphereGeometry(0.009, 8, 6), iris, 0.037 * s, 0.105, -0.102);
    const b = mesh(new THREE.BoxGeometry(0.035, 0.008, 0.01), brow, 0.038 * s, 0.13, -0.093);
    b.rotation.z = -0.12 * s;
    const ear = mesh(new THREE.SphereGeometry(0.028, 8, 6), head.children[0].material, 0.097 * s, 0.09, 0.005);
    ear.scale.set(0.45, 1, 0.75);
    head.add(eye, pupil, b, ear);
  }
  const nose = mesh(new THREE.ConeGeometry(0.016, 0.045, 8), head.children[0].material, 0, 0.078, -0.107);
  nose.rotation.x = -Math.PI / 2 + 0.35;
  const mouth = mesh(new THREE.BoxGeometry(0.04, 0.007, 0.01), solid('#8a4a42', 0.6), 0, 0.035, -0.098);
  head.add(nose, mouth);
}

function addHair(head, spec) {
  if (!spec.hairStyle || spec.hairStyle === 'none') return;
  const hm = solid(spec.hair, 0.85);
  // 머리 덮개를 뒤로 기울여 앞머리 선은 이마 위, 뒷머리는 목덜미까지 오게 한다
  const cap = (scale = 1.06, thetaLen = Math.PI / 2.1) => {
    const m = mesh(new THREE.SphereGeometry(0.108, 16, 12, 0, Math.PI * 2, 0, thetaLen), hm, 0, 0.11, 0.01);
    m.scale.set(0.95 * scale, 1.15 * scale, 1.05 * scale);
    m.rotation.x = -0.45;
    return m;
  };
  switch (spec.hairStyle) {
    case 'short':
      head.add(cap());
      break;
    case 'bob': {
      head.add(cap(1.1, Math.PI / 1.7));
      const back = mesh(new THREE.BoxGeometry(0.2, 0.13, 0.08), hm, 0, 0.06, 0.06);
      head.add(back);
      for (const s of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.03, 0.13, 0.1), hm, 0.095 * s, 0.07, 0.01)); // 옆머리
      break;
    }
    case 'ponytail': {
      head.add(cap(1.07));
      const tail = mesh(capsule(0.03, 0.14), hm, 0, 0.05, 0.12);
      tail.rotation.x = 0.4;
      head.add(tail);
      break;
    }
    case 'curly':
      head.add(cap(1.12, Math.PI / 1.9));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        head.add(mesh(new THREE.SphereGeometry(0.035, 6, 5), hm, Math.cos(a) * 0.085, 0.16 + Math.sin(i) * 0.02, Math.sin(a) * 0.085));
      }
      break;
    case 'cap': {
      head.add(cap(1.02, Math.PI / 2.4));
      const cm = cloth(spec.capColor || '#223');
      const c = mesh(new THREE.SphereGeometry(0.112, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), cm, 0, 0.12, 0.005);
      c.scale.set(0.97, 0.9, 1.05);
      const brim = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 16, 1, false, Math.PI / 2, Math.PI), cm, 0, 0.13, -0.09);
      brim.scale.z = 1.2;
      head.add(c, brim);
      break;
    }
    default:
      head.add(cap());
  }
}

function addTopDetails(root, spec, top) {
  const darker = new THREE.Color(spec.topColor).multiplyScalar(0.7);
  const trim = cloth(`#${darker.getHexString()}`);
  switch (spec.top) {
    case 'hoodie': {
      // 후드와 앞주머니, 끈
      const hood = mesh(new THREE.TorusGeometry(0.1, 0.04, 8, 16, Math.PI), trim, 0, 1.46, 0.06);
      hood.rotation.x = -0.3;
      const pocket = mesh(new THREE.BoxGeometry(0.2, 0.09, 0.02), trim, 0, 1.08, -0.104);
      root.add(hood, pocket);
      for (const s of [-1, 1]) root.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), solid('#eee'), 0.03 * s, 1.37, -0.115));
      break;
    }
    case 'jacket': {
      // 지퍼와 깃
      root.add(mesh(new THREE.BoxGeometry(0.012, 0.42, 0.01), solid('#bbb', 0.3, 0.6), 0, 1.2, -0.125));
      for (const s of [-1, 1]) {
        const collar = mesh(new THREE.BoxGeometry(0.09, 0.06, 0.02), trim, 0.06 * s, 1.44, -0.08);
        collar.rotation.z = 0.5 * s;
        root.add(collar);
      }
      break;
    }
    case 'shirt': {
      // 셔츠 깃과 단추
      for (const s of [-1, 1]) {
        const collar = mesh(new THREE.BoxGeometry(0.07, 0.04, 0.015), solid('#f4f4f4'), 0.045 * s, 1.45, -0.075);
        collar.rotation.z = 0.6 * s;
        root.add(collar);
      }
      for (let i = 0; i < 4; i++) root.add(mesh(new THREE.SphereGeometry(0.008, 6, 4), solid('#f4f4f4'), 0, 1.38 - i * 0.09, -0.128));
      break;
    }
    case 'tshirt':
    default: {
      const neck = mesh(new THREE.TorusGeometry(0.055, 0.01, 6, 16), trim, 0, 1.46, -0.01);
      neck.rotation.x = Math.PI / 2;
      root.add(neck);
    }
  }
}

// ───────────── 술래 눈빛 ─────────────

const eyeHalo = () =>
  canvasTexture(
    'eye-halo',
    32,
    32,
    (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    },
    { repeat: false },
  );

/**
 * 살짝 빛나는 눈: 빛나는 눈동자 + 작은 빛 번짐.
 * h.glow 목록에 넣어 두면 아바타가 켜고 끈다 (저격수는 조준하는 동안 끔).
 * points: 머리 기준 [x, y, z] 목록, size: 눈동자 반지름
 */
function addGlowEyes(h, points, color, size = 0.011) {
  h.glow = h.glow || [];
  const on = new THREE.Color(color);
  for (const [x, y, z] of points) {
    const pupil = mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color: on }), x, y, z);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: eyeHalo(), color: on, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    halo.material.userData.keepOpacity = true; // 반투명 처리(setGhost)에서 제외
    halo.position.set(x, y, z - 0.004);
    halo.scale.setScalar(size * 7);
    h.parts.head.add(pupil, halo);
    h.glow.push({ mesh: pupil, halo, on, off: new THREE.Color('#1a1a1a') });
  }
}

// 얼굴이 있는 직업의 눈 위치 (흰자 바로 앞)
const FACE_EYES = [
  [-0.037, 0.105, -0.104],
  [0.037, 0.105, -0.104],
];

// ───────────── 직업별 술래 의상 ─────────────

const HUNTER_SPECS = {
  maniac: { skin: '#a8322a', topColor: '#4a443c', pants: '#2a2622', shoes: '#1e1a16', hairStyle: 'none', top: 'tshirt', noFace: true },
  assassin: { skin: '#d9b38f', topColor: '#1c2230', pants: '#141822', shoes: '#111', hairStyle: 'none', top: 'jacket', eyes: '#111' },
  sniper: { skin: '#c99a73', topColor: '#3e4a33', pants: '#2c3326', shoes: '#2a2018', hairStyle: 'none', top: 'jacket' },
  captain: { skin: '#d7b089', topColor: '#1f2f5a', pants: '#2b2420', shoes: '#140f0b', hairStyle: 'short', hair: '#3a2a1e', top: 'jacket' },
  ghost: { skin: '#eef3f8', topColor: '#dfe6ee', pants: '#dfe6ee', shoes: '#dfe6ee', hairStyle: 'none', top: 'tshirt', noFace: true },
  skinwalker: { skin: '#d9a58e', topColor: '#c79a86', pants: '#7a4f3f', shoes: '#3a2418', hairStyle: 'none', top: 'tshirt', noFace: true },
  sprinter: { skin: '#e3b98f', topColor: '#c8282d', pants: '#1c1c22', shoes: '#f2f2f2', hairStyle: 'short', hair: '#1b1410', top: 'jacket' },
};

export function hunterSpec(cls) {
  return { sleeves: 'long', ...(HUNTER_SPECS[cls] || HUNTER_SPECS.maniac) };
}

/** 직업별 머리·몸 소품 */
export function dressHunter(cls, h) {
  const { head } = h.parts;
  const root = h.root;
  switch (cls) {
    case 'maniac': {
      // 도깨비 탈: 붉은 얼굴, 뿔, 송곳니, 노란 눈 / 찢어진 작업복과 피 얼룩
      const maskMat = solid('#b0261e', 0.5);
      const mask = mesh(new THREE.SphereGeometry(0.1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), maskMat, 0, 0.08, -0.03);
      mask.rotation.x = -Math.PI / 2;
      mask.scale.set(1, 1, 1.15);
      head.add(mask);
      for (const s of [-1, 1]) {
        const horn = mesh(new THREE.ConeGeometry(0.022, 0.12, 8), solid('#e8dcc0', 0.4), 0.055 * s, 0.22, -0.01);
        horn.rotation.z = -0.35 * s;
        const fang = mesh(new THREE.ConeGeometry(0.008, 0.03, 5), solid('#f4efe0', 0.3), 0.022 * s, 0.03, -0.108);
        fang.rotation.x = Math.PI;
        head.add(horn, fang);
      }
      addGlowEyes(h, [
        [-0.038, 0.11, -0.113],
        [0.038, 0.11, -0.113],
      ], '#ffd23a', 0.016);
      const brows = mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), solid('#2a0a08'), 0, 0.14, -0.11);
      const hair = mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), solid('#141010', 0.9), 0, 0.12, 0.02);
      head.add(brows, hair);
      for (let i = 0; i < 5; i++) {
        root.add(mesh(new THREE.SphereGeometry(0.02 + Math.random() * 0.03, 6, 4), solid('#5a0d0a', 0.4), (Math.random() - 0.5) * 0.25, 1.05 + Math.random() * 0.35, -0.12));
      }
      break;
    }
    case 'assassin': {
      const navy = cloth('#1c2230');
      const hood = mesh(new THREE.SphereGeometry(0.118, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.85), navy, 0, 0.1, 0.01);
      hood.scale.set(0.96, 1.12, 1.05);
      const maskM = mesh(new THREE.BoxGeometry(0.18, 0.08, 0.12), navy, 0, 0.05, -0.045);
      const band = mesh(new THREE.TorusGeometry(0.108, 0.012, 6, 20), cloth('#b3262b'), 0, 0.15, 0);
      band.rotation.x = Math.PI / 2;
      const tail = mesh(new THREE.BoxGeometry(0.03, 0.18, 0.01), cloth('#b3262b'), 0.03, 0.08, 0.12);
      tail.rotation.z = 0.3;
      head.add(hood, maskM, band, tail);
      addGlowEyes(h, FACE_EYES, '#ff4a4a');
      // 허리 띠와 쿠나이 주머니
      root.add(mesh(new THREE.BoxGeometry(0.09, 0.07, 0.04), cloth('#2a2f3c'), 0.12, 0.96, -0.1));
      break;
    }
    case 'sniper': {
      const olive = cloth('#2c3326');
      const capM = mesh(new THREE.SphereGeometry(0.114, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), olive, 0, 0.13, 0);
      const balaclava = mesh(new THREE.SphereGeometry(0.108, 14, 10), olive, 0, 0.07, 0.004);
      balaclava.scale.set(0.95, 0.9, 1.0);
      const goggles = mesh(new THREE.BoxGeometry(0.17, 0.035, 0.03), new THREE.MeshBasicMaterial({ color: '#ff3b2f' }), 0, 0.11, -0.1);
      head.add(capM, balaclava, goggles);
      addGlowEyes(h, [
        [-0.04, 0.11, -0.117],
        [0.04, 0.11, -0.117],
      ], '#ff3b2f', 0.012);
      h.glow.push({ mesh: goggles, on: new THREE.Color('#ff3b2f'), off: new THREE.Color('#2a1210') });
      // 전술 조끼와 탄약 주머니
      root.add(mesh(new THREE.BoxGeometry(0.34, 0.3, 0.06), cloth('#3a4430'), 0, 1.22, -0.1));
      for (const x of [-0.1, 0, 0.1]) root.add(mesh(new THREE.BoxGeometry(0.07, 0.08, 0.04), cloth('#2a3022'), x, 1.12, -0.14));
      break;
    }
    case 'captain': {
      const black = solid('#15151a', 0.8);
      const brim = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 3), black, 0, 0.21, 0);
      const crown = mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.1, 14), black, 0, 0.27, 0);
      const trimHat = mesh(new THREE.TorusGeometry(0.105, 0.007, 4, 18), solid('#c9a23a', 0.3, 0.8), 0, 0.225, 0);
      trimHat.rotation.x = Math.PI / 2;
      const beard = mesh(new THREE.SphereGeometry(0.08, 12, 8), solid('#3a2a1e', 0.95), 0, 0.02, -0.06);
      beard.scale.set(1, 1.2, 0.8);
      const patch = mesh(new THREE.BoxGeometry(0.04, 0.035, 0.01), solid('#111'), 0.037, 0.105, -0.107);
      const strap = mesh(new THREE.TorusGeometry(0.1, 0.004, 4, 20), solid('#111'), 0, 0.12, 0);
      strap.rotation.set(Math.PI / 2, 0.4, 0);
      head.add(brim, crown, trimHat, beard, patch, strap);
      addGlowEyes(h, [FACE_EYES[0]], '#ffb347'); // 안대 없는 왼쪽 눈만
      // 코트 자락, 금 단추, 견장
      const gold = solid('#c9a23a', 0.3, 0.8);
      for (let i = 0; i < 5; i++) for (const s of [-1, 1]) root.add(mesh(new THREE.SphereGeometry(0.01, 6, 4), gold, 0.05 * s, 1.38 - i * 0.08, -0.13));
      for (const s of [-1, 1]) {
        root.add(mesh(new THREE.BoxGeometry(0.1, 0.02, 0.09), gold, 0.2 * s, 1.47, 0));
        const tail = mesh(new THREE.BoxGeometry(0.13, 0.42, 0.03), cloth('#1f2f5a'), 0.08 * s, 0.82, 0.1);
        tail.rotation.x = -0.12;
        root.add(tail);
      }
      break;
    }
    case 'ghost': {
      // 텅 빈 검은 눈구멍과 벌린 입, 너덜너덜한 천 자락
      const hole = solid('#05070c', 1);
      for (const s of [-1, 1]) {
        const e = mesh(new THREE.SphereGeometry(0.028, 10, 8), hole, 0.04 * s, 0.11, -0.092);
        addGlowEyes(h, [[0.04 * s, 0.11, -0.112]], '#a8e4ff', 0.01); // 눈구멍 속 창백한 빛
        e.scale.set(1, 1.5, 0.6);
        head.add(e);
      }
      const mouth = mesh(new THREE.SphereGeometry(0.03, 10, 8), hole, 0, 0.03, -0.094);
      mouth.scale.set(0.8, 1.7, 0.5);
      head.add(mouth);
      const profile = [];
      for (let i = 0; i <= 10; i++) profile.push(new THREE.Vector2(0.12 + i * 0.022, 1.45 - i * 0.11));
      const sheetGeo = new THREE.LatheGeometry(profile, 24);
      // 아랫단을 들쭉날쭉하게
      const pos = sheetGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < 0.5) pos.setY(i, pos.getY(i) + Math.sin(i * 1.7) * 0.06);
      }
      sheetGeo.computeVertexNormals();
      root.add(mesh(sheetGeo, new THREE.MeshStandardMaterial({ color: '#dfe6ee', roughness: 0.9, side: THREE.DoubleSide }), 0, 0, 0));
      h.parts.legL.visible = false;
      h.parts.legR.visible = false;
      break;
    }
    case 'skinwalker': {
      // 꿰맨 가죽 얼굴, 짝짝이 눈, 찢어진 입 / 몸 곳곳의 다른 색 가죽 조각과 바늘땀
      const stitch = solid('#3a1a14', 0.9);
      for (const [x, y, rz, len] of [
        [-0.03, 0.14, 0.3, 0.1],
        [0.04, 0.06, -0.5, 0.12],
        [0, 0.17, 1.4, 0.08],
        [-0.05, 0.02, 0.9, 0.06],
      ]) {
        const st = mesh(new THREE.BoxGeometry(len, 0.006, 0.006), stitch, x, y, -0.104);
        st.rotation.z = rz;
        head.add(st);
      }
      head.add(mesh(new THREE.SphereGeometry(0.026, 10, 8), solid('#f2efe4', 0.2), 0.038, 0.105, -0.092));
      head.add(mesh(new THREE.SphereGeometry(0.008, 6, 4), solid('#111'), 0.038, 0.105, -0.117));
      head.add(mesh(new THREE.SphereGeometry(0.013, 8, 6), solid('#111'), -0.036, 0.1, -0.1));
      addGlowEyes(h, [
        [0.038, 0.105, -0.118],
        [-0.036, 0.1, -0.112],
      ], '#9dff6a', 0.009); // 짝짝이 눈에 병든 초록빛
      const mouth = mesh(new THREE.BoxGeometry(0.08, 0.01, 0.01), solid('#4a0e0a'), 0.01, 0.035, -0.1);
      mouth.rotation.z = 0.15;
      head.add(mouth);
      const hair = mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 1.3, 0, Math.PI / 2.4), solid('#3a2a20', 0.95), 0, 0.12, 0);
      head.add(hair);
      const patchColors = ['#b98670', '#e0b39c', '#a06a55', '#d1957c'];
      for (let i = 0; i < 7; i++) {
        const p = mesh(new THREE.BoxGeometry(0.08 + Math.random() * 0.06, 0.07 + Math.random() * 0.05, 0.01), solid(patchColors[i % 4], 0.7), (Math.random() - 0.5) * 0.24, 1.0 + Math.random() * 0.4, -0.128);
        root.add(p);
      }
      break;
    }
    case 'sprinter': {
      const band = mesh(new THREE.TorusGeometry(0.106, 0.012, 6, 20), cloth('#f2f2f2'), 0, 0.15, 0);
      band.rotation.x = Math.PI / 2;
      head.add(band);
      addGlowEyes(h, FACE_EYES, '#ff9a3c');
      // 운동복 흰 줄
      for (const s of [-1, 1]) {
        root.add(mesh(new THREE.BoxGeometry(0.012, 0.45, 0.012), cloth('#f2f2f2'), 0.19 * s, 1.2, 0));
        const legStripe = mesh(new THREE.BoxGeometry(0.012, 0.7, 0.012), cloth('#f2f2f2'), 0.073 * s * 1.0, -0.35, 0);
        (s < 0 ? h.parts.legL : h.parts.legR).add(legStripe);
      }
      root.add(mesh(new THREE.BoxGeometry(0.05, 0.06, 0.01), cloth('#f2f2f2'), 0.08, 1.33, -0.13)); // 등번호 대신 가슴 로고
      break;
    }
    default:
      break;
  }
}
