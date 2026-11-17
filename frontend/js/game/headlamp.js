// 폐광산 헤드램프: 실제 손전등처럼 보이도록 빛의 디테일을 더한다.
// - 렌즈 무늬(쿠키) 텍스처: 차가운 흰색 중심부 + 반사경 고리 + 누런 바깥 번짐 + 렌즈 얼룩
// - 실제 그림자(내 램프), 물리 감쇠(거리 제곱)
// - 고개를 돌리면 빛이 아주 살짝 늦게 따라옴 (머리에 찬 램프의 관성)
// - 다른 플레이어의 헤드램프: 머리의 램프, 정면에서 볼 때 눈부신 렌즈 빛, 공기 중에 보이는 빛줄기,
//   가까운 몇 명은 실제 빛으로 바닥·벽을 비춘다
// - 빛줄기 안의 먼지만 반짝임
import * as THREE from 'three';
import { canvasTexture } from './textures.js';

const MOBILE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

// 램프 수치 (화면 효과만, 게임 판정과 무관)
const LAMP_COLOR = '#fff1dc';
const LAMP_ANGLE = 0.56; // 원뿔 반각 (rad). 쿠키 텍스처가 이 원뿔 전체에 펼쳐진다
const LAMP_PENUMBRA = 0.35;
const MY_INTENSITY = 150;
const MY_DISTANCE = 40;
const OTHER_INTENSITY = 110;
const OTHER_DISTANCE = 30;
const BEAM_LENGTH = 9; // 다른 사람 빛줄기 길이 (m)
const POOL_SIZE = MOBILE ? 2 : 3; // 실제로 빛을 비추는 다른 사람 램프 수 (셰이더 비용 때문에 고정)
const POOL_RANGE = 38; // 이 거리 안의 가장 가까운 사람부터 빛을 준다

/** 헤드램프 렌즈 무늬. 가운데가 가장 밝고 반사경 고리, 바깥 번짐은 누렇고 어둡다 */
export function lampCookie() {
  return canvasTexture(
    'lamp-cookie',
    256,
    256,
    (g, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const R = w / 2;
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      // 바깥 번짐 (따뜻한 색, 어둡게)
      let grd = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      grd.addColorStop(0, 'rgba(255,214,160,0.8)');
      grd.addColorStop(0.55, 'rgba(255,200,140,0.6)');
      grd.addColorStop(0.85, 'rgba(230,160,100,0.22)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      // 중심 핫스팟 (조금 차가운 흰색)
      grd = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.34);
      grd.addColorStop(0, 'rgba(235,242,255,1)');
      grd.addColorStop(0.5, 'rgba(230,236,250,0.75)');
      grd.addColorStop(1, 'rgba(255,240,215,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      // 반사경 고리: 핫스팟 가장자리의 밝은 고리 + 바깥의 희미한 고리
      for (const [r, a, wdt] of [
        [0.3, 0.32, 0.05],
        [0.47, 0.12, 0.035],
        [0.7, 0.07, 0.03],
      ]) {
        const ring = g.createRadialGradient(cx, cy, R * (r - wdt), cx, cy, R * (r + wdt));
        ring.addColorStop(0, 'rgba(255,236,205,0)');
        ring.addColorStop(0.5, `rgba(255,236,205,${a})`);
        ring.addColorStop(1, 'rgba(255,236,205,0)');
        g.fillStyle = ring;
        g.fillRect(0, 0, w, h);
      }
      // 가장자리의 옅은 색 번짐 (렌즈 색수차)
      const fringe = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 0.92);
      fringe.addColorStop(0, 'rgba(120,150,255,0)');
      fringe.addColorStop(0.5, 'rgba(120,150,255,0.05)');
      fringe.addColorStop(1, 'rgba(120,150,255,0)');
      g.fillStyle = fringe;
      g.fillRect(0, 0, w, h);
      // 렌즈 얼룩·흠집: 빛 속에 아주 옅은 어두운 점
      g.globalCompositeOperation = 'source-over';
      let s = 7;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 14; i++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * R * 0.75;
        const rr = 6 + rnd() * 16;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        const sm = g.createRadialGradient(x, y, 0, x, y, rr);
        sm.addColorStop(0, `rgba(0,0,0,${0.06 + rnd() * 0.08})`);
        sm.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = sm;
        g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      }
      // 원 바깥은 완전히 검게 (원뿔 밖으로 새지 않게)
      g.globalCompositeOperation = 'destination-in';
      const mask = g.createRadialGradient(cx, cy, R * 0.88, cx, cy, R);
      mask.addColorStop(0, 'rgba(0,0,0,1)');
      mask.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = mask;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
    },
    { repeat: false },
  );
}

