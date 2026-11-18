// 그래픽 품질
// - 보통(normal): WebGL 렌더러 (모든 기기)
// - 고품질(high): WebGPU 렌더러 + 화면 기반 간접광(SSGI)·반사(SSR)·시간 누적 안티에일리어싱(TRAA)
// 고품질 모듈(three/webgpu 등)은 크기가 커서, 고품질을 고른 사람만 미리 내려받는다.
// 개발·시험용: 주소 뒤에 ?gfx=high 를 붙이면 소프트웨어 GPU에서도 고품질을 켤 수 있다.

export const GFX_NORMAL = 'normal';
export const GFX_HIGH = 'high';

const FORCE = (() => {
  try {
    return new URLSearchParams(location.search).get('gfx') === 'high';
  } catch {
    return false;
  }
})();

let supportPromise = null;

/**
 * 이 기기에서 고품질(WebGPU)을 쓸 수 있는지.
 * reason: ok | forced | insecure(https가 아님) | none(WebGPU 없음) | software(GPU 가속 없음)
 */
export function webgpuSupport() {
  if (!supportPromise) supportPromise = detect();
  return supportPromise;
}

async function detect() {
  if (typeof window === 'undefined') return { ok: false, reason: 'none' };
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!navigator.gpu) return { ok: false, reason: 'none' };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { ok: false, reason: 'none' };
    const info = adapter.info || {};
    const text = `${info.vendor || ''} ${info.architecture || ''} ${info.device || ''} ${info.description || ''}`;
    // 소프트웨어로 그리는 GPU(SwiftShader 등)는 고품질 효과를 감당하지 못한다
    const software = adapter.isFallbackAdapter || info.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software|basic render/i.test(text);
    if (software && !FORCE) return { ok: false, reason: 'software' };
    return { ok: true, reason: software ? 'forced' : 'ok' };
  } catch {
    return { ok: false, reason: 'none' };
  }
}

let mods = null;
let loading = null;

/** 고품질 모듈을 미리 내려받는다 (지원하지 않는 기기면 null) */
export function preloadHQ() {
  if (!loading) {
    loading = (async () => {
      const support = await webgpuSupport();
      if (!support.ok) return null;
      const [WG, TSL, ssgiMod, ssrMod, traaMod] = await Promise.all([
        import('three/webgpu'),
        import('three/tsl'),
        import('three/addons/tsl/display/SSGINode.js'),
        import('three/addons/tsl/display/SSRNode.js'),
        import('three/addons/tsl/display/TRAANode.js'),
      ]);
      mods = { WG, TSL, ssgi: ssgiMod.ssgi, ssr: ssrMod.ssr, traa: traaMod.traa };
      return mods;
    })().catch((e) => {
      console.warn('[gfx] 고품질 모듈을 불러오지 못했어요', e);
      loading = null;
      return null;
    });
  }
  return loading;
}

/** 이미 불러온 고품질 모듈 (아직이면 null) */
export function hqModules() {
  return mods;
}

/** 설정 화면에 보여 줄 설명 */
export function supportText(support, mobile) {
  if (!support) return '이 기기에서 고품질을 쓸 수 있는지 확인하는 중이에요…';
  switch (support.reason) {
    case 'insecure':
      return '⚠ 고품질(WebGPU)은 https:// 주소로 접속했을 때만 쓸 수 있어요.';
    case 'none':
      return '⚠ 이 브라우저는 WebGPU를 지원하지 않아 고품질을 쓸 수 없어요. (Chrome·Edge 113+, Safari 26+ 등)';
    case 'software':
      return '⚠ 이 기기는 그래픽 가속(GPU)이 없어 고품질을 쓸 수 없어요.';
    default:
      return mobile
        ? '고품질: 빛 번짐(간접광)·구석 그늘·물웅덩이 반사. 휴대폰에서는 뜨거워지거나 느릴 수 있어요. 느려지면 효과를 자동으로 줄여요.'
        : '고품질: 빛 번짐(간접광)·구석 그늘·물웅덩이 반사. 느려지면 효과를 자동으로 줄여요.';
  }
}
