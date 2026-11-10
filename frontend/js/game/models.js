// 캐릭터, 방망이, 발전기, 덫, 탈출구 모델 (기본 도형으로 구성)
import * as THREE from 'three';
import { labelTexture, generatorPanel } from './textures.js';

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

export const SURVIVOR_COLORS = ['#3d7bd9', '#e0a526', '#3fae6a', '#c64f9b', '#8a5bd6'];

/** 방망이: 손잡이가 원점, +y 방향으로 뻗음 */
export function makeBat() {
  const g = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.22, 8), mat('#2b2b2b'));
  grip.position.y = 0.05;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.024, 0.62, 10), mat('#b98a55'));
  body.position.y = 0.47;
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8), mat('#2b2b2b'));
  knob.position.y = -0.06;
  // 못 박힌 느낌
  for (let i = 0; i < 5; i++) {
    const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 4), mat('#c9c9c9'));
    const a = i * 1.3;
    nail.position.set(Math.cos(a) * 0.045, 0.58 + i * 0.04, Math.sin(a) * 0.045);
    nail.rotation.z = Math.PI / 2;
    nail.rotation.y = -a;
    g.add(nail);
  }
  g.add(grip, body, knob);
  return g;
}

/** 쿠나이: 손잡이 끝(고리)이 원점, 날이 +y 방향 */
export function makeKunai() {
  const g = new THREE.Group();
  const steel = mat('#b9c0c8');
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 14), steel);
  ring.position.y = -0.03;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.12, 8), mat('#2b1f1a'));
  grip.position.y = 0.06;
  // 손잡이에 감은 끈
  for (let i = 0; i < 4; i++) {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 4, 10), mat('#8a1f1f'));
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 0.02 + i * 0.028;
    g.add(wrap);
  }
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.02), steel);
  guard.position.y = 0.125;
  const blade = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), mat('#d7dde3', { emissive: '#101418' }));
  blade.scale.set(0.034, 0.12, 0.01);
  blade.position.y = 0.24;
  g.add(ring, grip, guard, blade);
  return g;
}

/** 저격총: 개머리판이 원점, 총구가 -z 방향 */
export function makeRifle() {
  const g = new THREE.Group();
  const dark = mat('#22262b');
  const wood = mat('#6b4a2f');
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.32), wood);
  stock.position.set(0, -0.02, 0.0);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.5), wood);
  body.position.set(0, 0, -0.38);
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.07, 0.22), dark);
  receiver.position.set(0, 0.05, -0.3);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.62, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.9);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.3, 10), dark);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.12, -0.32);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 10), new THREE.MeshBasicMaterial({ color: '#7fd0ff' }));
  lens.position.set(0, 0.12, -0.471);
  lens.rotation.y = Math.PI;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.05), dark);
  grip.position.set(0, -0.07, -0.2);
  g.add(stock, body, receiver, barrel, scope, lens, grip);
  g.userData.muzzle = new THREE.Vector3(0, 0.03, -1.22);
  return g;
}

