// 서버가 보낸 맵 데이터(boxes/decor/roads)로 일본 시골 마을을 렌더링한다.
// 같은 재질은 하나의 지오메트리로 합쳐 모바일에서도 가볍게 그린다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';

const tmpColor = new THREE.Color();

function paint(geo, color) {
  tmpColor.set(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = tmpColor.r;
    arr[i * 3 + 1] = tmpColor.g;
    arr[i * 3 + 2] = tmpColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** 텍스처가 실제 크기(m)에 맞게 반복되는 박스. su/sv = 텍스처 1장이 덮는 m */
function texturedBox(w, h, d, su, sv) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const spans = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * spans[f][0]) / su, (uv.getY(i) * spans[f][1]) / sv);
    }
  }
  return g;
}

function place(geo, x, y, z, rotY = 0) {
  if (rotY) geo.rotateY(rotY);
  geo.translate(x, y, z);
  return geo;
}

/** 박공지붕 (용마루가 x축 방향). w: x폭, d: z폭, rh: 높이 */
function gableRoof(w, d, rh) {
  const hw = w / 2;
  const hd = d / 2;
  const p = [];
  const uv = [];
  const quad = (a, b, c, e, uScale, vScale) => {
    p.push(...a, ...b, ...c, ...a, ...c, ...e);
    uv.push(0, 0, uScale, 0, uScale, vScale, 0, 0, uScale, vScale, 0, vScale);
  };
  const slope = Math.hypot(hd, rh);
  // 앞 경사면 (+z), 뒤 경사면 (-z)
  quad([-hw, 0, hd], [hw, 0, hd], [hw, rh, 0], [-hw, rh, 0], w / 2, slope / 2);
  quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, rh, 0], [hw, rh, 0], w / 2, slope / 2);
  // 아래면
  quad([-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], 0.1, 0.1);
  // 박공 삼각형
  p.push(-hw, 0, -hd, -hw, 0, hd, -hw, rh, 0);
  p.push(hw, 0, hd, hw, 0, -hd, hw, rh, 0);
  uv.push(0, 0, 0.1, 0, 0.05, 0.1, 0, 0, 0.1, 0, 0.05, 0.1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function groundPlane(w, d, s) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / s, (uv.getY(i) * d) / s);
  return g;
}

class Batch {
  constructor() {
    this.list = [];
  }
  add(geo, color = '#ffffff') {
    if (!geo.attributes.color) paint(geo, color);
    if (geo.index) geo = geo.toNonIndexed();
    this.list.push(geo);
  }
  mesh(material) {
    if (!this.list.length) return null;
    const merged = mergeGeometries(this.list, false);
    this.list.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, material);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

const lambert = (opts) => new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });

