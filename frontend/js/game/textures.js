// 캔버스로 직접 그리는 텍스처 (외부 이미지 파일 없이)
import * as THREE from 'three';

const cache = new Map();

export function canvasTexture(key, w, h, draw, { repeat = true, srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/**
 * 굴곡이 있는 질감: 색 질감과 같은 배치로 높이 지도를 함께 그리고, 높이에서 노멀 맵을 만든다.
 * draw(g, w, h, hg): g = 색 캔버스, hg = 높이 캔버스 (밝을수록 튀어나옴, 처음엔 중간 회색 128)
 * 반환한 색 질감의 userData에 normalMap(노멀 맵)·heightMap(높이 지도)이 붙는다.
 * 노멀 맵은 탄젠트 없이 화면 미분으로 쓰이므로 정점 데이터가 늘지 않는다 (보통·고품질 공통).
 * strength: 굴곡 세기 (클수록 깊어 보임)
 */
export function reliefTexture(key, w, h, draw, { strength = 2, srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const hc = document.createElement('canvas');
  hc.width = w;
  hc.height = h;
  const hg = hc.getContext('2d', { willReadFrequently: true });
  hg.fillStyle = 'rgb(128,128,128)';
  hg.fillRect(0, 0, w, h);
  draw(g, w, h, hg);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const data = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t; // 색이 아닌 데이터라 색 공간 변환 없이
  };
  tex.userData.heightMap = data(hc);
  tex.userData.normalMap = data(normalFromHeight(hc, strength));
  cache.set(key, tex);
  return tex;
}

/** 높이 캔버스 → 탄젠트 공간 노멀 맵 캔버스 (소벨 필터, 가장자리는 반대편과 이어서 타일 경계가 안 보이게) */
function normalFromHeight(hc, strength) {
  const w = hc.width;
  const h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = src[i * 4] / 255;
  const at = (x, y) => H[((y + h) % h) * w + ((x + w) % w)];
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const og = out.getContext('2d');
  const img = og.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      // 캔버스 y는 아래로, 질감 v는 위로 증가 (CanvasTexture가 뒤집어 올림)
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

/** 높이 캔버스에 잔 굴곡 (밝은 점 = 볼록, 어두운 점 = 오목) */
export function hNoise(hg, w, h, amount, n = 1500, size = 2) {
  for (let i = 0; i < n; i++) {
    const v = 128 + (Math.random() - 0.5) * 2 * amount;
    hg.fillStyle = `rgba(${v},${v},${v},0.5)`;
    hg.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * size, 1 + Math.random() * size);
  }
}

/**
 * 높이 캔버스에 둥근 혹 (가운데가 가장 높고 가장자리로 갈수록 낮아짐).
 * wrap: 가장자리를 넘으면 반대편에도 그린다 (색 질감도 이어 그릴 때만)
 */
export function hBump(hg, w, h, x, y, rx, ry, top, edge = 128, rot = 0, wrap = false) {
  const offs = wrap ? [-1, 0, 1] : [0];
  for (const ox of offs.map((k) => k * w)) {
    for (const oy of offs.map((k) => k * h)) {
      const cx = x + ox;
      const cy = y + oy;
      if (cx + rx < 0 || cx - rx > w || cy + rx < 0 || cy - rx > h) continue;
      hg.save();
      hg.translate(cx, cy);
      hg.rotate(rot);
      hg.scale(1, ry / rx);
      const grd = hg.createRadialGradient(0, 0, 0, 0, 0, rx);
      grd.addColorStop(0, `rgb(${top},${top},${top})`);
      grd.addColorStop(0.7, `rgb(${(top * 2 + edge) / 3},${(top * 2 + edge) / 3},${(top * 2 + edge) / 3})`);
      grd.addColorStop(1, `rgb(${edge},${edge},${edge})`);
      hg.fillStyle = grd;
      hg.beginPath();
      hg.arc(0, 0, rx, 0, Math.PI * 2);
      hg.fill();
      hg.restore();
    }
  }
}

/** 높이 캔버스를 픽셀마다 계산해 채운다: fn(x, y) → 0(깊음)~255(높음). 규칙적인 무늬(줄눈·기와 골·주름)에 쓴다 */
export function hFill(hg, w, h, fn) {
  const img = hg.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, fn(x, y)));
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  hg.putImageData(img, 0, 0);
}