/** 다른 플레이어 모델. yaw=0에서 -z를 바라본다 */
export class Avatar {
  constructor(role, colorIndex, name, showLabel, cls = 'maniac') {
    this.role = role;
    this.cls = role === 'hunter' ? cls : null;
    this.group = new THREE.Group();
    const isHunter = role === 'hunter';
    const sniper = this.cls === 'sniper';
    const assassin = this.cls === 'assassin';
    const scale = isHunter ? 1.12 : 1;
    const body = new THREE.Group();
    body.scale.setScalar(scale);
    this.group.add(body);

    const shirt = assassin ? '#1c2230' : sniper ? '#3e4a33' : isHunter ? '#2a2326' : SURVIVOR_COLORS[colorIndex % SURVIVOR_COLORS.length];
    const pants = assassin ? '#141822' : sniper ? '#2c3326' : isHunter ? '#1a1718' : '#3b3f4a';
    const skin = assassin ? '#d9b38f' : sniper ? '#26292c' : isHunter ? '#b8342c' : '#e9c6a1';

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.26), mat(shirt));
    torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat(skin));
    head.position.y = 1.62;
    body.add(torso, head);

    if (assassin) {
      // 암살자: 두건 + 입을 가린 복면 + 빨간 머리띠
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.182, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), mat('#1c2230'));
      hood.position.y = 1.63;
      const maskM = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.13, 0.2), mat('#1c2230'));
      maskM.position.set(0, 1.55, -0.06);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.178, 0.018, 6, 20), mat('#b3262b'));
      band.rotation.x = Math.PI / 2;
      band.position.y = 1.7;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.02), mat('#b3262b'));
      tail.position.set(0.04, 1.62, 0.19);
      tail.rotation.z = 0.3;
      body.add(hood, maskM, band, tail);
    } else if (sniper) {
      // 저격수: 복면 + 모자, 빨간 고글
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 12), mat('#2c3326'));
      cap.position.y = 1.76;
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#2c3326'));
      top.position.y = 1.76;
      const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.05), new THREE.MeshBasicMaterial({ color: '#ff3b2f' }));
      goggles.position.set(0, 1.66, -0.15);
      body.add(cap, top, goggles);
    } else if (isHunter) {
      // 도깨비 탈: 뿔 두 개와 노란 눈
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 6), mat('#e8dcc0'));
        horn.position.set(0.08 * s, 1.8, -0.02);
        horn.rotation.z = -0.3 * s;
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: '#ffd23a' }));
        eye.position.set(0.06 * s, 1.65, -0.15);
        body.add(horn, eye);
      }
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#111'));
      hair.position.y = 1.64;
      body.add(hair);
    } else {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.175, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), mat('#2a1d14'));
      hair.position.y = 1.64;
      body.add(hair);
    }

    const limb = (w, h, color) => {
      const pivot = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat(color));
      m.position.y = -h / 2;
      pivot.add(m);
      return pivot;
    };
    this.legL = limb(0.17, 0.85, pants);
    this.legR = limb(0.17, 0.85, pants);
    this.legL.position.set(-0.11, 0.85, 0);
    this.legR.position.set(0.11, 0.85, 0);
    this.armL = limb(0.13, 0.6, shirt);
    this.armR = limb(0.13, 0.6, shirt);
    this.armL.position.set(-0.3, 1.42, 0);
    this.armR.position.set(0.3, 1.42, 0); // 오른손 (+x)
    body.add(this.legL, this.legR, this.armL, this.armR);

    if (assassin) {
      this.kunai = makeKunai();
      this.kunai.position.set(0, -0.6, 0);
      this.kunai.rotation.x = Math.PI; // 날이 팔 끝 방향 (아래로 들고 다님)
      this.armR.add(this.kunai);
    } else if (sniper) {
      this.rifle = makeRifle();
      this.rifle.position.set(0, -0.56, 0);
      this.rifle.rotation.x = -Math.PI / 2; // 총구가 팔 방향
      this.armR.add(this.rifle);
    } else if (isHunter) {
      this.bat = makeBat();
      this.bat.position.set(0, -0.58, 0);
      this.bat.rotation.x = -Math.PI / 2.2;
      this.armR.add(this.bat);
    }

    if (showLabel) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(name), depthWrite: false, transparent: true }));
      sprite.scale.set(1.2, 0.3, 1);
      sprite.position.y = 2.1;
      this.group.add(sprite);
      this.label = sprite;
    }

    this.walk = 0;
    this.swing = 0;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.speed = 0;
    this.stunned = false;
    this.repairing = false;
    this.aiming = false;
    this.recoil = 0;
    this.flash = 0;
    this.materials = [];
    this.group.traverse((o) => o.material && this.materials.push(o.material));
  }

  setTarget(x, z, yaw, snap = false) {
    this.target.set(x, 0, z);
    this.targetYaw = yaw;
    if (snap) {
      this.pos.copy(this.target);
      this.yaw = yaw;
    }
  }

  playSwing() {
    this.swing = 1;
    this.recoil = 1;
  }

  /** 투명화된 암살자를 같은 편/관전자 화면에서 반투명하게 (1 = 보통) */
  setGhost(alpha) {
    if (this.ghost === alpha) return;
    this.ghost = alpha;
    for (const m of this.materials) {
      m.transparent = alpha < 1;
      m.opacity = alpha;
      m.depthWrite = alpha >= 1;
      m.needsUpdate = true;
    }
  }

  /** 저격총 총구의 월드 좌표 */
  muzzleWorld(out = new THREE.Vector3()) {
    if (!this.rifle) return out.set(this.pos.x, 1.5, this.pos.z);
    this.group.updateMatrixWorld(true);
    return this.rifle.localToWorld(out.copy(this.rifle.userData.muzzle));
  }

  hitFlash() {
    this.flash = 0.35;
  }

  update(dt) {
    const prev = this.pos.clone();
    const k = 1 - Math.exp(-dt * 14);
    this.pos.lerp(this.target, k);
    if (this.pos.distanceTo(this.target) > 6) this.pos.copy(this.target);
    let dy = this.targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * k;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    const moved = prev.distanceTo(this.pos) / Math.max(dt, 1e-3);
    this.speed += (moved - this.speed) * Math.min(1, dt * 10);
    const moving = this.speed > 0.3 && !this.stunned;
    this.walk += dt * (moving ? 2.2 + this.speed * 1.4 : 0);
    const amp = moving ? Math.min(0.7, 0.25 + this.speed * 0.08) : 0;
    const s = Math.sin(this.walk) * amp;
    this.legL.rotation.x = s;
    this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 0.8;

    if (this.repairing) {
      // 앞으로 팔을 뻗어 수리
      this.armL.rotation.x = 1.2 + Math.sin(performance.now() / 120) * 0.15;
      this.armR.rotation.x = 1.2 - Math.sin(performance.now() / 120) * 0.15;
    } else if (this.cls === 'assassin' && this.swing > 0) {
      // 앞으로 찌르기
      this.swing = Math.max(0, this.swing - dt * 4);
      const t = 1 - this.swing;
      this.armR.rotation.x = t < 0.25 ? 0.4 + (t / 0.25) * 1.3 : 1.7 - Math.min(1, (t - 0.25) / 0.6) * 1.3;
    } else if (this.cls === 'sniper') {
      // 조준하면 총을 들어 앞을 겨눈다
      this.recoil = Math.max(0, this.recoil - dt * 4);
      const aimX = this.aiming ? 1.5 : 0.75 + s * 0.15;
      this.armR.rotation.x = aimX + this.recoil * 0.5;
      this.armL.rotation.x = aimX + 0.1;
      this.armL.rotation.z = this.aiming ? -0.45 : -0.3;
    } else if (this.role === 'hunter' && this.swing > 0) {
      // 위에서 아래로 내려치기
      this.swing = Math.max(0, this.swing - dt * 3.2);
      const t = 1 - this.swing;
      this.armR.rotation.x = t < 0.3 ? -2.6 * (t / 0.3) : -2.6 + 3.2 * Math.min(1, (t - 0.3) / 0.35);
    } else {
      this.armR.rotation.x = this.role === 'hunter' ? -0.4 + s * 0.3 : s * 0.8;
    }
    if (this.stunned) {
      this.legL.rotation.x = 0.2;
      this.legR.rotation.x = -0.1;
    }

    if (this.flash > 0) {
      this.flash -= dt;
      const on = this.flash > 0 && Math.floor(this.flash * 20) % 2 === 0;
      for (const m of this.materials) if (m.emissive) m.emissive.set(on ? '#661111' : '#000000');
    }
  }

  dispose() {
    this.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}