/** 렌즈를 정면에서 볼 때 번지는 눈부신 빛 */
const lensGlow = () =>
  canvasTexture(
    'lamp-glow',
    128,
    128,
    (g, w, h) => {
      const cx = w / 2;
      let grd = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.08, 'rgba(255,250,235,0.95)');
      grd.addColorStop(0.22, 'rgba(255,228,185,0.6)');
      grd.addColorStop(0.55, 'rgba(255,200,140,0.16)');
      grd.addColorStop(1, 'rgba(255,190,120,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      // 가로 빛 번짐 (렌즈 스트릭)
      grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, 'rgba(255,230,200,0)');
      grd.addColorStop(0.5, 'rgba(255,240,220,0.5)');
      grd.addColorStop(1, 'rgba(255,230,200,0)');
      g.fillStyle = grd;
      g.fillRect(0, cx - 1.5, w, 3);
    },
    { repeat: false },
  );

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** 시간에 따라 아주 미세하게 흔들리는 밝기 (전지·접촉 불량 느낌, 눈에 거슬리지 않게) */
function flicker(t, seed) {
  return 1 - 0.025 * (Math.sin(t * 13.1 + seed) * 0.5 + Math.sin(t * 29.7 + seed * 2.3) * 0.3 + Math.sin(t * 3.3 + seed) * 0.2);
}

function makeSpot(intensity, distance) {
  const l = new THREE.SpotLight(LAMP_COLOR, intensity, distance, LAMP_ANGLE, LAMP_PENUMBRA, 2);
  l.map = lampCookie();
  return l;
}