export function buildWorld(scene, map) {
  const group = new THREE.Group();
  const size = map.size;

  const B = {
    grass: new Batch(),
    road: new Batch(),
    ground: { dirt: new Batch(), gravel: new Batch(), paddy: new Batch() },
    block: new Batch(),
    stone: new Batch(),
    house: new Batch(),
    roof: new Batch(),
    wood: new Batch(),
    plain: new Batch(),
    foliage: new Batch(),
    glow: new Batch(),
    vending: new Batch(),
  };

  // 바닥
  B.grass.add(groundPlane(size + 80, size + 80, 6), '#ffffff');
  for (const r of map.roads) B.road.add(place(groundPlane(r.w, r.d, 6), r.x, 0.02, r.z));
  for (const d of map.decor) {
    if (d.kind === 'paddy') {
      B.ground.paddy.add(place(groundPlane(d.w, d.d, 3), d.x, 0.03, d.z));
      // 논두렁
      B.ground.dirt.add(place(groundPlane(d.w + 0.6, d.d + 0.6, 3), d.x, 0.025, d.z));
    } else if (d.kind === 'dirt') {
      B.ground.dirt.add(place(groundPlane(d.w, d.d, 5), d.x, 0.025, d.z));
    } else if (d.kind === 'gravel') {
      B.ground.gravel.add(place(groundPlane(d.w, d.d, 4), d.x, 0.025, d.z));
    } else if (d.kind === 'canopy') {
      const geo = new THREE.IcosahedronGeometry(d.r, 1);
      geo.scale(1, 0.8, 1);
      const shade = 0.75 + Math.random() * 0.35;
      tmpColor.setRGB(0.24 * shade, 0.36 * shade, 0.18 * shade);
      B.foliage.add(place(geo, d.x, d.y, d.z), tmpColor.getHex());
      if (d.fruit) {
        // 감나무 열매
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2;
          const y = d.y + (Math.random() - 0.4) * d.r;
          const rr = d.r * 0.9;
          B.plain.add(
            place(new THREE.SphereGeometry(0.12, 6, 4), d.x + Math.cos(a) * rr, y, d.z + Math.sin(a) * rr),
            '#e8742a',
          );
        }
      }
    }
  }

  for (const b of map.boxes) {
    switch (b.kind) {
      case 'wall':
        B.block.add(place(texturedBox(b.w, b.h, b.d, 0.8, 0.4), b.x, b.h / 2, b.z), '#ffffff');
        // 위쪽 마감돌
        B.plain.add(place(new THREE.BoxGeometry(b.w + 0.04, 0.08, b.d + 0.04), b.x, b.h + 0.04, b.z), '#7d7a73');
        break;
      case 'boundary':
        B.block.add(place(texturedBox(b.w, b.h, b.d, 0.8, 0.4), b.x, b.h / 2, b.z), '#8a857c');
        break;
      case 'stonewall':
        B.stone.add(place(texturedBox(b.w, b.h, b.d, 1.6, 1.6), b.x, b.h / 2, b.z));
        break;
      case 'house':
        buildHouse(B, b);
        break;
      case 'trunk': {
        const r = b.w / 2;
        B.wood.add(place(new THREE.CylinderGeometry(r * 0.8, r, b.h + 1, 7), b.x, (b.h + 1) / 2, b.z), '#7a5a40');
        break;
      }
      case 'pole':
        B.plain.add(place(new THREE.CylinderGeometry(0.12, 0.16, b.h, 7), b.x, b.h / 2, b.z), '#8e8b84');
        B.wood.add(place(new THREE.BoxGeometry(1.4, 0.1, 0.1), b.x, b.h - 0.6, b.z), '#5a4a3a');
        if (Math.random() < 0.3) B.plain.add(place(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 8), b.x + 0.3, b.h - 1.6, b.z), '#6c6f72');
        break;
      case 'vending':
        buildVending(B, b);
        break;
      case 'truck':
        buildTruck(B, b);
        break;
      case 'hut':
      case 'shed':
        B.wood.add(place(texturedBox(b.w, b.h, b.d, 1.5, 1.5), b.x, b.h / 2, b.z), '#b89a7a');
        B.plain.add(place(new THREE.BoxGeometry(b.w + 0.4, 0.08, b.d + 0.4), b.x, b.h + 0.04, b.z), '#5d6a73');
        break;
      case 'shrine':
        B.wood.add(place(texturedBox(b.w, b.h * 0.6, b.d, 1.5, 1.5), b.x, (b.h * 0.6) / 2 + 0.5, b.z), '#b0563a');
        B.plain.add(place(new THREE.BoxGeometry(b.w + 0.6, 0.5, b.d + 0.6), b.x, 0.25, b.z), '#8b877c');
        B.roof.add(place(gableRoof(b.w + 1.6, b.d + 1.8, 2.2), b.x, b.h * 0.6 + 0.5, b.z), '#3b3f45');
        break;
      case 'lantern':
        B.plain.add(place(new THREE.BoxGeometry(0.5, 0.9, 0.5), b.x, 0.45, b.z), '#8f8b82');
        B.glow.add(place(new THREE.BoxGeometry(0.42, 0.35, 0.42), b.x, 1.07, b.z), '#ffcf7a');
        B.plain.add(place(new THREE.ConeGeometry(0.55, 0.4, 4), b.x, 1.45, b.z, Math.PI / 4), '#8f8b82');
        break;
      case 'scarecrow':
        B.wood.add(place(new THREE.BoxGeometry(0.1, b.h, 0.1), b.x, b.h / 2, b.z), '#7a5a40');
        B.wood.add(place(new THREE.BoxGeometry(1.2, 0.08, 0.08), b.x, b.h * 0.75, b.z), '#7a5a40');
        B.plain.add(place(new THREE.BoxGeometry(0.5, 0.6, 0.25), b.x, b.h * 0.65, b.z), '#5a6b8a');
        B.plain.add(place(new THREE.SphereGeometry(0.17, 8, 6), b.x, b.h + 0.05, b.z), '#d9c9a0');
        B.plain.add(place(new THREE.ConeGeometry(0.42, 0.22, 10), b.x, b.h + 0.25, b.z), '#c9a85a');
        break;
      default:
        B.plain.add(place(new THREE.BoxGeometry(b.w, b.h, b.d), b.x, b.h / 2, b.z), '#888888');
    }
  }

  // 먼 산 실루엣
  const mountains = buildMountains(size);

  const meshes = [
    B.grass.mesh(lambert({ map: T.grass() })),
    B.road.mesh(lambert({ map: T.asphalt() })),
    B.ground.dirt.mesh(lambert({ map: T.dirt() })),
    B.ground.gravel.mesh(lambert({ map: T.gravel() })),
    B.ground.paddy.mesh(new THREE.MeshPhongMaterial({ vertexColors: true, map: T.paddy(), shininess: 80, specular: 0x556677 })),
    B.block.mesh(lambert({ map: T.blockWall() })),
    B.stone.mesh(lambert({ map: T.stoneWall() })),
    B.house.mesh(lambert({ map: T.houseWall() })),
    B.roof.mesh(lambert({ map: T.roofTiles() })),
    B.wood.mesh(lambert({ map: T.wood() })),
    B.plain.mesh(lambert({})),
    B.foliage.mesh(lambert({ flatShading: true })),
    B.glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })),
    B.vending.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, map: T.vendingFront() })),
    mountains,
  ];
  for (const m of meshes) if (m) group.add(m);
  scene.add(group);
  return group;
}

