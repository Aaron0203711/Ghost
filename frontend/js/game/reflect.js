// 고품질 화질의 화면 반사(SSR) 세기를 재질마다 정한다. 보통 화질(WebGL)에는 아무 영향이 없다.
// 화면 반사는 화면에 보이는 것만 비추므로, 화면 밖이나 벽 뒤에 숨은 사람이 비쳐 보이지는 않는다.
//   base : 정면에서 볼 때 비치는 정도 (0~1)
//   edge : 스치듯 비스듬히 볼 때 비치는 정도 (실제 물체처럼 비스듬할수록 더 비친다)
//   rough: 흐림 (0 = 거울, 1 = 아주 흐림)
export const REFLECT = {
  glass: { base: 0.25, edge: 0.85, rough: 0.02 }, // 유리창, 자판기 앞면
  water: { base: 0.12, edge: 0.65, rough: 0.04 }, // 논, 물웅덩이
  metal: { base: 0.3, edge: 0.7, rough: 0.18 }, // 레일, 칼날, 닻, 쇠붙이
  rust: { base: 0.08, edge: 0.35, rough: 0.5 }, // 녹슨 함석, 녹슨 쇠사슬
  tile: { base: 0.06, edge: 0.4, rough: 0.22 }, // 유약 바른 기와
  gloss: { base: 0.06, edge: 0.35, rough: 0.15 }, // 플라스틱·눈동자·반질반질한 것
  painted: { base: 0.04, edge: 0.28, rough: 0.35 }, // 칠한 금속·간판·잡동사니
  stone: { base: 0.02, edge: 0.18, rough: 0.6 }, // 돌담, 블록, 아스팔트, 바위, 자갈
  wood: { base: 0.02, edge: 0.14, rough: 0.65 }, // 나무, 판자, 벽지
  default: { base: 0.02, edge: 0.14, rough: 0.6 }, // 따로 정하지 않은 재질
  matte: { base: 0, edge: 0.05, rough: 0.85 }, // 풀, 흙, 카펫, 천, 피부 (거의 안 비침)
};

/**
 * 재질에 반사 종류를 표시한다.
 * mask: 질감의 일부만 다른 종류로 비치게 하는 흑백 질감 (흰 곳 = maskKind). 예: 집 외벽의 창유리
 */
export function reflect(material, kind, mask = null, maskKind = 'glass') {
  material.userData.reflect = kind;
  if (mask) material.userData.reflectMask = { texture: mask, kind: maskKind };
  return material;
}

/** 표시가 없는 재질의 반사 종류: 캐릭터(Standard 재질)는 금속성·거칠기 값으로 정한다 */
export function reflectKind(material) {
  if (material.userData.reflect) return material.userData.reflect;
  if (material.isMeshStandardMaterial) {
    if (material.metalness >= 0.5) return 'metal';
    if (material.roughness <= 0.35) return 'gloss';
    return 'matte';
  }
  return 'default';
}
