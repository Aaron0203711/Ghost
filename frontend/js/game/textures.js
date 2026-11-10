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

export function noise(g, w, h, alpha, n = 1800, light = false) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** 콘크리트 블록 담장: 텍스처 1장 = 가로 2블록(0.8m) × 세로 2단(0.4m) */
export const blockWall = () =>
  canvasTexture('block', 256, 128, (g, w, h) => {
    g.fillStyle = '#9d9a92';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.18, 2500);
    noise(g, w, h, 0.12, 1200, true);
    g.strokeStyle = 'rgba(60,58,52,0.55)';
    g.lineWidth = 3;
    for (let row = 0; row < 2; row++) {
      const y = row * (h / 2);
      g.beginPath();
      g.moveTo(0, y + 1);
      g.lineTo(w, y + 1);
      g.stroke();
      const off = row % 2 ? w / 4 : 0;
      for (let k = 0; k < 3; k++) {
        const x = (off + (k * w) / 2) % w;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + h / 2);
        g.stroke();
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
  });

export const stoneWall = () =>
  canvasTexture('stone', 256, 256, (g, w, h) => {
    g.fillStyle = '#6f6c64';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 18 + Math.random() * 26;
      const v = 95 + Math.floor(Math.random() * 50);
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.7, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(30,30,25,0.6)';
      g.lineWidth = 3;
      g.stroke();
    }
    noise(g, w, h, 0.2, 2000);
  });

/** 집 외벽: 목재 판자 하단 + 회벽 상단 + 창문 (1장 = 3m × 3m) */
export const houseWall = () =>
  canvasTexture('house', 256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.08, 1500);
    // 아래쪽 판자
    g.fillStyle = '#b9a58a';
    g.fillRect(0, h * 0.55, w, h * 0.45);
    g.strokeStyle = 'rgba(70,50,30,0.5)';
    g.lineWidth = 2;
    for (let y = h * 0.55; y < h; y += 10) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    // 기둥
    g.fillStyle = '#5b4330';
    g.fillRect(0, 0, 10, h);
    // 창문 (격자 창)
    const wx = w * 0.32;
    const wy = h * 0.2;
    const ww = w * 0.42;
    const wh = h * 0.42;
    g.fillStyle = '#2a2f36';
    g.fillRect(wx, wy, ww, wh);
    g.fillStyle = 'rgba(255,214,140,0.55)';
    g.fillRect(wx + 4, wy + 4, ww - 8, wh - 8);
    g.strokeStyle = '#4a3626';
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
  });

/** 기와 지붕 */
export const roofTiles = () =>
  canvasTexture('roof', 128, 128, (g, w, h) => {
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
  });

export const wood = () =>
  canvasTexture('wood', 128, 128, (g, w, h) => {
    g.fillStyle = '#6b4a2f';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.2})`;
      g.fillRect(x, 0, 2, h);
      for (let i = 0; i < 6; i++) {
        g.fillStyle = `rgba(255,220,180,${Math.random() * 0.08})`;
        g.fillRect(x + 3 + Math.random() * 10, 0, 1, h);
      }
    }
    noise(g, w, h, 0.15, 600);
  });

export const asphalt = () =>
  canvasTexture('asphalt', 256, 256, (g, w, h) => {
    g.fillStyle = '#4a4a4c';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.25, 6000);
    noise(g, w, h, 0.08, 3000, true);
    g.strokeStyle = 'rgba(20,20,20,0.35)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      let x = Math.random() * w;
      let y = Math.random() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (Math.random() - 0.5) * 40;
        y += (Math.random() - 0.5) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });

export const grass = () =>
  canvasTexture('grass', 256, 256, (g, w, h) => {
    g.fillStyle = '#4d5e34';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? 'rgba(90,110,55,0.6)' : v < 0.8 ? 'rgba(55,70,35,0.6)' : 'rgba(120,120,70,0.5)';
      g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 3);
    }
  });

export const dirt = () =>
  canvasTexture('dirt', 256, 256, (g, w, h) => {
    g.fillStyle = '#7a654a';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 0.3, 5000);
    noise(g, w, h, 0.1, 2000, true);
  });

export const gravel = () =>
  canvasTexture('gravel', 256, 256, (g, w, h) => {
    g.fillStyle = '#a9a69c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) {
      const v = 120 + Math.floor(Math.random() * 100);
      g.fillStyle = `rgb(${v},${v},${v - 8})`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 0, Math.PI * 2);
      g.fill();
    }
  });

/** 논: 물 위로 벼 줄 */
export const paddy = () =>
  canvasTexture('paddy', 256, 256, (g, w, h) => {
    g.fillStyle = '#4c5f4a';
    g.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 16) {
      for (let x = 6; x < w; x += 14) {
        g.fillStyle = `rgba(${110 + Math.random() * 40},${140 + Math.random() * 40},60,0.95)`;
        g.fillRect(x + Math.random() * 2, y - 4, 4, 8);
      }
    }
  });

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