function buildHouse(B, b) {
  const storeys = b.storeys || 1;
  // 벽 (텍스처 세로 1장 = 1층)
  B.house.add(place(texturedBox(b.w, b.h, b.d, 3, b.h / storeys), b.x, b.h / 2, b.z), b.wallColor);
  // 기초
  B.plain.add(place(new THREE.BoxGeometry(b.w + 0.1, 0.35, b.d + 0.1), b.x, 0.17, b.z), '#7c7870');
  // 2층집은 1층 위에 차양
  if (storeys === 2) {
    B.roof.add(place(new THREE.BoxGeometry(b.w + 1.0, 0.12, b.d + 1.0), b.x, 2.85, b.z), b.roofColor);
  }
  const ridgeX = b.ridgeX;
  const span = ridgeX ? b.d : b.w;
  const len = ridgeX ? b.w : b.d;
  const roof = gableRoof(len + 1.0, span + 1.2, Math.min(2.6, span * 0.38));
  if (!ridgeX) roof.rotateY(Math.PI / 2);
  B.roof.add(place(roof, b.x, b.h, b.z), b.roofColor);
  // 용마루
  const ridge = new THREE.BoxGeometry(ridgeX ? len + 1.1 : 0.25, 0.22, ridgeX ? 0.25 : len + 1.1);
  B.plain.add(place(ridge, b.x, b.h + Math.min(2.6, span * 0.38) + 0.05, b.z), '#2a2d33');
}

