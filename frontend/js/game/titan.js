// 입체기동 이벤트 모드 화면: 거대한 벽에 둘러싸인 성곽 도시, 거인 술래, 입체기동장치 와이어, 지붕 위 총,
// 거인 체력 막대, 승리 장면(생존자 승리: 쓰러진 거인을 밟음 / 술래 승리: 생존자를 모두 입에 털어 넣음).
import * as THREE from 'three';
import { TITAN } from '@shared/constants.js';
import { Batch, place, texturedBox, groundPlane, lambert } from './world.js';
import * as T from './textures.js';
import { reflect } from './reflect.js';
import { Avatar, makeRifle, Tracer, makeImpact } from './models.js';

export const TITAN_FOG = { color: '#9c8f8a', near: 70, far: 330 };

/** 성곽 도시 (벽·집·시계탑·길) */
export function buildTitanWorld(scene, map) {
  const group = new THREE.Group();
  const size = map.size;
  const B = {
    ground: new Batch(),
    road: new Batch(),
    wall: new Batch(),
    house: new Batch(),
    plain: new Batch(),
    roof: new Batch(),
    wood: new Batch(),
  };
  B.ground.add(groundPlane(size + 200, size + 200, 8), '#c9b58f');
  for (const r of map.roads) B.road.add(place(groundPlane(r.w, r.d, 4), r.x, 0.02, r.z), '#d8cfc0');
  for (const p of map.plazas || []) B.road.add(place(groundPlane(p.w, p.d, 4), p.x, 0.03, p.z), '#e6dccb');

  for (const b of map.boxes) {
    if (b.kind === 'titanWall') {
      B.wall.add(place(texturedBox(b.w, b.h, b.d, 6, 6), b.x, b.h / 2, b.z), '#bdb3a2');
      // 성가퀴 (벽 위 톱니)
      const along = b.w > b.d;
      const len = along ? b.w : b.d;
      for (let t = -len / 2 + 3; t < len / 2 - 2; t += 8) {
        const x = along ? b.x + t : b.x;
        const z = along ? b.z : b.z + t;
        B.wall.add(place(texturedBox(along ? 4 : b.w, 2.6, along ? b.d : 4, 6, 6), x, b.h + 1.3, z), '#ada391');
      }
      // 벽 아래쪽 띠
      B.plain.add(place(new THREE.BoxGeometry(b.w + 0.6, 1.2, b.d + 0.6), b.x, 0.6, b.z), '#7f7768');
    } else if (b.kind === 'thouse') {
      B.house.add(place(texturedBox(b.w, b.h, b.d, 4.2, 3.6), b.x, b.h / 2, b.z), b.color || '#e0d4bc');
      // 층마다 나무 들보 띠 (반목조 느낌)
      const floors = b.floors || Math.round(b.h / 3.6);
      for (let f = 1; f < floors; f++) {
        const y = (b.h / floors) * f;
        B.wood.add(place(new THREE.BoxGeometry(b.w + 0.12, 0.28, b.d + 0.12), b.x, y, b.z), '#5b3d2a');
      }
      // 평평한 지붕 + 낮은 난간 + 굴뚝
      B.roof.add(place(new THREE.BoxGeometry(b.w + 0.5, 0.35, b.d + 0.5), b.x, b.h - 0.16, b.z), b.roof || '#7a4a35');
      const t = 0.3;
      const ph = 0.45;
      B.roof.add(place(new THREE.BoxGeometry(b.w + 0.5, ph, t), b.x, b.h + ph / 2 + 0.2, b.z - b.d / 2 - 0.1), b.roof || '#7a4a35');
      B.roof.add(place(new THREE.BoxGeometry(b.w + 0.5, ph, t), b.x, b.h + ph / 2 + 0.2, b.z + b.d / 2 + 0.1), b.roof || '#7a4a35');
      B.roof.add(place(new THREE.BoxGeometry(t, ph, b.d + 0.5), b.x - b.w / 2 - 0.1, b.h + ph / 2 + 0.2, b.z), b.roof || '#7a4a35');
      B.roof.add(place(new THREE.BoxGeometry(t, ph, b.d + 0.5), b.x + b.w / 2 + 0.1, b.h + ph / 2 + 0.2, b.z), b.roof || '#7a4a35');
      const cx = b.x + (((b.x * 7.3 + b.z * 3.1) % 1) - 0.5) * b.w * 0.5;
      const cz = b.z + (((b.x * 2.7 + b.z * 5.9) % 1) - 0.5) * b.d * 0.5;
      B.plain.add(place(new THREE.BoxGeometry(1.1, 1.8, 1.1), cx, b.h + 0.9, cz), '#7d6656');
    } else if (b.kind === 'tower') {
      B.wall.add(place(texturedBox(b.w, b.h, b.d, 3, 3), b.x, b.h / 2, b.z), b.color || '#cfc2a6');
      B.roof.add(place(new THREE.BoxGeometry(b.w + 0.8, 0.5, b.d + 0.8), b.x, b.h, b.z), '#5a4638');
      B.roof.add(place(new THREE.ConeGeometry(b.w * 0.55, 10, 4), b.x, b.h + 5.2, b.z, Math.PI / 4), b.roof || '#4b3a30');
      // 시계판 (네 면)
      for (const [dx, dz, ry] of [
        [0, b.d / 2 + 0.06, 0],
        [0, -b.d / 2 - 0.06, Math.PI],
        [b.w / 2 + 0.06, 0, Math.PI / 2],
        [-b.w / 2 - 0.06, 0, -Math.PI / 2],
      ]) {
        const face = new THREE.CircleGeometry(2.6, 20);
        B.plain.add(place(face, b.x + dx, b.h - 5, b.z + dz, ry), '#f1ead8');
      }
    } else {
      B.plain.add(place(new THREE.BoxGeometry(b.w, b.h, b.d), b.x, b.h / 2, b.z), '#888888');
    }
  }
  const meshes = [
    B.ground.mesh(reflect(lambert({ map: T.dirt() }), 'matte')),
    B.road.mesh(reflect(lambert({ map: T.gravel() }), 'stone')),
    B.wall.mesh(reflect(lambert({ map: T.stoneWall() }), 'stone')),
    B.house.mesh(reflect(lambert({ map: T.houseWall() }), 'wood')),
    B.roof.mesh(reflect(lambert({}), 'tile')),
    B.wood.mesh(reflect(lambert({ map: T.wood() }), 'wood')),
    B.plain.mesh(reflect(lambert({}), 'painted')),
  ];
  for (const m of meshes) if (m) group.add(m);
  scene.add(group);
  return group;
}