/** 높이 캔버스의 직사각형 영역만 픽셀마다 계산해 채운다 */
export function hFillRect(hg, x0, y0, rw, rh, fn) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  rw = Math.round(rw);
  rh = Math.round(rh);
  const img = hg.createImageData(rw, rh);
  const d = img.data;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const v = Math.max(0, Math.min(255, fn(x0 + x, y0 + y)));
      const i = (y * rw + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  hg.putImageData(img, x0, y0);
}

/** 높이 캔버스에 선 (홈은 낮은 값, 이음매는 높은 값). bevel: 바깥쪽으로 완만하게 깎인 폭 */
export function hLine(hg, pts, v, width, bevel = 0, bevelV = 128) {
  const stroke = (lw, val) => {
    hg.strokeStyle = `rgb(${val},${val},${val})`;
    hg.lineWidth = lw;
    hg.beginPath();
    hg.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) hg.lineTo(pts[k][0], pts[k][1]);
    hg.stroke();
  };
  if (bevel > 0) stroke(width + bevel * 2, bevelV);
  stroke(width, v);
}

export function noise(g, w, h, alpha, n = 1800, light = false) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** 콘크리트 블록 담장: 텍스처 1장 = 가로 2블록(0.8m) × 세로 2단(0.4m) */
// 굴곡(노멀 맵): 블록 면은 거칠고 평평, 줄눈은 오목한 홈, 블록 모서리는 살짝 깎임
export const blockWall = () =>
  reliefTexture('block', 256, 128, (g, w, h, hg) => {
    g.fillStyle = '#9d9a92';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.18, 2500);
    noise(g, w, h, 0.12, 1200, true);
    hg.fillStyle = 'rgb(176,176,176)';
    hg.fillRect(0, 0, w, h);
    hNoise(hg, w, h, 45, 3500, 2);
    g.strokeStyle = 'rgba(60,58,52,0.55)';
    g.lineWidth = 3;
    for (let row = 0; row < 2; row++) {
      const y = row * (h / 2);
      g.beginPath();
      g.moveTo(0, y + 1);
      g.lineTo(w, y + 1);
      g.stroke();
      // 위쪽 줄눈은 아래 가장자리와 이어지도록 한 번 더
      for (const yy of row ? [y + 1] : [y + 1, h + 1]) hLine(hg, [[0, yy], [w, yy]], 50, 3, 2, 120);
      const off = row % 2 ? w / 4 : 0;
      for (let k = 0; k < 3; k++) {
        const x = (off + (k * w) / 2) % w;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + h / 2);
        g.stroke();
        for (const xx of x === 0 ? [0, w] : [x]) hLine(hg, [[xx, y], [xx, y + h / 2]], 50, 3, 2, 120);
      }
    }
    // 물때 얼룩
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * w;
      const grd = g.createLinearGradient(0, h * 0.4, 0, h);
      grd.addColorStop(0, 'rgba(40,45,35,0)');
      grd.addColorStop(1, 'rgba(40,45,35,0.25)');
      g.fillStyle = grd;
      g.fillRect(x, h * 0.4, 10 + Math.random() * 30, h * 0.6);
    }
  }, { strength: 2.5 });

// 굴곡: 둥글게 튀어나온 돌, 깊이 들어간 줄눈 (고품질에서는 시차 매핑으로 돌이 실제로 튀어나와 보임)
export const stoneWall = () =>
  reliefTexture('stone', 256, 256, (g, w, h, hg) => {
    g.fillStyle = '#6f6c64';
    g.fillRect(0, 0, w, h);
    hg.fillStyle = 'rgb(55,55,55)';
    hg.fillRect(0, 0, w, h);
    hNoise(hg, w, h, 30, 1500, 2);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 18 + Math.random() * 26;
      const v = 95 + Math.floor(Math.random() * 50);
      const rot = Math.random() * 3;
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.7, rot, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(30,30,25,0.6)';
      g.lineWidth = 3;
      g.stroke();
      // 돌마다 높이가 조금씩 다르게 튀어나옴
      hBump(hg, w, h, x, y, r, r * 0.7, 205 + Math.random() * 45, 120, rot);
      hg.strokeStyle = 'rgb(55,55,55)';
      hg.lineWidth = 3;
      hg.beginPath();
      hg.ellipse(x, y, r, r * 0.7, rot, 0, Math.PI * 2);
      hg.stroke();
    }
    noise(g, w, h, 0.2, 2000);
    hNoise(hg, w, h, 35, 2500, 2);
  }, { strength: 3 });