function buildVending(B, b) {
  const colors = ['#c8352f', '#f4f4f4', '#2d5fb8', '#1f8a4c'];
  B.plain.add(place(new THREE.BoxGeometry(b.w, b.h, b.d), b.x, b.h / 2, b.z), colors[Math.floor(Math.random() * colors.length)]);
  const front = new THREE.PlaneGeometry(Math.min(b.w, b.d) * 0.86, b.h * 0.86);
  let rot = 0;
  let ox = 0;
  let oz = 0;
  if (b.face === 'x+') {
    rot = Math.PI / 2;
    ox = b.w / 2 + 0.005;
  } else if (b.face === 'x-') {
    rot = -Math.PI / 2;
    ox = -b.w / 2 - 0.005;
  } else if (b.face === 'z+') {
    oz = b.d / 2 + 0.005;
  } else {
    rot = Math.PI;
    oz = -b.d / 2 - 0.005;
  }
  // face 방향(도로 쪽)을 바라보는 앞면
  B.vending.add(place(front, b.x + ox, b.h / 2, b.z + oz, rot), '#ffffff');
}

function buildTruck(B, b) {
  const alongX = b.w > b.d;
  const L = alongX ? b.w : b.d;
  const W = alongX ? b.d : b.w;
  const parts = [];
  // 차체 (x축 기준으로 만든 뒤 회전)
  parts.push([new THREE.BoxGeometry(L, 0.5, W), 0, 0.55, 0, '#f2f2ee']);
  parts.push([new THREE.BoxGeometry(L * 0.33, 0.95, W), L * 0.33, 1.25, 0, '#f2f2ee']);
  parts.push([new THREE.BoxGeometry(0.02, 0.5, W * 0.85), L * 0.5, 1.35, 0, '#2a3440']);
  parts.push([new THREE.BoxGeometry(L * 0.62, 0.4, 0.06), -L * 0.17, 1.0, W / 2 - 0.03, '#d8d8d2']);
  parts.push([new THREE.BoxGeometry(L * 0.62, 0.4, 0.06), -L * 0.17, 1.0, -W / 2 + 0.03, '#d8d8d2']);
  for (const wx of [-L * 0.3, L * 0.3]) {
    for (const wz of [-W / 2, W / 2]) {
      const wheel = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 10);
      wheel.rotateX(Math.PI / 2);
      parts.push([wheel, wx, 0.28, wz, '#1d1d1d']);
    }
  }
  for (const [geo, x, y, z, c] of parts) {
    geo.translate(x, y, z);
    if (!alongX) geo.rotateY(Math.PI / 2);
    geo.translate(b.x, 0, b.z);
    B.plain.add(geo, c);
  }
}

function buildMountains(size) {
  const pos = [];
  const col = [];
  const R = size * 0.9;
  const segs = 48;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const h0 = 14 + Math.sin(i * 1.7) * 6 + Math.sin(i * 0.5) * 8;
    const h1 = 14 + Math.sin((i + 1) * 1.7) * 6 + Math.sin((i + 1) * 0.5) * 8;
    const p = (a, h) => [Math.cos(a) * R, h, Math.sin(a) * R];
    const v = [p(a0, -2), p(a1, -2), p(a1, h1), p(a0, h0)];
    pos.push(...v[0], ...v[1], ...v[2], ...v[0], ...v[2], ...v[3]);
    for (let k = 0; k < 6; k++) col.push(0.13, 0.13, 0.19);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  return m;
}

/** 해질녘 하늘 */
export function buildSky(scene) {
  const geo = new THREE.SphereGeometry(190, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vPos;
      void main(){
        float h = normalize(vPos).y;
        vec3 horizon = vec3(0.86, 0.52, 0.36);
        vec3 mid = vec3(0.42, 0.33, 0.48);
        vec3 top = vec3(0.10, 0.11, 0.22);
        vec3 c = h < 0.0 ? horizon * 0.6 : (h < 0.25 ? mix(horizon, mid, h / 0.25) : mix(mid, top, clamp((h - 0.25) / 0.6, 0.0, 1.0)));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}