const _box = new THREE.Box3();

/** 술래 아바타를 키 25m 거인으로 키운다 */
export function makeGiant(avatar) {
  avatar.body.scale.setScalar(1);
  avatar.body.updateMatrixWorld(true);
  _box.setFromObject(avatar.body);
  const h = Math.max(1, _box.max.y - _box.min.y);
  avatar.body.scale.setScalar(TITAN.HEIGHT / h);
  avatar.giant = true;
  avatar.tall = false;
  if (avatar.label) {
    avatar.label.position.y = TITAN.HEIGHT + 1.5;
    avatar.label.scale.set(6, 1.5, 1);
  }
  return avatar;
}

/** 생존자 허리 양쪽 입체기동장치 (가스통과 손잡이) */
export function addOdmGear(avatar) {
  const mat = new THREE.MeshLambertMaterial({ color: '#8d949c' });
  const dark = new THREE.MeshLambertMaterial({ color: '#3d3a36' });
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 8), mat);
    tank.rotation.x = Math.PI / 2;
    g.add(tank);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.18), dark);
    box.position.set(0, 0.02, -0.12);
    g.add(box);
    g.position.set(s * 0.26, 0.95, 0.02);
    avatar.body.add(g);
  }
  // 허벅지 벨트
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 4, 14), dark);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.98;
  avatar.body.add(belt);
  avatar.group.traverse((o) => o.material && !avatar.materials.includes(o.material) && avatar.materials.push(o.material));
}