/** 공기 중 먼지에 산란되어 보이는 빛줄기 (꼭짓점이 원점, -z 방향) */
function makeBeamMesh() {
  const r = Math.tan(LAMP_ANGLE * 0.8) * BEAM_LENGTH;
  const geo = new THREE.ConeGeometry(r, BEAM_LENGTH, 28, 1, true);
  geo.translate(0, -BEAM_LENGTH / 2, 0); // 꼭짓점을 원점으로
  geo.rotateX(Math.PI / 2); // 원뿔이 -z로 퍼지게 (꼭짓점은 원점)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.22 }, uLen: { value: BEAM_LENGTH }, uColor: { value: new THREE.Color('#ffe7c4') } },
    vertexShader: /* glsl */ `
      varying float vAxial;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vAxial = -position.z / ${BEAM_LENGTH.toFixed(1)};
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform vec3 uColor;
      varying float vAxial;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        // 원뿔 가장자리(옆으로 보이는 면)는 흐리게, 가운데를 지나가는 시선은 진하게
        float facing = abs(dot(normalize(vN), normalize(vView)));
        float edge = pow(facing, 1.6);
        // 렌즈에서 멀어질수록 빛이 퍼지며 옅어짐, 렌즈 바로 앞도 살짝 흐리게
        float along = pow(1.0 - clamp(vAxial, 0.0, 1.0), 2.2) * smoothstep(0.0, 0.06, vAxial);
        // 멀리 있는 빛줄기는 안개 속으로
        float dist = length(vView);
        float fog = 1.0 - smoothstep(18.0, 55.0, dist);
        float a = uOpacity * edge * along * fog;
        gl_FragColor = vec4(uColor, a); // 가산 혼합 (SRC_ALPHA, ONE)
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; // 원뿔이 화면 밖에서 들어올 때 깜빡이지 않게
  m.renderOrder = 5;
  return m;
}

/**
 * 갱도 헤드램프 전체를 관리한다.
 *  - 내 램프: 카메라를 따라가며 실제 그림자를 드리운다
 *  - 다른 사람 램프: 아바타 머리에 붙는 모델 + 빛줄기 + 렌즈 빛, 가까운 몇 명은 실제 빛
 */
export class Headlamps {
  constructor(scene, renderer) {
    this.scene = scene;
    this.t = 0;
    // 그림자: 내 램프 하나만 (모바일은 작은 그림자 지도)
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const lamp = makeSpot(MY_INTENSITY, MY_DISTANCE);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(MOBILE ? 512 : 1024, MOBILE ? 512 : 1024);
    lamp.shadow.camera.near = 0.2;
    lamp.shadow.camera.far = MY_DISTANCE;
    lamp.shadow.bias = -0.0006;
    lamp.shadow.normalBias = 0.03;
    lamp.shadow.radius = 3;
    scene.add(lamp, lamp.target);
    this.mine = lamp;
    this.myQuat = null; // 램프가 바라보는 방향 (카메라를 살짝 늦게 따라감)

    // 다른 사람 램프 중 실제로 빛을 비추는 것 (수가 바뀌면 셰이더를 다시 만들어야 해서 고정)
    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const l = makeSpot(0, OTHER_DISTANCE);
      l.visible = true;
      scene.add(l, l.target);
      this.pool.push(l);
    }
    this.lamps = new Map(); // avatar → { rig, beam, glow, glowMat, seed }
  }

  /** 아바타 머리에 헤드램프를 단다 (이마의 램프 몸체 + 렌즈 + 빛줄기 + 렌즈 빛) */
  attach(avatar) {
    if (this.lamps.has(avatar)) return;
    const rig = new THREE.Group();
    rig.position.set(0, 0.15, -0.1); // 이마 앞
    const strap = new THREE.Mesh(
      new THREE.TorusGeometry(0.104, 0.012, 6, 20),
      new THREE.MeshLambertMaterial({ color: '#2b2622' }),
    );
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(0.95, 1.05, 1);
    strap.position.set(0, -0.03, 0.1);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.045), new THREE.MeshLambertMaterial({ color: '#3a3632' }));
    body.position.z = -0.005;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 16), new THREE.MeshBasicMaterial({ color: '#fffaf0' }));
    lens.position.z = -0.0285;
    lens.rotation.y = Math.PI;
    const beam = makeBeamMesh();
    beam.position.z = -0.03;
    const glowMat = new THREE.SpriteMaterial({
      map: lensGlow(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
      fog: false,
      toneMapped: false, // 눈부신 빛은 톤 매핑으로 눌리지 않게
    });
    const glow = new THREE.Sprite(glowMat);
    glow.position.z = -0.04;
    glow.renderOrder = 6;
    rig.add(strap, body, lens, beam, glow);
    // 머리 크기 비율을 그대로 쓰되 빛줄기 길이는 몸 크기와 상관없게
    avatar.head.add(rig);
    const sc = avatar.body.scale.x || 1;
    beam.scale.setScalar(1 / sc);
    this.lamps.set(avatar, { rig, beam, glow, glowMat, seed: Math.random() * 100 });
  }

  detach(avatar) {
    const l = this.lamps.get(avatar);
    if (!l) return;
    l.rig.removeFromParent();
    l.rig.traverse((o) => {
      o.geometry?.dispose();
      if (o.material && o.material !== l.glowMat) o.material.dispose();
    });
    l.glowMat.dispose();
    this.lamps.delete(avatar);
  }

  /**
   * 매 프레임: 내 램프를 카메라에 맞추고, 다른 사람 램프의 방향·빛·눈부심을 갱신.
   * collision: 앞의 벽·바닥까지 거리를 재서 가까운 벽을 비출 때 눈이 적응한 것처럼 밝기를 낮춘다
   */
  update(dt, camera, collision) {
    this.t += dt;
    const t = this.t;

    // ── 내 램프: 이마 높이 (손에 든 무기는 원뿔 밖), 방향은 살짝 늦게 따라감
    camera.updateMatrixWorld();
    const lamp = this.mine;
    lamp.position.set(0.05, 0.1, 0.15).applyMatrix4(camera.matrixWorld);
    _q.copy(camera.quaternion);
    if (!this.myQuat) this.myQuat = _q.clone();
    else this.myQuat.slerp(_q, 1 - Math.exp(-dt * 22));
    // 램프는 시선보다 아주 조금 아래를 향함
    _v.set(0, -0.06, -1).normalize().applyQuaternion(this.myQuat);
    lamp.target.position.copy(lamp.position).addScaledVector(_v, 6);
    lamp.target.updateMatrixWorld();
    // 눈 적응: 바로 앞 벽·바닥이 가까우면 하얗게 타지 않도록 (거리 제곱에 맞춰) 밝기를 줄인다
    const near = nearSurface(camera.position, _v, collision);
    const want = Math.max(0.18, Math.min(1, (near / 2.4) ** 2));
    this.adapt = this.adapt == null ? want : this.adapt + (want - this.adapt) * Math.min(1, dt * 5);
    lamp.intensity = MY_INTENSITY * this.adapt * flicker(t, 0);

    // ── 다른 사람 램프
    const camPos = camera.position;
    const cand = [];
    for (const [avatar, l] of this.lamps) {
      const shown = isShown(avatar.group);
      l.rig.visible = shown;
      if (!shown) continue;
      // 머리는 시선의 60%만 숙이므로, 램프가 나머지를 채워 실제 시선 방향을 비춘다
      const want = (avatar.pitch || 0) - avatar.head.rotation.x - avatar.body.rotation.x;
      l.rig.rotation.x += (want - l.rig.rotation.x) * Math.min(1, dt * 12);
      l.rig.updateMatrixWorld(true);
      l.rig.getWorldPosition(_v);
      _q.setFromRotationMatrix(l.rig.matrixWorld);
      _v2.set(0, 0, -1).applyQuaternion(_q); // 램프가 비추는 방향
      // 렌즈 빛: 램프가 나를 향할수록 크고 밝게 (정면이면 눈부심)
      const toCam = camPos.clone().sub(_v);
      const dist = toCam.length();
      toCam.divideScalar(dist || 1);
      const facing = Math.max(0, _v2.dot(toCam));
      const glare = Math.pow(facing, 6);
      const fogFade = 1 - smooth(25, 60, dist);
      l.glowMat.opacity = Math.min(1, (0.25 + glare * 1.1) * fogFade) * flicker(t, l.seed);
      const size = (0.12 + glare * 1.4) * Math.min(2.2, 0.6 + dist * 0.08);
      l.glow.scale.setScalar(size / (avatar.body.scale.x || 1));
      // 빛줄기: 정면에서 보면 원뿔이 겹쳐 너무 진해지므로 살짝 줄인다
      l.beam.material.uniforms.uOpacity.value = (0.34 - glare * 0.14) * flicker(t, l.seed);
      cand.push({ avatar, l, dist, pos: _v.clone(), dir: _v2.clone() });
    }

    // 가까운 사람부터 실제 빛을 준다
    cand.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < this.pool.length; i++) {
      const spot = this.pool[i];
      const c = cand[i];
      if (!c || c.dist > POOL_RANGE) {
        spot.intensity = 0;
        continue;
      }
      // 멀어질 때 갑자기 꺼지지 않게 경계 근처에서 서서히
      const fade = 1 - smooth(POOL_RANGE - 8, POOL_RANGE, c.dist);
      spot.position.copy(c.pos).addScaledVector(c.dir, 0.05);
      spot.target.position.copy(c.pos).addScaledVector(c.dir, 6);
      spot.target.updateMatrixWorld();
      spot.intensity = OTHER_INTENSITY * fade * flicker(t, c.l.seed);
    }
  }

  dispose() {
    for (const a of [...this.lamps.keys()]) this.detach(a);
    this.scene.remove(this.mine, this.mine.target);
    this.mine.shadow.map?.dispose();
    for (const l of this.pool) this.scene.remove(l, l.target);
  }
}

/** 눈 위치에서 방향 dir로 처음 닿는 벽·건물·바닥까지 거리 (최대 6m) */
function nearSurface(eye, dir, collision) {
  let best = 6;
  if (dir.y < -0.02) best = Math.min(best, eye.y / -dir.y); // 바닥
  const h = Math.hypot(dir.x, dir.z);
  if (collision && h > 0.05) {
    const dx = dir.x / h;
    const dz = dir.z / h;
    const dh = collision.rayDistance(eye.x, eye.z, dx, dz, best * h);
    if (dh < Infinity) {
      const d = dh / h;
      // 낮은 담장 위로 지나가는 빛은 무시
      if (collision.pointBlocked(eye.x + dx * (dh + 0.05), eye.y + dir.y * d, eye.z + dz * (dh + 0.05))) best = Math.min(best, d);
    }
  }
  return best;
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function isShown(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return !!o.parent;
}

/** 갱도의 물체가 내 램프의 그림자를 드리우고 받게 한다 (빛나는 것·투명한 것은 제외) */
export function enableShadows(root) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.overlay) return;
    const m = o.material;
    if (!m || m.isMeshBasicMaterial || m.isShaderMaterial || m.transparent) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

/** 빛줄기 안에 들어온 먼지만 밝게 반짝이도록 PointsMaterial을 고친다 */
export function litDustMaterial(material, lamp) {
  const uniforms = {
    uLampPos: { value: lamp.position.clone() },
    uLampDir: { value: new THREE.Vector3(0, 0, -1) },
    uCosOuter: { value: Math.cos(LAMP_ANGLE) },
    uCosInner: { value: Math.cos(LAMP_ANGLE * 0.35) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDustWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDustWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vDustWorld;\nuniform vec3 uLampPos;\nuniform vec3 uLampDir;\nuniform float uCosOuter;\nuniform float uCosInner;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 dl = vDustWorld - uLampPos;
        float dd = length(dl);
        float cone = smoothstep(uCosOuter, uCosInner, dot(dl / max(dd, 1e-3), uLampDir));
        float lit = cone / (1.0 + dd * dd * 0.04);
        diffuseColor.rgb *= 0.35 + lit * 3.2;
        diffuseColor.a *= 0.18 + lit * 1.1;`,
      );
  };
  material.customProgramCacheKey = () => 'lit-dust';
  return {
    update(lampObj) {
      uniforms.uLampPos.value.copy(lampObj.position);
      uniforms.uLampDir.value.copy(lampObj.target.position).sub(lampObj.position).normalize();
    },
  };
}
