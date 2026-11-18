// 고품질 그래픽 (WebGPU 렌더러)
// 장면을 한 번 그리면서 색·확산색·노멀(+반사 세기)·속도를 함께 기록(MRT)하고,
//   SSGI: 화면에 보이는 빛이 주변 벽·바닥으로 번지는 간접광 + 구석·틈의 그늘(AO)
//   SSR : 모든 표면의 반사 (재질마다 세기·흐림이 다름, reflect.js)
//   TRAA: 여러 프레임을 겹쳐 계단 현상과 노이즈를 지움
// 깊은 굴곡이 있는 재질(돌담·블록·기와·암반)은 시차 차폐 매핑으로 굴곡이 실제 깊이처럼 보인다.
// 순서로 합성한다. 프레임이 낮으면 해상도와 효과 단계를 스스로 낮춘다.
// 공정성: 고품질이 어둠 속을 더 잘(또는 덜) 보이게 하면 안 되므로, 그늘로 줄어든 화면 평균 밝기를
// 맵별 보정값(comp)으로 되돌려 보통 화질과 같게 맞춘다.
import * as THREE from 'three';
import { REFLECT, reflectKind } from './reflect.js';

const FPS_LOW = 40; // 이보다 느리면 효과 단계를 한 단계 낮춘다
const WARMUP = 4; // 시작·단계 변경 뒤 셰이더를 준비하는 동안은 재지 않음 (초)
const WINDOW = 3; // 이 시간 동안의 평균 프레임으로 판단 (초)

// 맵별 효과 세기: radius(m)·gi(간접광)·ao(그늘을 얼마나 적용할지 0~1).
// 보통 화질과 화면 전체 밝기가 비슷하도록 맞춘 값 (고품질이 더 밝거나 어두우면 불공평)
const HQ_PRESET = {
  village: { radius: 1, gi: 6, ao: 0.85, comp: 1.1 },
  mine: { radius: 1, gi: 6, ao: 0.85, comp: 1.28 },
  backrooms: { radius: 1, gi: 6, ao: 0.85, comp: 1.17 },
};