/** 지붕 위 총: 소총 모양 + 멀리서도 보이는 빛기둥 */
function makeGunPickup() {
  const g = new THREE.Group();
  const rifle = makeRifle();
  rifle.scale.setScalar(1.8);
  rifle.rotation.z = Math.PI / 2;
  rifle.position.y = 0.6;
  g.add(rifle);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 30, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  beam.position.y = 15;
  g.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.0, 20), new THREE.MeshBasicMaterial({ color: '#ffe680', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  g.userData.rifle = rifle;
  return g;
}

const lineMat = new THREE.LineBasicMaterial({ color: '#e9eef2', transparent: true, opacity: 0.9 });

/** 와이어 두 줄 (허리 양쪽 → 박힌 곳) */
function makeWire() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  const line = new THREE.LineSegments(geo, lineMat);
  line.frustumCulled = false;
  return line;
}

function setWire(line, from, yaw, to) {
  const arr = line.geometry.attributes.position.array;
  const rx = Math.cos(yaw) * 0.26;
  const rz = -Math.sin(yaw) * 0.26;
  arr.set([from.x - rx, from.y, from.z - rz, to.x - rx * 0.3, to.y, to.z - rz * 0.3, from.x + rx, from.y, from.z + rz, to.x + rx * 0.3, to.y, to.z + rz * 0.3]);
  line.geometry.attributes.position.needsUpdate = true;
}

const $ = (id) => document.getElementById(id);

/** 입체기동 모드의 화면 효과와 HUD. GameSession이 만들고 상태·이벤트를 넘겨 준다 */
export class TitanFx {
  constructor(session, start) {
    this.s = session;
    this.scene = session.scene;
    this.wires = new Map(); // 플레이어 id → { line, to }
    this.guns = new Map(); // 총 id → 모델
    this.tracers = new Map();
    this.hunterId = [...session.info.values()].find((p) => p.role === 'hunter')?.id;
    this.hunterHp = 0;
    this.hunterMax = TITAN.HP;
    this.hasGun = false;
    for (const g of start.guns || []) this.addGun(g);
    $('titan-hud').classList.remove('hidden');
    this.renderHp();
    this.renderGun();
  }

  addGun(g) {
    if (this.guns.has(g.id)) return;
    const m = makeGunPickup();
    m.position.set(g.x, g.y, g.z);
    this.scene.add(m);
    this.guns.set(g.id, m);
  }

  removeGun(id) {
    const m = this.guns.get(id);
    if (!m) return;
    this.scene.remove(m);
    m.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
    this.guns.delete(id);
  }

  onState(st) {
    const ids = new Set((st.guns || []).map((g) => g.id));
    for (const g of st.guns || []) this.addGun(g);
    for (const id of [...this.guns.keys()]) if (!ids.has(id)) this.removeGun(id);
    for (const p of st.players) {
      if (p.hidden) continue;
      if (p.w) {
        let w = this.wires.get(p.id);
        if (!w) {
          w = { line: makeWire(), to: new THREE.Vector3() };
          this.scene.add(w.line);
          this.wires.set(p.id, w);
        }
        w.to.set(p.w[0], p.w[1], p.w[2]);
      } else this.dropWire(p.id);
      if (p.id === this.hunterId && p.hits !== this.hunterHp) {
        this.hunterHp = p.hits;
        this.renderHp();
      }
      if (p.id === this.s.myId && !!p.gun !== this.hasGun) {
        this.hasGun = !!p.gun;
        this.renderGun();
      }
    }
  }

  dropWire(id) {
    const w = this.wires.get(id);
    if (!w) return;
    this.scene.remove(w.line);
    w.line.geometry.dispose();
    this.wires.delete(id);
  }