/** 1인칭 시점에서 화면 오른쪽 아래에 보이는 방망이 (오른손) */
export class BatViewModel {
  constructor(camera) {
    this.root = new THREE.Group();
    this.hand = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.42), mat('#2a2326'));
    arm.position.set(0, -0.03, 0.2);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat('#b8342c'));
    this.bat = makeBat();
    this.bat.position.set(0, -0.02, 0);
    this.hand.add(arm, fist, this.bat);
    this.root.add(this.hand);
    this.root.scale.setScalar(0.55);
    this.root.position.set(0.3, -0.3, -0.5);
    camera.add(this.root);
    this.swing = 0;
    this.bob = 0;
    this.rest();
  }

  rest() {
    this.hand.rotation.set(0.35, 0.15, -0.25);
    this.hand.position.set(0, 0, 0);
  }

  playSwing() {
    this.swing = 1;
  }

  update(dt, moving) {
    this.bob += dt * (moving ? 9 : 2);
    const by = Math.sin(this.bob) * (moving ? 0.015 : 0.004);
    const bx = Math.cos(this.bob * 0.5) * (moving ? 0.012 : 0.002);
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt * 3.5);
      const t = 1 - this.swing;
      // 들어올렸다가 화면 가운데로 내려친다
      const up = t < 0.25 ? t / 0.25 : 1 - Math.min(1, (t - 0.25) / 0.3);
      const down = t < 0.25 ? 0 : Math.min(1, (t - 0.25) / 0.3) * (1 - Math.max(0, (t - 0.7) / 0.3));
      this.hand.rotation.set(0.35 + up * 0.9 - down * 1.6, 0.15 + down * 0.6, -0.25 - down * 0.5);
      this.hand.position.set(-down * 0.18, up * 0.08 - down * 0.05, -down * 0.08);
    } else {
      this.rest();
    }
    this.root.position.set(0.3 + bx, -0.3 + by, -0.5);
  }
}

