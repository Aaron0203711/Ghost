// 생존자 지도: 맵을 위에서 본 모습. 다른 생존자·발전기는 숨기고,
// 내 위치와 방향, 생존자가 찾은 발전기, 생존자가 잡힌 자리(X), 열린 탈출구만 표시한다.

const SIZE = 600; // 캔버스 해상도 (px)

const THEMES = {
  village: { ground: '#4a5636', road: '#6b6762', house: '#3a3029', wall: '#cfc8b6', paddy: '#4f6d6a', dirt: '#7a6a4f', tree: '#2f4024', boundary: '#1e1a16' },
  mine: { ground: '#2c2520', road: '#5a4d40', house: '#7a4a2e', wall: '#a8998a', paddy: '#26383a', dirt: '#1b1916', tree: '#4a3a2a', boundary: '#0f0c0a' },
  backrooms: { ground: '#b7a65c', road: '#b7a65c', house: '#6d5f2c', wall: '#5a4e22', paddy: '#b7a65c', dirt: '#b7a65c', tree: '#5a4e22', boundary: '#3d3416' },
};

export class MiniMap {
  /** @param {any} map 서버가 보낸 맵 데이터, @param {Map} gens 발전기 (id → {x,z,done}) */
  constructor(map, gens, theme) {
    this.map = map;
    this.gens = gens;
    this.theme = THEMES[theme] || THEMES.village;
    this.half = map.size / 2;
    this.scale = SIZE / map.size;
    this.base = this.drawBase();
    this.found = new Set();
    this.deaths = [];
    this.exit = null;
  }

  px(x) {
    return (x + this.half) * this.scale;
  }

  py(z) {
    return (z + this.half) * this.scale;
  }

  /** 지형은 바뀌지 않으므로 한 번만 그려 둔다 */
  drawBase() {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');
    const T = this.theme;
    g.fillStyle = T.ground;
    g.fillRect(0, 0, SIZE, SIZE);
    const rect = (x, z, w, d, color) => {
      g.fillStyle = color;
      g.fillRect(this.px(x - w / 2), this.py(z - d / 2), Math.max(1.2, w * this.scale), Math.max(1.2, d * this.scale));
    };
    for (const r of this.map.roads || []) rect(r.x, r.z, r.w, r.d, T.road);
    for (const d of this.map.decor || []) {
      if (d.kind === 'paddy') rect(d.x, d.z, d.w, d.d, T.paddy);
      else if (d.kind === 'dirt' || d.kind === 'gravel') rect(d.x, d.z, d.w, d.d, T.dirt);
    }
    for (const b of this.map.boxes) {
      switch (b.kind) {
        case 'house':
        case 'shrine':
        case 'hut':
        case 'shed':
        case 'truck':
          rect(b.x, b.z, b.w, b.d, T.house);
          break;
        case 'wall':
        case 'stonewall':
        case 'pillar':
          rect(b.x, b.z, b.w, b.d, T.wall);
          break;
        case 'boundary':
          rect(b.x, b.z, b.w, b.d, T.boundary);
          break;
        case 'trunk':
          rect(b.x, b.z, 1.2, 1.2, T.tree);
          break;
        default:
          break; // 전봇대·자판기 같은 작은 물건은 생략
      }
    }
    // 테두리
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, SIZE - 4, SIZE - 4);
    return c;
  }

  /** 서버가 보낸 지도 정보 반영 */
  update(info, exit) {
    if (info) {
      this.found = new Set(info.found || []);
      this.deaths = info.deaths || [];
    }
    if (exit) this.exit = exit;
  }

  /** 캔버스에 지도와 표시를 그린다. me: {x, z, yaw} 또는 null(관전 중) */
  draw(canvas, me) {
    const g = canvas.getContext('2d');
    if (canvas.width !== SIZE) canvas.width = canvas.height = SIZE;
    g.drawImage(this.base, 0, 0);

    // 찾은 발전기 (켜지면 초록)
    for (const id of this.found) {
      const gen = this.gens.get(id);
      if (!gen) continue;
      const x = this.px(gen.x);
      const y = this.py(gen.z);
      g.beginPath();
      g.arc(x, y, 11, 0, Math.PI * 2);
      g.fillStyle = gen.done ? '#3cff6a' : '#ff5a3a';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#111';
      g.stroke();
      g.fillStyle = '#111';
      g.font = 'bold 14px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('⚡', x, y + 1);
    }

    // 생존자가 잡힌 자리
    for (const d of this.deaths) {
      const x = this.px(d.x);
      const y = this.py(d.z);
      const r = 9;
      g.lineCap = 'round';
      g.strokeStyle = '#111';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(x - r, y - r);
      g.lineTo(x + r, y + r);
      g.moveTo(x + r, y - r);
      g.lineTo(x - r, y + r);
      g.stroke();
      g.strokeStyle = '#ff2b2b';
      g.lineWidth = 4;
      g.stroke();
    }

    // 탈출구
    if (this.exit) {
      const x = this.px(this.exit.x);
      const y = this.py(this.exit.z);
      const pulse = 14 + Math.sin(performance.now() / 250) * 3;
      g.beginPath();
      g.arc(x, y, pulse, 0, Math.PI * 2);
      g.fillStyle = 'rgba(127,227,255,0.35)';
      g.fill();
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.fillStyle = '#7fe3ff';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#0b2a33';
      g.stroke();
      g.fillStyle = '#0b2a33';
      g.font = 'bold 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('출', x, y + 1);
    }

    // 내 위치와 바라보는 방향 (위 = 북쪽, -z)
    if (me) {
      const x = this.px(me.x);
      const y = this.py(me.z);
      const ang = Math.atan2(-Math.cos(me.yaw), -Math.sin(me.yaw));
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(14, 0);
      g.lineTo(-9, 9);
      g.lineTo(-4, 0);
      g.lineTo(-9, -9);
      g.closePath();
      g.fillStyle = '#ffe14d';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#111';
      g.stroke();
      g.restore();
    }
  }
}