/**
 * 집 외벽: 목재 판자 하단 + 회벽 상단 + 창문 (1장 = 3m × 3m).
 * 굴곡: 회벽은 잔 요철, 판자는 겹친 홈, 기둥·창틀·창살은 튀어나오고 창유리는 매끈하게 들어가 있다
 * (유리에는 아주 옅은 물결: 옛 유리처럼 비친 모습이 살짝 일렁임)
 */
export const houseWall = () =>
  reliefTexture('house', 256, 256, (g, w, h, hg) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.08, 1500);
    hg.fillStyle = 'rgb(150,150,150)';
    hg.fillRect(0, 0, w, h);
    hNoise(hg, w, h * 0.55, 30, 2500, 2); // 회벽
    // 아래쪽 판자
    g.fillStyle = '#b9a58a';
    g.fillRect(0, h * 0.55, w, h * 0.45);
    hg.fillStyle = 'rgb(140,140,140)';
    hg.fillRect(0, h * 0.55, w, h * 0.45);
    g.strokeStyle = 'rgba(70,50,30,0.5)';
    g.lineWidth = 2;
    for (let y = h * 0.55; y < h; y += 10) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      // 판자가 아래로 겹쳐 내려가는 턱: 홈 바로 아래는 낮고 위로 갈수록 두꺼워짐
      const grd = hg.createLinearGradient(0, y, 0, y + 10);
      grd.addColorStop(0, 'rgb(105,105,105)');
      grd.addColorStop(1, 'rgb(165,165,165)');
      hg.fillStyle = grd;
      hg.fillRect(0, y, w, 10);
      hLine(hg, [[0, y], [w, y]], 70, 2);
    }
    hNoise(hg, w, h, 18, 800, 3);
    // 기둥
    g.fillStyle = '#5b4330';
    g.fillRect(0, 0, 10, h);
    hg.fillStyle = 'rgb(215,215,215)';
    hg.fillRect(1, 0, 8, h);
    // 창문 (격자 창)
    const wx = w * 0.32;
    const wy = h * 0.2;
    const ww = w * 0.42;
    const wh = h * 0.42;
    g.fillStyle = '#2a2f36';
    g.fillRect(wx, wy, ww, wh);
    g.fillStyle = 'rgba(255,214,140,0.55)';
    g.fillRect(wx + 4, wy + 4, ww - 8, wh - 8);
    // 유리: 벽보다 안쪽, 거의 평평 (아주 옅은 물결)
    hFillRect(hg, wx + 4, wy + 4, ww - 8, wh - 8, (x, y) => 110 + 2.5 * Math.sin(x * 0.21 + Math.sin(y * 0.13) * 2) + 2 * Math.sin(y * 0.17));
    g.strokeStyle = '#4a3626';
    g.lineWidth = 5;
    g.strokeRect(wx, wy, ww, wh);
    hg.strokeStyle = 'rgb(215,215,215)';
    hg.lineWidth = 5;
    hg.strokeRect(wx, wy, ww, wh);
    g.lineWidth = 3;
    hg.lineWidth = 3;
    hg.strokeStyle = 'rgb(195,195,195)';
    for (let k = 1; k < 3; k++) {
      for (const c of [g, hg]) {
        c.beginPath();
        c.moveTo(wx + (ww * k) / 3, wy);
        c.lineTo(wx + (ww * k) / 3, wy + wh);
        c.stroke();
      }
    }
    for (const c of [g, hg]) {
      c.beginPath();
      c.moveTo(wx, wy + wh / 2);
      c.lineTo(wx + ww, wy + wh / 2);
      c.stroke();
    }
  }, { strength: 2.5 });

/** 집 외벽(houseWall)에서 창유리 자리만 흰색인 마스크: 고품질 화질에서 유리만 또렷하게 비치게 */
export const houseWallGlass = () =>
  canvasTexture(
    'house-glass',
    256,
    256,
    (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      const wx = w * 0.32;
      const wy = h * 0.2;
      const ww = w * 0.42;
      const wh = h * 0.42;
      g.fillStyle = '#fff';
      g.fillRect(wx + 4, wy + 4, ww - 8, wh - 8);
      // 창살은 나무라서 비치지 않게
      g.strokeStyle = '#000';
      g.lineWidth = 5;
      g.strokeRect(wx, wy, ww, wh);
      g.lineWidth = 3;
      for (let k = 1; k < 3; k++) {
        g.beginPath();
        g.moveTo(wx + (ww * k) / 3, wy);
        g.lineTo(wx + (ww * k) / 3, wy + wh);
        g.stroke();
      }
      g.beginPath();
      g.moveTo(wx, wy + wh / 2);
      g.lineTo(wx + ww, wy + wh / 2);
      g.stroke();
    },
    { srgb: false },
  );