export class HQRenderer {
  /**
   * @param {*} mods gfx.js의 preloadHQ()로 불러온 모듈
   * @param {{ theme: string, onDowngrade?: (level:number, fps:number) => void, onFail?: (why:string) => void }} opts
   *   onFail: WebGPU를 시작하지 못했거나 게임 중에 GPU 장치가 끊겼을 때
   */
  constructor(mods, { theme = 'village', onDowngrade, onFail } = {}) {
    this.mods = mods;
    this.theme = theme;
    this.onDowngrade = onDowngrade;
    this.onFail = onFail;
    this.disposed = false;
    const renderer = new mods.WG.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
    // 효과 비용이 픽셀 수에 비례하므로 휴대폰은 1배, PC는 최대 1.5배로 그리고 계단 현상은 TRAA가 지운다
    const mobile = window.matchMedia?.('(pointer: coarse)').matches;
    renderer.setPixelRatio(mobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer = renderer;
    // GPU 장치가 끊기면 (드라이버 재시작 등) 알린다. 정리하려고 직접 닫은 경우는 제외
    const defaultLost = renderer.onDeviceLost;
    renderer.onDeviceLost = (info) => {
      defaultLost.call(renderer, info);
      if (!this.disposed && info?.reason !== 'destroyed') this.onFail?.('lost');
    };
    this.ready = false;
    this.level = 2; // 2: 간접광+반사+TRAA, 1: 간접광(가볍게)+TRAA, 0: 효과 없음
    this.perf = { warm: 0, frames: 0, time: 0 };
  }

  /** 장면과 카메라가 준비되면 후처리를 만든다 */
  setup(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    const { WG, TSL, ssgi, ssr, traa } = this.mods;
    const { pass, mrt, output, normalView, diffuseColor, velocity, float, vec4, packNormalToRGB, unpackRGBToNormal, sample, select, isBackgroundDepth, mix, uniform, luminance, max } = TSL;

    // 재질의 반사 세기: 정면은 base, 스치듯 볼수록 edge (프레넬). 아주 약하면 0으로 (반사 계산을 건너뜀)
    const { dot, pow, positionView } = TSL;
    const grazing = pow(dot(normalView, positionView.negate().normalize()).clamp(0, 1).oneMinus(), 4);
    this.reflectivity = (p) => {
      const r = mix(float(p.base), float(p.edge), grazing);
      return select(r.lessThan(0.015), float(0), r);
    };

    // WebGPU는 한 번에 쓰는 렌더 타깃이 픽셀당 32바이트로 제한된다 (rgba16f·rgba8 모두 8바이트로 계산).
    // 그래서 출력은 4개만: 반사 세기는 노멀 버퍼의 알파, 반사 흐림은 확산색 버퍼의 알파에 넣는다
    const scenePass = pass(scene, camera);
    // 속도 버퍼의 b 채널: 반투명 효과(빛 번짐·이름표·빛줄기)가 그 픽셀에 보탠 밝기 (아래 clearMRT)
    scenePass.setMRT(
      mrt({
        output,
        diffuseColor: vec4(diffuseColor.rgb, REFLECT.default.rough),
        normal: vec4(packNormalToRGB(normalView), this.reflectivity(REFLECT.default)),
        velocity: vec4(velocity.xy, 0, 0),
      }),
    );
    // 메모리 대역폭 절약: 색이 아닌 정보는 8비트로
    for (const name of ['diffuseColor', 'normal']) scenePass.getTexture(name).type = THREE.UnsignedByteType;

    const color = scenePass.getTextureNode('output');
    const diffuse = scenePass.getTextureNode('diffuseColor');
    const depth = scenePass.getTextureNode('depth');
    const normalTex = scenePass.getTextureNode('normal');
    const vel = scenePass.getTextureNode('velocity');
    const sceneNormal = sample((uv) => unpackRGBToNormal(normalTex.sample(uv)));

    // 간접광 + 구석 그늘. 사람 키에 맞춘 반경 (크면 낮은 갱도 천장·벽 때문에 화면 전체가 어두워진다)
    const preset = HQ_PRESET[this.theme] ?? HQ_PRESET.village;
    const gi = ssgi(color, depth, sceneNormal, camera);
    gi.sliceCount.value = 2;
    gi.stepCount.value = 8;
    gi.radius.value = preset.radius;
    // 반경을 화면 픽셀이 아닌 실제 거리(m)로: 화면 기준이면 먼 벽의 그늘이 바닥으로 몇 m씩 길게 뻗는다
    gi.useScreenSpaceSampling.value = false;
    gi.thickness.value = 0.5;
    gi.aoIntensity.value = 1;
    gi.giIntensity.value = preset.gi;
    this.gi = gi;
    // 그늘은 벽·바닥에만: 그 위에 겹친 반투명 효과(빛 번짐 등)가 차지하는 밝기만큼은 그늘을 빼고,
    // 강도도 일부만 적용 (직접 비추는 빛까지 다 가리면 실제보다 어둡다)
    this.aoStrength = uniform(preset.ao);
    const overlay = vel.b.div(max(luminance(color.rgb), 1e-4)).clamp(0, 1);
    const ao = mix(float(1), gi.getAONode().r, this.aoStrength.mul(overlay.oneMinus()));
    const giColor = gi.getGINode().rgb;
    // 그늘로 줄어든 평균 밝기를 되돌리는 보정 (맵별로 측정해 맞춤)
    this.exposure = uniform(preset.comp);
    // 하늘처럼 깊이가 없는 배경은 원래 색 그대로 (간접광 버퍼가 흰색으로 비워져 있음)
    const lit = color.rgb.mul(ao).add(diffuse.rgb.mul(giColor)).mul(this.exposure);
    const composite = vec4(select(isBackgroundDepth(depth.r), color.rgb, lit), color.a);

    // 반사: 세기는 노멀 알파, 흐림은 확산색 알파 (재질마다 다름). 세기가 0인 곳은 바로 건너뛴다
    const refl = ssr(color, depth, sceneNormal, { metalnessNode: normalTex.a, roughnessNode: diffuse.a });
    refl.maxDistance.value = 24;
    refl.thickness.value = 0.35;
    refl.quality.value = 0.4;
    const withRefl = vec4(composite.rgb.add(refl.rgb), composite.a);

    this.nodes = { color, diffuse, depth, ao, giColor, composite, refl }; // 시험·조정용
    this.outputs = {
      2: traa(withRefl, depth, vel, camera),
      1: traa(composite, depth, vel, camera),
    };
    const pipeline = new WG.RenderPipeline(this.renderer);
    pipeline.outputNode = this.outputs[2];
    this.pipeline = pipeline;

    // 반투명한 것(이름표·빛줄기·먼지·번쩍임)은 색만 더하고, 간접광·반사·TRAA가 쓰는 정보는 건드리지 않는다.
    // 대신 자기가 보탠 밝기를 속도 버퍼 b 채널에 더해 둔다 (합성할 때 그만큼 그늘을 빼려고)
    const blend = (src, dst) => {
      const b = new WG.BlendMode(THREE.CustomBlending);
      b.blendSrc = b.blendSrcAlpha = src;
      b.blendDst = b.blendDstAlpha = dst;
      return b;
    };
    const keep = blend(THREE.ZeroFactor, THREE.OneFactor);
    const add = blend(THREE.OneFactor, THREE.OneFactor);
    const zero = vec4(0);
    this.clearMRT = mrt({ diffuseColor: zero, normal: zero, velocity: vec4(0, 0, luminance(output.rgb).mul(output.a), 0) });
    this.clearMRT.setBlendMode('diffuseColor', keep);
    this.clearMRT.setBlendMode('normal', keep);
    this.clearMRT.setBlendMode('velocity', add);
    this.reflectMRTs = new Map(); // 반사 종류별 MRT (재질끼리 공유)

    this.renderer
      .init()
      .then(() => {
        const r = this.renderer;
        // 간접광은 rg11b10 렌더 타깃이 필요 (거의 모든 데스크톱 GPU가 지원)
        if (r.backend.isWebGPUBackend && !r.hasFeature('rg11b10ufloat-renderable')) this.level = 0;
        console.info(`[gfx] 고품질: ${r.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2'} 단계 ${this.level}`);
        this.ready = true;
      })
      .catch((e) => {
        console.error('[gfx] WebGPU 렌더러를 시작하지 못했어요', e);
        this.onFail?.('init');
      });
  }

  /** 매 프레임. rawDt: 실제 경과 시간(초, 자르지 않은 값) */
  render(rawDt) {
    if (!this.ready) return;
    this.syncMaterials();
    if (this.level === 0) this.renderer.render(this.scene, this.camera);
    else this.pipeline.render();
    this.watchPerf(rawDt);
  }

  /** 새로 생기거나 반투명 여부가 바뀐 재질에 맞는 MRT 출력을 붙인다 */
  syncMaterials() {
    this.scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) for (const x of m) this.syncMaterial(x);
      else this.syncMaterial(m);
    });
  }

  syncMaterial(m) {
    // 효과를 끈 단계 0은 MRT 없이 그리므로 재질에도 MRT 출력을 붙이지 않는다 (시차 매핑도 끔)
    const kind = reflectKind(m);
    const pom = this.level > 0 && !m.transparent && m.userData.parallax > 0 && !!m.map?.userData?.heightMap;
    const base = this.level === 0 ? 'none' : m.transparent ? 'clear' : m.userData.reflectMask ? `mask:${kind}` : kind;
    const want = pom ? `${base}+pom` : base;
    if (m.userData.hqMrt === want) return;
    m.userData.hqMrt = want;
    m.mrtNode = base === 'none' ? null : base === 'clear' ? this.clearMRT : this.reflectMRT(kind, m);
    if (pom) this.applyParallax(m);
    else if (m.userData.hqPom) {
      m.colorNode = null;
      m.normalNode = null;
      m.userData.hqPom = false;
    }
    // WebGPU 렌더러는 일반 재질의 셰이더 캐시 키를 재질 종류·속성 유무로만 만들어서,
    // 여기서 붙인 노드(반사 MRT·시차 매핑)가 달라도 같은 종류 재질끼리 먼저 컴파일된 셰이더를 함께 쓴다.
    // 그래서 붙인 노드에 맞는 키를 준다: 고정 질감을 쓰는 시차 매핑·마스크 재질은 재질마다 따로
    const key = `hq:${want}:${pom || m.userData.reflectMask ? m.uuid : ''}`;
    m.customProgramCacheKey = () => key;
    m.needsUpdate = true;
  }

  /**
   * 시차 차폐 매핑(POM): 높이 지도를 따라 시선을 12단계로 들어가 표면에 닿는 곳을 찾고,
   * 직전 단계와 보간해 계단 현상을 없앤다. 색·노멀 질감을 모두 그 자리에서 읽어 굴곡이 실제 깊이처럼 보인다.
   * 탄젠트 없이 화면 미분으로 접선 공간을 만든다 (노멀 맵을 적용하기 전의 면 노멀 기준).
   */
  applyParallax(m) {
    const { TSL } = this.mods;
    const { Fn, texture, uv, float, vec2, vec3, positionView, positionViewDirection, normalViewGeometry, Loop, If, Break, mix, max, select, normalMap } = TSL;
    const map = m.map;
    const heightTex = map.userData.heightMap;
    const normalTex = m.normalMap ?? map.userData.normalMap;
    const depth = m.userData.parallax;
    const STEPS = 12;
    const pomUV = Fn(() => {
      const uv0 = uv();
      const V = positionViewDirection;
      const Ng = normalViewGeometry;
      const N = select(Ng.dot(V).lessThan(0), Ng.negate(), Ng); // 뒷면에서 볼 때도 바깥쪽으로
      const q0 = positionView.dFdx();
      const q1 = positionView.dFdy();
      const st0 = uv0.dFdx();
      const st1 = uv0.dFdy();
      const q1perp = q1.cross(N);
      const q0perp = N.cross(q0);
      const T = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
      const B = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
      const inv = max(T.dot(T), B.dot(B)).max(1e-12).inverseSqrt();
      const Vt = vec3(V.dot(T.mul(inv)), V.dot(B.mul(inv)), V.dot(N)).toVar();
      // 한 단계에 움직일 UV (비스듬할수록 멀리, 너무 비스듬하면 제한)
      const shift = Vt.xy.div(max(Vt.z, 0.3)).mul(depth / STEPS).toVar();
      // 반복문 안에서는 밉맵 선택용 미분을 미리 구한 값으로 (WGSL 제약)
      const depthAt = (p) => float(1).sub(texture(heightTex, p).grad(st0, st1).r);
      const cur = uv0.toVar();
      const d = depthAt(cur).toVar();
      const layer = float(0).toVar();
      Loop(STEPS, () => {
        If(layer.greaterThanEqual(d), () => {
          Break();
        });
        cur.subAssign(shift);
        layer.addAssign(1 / STEPS);
        d.assign(depthAt(cur));
      });
      const prev = cur.add(shift);
      const after = d.sub(layer);
      const before = depthAt(prev).sub(layer).add(1 / STEPS);
      const w = after.div(after.sub(before).min(-1e-5)).clamp(0, 1);
      return mix(cur, prev, w);
    })();
    m.colorNode = texture(map, pomUV); // 정점 색은 렌더러가 따로 곱한다
    if (normalTex) m.normalNode = normalMap(texture(normalTex, pomUV), vec2(m.normalScale.x, m.normalScale.y));
    m.userData.hqPom = true;
  }

  /** 재질의 반사 세기(노멀 알파)·흐림(확산색 알파)을 쓰는 MRT. 마스크가 있으면 흰 곳만 다른 종류로 */
  reflectMRT(kind, m) {
    const { mrt, vec4, float, mix, normalView, packNormalToRGB, diffuseColor, texture, uv } = this.mods.TSL;
    const p = REFLECT[kind] ?? REFLECT.default;
    const mask = m.userData.reflectMask;
    if (mask) {
      if (!m.userData.hqMaskMRT) {
        const q = REFLECT[mask.kind] ?? REFLECT.glass;
        const w = texture(mask.texture, uv()).r;
        m.userData.hqMaskMRT = mrt({
          normal: vec4(packNormalToRGB(normalView), mix(this.reflectivity(p), this.reflectivity(q), w)),
          diffuseColor: vec4(diffuseColor.rgb, mix(float(p.rough), float(q.rough), w)),
        });
      }
      return m.userData.hqMaskMRT;
    }
    let node = this.reflectMRTs.get(kind);
    if (!node) {
      node = mrt({
        normal: vec4(packNormalToRGB(normalView), this.reflectivity(p)),
        diffuseColor: vec4(diffuseColor.rgb, float(p.rough)),
      });
      this.reflectMRTs.set(kind, node);
    }
    return node;
  }

  watchPerf(dt) {
    if (this.level === 0 || !(dt > 0) || dt > 0.5) return; // 탭 전환 등으로 멈췄던 프레임은 무시
    const p = this.perf;
    if (p.warm < WARMUP) {
      p.warm += dt;
      return;
    }
    p.frames++;
    p.time += dt;
    if (p.time < WINDOW) return;
    const fps = p.frames / p.time;
    p.frames = 0;
    p.time = 0;
    if (fps < FPS_LOW) this.setLevel(this.level - 1, fps);
  }

  setLevel(level, fps = 0) {
    this.level = Math.max(0, level);
    this.renderer.setPixelRatio(1); // 해상도부터 낮춘다
    if (this.level === 1) {
      this.gi.sliceCount.value = 1;
      this.gi.stepCount.value = 8;
      this.pipeline.outputNode = this.outputs[1];
      this.pipeline.needsUpdate = true;
    }
    this.perf = { warm: 0, frames: 0, time: 0 };
    this.onDowngrade?.(this.level, fps);
  }

  // ───────────── WebGPU용 재질 (WebGL 버전은 GLSL로 따로 있음) ─────────────

  /** 마을 해질녘 하늘 (world.js buildSky의 GLSL과 같은 색). sunDir이 있으면 해 원반과 해 쪽 노을 번짐 */
  skyMaterial(sunDir = null) {
    const { WG, TSL } = this.mods;
    const { positionLocal, vec3, mix, clamp, select, sRGBTransferEOTF, uniform, max, dot, pow, smoothstep, float } = TSL;
    const m = new WG.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    const d = positionLocal.normalize();
    const h = d.y;
    const horizon = vec3(0.86, 0.52, 0.36);
    const mid = vec3(0.42, 0.33, 0.48);
    const top = vec3(0.1, 0.11, 0.22);
    let c = select(
      h.lessThan(0),
      horizon.mul(0.6),
      select(h.lessThan(0.25), mix(horizon, mid, h.div(0.25)), mix(mid, top, clamp(h.sub(0.25).div(0.6), 0, 1))),
    );
    if (sunDir) {
      const s = max(dot(d, uniform(sunDir.clone())), 0);
      const low = float(1).sub(smoothstep(-0.05, 0.55, h));
      c = c.add(vec3(1, 0.55, 0.28).mul(pow(s, 6).mul(0.32).mul(low).add(pow(s, 48).mul(0.35))));
      c = c.add(vec3(1, 0.8, 0.55).mul(pow(s, 900).mul(0.9)));
      c = mix(c, vec3(1, 0.9, 0.72), smoothstep(0.99955, 0.99975, s));
    }
    // 기존 하늘은 sRGB 값을 그대로 화면에 썼으므로 선형으로 바꿔 넣는다
    m.colorNode = sRGBTransferEOTF(c);
    return m;
  }

  /** 헤드램프 빛줄기 (headlamp.js makeBeamMesh의 GLSL과 같은 모양). opacity.value로 세기 조절 */
  beamMaterial(length, hex) {
    const { WG, TSL } = this.mods;
    const { uniform, abs, dot, pow, smoothstep, positionLocal, positionView, normalView, color, float, sRGBTransferEOTF } = TSL;
    const opacity = uniform(0.22);
    const m = new WG.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const facing = abs(dot(normalView, positionView.negate().normalize()));
    const axial = positionLocal.z.negate().div(length).clamp(0, 1);
    const along = pow(axial.oneMinus(), 2.2).mul(smoothstep(0, 0.06, axial));
    const fade = smoothstep(18, 55, positionView.length()).oneMinus();
    const a = opacity.mul(pow(facing, 1.6)).mul(along).mul(fade);
    // WebGL 버전은 색을 화면 밝기 그대로 더했다. 여기서는 선형 공간에서 더한 뒤 sRGB로 바뀌므로
    // 옅은 빛이 몇 배 밝아진다: 화면에 더해질 밝기를 선형 값으로 되돌려 넣어 같은 느낌으로 맞춘다
    m.colorNode = sRGBTransferEOTF(color(new THREE.Color(hex)).mul(a));
    m.opacityNode = float(1);
    return { material: m, opacity };
  }

  /**
   * 갱도 먼지 (mine.js Dust + headlamp.js litDustMaterial과 같은 모습).
   * WebGPU의 점은 1픽셀이라 인스턴싱한 스프라이트로 그린다.
   */
  makeDust(scene, count, lampAngle) {
    const { WG, TSL } = this.mods;
    const { instancedBufferAttribute, uniform, uv, positionWorld, smoothstep, dot, max, float, color } = TSL;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 24;
      pos[i * 3 + 1] = 0.3 + Math.random() * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 24;
    }
    const mat = new WG.PointsNodeMaterial({ transparent: true, depthWrite: false, sizeAttenuation: true });
    mat.size = 0.035;
    mat.positionNode = instancedBufferAttribute(new THREE.InstancedBufferAttribute(pos, 3));
    const lampPos = uniform(new THREE.Vector3());
    const lampDir = uniform(new THREE.Vector3(0, 0, -1));
    const dl = positionWorld.sub(lampPos);
    const dd = dl.length();
    const cone = smoothstep(Math.cos(lampAngle), Math.cos(lampAngle * 0.35), dot(dl.div(max(dd, 1e-3)), lampDir));
    const lit = cone.div(dd.mul(dd).mul(0.04).add(1));
    const round = float(1).sub(smoothstep(0, 0.5, uv().sub(0.5).length())); // 동그랗게 번지는 점
    mat.colorNode = color(new THREE.Color('#d8c7a8')).mul(lit.mul(3.2).add(0.35));
    mat.opacityNode = round.mul(0.5).mul(lit.mul(1.1).add(0.18));
    const sprite = new THREE.Sprite(mat);
    sprite.count = count;
    sprite.frustumCulled = false;
    const group = new THREE.Group();
    group.add(sprite);
    scene.add(group);
    let t = 0;
    return {
      points: group,
      // 카메라 근처 24m 칸 단위로 따라다닌다 (mine.js Dust와 같음)
      update(dt, cam) {
        t += dt;
        group.position.set(Math.round(cam.x / 24) * 24, Math.sin(t * 0.3) * 0.15, Math.round(cam.z / 24) * 24);
        group.rotation.y = Math.sin(t * 0.05) * 0.2;
      },
      setLamp(lamp) {
        lampPos.value.copy(lamp.position);
        lampDir.value.copy(lamp.target.position).sub(lamp.position).normalize();
      },
    };
  }

  setSize(w, h) {
    this.renderer.setSize(w, h);
  }

  dispose() {
    this.disposed = true;
    this.pipeline?.dispose();
    this.renderer.dispose();
  }
}