  onEvent(e) {
    const s = this.s;
    const name = (id) => s.info.get(id)?.name ?? '?';
    switch (e.kind) {
      case 'wire':
        if (s.distTo(e.id) < 30 || e.id === s.myId) s.sfxWire?.();
        break;
      case 'wireMiss':
        if (e.id === s.myId) s.centerMsg('와이어가 닿지 않아요 (벽·집 60m 안)', 0.9);
        break;
      case 'wireOff':
        this.dropWire(e.id);
        break;
      case 'stick':
        if (e.id === s.myId) s.centerMsg('🪝 벽에 붙었다! 0.5초 안에 다시 쏘세요', 0.9);
        break;
      case 'land':
        this.dropWire(e.id);
        break;
      case 'gunSpawn':
        this.addGun({ id: e.gid, x: e.x, y: e.y, z: e.z });
        break;
      case 'gunPick':
        this.removeGun(e.gid);
        if (e.id === s.myId) {
          this.hasGun = true;
          this.renderGun();
          s.centerMsg('🔫 총을 주웠다! 한 발 · 거인을 맞히면 1칸', 2);
        } else if (s.role !== 'hunter') s.feed(`🔫 ${name(e.id)}이(가) 총을 주웠다`);
        break;
      case 'tshot': {
        const o = new THREE.Vector3(e.x, e.y, e.z);
        const d = new THREE.Vector3(e.dx, e.dy, e.dz);
        const tr = new Tracer(this.scene, o, d, TITAN.BULLET_SPEED);
        s.liveTracers.push(tr);
        this.tracers.set(e.bid, tr);
        if (e.id === s.myId) {
          this.hasGun = false;
          this.renderGun();
        }
        break;
      }
      case 'tshotEnd': {
        const p = new THREE.Vector3(e.x, e.y, e.z);
        this.tracers.get(e.bid)?.stopAt(p);
        this.tracers.delete(e.bid);
        if (!e.out) s.effects.push(makeImpact(this.scene, p, e.hit ? '#ff6a4a' : '#fff2c0'));
        break;
      }
      case 'titanHit':
        this.hunterHp = e.hits;
        this.renderHp(true);
        s.avatars.get(e.id)?.hitFlash();
        if (e.by === s.myId) {
          s.hitMarker();
          s.feed(`🎯 거인 명중! (${e.hits}/${e.max})`, 'good');
        } else if (e.id === s.myId) {
          s.flash('hit');
          s.centerMsg(`총에 맞았다! 체력 ${e.max - e.hits}/${e.max}`, 1.5);
        } else s.feed(`🎯 ${e.byName}이(가) 거인을 맞혔다 (${e.hits}/${e.max})`, 'good');
        break;
      case 'titanGrab':
        s.avatars.get(e.id)?.playSwing();
        break;
      default:
        break;
    }
  }