export class GeneratorModel {
  constructor(g) {
    this.group = new THREE.Group();
    this.group.position.set(g.x, 0, g.z);
    this.group.rotation.y = g.rot;
    const panel = generatorPanel();
    const bodyMat = [mat('#4a5a48'), mat('#4a5a48'), mat('#3e4a3c'), mat('#3e4a3c'), mat('#ffffff', { map: panel }), mat('#4a5a48')];
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.8), bodyMat);
    body.position.y = 0.55;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.9), mat('#2a2a2a'));
    base.position.y = 0.06;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), mat('#555'));
    pipe.position.set(0.4, 1.15, 0.2);
    // 담장 너머로도 보이는 표시등 기둥
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), mat('#666'));
    pole.position.set(-0.45, 2.1, -0.25);
    this.bulbMat = new THREE.MeshBasicMaterial({ color: '#ff3a2a' });
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), this.bulbMat);
    this.bulb.position.set(-0.45, 3.3, -0.25);
    this.light = new THREE.PointLight('#ff3a2a', 3, 9, 1.6);
    this.light.position.set(-0.45, 3.0, -0.25);
    this.group.add(body, base, pipe, pole, this.bulb, this.light);
    this.progress = 0;
    this.done = false;
    this.t = Math.random() * 10;
  }

  set(progress, done) {
    this.progress = progress;
    if (done && !this.done) {
      this.done = true;
      this.bulbMat.color.set('#3cff6a');
      this.light.color.set('#3cff6a');
      this.light.intensity = 6;
      this.light.distance = 14;
    }
  }

  update(dt) {
    this.t += dt;
    if (!this.done) {
      // 진행될수록 빠르게 깜빡임
      const speed = 1.5 + this.progress * 8;
      const on = Math.sin(this.t * speed * Math.PI) > -0.3;
      this.bulbMat.color.set(on ? '#ff3a2a' : '#5a1510');
      this.light.intensity = on ? 3 : 0.6;
    }
  }
}

export function makeTrap(faint) {
  const g = new THREE.Group();
  const m = mat('#7b7f86', { transparent: faint, opacity: faint ? 0.35 : 1 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 20), m);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), m);
  plate.position.y = 0.03;
  g.add(ring, plate);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 4), m);
    tooth.position.set(Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3);
    g.add(tooth);
  }
  return g;
}

/** 탈출구: 빛나는 도리이(鳥居) */
export function makeExit(exit) {
  const g = new THREE.Group();
  g.position.set(exit.x, 0, exit.z);
  g.rotation.y = exit.rot;
  const red = mat('#d2452b');
  const black = mat('#1d1d1d');
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 4.2, 10), red);
    post.position.set(1.6 * s, 2.1, 0);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.4, 10), black);
    foot.position.set(1.6 * s, 0.2, 0);
    g.add(post, foot);
  }
  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.3, 0.45), black);
  kasagi.position.y = 4.35;
  const kasagi2 = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.22, 0.4), red);
  kasagi2.position.y = 4.1;
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.2, 0.25), red);
  nuki.position.y = 3.4;
  const portal = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 3.3),
    new THREE.MeshBasicMaterial({ color: '#c8f2ff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
  );
  portal.position.y = 1.7;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.6, 40, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: '#9fe8ff', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  );
  beam.position.y = 20;
  const light = new THREE.PointLight('#bdf0ff', 8, 18, 1.4);
  light.position.y = 2;
  g.add(kasagi, kasagi2, nuki, portal, beam, light);
  g.userData.portal = portal;
  return g;
}

/** 1인칭 저격총 (오른손). 조준(스코프) 중에는 숨긴다 */
export class RifleViewModel {
  constructor(camera) {
    this.root = new THREE.Group();
    this.gun = makeRifle();
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.12), mat('#2c3326'));
    glove.position.set(0.02, -0.08, -0.18);
    const glove2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.12), mat('#2c3326'));
    glove2.position.set(-0.03, -0.05, -0.62);
    this.gun.add(glove, glove2);
    this.root.add(this.gun);
    this.root.scale.setScalar(0.7);
    camera.add(this.root);
    this.recoil = 0;
    this.bob = 0;
    this.aim = 0;
  }

  playSwing() {
    this.recoil = 1;
  }

  update(dt, moving, aiming) {
    this.bob += dt * (moving ? 9 : 2);
    this.aim += ((aiming ? 1 : 0) - this.aim) * Math.min(1, dt * 14);
    this.recoil = Math.max(0, this.recoil - dt * 3);
    const by = Math.sin(this.bob) * (moving ? 0.012 : 0.003);
    const bx = Math.cos(this.bob * 0.5) * (moving ? 0.01 : 0.002);
    const r = this.recoil;
    // 평소: 오른쪽 아래, 조준: 화면 가운데로 올라오며 스코프 화면으로 전환
    this.root.position.set(0.22 * (1 - this.aim) + bx, -0.24 + 0.12 * this.aim + by + r * 0.03, -0.32 + r * 0.08);
    this.gun.rotation.set(r * 0.25, 0.04 * (1 - this.aim), 0);
    this.root.visible = this.aim < 0.85;
  }
}