/** 기와 지붕 */
// 굴곡: 둥글게 솟은 기와 골(가로), 위 줄 기와 밑으로 들어가는 턱(세로). 고품질에서는 시차 매핑
export const roofTiles = () =>
  reliefTexture('roof', 128, 128, (g, w, h, hg) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const grd = g.createLinearGradient(x, 0, x + 16, 0);
      grd.addColorStop(0, '#9a9a9a');
      grd.addColorStop(0.5, '#ffffff');
      grd.addColorStop(1, '#8a8a8a');
      g.fillStyle = grd;
      g.fillRect(x, 0, 16, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < h; y += 21) g.fillRect(0, y, w, 3);
    hFill(hg, w, h, (x, y) => {
      const hump = Math.sin(((x % 16) / 16) * Math.PI); // 기와 한 장의 둥근 단면
      const k = y % 21;
      const ramp = k / 21; // 아래 가장자리로 갈수록 두꺼움 (아래 줄을 덮음)
      return 55 + hump * 125 + ramp * 55 - (k < 3 ? 35 : 0);
    });
  }, { strength: 2.5 });

// 굴곡: 판자 사이 홈(모서리 깎임), 판자 면의 나뭇결
export const wood = () =>
  reliefTexture('wood', 128, 128, (g, w, h, hg) => {
    g.fillStyle = '#6b4a2f';
    g.fillRect(0, 0, w, h);
    hFill(hg, w, h, (x) => {
      const k = x % 16;
      return k < 2 ? 70 : k === 2 || k === 15 ? 125 : 150;
    });
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.2})`;
      g.fillRect(x, 0, 2, h);
      for (let i = 0; i < 6; i++) {
        const gx = x + 3 + Math.random() * 10;
        g.fillStyle = `rgba(255,220,180,${Math.random() * 0.08})`;
        g.fillRect(gx, 0, 1, h);
        hg.fillStyle = 'rgba(178,178,178,0.6)'; // 나뭇결
        hg.fillRect(gx, 0, 1, h);
      }
    }
    noise(g, w, h, 0.15, 600);
    hNoise(hg, w, h, 25, 600, 2);
  }, { strength: 2 });

// 굴곡: 골재 알갱이로 오돌토돌한 면, 갈라진 틈은 홈
export const asphalt = () =>
  reliefTexture('asphalt', 256, 256, (g, w, h, hg) => {
    g.fillStyle = '#4a4a4c';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.25, 6000);
    noise(g, w, h, 0.08, 3000, true);
    hNoise(hg, w, h, 85, 9000, 2);
    g.strokeStyle = 'rgba(20,20,20,0.35)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      let x = Math.random() * w;
      let y = Math.random() * h;
      const pts = [[x, y]];
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * 40;
        y += (Math.random() - 0.5) * 40;
        pts.push([x, y]);
      }
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts.slice(1)) g.lineTo(px, py);
      g.stroke();
      hLine(hg, pts, 25, 2, 1, 90);
    }
  }, { strength: 1.6 });

// 굴곡: 풀잎이 촘촘히 솟은 면 (약하게)
export const grass = () =>
  reliefTexture('grass', 256, 256, (g, w, h, hg) => {
    g.fillStyle = '#4d5e34';
    g.fillRect(0, 0, w, h);
    hg.fillStyle = 'rgb(100,100,100)';
    hg.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const v = Math.random();
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = 2 + Math.random() * 3;
      g.fillStyle = v < 0.5 ? 'rgba(90,110,55,0.6)' : v < 0.8 ? 'rgba(55,70,35,0.6)' : 'rgba(120,120,70,0.5)';
      g.fillRect(x, y, 1, len);
      hg.fillStyle = `rgba(${150 + v * 60},${150 + v * 60},${150 + v * 60},0.7)`;
      hg.fillRect(x, y, 1, len);
    }
  }, { strength: 1.2 });

// 굴곡: 울퉁불퉁한 흙과 작은 돌멩이
export const dirt = () =>
  reliefTexture('dirt', 256, 256, (g, w, h, hg) => {
    g.fillStyle = '#7a654a';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.3, 5000);
    noise(g, w, h, 0.1, 2000, true);
    hNoise(hg, w, h, 60, 5000, 3);
    for (let i = 0; i < 70; i++) hBump(hg, w, h, Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 2, 200, 128);
  }, { strength: 1.4 });

// 굴곡: 자갈 하나하나가 둥글게 솟음
export const gravel = () =>
  reliefTexture('gravel', 256, 256, (g, w, h, hg) => {
    g.fillStyle = '#a9a69c';
    g.fillRect(0, 0, w, h);
    hg.fillStyle = 'rgb(80,80,80)';
    hg.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      const v = 120 + Math.floor(Math.random() * 100);
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 1 + Math.random() * 2;
      g.fillStyle = `rgb(${v},${v},${v - 8})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      // 자갈은 작아서 그라데이션 대신 원 두 겹으로 (빠름)
      for (const [rr, hv] of [[r + 0.5, 160], [r * 0.6, 215]]) {
        hg.fillStyle = `rgb(${hv},${hv},${hv})`;
        hg.beginPath();
        hg.arc(x, y, rr, 0, Math.PI * 2);
        hg.fill();
      }
    }
  }, { strength: 1.6 });