  renderHp(flash = false) {
    const left = Math.max(0, this.hunterMax - this.hunterHp);
    $('titan-hp-fill').style.transform = `scaleX(${left / this.hunterMax})`;
    $('titan-hp-text').textContent = `${left}/${this.hunterMax}`;
    if (flash) {
      const el = $('titan-hp');
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }

  renderGun() {
    const isSurvivor = this.s.role !== 'hunter';
    $('titan-gun').classList.toggle('hidden', !isSurvivor || !this.hasGun);
    $('btn-tgun')?.classList.toggle('hidden', !isSurvivor || !this.hasGun);
  }

  update() {
    const s = this.s;
    for (const [id, w] of this.wires) {
      let from;
      let yaw;
      if (id === s.myId) {
        from = new THREE.Vector3(s.pos.x, s.y + 1.0, s.pos.z);
        yaw = s.yaw;
      } else {
        const a = s.avatars.get(id);
        if (!a || !a.group.visible) {
          w.line.visible = false;
          continue;
        }
        from = new THREE.Vector3(a.group.position.x, a.group.position.y + 1.0, a.group.position.z);
        yaw = a.yaw;
      }
      w.line.visible = true;
      setWire(w.line, from, yaw, w.to);
    }
    const t = performance.now() / 1000;
    for (const m of this.guns.values()) {
      m.userData.rifle.rotation.y = t * 1.6;
      m.userData.rifle.position.y = 0.6 + Math.sin(t * 2.2) * 0.12;
    }
  }

  /**
   * 승리 장면 (약 7초). 생존자 승리: 거인이 뒤로 쓰러지고 생존자들이 몸 위에서 밟는다.
   * 술래 승리: 거인이 생존자들을 한 손에 모아 입에 털어 넣는다. 반환: 장면 길이(ms)
   */
  playEnding(msg) {
    const s = this.s;
    s.cinematic = true;
    s.controls.enabled = false;
    s.controls.releaseAll();
    if (document.pointerLockElement) document.exitPointerLock?.();
    $('screen-game').classList.add('cinematic');
    for (const w of this.wires.values()) w.line.visible = false;
    for (const id of [...this.wires.keys()]) this.dropWire(id);
    const survivorsWin = msg.winner === 'survivors';
    const hunterEntry = msg.players.find((p) => p.role === 'hunter');
    // 거인: 내가 술래면 장면용 아바타를 새로 만든다
    let giant = hunterEntry && s.avatars.get(hunterEntry.id);
    const temps = [];
    if (hunterEntry && !giant) {
      giant = makeGiant(new Avatar('hunter', 0, hunterEntry.name, false, hunterEntry.cls));
      s.scene.add(giant.group);
      temps.push(giant);
    }
    const gx = hunterEntry?.x ?? s.pos.x;
    const gz = hunterEntry?.z ?? s.pos.z;
    if (giant) {
      giant.setTarget(gx, gz, giant.yaw || 0, true);
      giant.group.visible = true;
      giant.group.position.set(gx, 0, gz);
      giant.group.rotation.order = 'YXZ'; // 바라보는 방향(yaw) 기준으로 뒤로 쓰러지게
      giant.group.rotation.set(0, giant.yaw || 0, 0);
      giant.body.position.y = 0;
      giant.body.rotation.set(0, 0, 0);
      giant.setGhost(1);
      giant.setReveal?.(false);
    }
    const yaw = giant?.yaw ?? 0;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    // 장면에 나올 생존자: 모든 생존자 (나도 포함)
    const crowd = [];
    let idx = 0;
    for (const p of msg.players) {
      if (p.role === 'hunter') continue;
      let a = s.avatars.get(p.id);
      if (!a) {
        const info = s.info.get(p.id);
        a = new Avatar('survivor', info?.index ?? idx, p.name, false, p.scls);
        addOdmGear(a);
        s.scene.add(a.group);
        temps.push(a);
      }
      a.group.visible = survivorsWin ? p.status === 'alive' : true;
      a.stunned = false;
      a.carried = false;
      a.thrown = false;
      a.cinema = true;
      crowd.push({ a, i: idx++ });
    }
    const duration = 7000;
    const t0 = performance.now();
    const cam = s.camera;
    const look = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    // 술래 승리: 얼굴 앞에 크게 벌어지는 입
    let mouthMesh = null;
    let headR = 1.6;
    if (!survivorsWin && giant) {
      giant.group.updateMatrixWorld(true);
      const hb = new THREE.Box3().setFromObject(giant.head);
      const hs = hb.getSize(new THREE.Vector3());
      headR = Math.max(0.8, Math.min(hs.x, hs.z, hs.y) / 2);
      mouthMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: '#1a0505', side: THREE.DoubleSide }));
      mouthMesh.scale.set(0.01, 0.01, 1);
      s.scene.add(mouthMesh);
      temps.push({ group: mouthMesh, dispose: () => mouthMesh.geometry.dispose() });
    }
    let bodyTop = null;
    s.cinemaUpdate = () => {
      const t = (performance.now() - t0) / 1000;
      if (survivorsWin) {
        // 거인이 뒤로 쓰러진다 (1.6초), 몸 위에서 생존자들이 쿵쿵 밟는다
        const fall = Math.min(1, t / 1.6);
        const k = fall * fall;
        if (giant) {
          giant.group.rotation.x = k * (Math.PI / 2) * 0.98;
          giant.group.position.y = 0;
          if (fall >= 1 && bodyTop === null) {
            // 누운 몸통 윗면 높이: 몸통 두께는 머리 크기와 비슷하다
            giant.group.updateMatrixWorld(true);
            const hb = new THREE.Box3().setFromObject(giant.head);
            bodyTop = Math.max(1.5, Math.min(5, hb.max.y - hb.min.y));
          }
          giant.armL.rotation.set(0, 0, -1.1 * k); // 팔을 양옆으로 벌리고 큰 대자로
          giant.armR.rotation.set(0, 0, 1.1 * k);
          for (const g of giant.glowEyes) g.mesh.material.color.set(t > 1.8 ? '#222' : g.on);
        }
        if (t > 1.6 && s.shakeOnce !== 1) {
          s.shakeOnce = 1;
          s.shake = 1.2;
        }
        const n = Math.max(1, crowd.length);
        crowd.forEach(({ a, i }) => {
          // 거인 몸통(가슴~배) 위에 줄지어 선다: 쓰러지면 몸이 +뒤쪽(-fwd)으로 눕는다
          const along = TITAN.HEIGHT * (0.55 + (0.25 * i) / n); // 배~가슴 위
          const side = ((i % 3) - 1) * 2.2;
          const bx = gx - fwd.x * along + right.x * side;
          const bz = gz - fwd.z * along + right.z * side;
          const phase = t * 5 + i * 1.3;
          const hop = t > 1.8 ? Math.abs(Math.sin(phase)) * 1.4 : 0;
          const top = t > 1.8 ? bodyTop ?? 2.6 : 0;
          a.setTarget(bx, bz, yaw + Math.PI, true);
          a.pos.y = top + hop;
          a.group.position.set(bx, top + hop, bz);
          a.group.rotation.set(0, yaw + Math.PI, 0);
          // 밟기: 한 발을 들어 쿵
          a.legR.rotation.x = t > 1.8 ? Math.max(0, Math.sin(phase)) * 1.1 : 0;
          a.kneeR.rotation.x = t > 1.8 ? -Math.max(0, Math.sin(phase)) * 1.2 : 0;
          a.armL.rotation.set(t > 1.8 ? -2.6 : 0, 0, -0.2);
          a.armR.rotation.set(t > 1.8 ? -2.6 + Math.sin(phase) * 0.3 : 0, 0, 0.2);
          if (t > 1.8 && Math.sin(phase) < -0.98 && Math.random() < 0.3) s.shake = Math.max(s.shake, 0.15);
        });
        // 카메라: 옆에서 천천히 돌며 내려다본다
        const ang = yaw + Math.PI / 2 + t * 0.18;
        const cx = gx - fwd.x * TITAN.HEIGHT * 0.55;
        const cz = gz - fwd.z * TITAN.HEIGHT * 0.55;
        cam.position.set(cx + Math.cos(ang) * 24, 27 + Math.sin(t * 0.4) * 2, cz + Math.sin(ang) * 24); // 집 지붕보다 높이
        look.set(cx, 3, cz);
      } else {
        // 술래 승리: 오른손에 생존자를 모아 입으로 털어 넣는다
        const lift = Math.min(1, t / 1.5);
        if (giant) {
          giant.group.rotation.x = 0;
          // 오른손을 얼굴 앞으로 들어 올림
          giant.armR.rotation.set(-2.05 * lift, 0, -0.55 * lift);
          giant.elbowR.rotation.x = 0.9 * lift;
          giant.armL.rotation.set(-0.3 * lift, 0, -0.2);
        }
        const head = new THREE.Vector3();
        if (giant) {
          giant.group.updateMatrixWorld(true);
          new THREE.Box3().setFromObject(giant.head).getCenter(head); // 머리 가운데 (뿔·머리카락 포함)
        } else head.set(gx, TITAN.HEIGHT - 2, gz);
        // 입: 얼굴 앞, 머리 가운데보다 조금 아래. 2초부터 크게 벌어진다
        const mouth = head.clone().addScaledVector(fwd, headR * 1.02).addScaledVector(up, -headR * 0.35);
        if (mouthMesh) {
          const open = Math.min(1, Math.max(0, (t - 1.2) / 0.6));
          mouthMesh.position.copy(mouth);
          mouthMesh.lookAt(mouth.clone().add(fwd));
          mouthMesh.scale.set(headR * 0.45 * open + 0.01, headR * (0.15 + 0.4 * open * (0.85 + Math.sin(t * 9) * 0.15)), 1);
        }
        // 생존자들은 거인 손바닥 위에 모여 있다가 한 명씩 입으로 떨어진다
        const hand = mouth.clone().addScaledVector(fwd, headR * 1.3).addScaledVector(up, headR * 1.4);
        crowd.forEach(({ a, i }) => {
          const tStart = 2 + i * 0.55; // 한 명씩 차례로
          let p;
          if (t < tStart) {
            p = hand.clone().addScaledVector(right, ((i % 3) - 1) * 0.7).addScaledVector(up, Math.floor(i / 3) * 0.6);
          } else {
            const k = Math.min(1, (t - tStart) / 0.7);
            const arc = Math.sin(k * Math.PI) * 2.5;
            p = hand.clone().lerp(mouth, k);
            p.y += arc;
            if (k >= 1) a.group.visible = false;
          }
          a.group.position.copy(p);
          a.group.rotation.set(Math.sin(t * 9 + i) * 0.4, 0, Math.PI / 2 + Math.sin(t * 7 + i) * 0.3);
          a.legL.rotation.x = Math.sin(t * 12 + i) * 0.7; // 버둥거림
          a.legR.rotation.x = -Math.sin(t * 12 + i) * 0.7;
          a.armL.rotation.x = -2 + Math.sin(t * 10 + i) * 0.5;
          a.armR.rotation.x = -2 - Math.sin(t * 10 + i) * 0.5;
        });
        // 카메라: 거인 얼굴 앞, 살짝 옆에서 입과 손을 본다
        const camD = 9 + headR * 3;
        cam.position.copy(head).addScaledVector(fwd, camD).addScaledVector(right, camD * 0.35).addScaledVector(up, -headR * 0.3);
        look.copy(mouth).addScaledVector(up, headR * 0.5);
      }
      if (s.shake > 0) {
        s.shake -= 1 / 60;
        cam.position.x += (Math.random() - 0.5) * s.shake * 0.6;
        cam.position.y += (Math.random() - 0.5) * s.shake * 0.6;
      }
      cam.lookAt(look);
      if (cam.fov !== 60) {
        cam.fov = 60;
        cam.updateProjectionMatrix();
      }
      s.sky.position.copy(cam.position);
    };
    s.centerMsg(survivorsWin ? '🏁 거인이 쓰러졌다! 생존자 승리' : msg.reason === 'titanTimeUp' ? '⏰ 시간 종료 · 거인 승리' : '👹 거인이 모두 먹어 치웠다 · 술래 승리', 4);
    this.endingTemps = temps;
    return duration;
  }

  dispose() {
    for (const id of [...this.wires.keys()]) this.dropWire(id);
    for (const id of [...this.guns.keys()]) this.removeGun(id);
    for (const a of this.endingTemps || []) {
      this.scene.remove(a.group);
      a.dispose();
    }
    $('titan-hud').classList.add('hidden');
    $('btn-tgun')?.classList.add('hidden');
    $('screen-game').classList.remove('cinematic', 'mode-titan');
  }
}

