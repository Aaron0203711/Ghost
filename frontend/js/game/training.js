// 훈련장 화면 요소: 허수아비 체력 막대, 맞았을 때 떠오르는 피해량
import * as THREE from 'three';

/** 허수아비 머리 위 체력 막대 (이름표 위). set(hits)로 남은 체력을 다시 그린다 */
export function makeHpBar(max) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 40;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sprite.scale.set(1.1, 0.17, 1);
  sprite.position.y = 2.42;
  let last = null;
  const set = (hits) => {
    const left = Math.max(0, max - hits);
    if (left === last) return;
    last = left;
    g.clearRect(0, 0, 256, 40);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.roundRect(4, 4, 248, 32, 10);
    g.fill();
    const w = 240 * (left / max);
    g.fillStyle = left / max > 0.5 ? '#4fd17a' : left / max > 0.25 ? '#f2c230' : '#e0553a';
    if (w > 0) {
      g.beginPath();
      g.roundRect(8, 8, Math.max(8, w), 24, 7);
      g.fill();
    }
    // 칸 구분선
    g.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 1; i < max; i++) g.fillRect(8 + (240 * i) / max - 1, 8, 2, 24);
    tex.needsUpdate = true;
  };
  set(0);
  return { sprite, set };
}

/** 맞은 자리에서 위로 떠오르며 사라지는 피해량 글자 (this.effects에 넣어 매 프레임 호출) */
export function makeDamagePop(scene, pos, text, color = '#ffd25a') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 80;
  const g = c.getContext('2d');
  g.font = 'bold 56px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(text, 128, 42);
  g.fillStyle = color;
  g.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.2, 0.375, 1);
  sprite.position.set(pos.x + (Math.random() - 0.5) * 0.4, 2.0, pos.z + (Math.random() - 0.5) * 0.4);
  sprite.renderOrder = 10;
  scene.add(sprite);
  let t = 0;
  return (dt) => {
    t += dt;
    sprite.position.y += dt * 1.1;
    mat.opacity = Math.max(0, 1 - Math.max(0, t - 0.5) * 2);
    if (t > 1) {
      scene.remove(sprite);
      tex.dispose();
      mat.dispose();
      return false;
    }
    return true;
  };
}