/** 총알 궤적 (빛나는 선). 서버 이벤트로 시작/끝 위치를 받는다 */
export class Tracer {
  constructor(scene, origin, dir, speed) {
    this.scene = scene;
    this.dir = dir.clone().normalize();
    this.pos = origin.clone();
    this.start = origin.clone();
    this.speed = speed;
    this.end = null;
    this.life = 3;
    const len = 4;
    const geo = new THREE.CylinderGeometry(0.025, 0.025, len, 5, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, len / 2);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.9, fog: false }));
    this.place();
    scene.add(this.mesh);
  }

  place() {
    // 꼬리가 총알 뒤에 오도록 (궤적은 -dir 방향으로 늘어짐)
    this.mesh.position.copy(this.pos).addScaledVector(this.dir, -4);
    this.mesh.lookAt(this.mesh.position.clone().add(this.dir));
  }

  stopAt(p) {
    this.end = p.clone();
  }

  /** @returns {boolean} 계속 살아 있으면 true */
  update(dt) {
    this.life -= dt;
    const step = this.speed * dt;
    if (this.end) {
      const left = this.end.clone().sub(this.pos).dot(this.dir);
      if (left <= step) {
        this.dispose();
        return false;
      }
    }
    this.pos.addScaledVector(this.dir, step);
    this.place();
    if (this.life <= 0) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** 총알이 박힌 곳의 작은 섬광 */
export function makeImpact(scene, p, color = '#fff2c0') {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true }));
  m.position.copy(p);
  scene.add(m);
  let t = 0;
  return (dt) => {
    t += dt;
    m.scale.setScalar(1 + t * 6);
    m.material.opacity = Math.max(0, 1 - t * 4);
    if (t > 0.25) {
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
      return false;
    }
    return true;
  };
}

/** 1인칭 쿠나이 (오른손). 투명화 중에는 반투명하게 보인다 */
export class KunaiViewModel {
  constructor(camera) {
    this.root = new THREE.Group();
    this.hand = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.4), mat('#1c2230'));
    arm.position.set(0, -0.02, 0.2);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), mat('#1c2230'));
    this.kunai = makeKunai();
    this.kunai.scale.setScalar(1.6);
    this.kunai.rotation.x = -Math.PI / 2; // 날이 앞(-z)
    this.kunai.position.set(0, 0, -0.02);
    this.hand.add(arm, fist, this.kunai);
    this.root.add(this.hand);
    this.root.scale.setScalar(0.75);
    camera.add(this.root);
    this.swing = 0;
    this.bob = 0;
    this.materials = [];
    this.root.traverse((o) => o.material && this.materials.push(o.material));
    this.baseEmissive = this.materials.map((m) => m.emissive?.clone());
    this.ghost = 1;
  }

  playSwing() {
    this.swing = 1;
  }

  /** 투명화 중이면 무기가 반투명 */
  setGhost(on) {
    const a = on ? 0.32 : 1;
    if (this.ghost === a) return;
    this.ghost = a;
    for (const m of this.materials) {
      m.transparent = on;
      m.opacity = a;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
    this.materials.forEach((m, i) => {
      if (m.emissive) m.emissive.copy(on ? new THREE.Color('#2a4a66') : this.baseEmissive[i]);
    });
  }

  update(dt, moving) {
    this.bob += dt * (moving ? 9 : 2);
    const by = Math.sin(this.bob) * (moving ? 0.014 : 0.004);
    const bx = Math.cos(this.bob * 0.5) * (moving ? 0.01 : 0.002);
    let thrust = 0;
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt * 4.5);
      const t = 1 - this.swing;
      thrust = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
    }
    // 평소에는 살짝 비스듬히, 공격하면 화면 가운데로 찌른다
    this.hand.rotation.set(0.15 - thrust * 0.1, 0.25 - thrust * 0.3, -0.2);
    this.root.position.set(0.28 + bx - thrust * 0.12, -0.27 + by + thrust * 0.05, -0.45 - thrust * 0.22);
  }
}
