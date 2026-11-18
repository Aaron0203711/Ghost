// 마을의 해: 서버가 판마다 정한 방향·높이(map.sun)에 해를 두고 그림자를 드리운다 (보통·고품질 공통).
// 건물·담장·나무·사람·발전기가 그림자를 드리우고 받는다 (enableShadows).
// 그림자 지도는 하나만 쓰고, 플레이어가 보는 쪽으로 따라다닌다.
import * as THREE from 'three';
import { SUN } from '@shared/constants.js';

const MOBILE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const RANGE = 40; // 그림자 범위 반경 (m): 보는 쪽으로 치우쳐 뒤 약 20m ~ 앞 약 60m
const AHEAD = 0.5; // 범위 중심을 보는 쪽으로 얼마나 옮길지 (반경의 비율)

/** 해 정보 → 해가 있는 쪽 단위 벡터 (장면에서 해를 향함) */
export function sunDirection(sun) {
  const ce = Math.cos(sun.elevation);
  return new THREE.Vector3(ce * Math.sin(sun.azimuth), Math.sin(sun.elevation), ce * Math.cos(sun.azimuth));
}

/** 예전 서버처럼 해 정보가 없을 때: 원래 있던 해 질 녘 햇빛 방향 */
export const DEFAULT_SUN = { azimuth: Math.atan2(-60, 30), elevation: Math.atan2(40, Math.hypot(60, 30)) };

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _c = new THREE.Vector3();

export class Sun {
  /**
   * @param {THREE.Scene} scene
   * @param {*} renderer WebGLRenderer 또는 WebGPURenderer
   * @param {{azimuth:number, elevation:number}} sun
   */
  constructor(scene, renderer, sun) {
    this.dir = sunDirection(sun);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // r187부터 PCF가 부드러운 그림자 (radius로 조절)

    // 해 질 녘 햇빛. 바닥 그림자가 보이도록 원래(1.4)보다 세게 하고 하늘빛을 줄였다 (session.js 마을 조명).
    // 햇빛 받는 바닥 밝기는 그대로, 해 반대쪽 면은 약 6% 어두워짐
    const light = new THREE.DirectionalLight('#ffb27a', 2.2);
    light.castShadow = true;
    const size = MOBILE ? 1024 : 2048;
    light.shadow.mapSize.set(size, size);
    const cam = light.shadow.camera;
    cam.left = -RANGE;
    cam.right = RANGE;
    cam.top = RANGE;
    cam.bottom = -RANGE;
    cam.near = 1;
    cam.far = 400;
    cam.updateProjectionMatrix();
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.05;
    light.shadow.radius = 2.5;
    light.shadow.intensity = SUN.SHADOW; // 은은한 그늘: 그림자 속에도 햇빛이 조금 남는다
    scene.add(light, light.target);
    this.light = light;
    this.texel = (RANGE * 2) / size;

    // 그림자 지도 축 (DirectionalLight 그림자 카메라가 해 쪽에서 내려다볼 때와 같은 축)
    _right.set(0, 1, 0).cross(this.dir).normalize();
    this.right = _right.clone();
    this.up = this.dir.clone().cross(this.right).normalize();
  }

  /**
   * 그림자 범위를 카메라가 보는 쪽으로 옮긴다.
   * 그림자 지도 한 칸 단위로 맞춰 움직여서, 걸을 때 그림자 가장자리가 떨리지 않게 한다.
   */
  update(camera) {
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _c.copy(camera.position).addScaledVector(_fwd, RANGE * AHEAD);
    const t = this.texel;
    const x = Math.round(_c.dot(this.right) / t) * t;
    const y = Math.round(_c.dot(this.up) / t) * t;
    const z = _c.dot(this.dir);
    _c.copy(this.right).multiplyScalar(x).addScaledVector(this.up, y).addScaledVector(this.dir, z);
    this.light.target.position.copy(_c);
    this.light.position.copy(_c).addScaledVector(this.dir, 200);
    this.light.target.updateMatrixWorld();
  }

  dispose() {
    this.light.shadow.map?.dispose();
    this.light.removeFromParent();
    this.light.target.removeFromParent();
  }
}