/** 논: 물 위로 벼 줄. 굴곡: 잔잔한 물결 + 물 위로 솟은 벼 포기 */
export const paddy = () =>
  reliefTexture('paddy', 256, 256, (g, w, h, hg) => {
    g.fillStyle = '#4c5f4a';
    g.fillRect(0, 0, w, h);
    // 물결: 타일 경계에서 이어지도록 주기를 질감 크기에 맞춤
    const k = (n) => (n * Math.PI * 2) / w;
    hFill(hg, w, h, (x, y) => 118 + 5 * Math.sin(k(3) * x + 2 * Math.sin(k(2) * y)) + 4 * Math.sin(k(5) * y + 1.7 * Math.sin(k(3) * x)));
    for (let y = 8; y < h; y += 16) {
      for (let x = 6; x < w; x += 14) {
        const px = x + Math.random() * 2;
        g.fillStyle = `rgba(${110 + Math.random() * 40},${140 + Math.random() * 40},60,0.95)`;
        g.fillRect(px, y - 4, 4, 8);
        hBump(hg, w, h, px + 2, y, 3, 5, 205, 130);
      }
    }
  }, { strength: 1.5 });

export const vendingFront = () =>
  canvasTexture(
    'vending',
    128,
    256,
    (g, w, h) => {
      g.fillStyle = '#e8eef5';
      g.fillRect(0, 0, w, h);
      const colors = ['#d23c3c', '#2f6fd6', '#f2b02f', '#3aa35b', '#8a4bd0', '#ef7f2b'];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 5; col++) {
          g.fillStyle = colors[(row * 5 + col) % colors.length];
          g.fillRect(10 + col * 22, 20 + row * 46, 14, 34);
          g.fillStyle = 'rgba(255,255,255,0.6)';
          g.fillRect(12 + col * 22, 24 + row * 46, 3, 26);
        }
      }
      g.fillStyle = '#20252b';
      g.fillRect(14, 170, 100, 26);
      g.fillStyle = '#556';
      g.fillRect(30, 210, 70, 30);
    },
    { repeat: false },
  );

export const generatorPanel = () =>
  canvasTexture(
    'gen',
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#4a5a48';
      g.fillRect(0, 0, w, h);
      noise(g, w, h, 0.25, 1200);
      g.fillStyle = '#2b2f2a';
      for (let y = 20; y < 110; y += 12) g.fillRect(16, y, 96, 5);
      g.fillStyle = '#d8c23a';
      g.fillRect(0, 0, w, 8);
      g.fillStyle = '#1b1b1b';
      for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 8, 8);
    },
    { repeat: false },
  );

/** 이름표 스프라이트용 텍스처 */
export function labelTexture(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const tw = Math.min(240, g.measureText(text).width + 24);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  g.roundRect(128 - tw / 2, 10, tw, 44, 14);
  g.fill();
  g.fillStyle = color;
  g.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
