// 한 판의 게임 클라이언트: 렌더링, 내 이동 예측, 서버 상태 반영, HUD, 관전.
import * as THREE from 'three';
import { CollisionWorld } from '@shared/collision.js';
import {
  RULES,
  ROLE,
  STATUS,
  stepStamina,
  speedFor,
  jumpHeight,
  HUNTER_CLASS,
  SNIPER,
  ASSASSIN,
  CLASS_INFO,
  MELEE,
  CAPTAIN,
  GHOST,
  SKINWALKER,
  SPRINTER,
  CLOWN,
  POLICE,
  SOLDIER,
  SYNERGY_INFO,
  SURVIVOR_CLASS_INFO,
  trapChargesFor,
  survivorSkillCooldown,
  ghostWallExit,
  TRAINING,
  DROWNED,
  PALCHEOK,
  eyeHeightFor,
  SEA_CURSE,
  diveStats,
  aimDirection,
} from '@shared/constants.js';
import { makeDiveRing, disposeRing, makeDiveWarning, makeSplash, makeCrack } from './dive.js';
import { buildWorld, buildSky } from './world.js';
import {
  Avatar,
  makeViewModel,
  makeAnchor,
  makeWisp,
  GeneratorModel,
  makeTrap,
  makeExit,
  Tracer,
  makeImpact,
  makeBall,
  makeThread,
  makeRobot,
  makeSmoke,
  makeTaserBolt,
} from './models.js';
import { Controls } from './input.js';
import { MINE_FOG, Dust, makeMineExit } from './mine.js';
import { BACKROOMS_FOG, makeBackroomsExit } from './backrooms.js';
import { Bgm } from './bgm.js';
import { MiniMap } from './minimap.js';
import { Gyro } from './gyro.js';
import { makeHpBar, makeDamagePop } from './training.js';
import { sfx, unlockAudio, ensureHum, stopHum } from './audio.js';

const $ = (id) => document.getElementById(id);
/** 체력 칸 표시 (반 칸 포함): 1.5 → "1.5", 2 → "2" */
const fmtHits = (h) => String(Math.round(h * 1000) / 1000);
const genBox = (g) => {
  const rotated = Math.abs(Math.sin(g.rot)) > 0.5;
  return { x: g.x, z: g.z, w: rotated ? 0.8 : 1.2, d: rotated ? 1.2 : 0.8 };
};

export class GameSession {
  /**
   * @param {{net:any, start:any, settings:any, onOpenSettings:()=>void}} opts
   */
  constructor({ net, start, settings, onOpenSettings }) {
    this.net = net;
    this.settings = settings;
    this.myId = start.you;
    this.info = new Map(start.players.map((p, i) => [p.id, { ...p, index: i }]));
    const me = this.info.get(this.myId);
    this.role = me.role;
    this.isHunter = this.role === ROLE.HUNTER;
    // 술래 직업: 미치광이(방망이+덫) / 저격수(저격총+조준)
    this.hunterClass = start.hunterClass ?? HUNTER_CLASS.MANIAC;
    this.isSniper = this.isHunter && this.hunterClass === HUNTER_CLASS.SNIPER;
    this.isAssassin = this.isHunter && this.hunterClass === HUNTER_CLASS.ASSASSIN;
    this.isCaptain = this.isHunter && this.hunterClass === HUNTER_CLASS.CAPTAIN;
    this.isGhost = this.isHunter && this.hunterClass === HUNTER_CLASS.GHOST;
    this.isSkin = this.isHunter && this.hunterClass === HUNTER_CLASS.SKINWALKER;
    this.isSprinter = this.isHunter && this.hunterClass === HUNTER_CLASS.SPRINTER;
    this.isClown = this.isHunter && this.hunterClass === HUNTER_CLASS.CLOWN;
    this.isDrowned = this.isHunter && this.hunterClass === HUNTER_CLASS.DROWNED;
    this.isPalcheok = this.isHunter && this.hunterClass === HUNTER_CLASS.PALCHEOK;
    this.carrying = null; // 팔척귀신: 들고 있는 생존자 id
    this.carryLeft = 0;
    this.carriedBy = null; // 생존자: 나를 들고 있는 팔척귀신
    this.eyeHeight = eyeHeightFor(this.isHunter ? this.hunterClass : null); // 팔척귀신은 2.3m
    this.diveAim = null; // 익사자: 스킬 키를 누르고 있는 동안 조준 원
    this.spyRevealUntil = 0; // 최고의 스파이들: 투명화 순간 생존자 위치 공개
    // 설치형 스킬: 미치광이 덫 3개(30초), 광대 실 4개(23초)
    const ch = trapChargesFor(this.hunterClass);
    this.trapMax = ch.max;
    this.trapCooldown = ch.cooldown;
    // 생존자 직업 (메인 화면에서 고름). 푸드파이터는 패시브라 스킬 버튼이 없다
    this.scls = this.isHunter ? null : me.scls;
    this.sskillCooldown = this.isHunter ? 0 : survivorSkillCooldown(this.scls);
    this.hasSSkill = this.sskillCooldown > 0;
    this.sskillLeft = 0;
    this.slowFactor = 1; // 생존자 감속 배율 (서버가 알려 줌)
    this.noRun = false;
    this.smoked = false; // 술래: 연막 속
    this.threadMeshes = new Map();
    this.cloneAvatars = new Map();
    this.smokeMeshes = new Map();
    this.robotMeshes = new Map();
    this.balls = new Map(); // 날아가는 광대 공 (서버 id → 화면 모델)
    this.bolts = new Map(); // 날아가는 테이저건 탄
    // 선장·유령·살가죽·질주자: 스킬 키 한 번 누르기 + 쿨타임
    this.hasClassSkill = this.isCaptain || this.isGhost || this.isSkin || this.isSprinter || this.isDrowned || this.isPalcheok;
    this.skillCooldown = {
      assassin: ASSASSIN.SKILL_COOLDOWN,
      captain: CAPTAIN.SKILL_COOLDOWN,
      ghost: GHOST.SKILL_COOLDOWN,
      skinwalker: SKINWALKER.SKILL_COOLDOWN,
      sprinter: SPRINTER.SKILL_COOLDOWN,
      drowned: DROWNED.SKILL_COOLDOWN,
      palcheok: PALCHEOK.SKILL_COOLDOWN,
    }[this.hunterClass] || 1;
    this.attackCooldown = this.isSniper
      ? SNIPER.SHOT_COOLDOWN
      : this.isClown
        ? CLOWN.BALL_COOLDOWN
        : (MELEE[this.hunterClass] || MELEE.maniac).cooldown;
    this.forced = false; // 닻에 끌려오거나 질주 중: 서버가 내 위치를 움직임
    this.serverPos = null;
    this.disguised = false; // 살가죽 변장 중
    this.myDash = null;
    this.anchorMeshes = new Map();
    this.wispMeshes = new Map();
    this.disguiseAvatars = new Map(); // 변장한 술래를 생존자 화면에 그리는 아바타
    this.pulls = []; // [끌려오는 사람 id, 선장 id]
    this.jumpT = null; // 점프 경과 시간 (땅이면 null)
    this.invisLeft = 0; // 암살자 내 투명화 남은 시간
    this.skillLeft = 0; // 암살자 스킬 쿨타임
    this.slowLeft = 0; // 암살자 기습 후 감속
    this.wallSlowLeft = 0; // 유령: 벽을 빠져나온 뒤 감속
    this.wallState = { inWall: false };
    this.aiming = false;
    this.tracers = new Map(); // 서버 총알 id → 궤적 (끝 위치를 받기 전)
    this.liveTracers = []; // 화면에 그리는 중인 궤적
    this.effects = [];
    // 이번 판 규칙 (5명이면 발전기 7개, 체력 2칸)
    this.hitsToCatch = start.rules?.hitsToCatch ?? RULES.HITS_TO_CATCH;
    this.maxHits = me.mx ?? this.hitsToCatch; // 내 체력 칸 (푸드파이터 +4)
    this.staminaMax = me.stm ?? RULES.STAMINA_MAX; // 푸드파이터 5초
    this.synergies = start.synergies || [];
    // 훈련장: 허수아비 상대로 혼자 연습 (제한 시간·승패 없음)
    this.training = start.training || null;
    this.trainingRestarted = !!start.restarted;
    this.hpBars = new Map(); // 허수아비 id → 체력 막대

    // 내 상태 (클라이언트 예측)
    this.pos = { x: me.x, z: me.z };
    this.yaw = me.yaw;
    this.pitch = 0;
    this.stam = { stamina: this.staminaMax, regenWait: 0 };
    this.running = false;
    this.moving = false;
    this.stunLeft = 0;
    this.status = STATUS.ALIVE;
    this.hits = 0;
    this.corr = 0;
    this.attackLeft = 0;
    this.charges = this.trapMax;
    this.chargeLeft = 0;
    this.sendTimer = 0;
    this.bobT = 0;
    this.shake = 0;
    this.lastState = null;
    this.gens = new Map();
    this.traps = new Map();
    this.exit = null;
    this.exitMesh = null;
    this.spectateId = null;
    this.heartbeatT = 0;
    this.danger = 0; // 술래가 가까운 정도 (배경음악 먹먹함)
    this.bgm = new Bgm(start.map.theme);
    this.disposed = false;

    // 바다의 저주: 닻이 커진다 (판정 0.8m → 1.5m에 맞춰)
    this.makeAnchorModel = () => {
      const m = makeAnchor();
      if (this.synergies.includes('seaCurse')) m.scale.multiplyScalar(SEA_CURSE.ANCHOR_RADIUS / CAPTAIN.ANCHOR_RADIUS);
      return m;
    };
    this.setupThree(start);
    this.setupHud();
    this.setupControls(onOpenSettings);

    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  setupThree(start) {
    const wrap = $('game-canvas-wrap');
    const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.theme = ['mine', 'backrooms'].includes(start.map.theme) ? start.map.theme : 'village';
    this.startMap = start.map;
    this.isMine = this.theme === 'mine';
    this.isBackrooms = this.theme === 'backrooms';
    // 시야: 마을 약 75m, 폐광산 약 60m(어두움), 백룸 약 75m(누런 안개)
    const fog = this.isMine ? MINE_FOG : this.isBackrooms ? BACKROOMS_FOG : { color: '#4a3c4f', near: 14, far: 78 };
    scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
    camera.rotation.order = 'YXZ';
    scene.add(camera);
    this.camera = camera;

    if (this.isMine) {
      // 갱도: 어둑한 주황빛 환경광 + 내 헤드램프
      scene.add(new THREE.HemisphereLight('#d6b48e', '#3a2d22', 1.8));
      scene.add(new THREE.AmbientLight('#7d6a58', 0.9));
      // 벽에 붙어도 하얗게 타지 않도록: 램프를 머리 뒤쪽에 두고, 밝은 부분은 톤 매핑으로 부드럽게
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.45;
      const lamp = new THREE.SpotLight('#ffe2b0', 32, 36, 0.65, 0.55, 1.25);
      lamp.position.set(0.15, 0.1, 0.7);
      lamp.target.position.set(0, -0.15, -1);
      camera.add(lamp, lamp.target);
      this.headlamp = lamp;
      this.dust = new Dust(scene);
    } else if (this.isBackrooms) {
      // 형광등 아래 밋밋하고 누런 빛
      scene.add(new THREE.HemisphereLight('#fff4c8', '#8f7d42', 2.1));
      scene.add(new THREE.AmbientLight('#e8dca8', 0.7));
    } else {
      scene.add(new THREE.HemisphereLight('#b9a3c9', '#3b3226', 1.6));
      const sun = new THREE.DirectionalLight('#ffb27a', 1.4);
      sun.position.set(-60, 40, 30);
      scene.add(sun);
      scene.add(new THREE.AmbientLight('#6c6280', 0.5));
    }

    this.sky = buildSky(scene, this.theme);
    this.worldGroup = buildWorld(scene, start.map);

    // 유령은 담장·벽을 통과한다 (서버와 같은 기준으로 예측)
    this.collision = new CollisionWorld(
      this.isGhost ? start.map.boxes.filter((b) => !GHOST.PASS_KINDS.includes(b.kind)) : start.map.boxes,
    );
    if (this.isGhost) this.wallWorld = new CollisionWorld(start.map.boxes.filter((b) => GHOST.PASS_KINDS.includes(b.kind)));
    for (const g of start.generators) {
      this.collision.add(genBox(g));
      const model = new GeneratorModel(g);
      scene.add(model.group);
      this.gens.set(g.id, { ...g, model, progress: 0, done: false });
    }

    this.avatars = new Map();
    for (const p of this.info.values()) {
      if (p.id === this.myId) continue;
      // 이름표는 같은 생존자끼리만 보인다
      // 같은 편끼리만 이름표가 보인다 (생존자끼리, 술래끼리)
      // 훈련장 허수아비는 항상 이름표와 체력 막대가 보인다
      const showLabel = p.dummy || (this.isHunter ? p.role === ROLE.HUNTER : p.role === ROLE.SURVIVOR);
      const a = new Avatar(p.role, p.index, p.name, showLabel, p.role === ROLE.HUNTER ? p.cls ?? this.hunterClass : p.scls);
      a.setTarget(p.x, p.z, p.yaw, true);
      if (p.dummy && p.role === ROLE.SURVIVOR) {
        const bar = makeHpBar(p.mx ?? this.hitsToCatch);
        a.group.add(bar.sprite);
        this.hpBars.set(p.id, bar);
      }
      scene.add(a.group);
      this.avatars.set(p.id, a);
    }

    if (this.isHunter) this.viewBat = makeViewModel(camera, this.hunterClass);
    // 닻 사슬 (선 여러 개를 한 번에 그림)
    const chainGeo = new THREE.BufferGeometry();
    chainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 6), 3));
    this.chain = new THREE.LineSegments(chainGeo, new THREE.LineBasicMaterial({ color: '#8a8f99' }));
    this.chain.frustumCulled = false;
    scene.add(this.chain);

    this.onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this.onResize);
  }

  setupHud() {
    const screen = $('screen-game');
    screen.classList.toggle('role-hunter', this.isHunter);
    screen.classList.toggle('role-survivor', !this.isHunter);
    screen.classList.toggle('cls-sniper', this.isSniper);
    screen.classList.toggle('cls-assassin', this.isAssassin);
    screen.classList.toggle('cls-skill', this.hasClassSkill);
    screen.classList.toggle('cls-clown', this.isClown);
    screen.classList.remove('smoked', 's-slowed', 'no-run', 'diving');
    screen.classList.remove('disguised');
    screen.classList.remove('invisible');
    screen.classList.remove('spectating', 'scoped');
    const info = CLASS_INFO[this.hunterClass];
    const hunterNames = [...this.info.values()]
      .filter((p) => p.role === ROLE.HUNTER)
      .map((p) => CLASS_INFO[p.cls ?? HUNTER_CLASS.MANIAC].name);
    const sinfo = SURVIVOR_CLASS_INFO[this.scls];
    $('hud-role').textContent = this.isHunter
      ? `${info.icon} 술래 · ${info.name}`
      : `${sinfo ? `${sinfo.icon} ${sinfo.name}` : '🏃 생존자'} · 술래: ${hunterNames.join(', ')}`;
    $('hud-role').className = `badge ${this.isHunter ? 'hunter' : 'survivor'}`;
    const classLabels = {
      captain: { main: ['🪝', '후크'], action: ['⚓', '닻'] },
      ghost: { main: ['💀', '할퀴기'], action: ['🔮', '유도탄'] },
      skinwalker: { main: ['⛓️', '갈고리'], action: ['🎭', '변장'] },
      sprinter: { main: ['🦵', '발차기'], action: ['💨', '질주'] },
      drowned: { main: ['🔱', '작살'], action: ['🌊', '다이빙'] },
      palcheok: { main: ['👊', '주먹'], action: ['🫳', '납치'] },
    };
    if (this.isClown) classLabels.clown = { main: ['🤹', '공'], action: ['🧵', '실'] };
    const labels = this.hasClassSkill || this.isClown
      ? classLabels[this.hunterClass]
      : this.isSniper
      ? { main: ['🎯', '발사'], action: ['🔭', '조준'] }
      : this.isAssassin
        ? { main: ['🗡️', '공격'], action: ['👻', '투명화'] }
        : this.isHunter
        ? { main: ['🏏', '공격'], action: ['🪤', '덫'] }
        : { main: ['🔧', '수리'], action: ['👟', '달리기'] };
    $('btn-main').querySelector('.ico').textContent = labels.main[0];
    $('btn-main').querySelector('.lbl').textContent = labels.main[1];
    $('btn-action').querySelector('.ico').textContent = labels.action[0];
    $('btn-action').querySelector('.lbl').textContent = labels.action[1];
    $('cd-main').querySelector('.ico').textContent = labels.main[0];
    $('cd-action').querySelector('.ico').textContent = labels.action[0];
    // 생존자 직업 스킬 버튼 (수리 왼쪽, PC는 Q)
    const sk = { doctor: '💉', police: '⚡', soldier: '💨', ninja: '👥', engineer: '🤖' }[this.scls] || '';
    $('btn-sskill').querySelector('.ico').textContent = sk;
    $('btn-sskill').querySelector('.lbl').textContent = sinfo?.skill || '';
    $('btn-sskill').classList.toggle('passive', !this.hasSSkill);
    $('cd-sskill').querySelector('.ico').textContent = sk;
    $('cd-sskill').classList.toggle('passive', !this.hasSSkill);
    $('pc-hint-sskill').textContent = this.hasSSkill ? `Q ${sinfo.skill} · ` : '';
    const skHint = document.querySelector('#pc-hint .sk-only');
    if (skHint) {
      skHint.textContent = this.isDrowned
        ? '좌클릭 작살 · E 꾹 눌러 조준, 떼면 다이빙'
        : this.isPalcheok
          ? '좌클릭 주먹 · E 납치, 들고 있을 때 E 던지기'
          : '좌클릭 공격 · E 스킬';
    }
    $('hud-feed').innerHTML = '';
    $('btn-train').classList.toggle('hidden', !this.training);
    screen.classList.toggle('training', !!this.training);
    if (this.training) {
      $('hud-timer').textContent = '🎯 훈련장';
      $('hud-timer').classList.remove('urgent');
    }
    $('hud-exit').classList.add('hidden');
    $('exit-label').textContent = this.isMine ? '🚪 갱구 출구' : this.isBackrooms ? '🚪 EXIT' : '⛩ 탈출구';
    screen.classList.toggle('theme-mine', this.isMine);
    screen.classList.toggle('theme-backrooms', this.isBackrooms);
    this.feed(this.isMine ? '⛏️ 맵: 폐광산' : this.isBackrooms ? '🟨 맵: 백룸' : '🏘️ 맵: 시골 마을');
    $('hud-repair').classList.add('hidden');
    $('hud-spectate').classList.add('hidden');
    $('hud-gens').innerHTML = [...this.gens.keys()].map((id) => `<i class="lamp" data-gen="${id}"></i>`).join('');
    this.updateGenHud();
    this.renderPlayerList();
    const mates = [...this.info.values()].filter((p) => p.role === ROLE.HUNTER && p.id !== this.myId).map((p) => p.name);
    const mateText = this.isHunter && mates.length ? ` · 동료 술래: ${mates.join(', ')}` : '';
    if (this.training) {
      this.feed('🎯 훈련장 · 🔄 버튼으로 역할·직업을 바꿀 수 있어요', 'good');
      this.centerMsg(
        this.trainingRestarted
          ? '탈출 성공! 처음부터 다시 시작해요'
          : this.isHunter
            ? `${info.icon} ${info.name} 체험 · 허수아비를 공격해 보세요`
            : `${sinfo?.icon ?? ''} ${sinfo?.name ?? '생존자'} 체험 · 술래 허수아비는 공격하지 않아요. 발전기 ${this.gens.size}개를 켜고 탈출해 보세요`,
        3,
      );
      return;
    }
    this.centerMsg(
      ({
        captain: '선장: 닻을 던져 생존자를 끌어오세요!',
        ghost: '처녀귀신: 담장을 지나다니며 유도탄으로 몰아붙이세요!',
        skinwalker: '살가죽: 생존자로 변장해 다가가세요. 공격하면 정체가 드러나요',
        sprinter: '질주자: 질주로 단숨에 거리를 좁히세요!',
        clown: '광대: 공을 던지고, 골목에 실 함정을 치세요!',
        drowned: '익사자: 스킬 키를 누르고 조준한 뒤 떼면 그곳으로 다이빙!',
        palcheok: '팔척귀신: 담장 너머를 내려다보세요. 생존자를 붙잡아 다른 생존자에게 던지세요!',
      }[this.isHunter ? this.hunterClass : ''] ||
      (this.isSniper
        ? '저격수: 조준해서 멀리서 맞히면 2칸!'
        : this.isAssassin
          ? '암살자: 투명해져서 다가가 쿠나이로 기습하세요!'
          : this.isHunter
          ? '생존자를 모두 잡으세요!'
          : `발전기 ${this.gens.size}개를 켜고 탈출하세요! (체력 ${this.maxHits}칸)`)) + mateText,
      3,
    );
    // 술래 2명의 직업 조합 시너지
    for (const id of this.synergies) {
      const sy = SYNERGY_INFO[id];
      if (!sy) continue;
      this.feed(`${sy.icon} ${sy.name} 발동! ${sy.desc}`, this.isHunter ? 'good' : 'bad');
      if (this.isHunter) setTimeout(() => !this.disposed && this.centerMsg(`${sy.icon} ${sy.name} 발동!`, 2.5), 3200);
    }
  }

  setupControls(onOpenSettings) {
    this.controls = new Controls(
      $('touch-layer'),
      {
        joy: $('joy'),
        knob: $('joy-knob'),
        canvas: this.renderer.domElement,
        buttons: { main: $('btn-main'), action: $('btn-action'), jump: $('btn-jump'), sskill: this.hasSSkill ? $('btn-sskill') : null },
      },
      () => this.settings.sensitivity,
    );
    this.controls.isHunter = this.isHunter;
    this.gyro = new Gyro(() => ({
      enabled: this.settings.gyro,
      sensitivity: this.settings.gyroSensitivity,
      invertX: this.settings.gyroInvertX,
      invertY: this.settings.gyroInvertY,
    }));
    this.controls.onPress('main', () => {
      unlockAudio();
      if (this.isHunter) this.tryAttack();
    });
    this.controls.onPress('jump', () => {
      unlockAudio();
      this.tryJump();
    });
    this.controls.onPress('sskill', () => {
      unlockAudio();
      this.trySurvivorSkill();
    });
    this.controls.onPress('action', () => {
      unlockAudio();
      if (this.isAssassin) this.trySkill();
      else if (this.isDrowned) this.startDiveAim();
      else if (this.hasClassSkill) this.tryClassSkill();
      else if (this.isHunter && !this.isSniper) this.tryTrap(); // 미치광이 덫, 광대 실 (저격수는 누르고 있는 동안 조준)
    });
    // 지도: 생존자만 (술래는 볼 수 없음)
    this.mapOpen = false;
    if (!this.isHunter) this.minimap = new MiniMap(this.startMap, this.gens, this.theme);
    $('btn-map').classList.toggle('hidden', this.isHunter);
    $('map-overlay').classList.add('hidden');
    // 터치: 다른 손가락으로 조이스틱을 잡고 있으면 click이 안 오는 기기가 있어서
    // 손가락이 닿는 순간(pointerdown)에 바로 켜고 끈다. 마우스는 click으로.
    this.mapTouchAt = 0;
    this.onMapDown = (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      this.mapTouchAt = performance.now();
      this.toggleMap();
    };
    this.onMapClick = () => {
      if (performance.now() - this.mapTouchAt < 700) return; // 방금 터치로 처리함
      this.toggleMap();
    };
    $('btn-map').addEventListener('pointerdown', this.onMapDown);
    $('btn-map').addEventListener('click', this.onMapClick);
    this.onMapKey = (e) => {
      if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement) && !e.repeat) this.toggleMap();
    };
    window.addEventListener('keydown', this.onMapKey);
    this.onSettingsClick = () => {
      this.controls.releaseAll();
      onOpenSettings();
    };
    $('btn-game-settings').addEventListener('click', this.onSettingsClick);
    this.onSpectateNext = () => this.cycleSpectate();
    $('btn-spectate-next').addEventListener('click', this.onSpectateNext);
  }

  tryAttack() {
    if (this.status !== STATUS.ALIVE || this.attackLeft > 0 || this.forced || this.stunLeft > 0) return;
    if (this.carrying) return; // 팔척귀신: 들고 있는 동안 주먹 불가
    this.attackLeft = this.attackCooldown;
    this.lastAttackAt = performance.now();
    this.viewBat?.playSwing();
    if (this.isSniper) {
      sfx.gunshot(1);
      this.shake = 0.12;
    } else if (this.isClown) sfx.ballThrow();
    else sfx.swing();
    if (this.disguised) this.setDisguised(false); // 공격하면 변장이 풀린다 (서버도 같은 규칙)
    // 누른 순간의 시점으로 판정하도록 방향을 함께 보낸다
    this.net.send({ t: 'attack', yaw: this.yaw, pitch: this.pitch });
  }

  /** 점프: 땅에 있을 때만, 생존자는 스태미나 1초분 필요. 덫에 걸리면 못 뜀 */
  tryJump() {
    if (this.status !== STATUS.ALIVE || this.jumpT !== null || this.stunLeft > 0 || this.isRepairing()) return;
    if (!this.isHunter) {
      if (this.stam.stamina < RULES.JUMP_STAMINA) {
        this.centerMsg('스태미나가 부족해 점프할 수 없어요', 1);
        return;
      }
      this.stam.stamina -= RULES.JUMP_STAMINA;
      this.stam.regenWait = RULES.STAMINA_REGEN_DELAY;
    }
    this.jumpT = 0;
    this.jumpStart = performance.now();
    sfx.jump();
    this.net.send({ t: 'jump' });
  }

  /** 선장 닻 · 처녀귀신 유도탄 · 살가죽 변장 · 질주자 질주 · 팔척귀신 납치·던지기 */
  /** 생존자 직업 스킬: 의사 회복, 경찰 테이저건, 군인 연막탄, 닌자 분신, 엔지니어 로봇 */
  trySurvivorSkill() {
    if (this.isHunter || !this.hasSSkill || this.status !== STATUS.ALIVE || this.sskillLeft > 0) return;
    if (performance.now() - (this.lastSSkillAt || 0) < 400) return;
    this.lastSSkillAt = performance.now();
    this.sskillLeft = this.sskillCooldown; // 대상이 없어 실패하면 서버가 알려 주고 되돌린다
    this.net.send({ t: 'skill', yaw: this.yaw, pitch: this.pitch });
  }

  tryClassSkill() {
    if (this.status !== STATUS.ALIVE || this.skillLeft > 0 || this.forced || this.disguised || this.stunLeft > 0) return;
    if (performance.now() - (this.lastSkillAt || 0) < 400) return;
    this.lastSkillAt = performance.now();
    // 쓰는 순간부터 쿨타임이 도는 직업은 바로 표시 (살가죽·질주자는 끝난 뒤부터)
    if (this.isCaptain || this.isGhost) this.skillLeft = this.skillCooldown;
    if (this.isCaptain) {
      sfx.throwAnchor();
      this.viewBat?.playSwing();
    } else if (this.isGhost) sfx.wisp();
    else if (this.isSkin) this.setDisguised(true);
    else if (this.isSprinter) sfx.dashCharge();
    else if (this.isPalcheok && this.carrying) {
      // 던지기: 그때부터 쿨타임
      this.carrying = null;
      this.skillLeft = this.skillCooldown;
      this.viewBat?.playSwing();
      sfx.hurl();
    }
    this.net.send({ t: 'skill', yaw: this.yaw, pitch: this.pitch });
    this.updateHunterHud();
  }

  /** 익사자: 스킬 키를 누르면 조준 원을 띄운다 (떼면 update에서 다이빙) */
  startDiveAim() {
    if (this.diveAim || this.status !== STATUS.ALIVE || this.skillLeft > 0 || this.forced || this.stunLeft > 0) return;
    const { radius, range } = diveStats(this.synergies);
    const ring = makeDiveRing(radius);
    this.scene.add(ring);
    this.diveAim = { ring, range, x: this.pos.x, z: this.pos.z };
    this.updateDiveAim();
  }

  /** 조준점이 가리키는 땅 (최대 거리로 줄임). 하늘을 보면 바라보는 방향으로 최대 거리 */
  updateDiveAim() {
    const aim = this.diveAim;
    const dir = aimDirection(this.yaw, this.pitch);
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const maxD = Number.isFinite(aim.range) ? aim.range : 150;
    let d = dir.y < -0.01 ? (this.eyeHeight / -dir.y) * flat : maxD;
    d = Math.min(d, maxD);
    aim.x = this.pos.x + (dir.x / flat) * d;
    aim.z = this.pos.z + (dir.z / flat) * d;
    aim.ring.position.set(aim.x, 0, aim.z);
    aim.ring.userData.edge.material.opacity = 0.65 + Math.sin(performance.now() / 120) * 0.25;
  }

  endDiveAim(fire) {
    const aim = this.diveAim;
    if (!aim) return;
    this.diveAim = null;
    disposeRing(this.scene, aim.ring);
    if (!fire || this.status !== STATUS.ALIVE || this.forced || this.stunLeft > 0 || this.skillLeft > 0) return;
    this.lastSkillAt = performance.now();
    this.skillLeft = this.skillCooldown; // 쓴 순간부터 쿨타임 (도착할 곳이 없으면 서버가 알려 줌)
    this.net.send({ t: 'skill', yaw: this.yaw, pitch: this.pitch, tx: Math.round(aim.x * 100) / 100, tz: Math.round(aim.z * 100) / 100 });
    this.updateHunterHud();
  }

  setDisguised(on) {
    this.disguised = on;
    $('screen-game').classList.toggle('disguised', on);
    if (on) sfx.disguise();
  }

  /** 암살자 투명화 */
  trySkill() {
    if (this.status !== STATUS.ALIVE || this.invisLeft > 0 || this.skillLeft > 0 || this.stunLeft > 0) return;
    this.invisLeft = ASSASSIN.INVIS_TIME;
    this.lastSkillAt = performance.now();
    sfx.invisOn();
    this.net.send({ t: 'skill' });
    this.updateHunterHud();
  }

  tryTrap() {
    if (this.status !== STATUS.ALIVE || this.charges <= 0 || this.stunLeft > 0) return;
    if (performance.now() - (this.lastTrapAt || 0) < 250) return;
    this.charges--;
    this.lastTrapAt = performance.now();
    if (this.chargeLeft <= 0) this.chargeLeft = this.trapCooldown;
    if (this.isClown) sfx.threadTwang();
    else sfx.trapPlace();
    this.net.send({ t: 'trap', yaw: this.yaw });
    this.updateHunterHud();
  }

  // ───────────────────────── 서버 메시지 ─────────────────────────

  handle(msg) {
    if (this.disposed) return;
    if (msg.t === 'state') this.onState(msg);
    else if (msg.t === 'event') this.onEvent(msg);
    else if (msg.t === 'correct') {
      this.pos.x = msg.x;
      this.pos.z = msg.z;
      this.corr = msg.corr;
    }
  }

  onState(s) {
    this.lastState = s;
    this.matchTime = s.time;
    for (const p of s.players) {
      const info = this.info.get(p.id);
      if (!info) continue;
      info.status = p.st;
      info.hits = p.hits;
      if (p.id === this.myId) {
        this.hits = p.hits;
        this.stunLeft = p.stun;
        this.serverPos = { x: p.x, z: p.z };
        this.myDash = p.dash || null;
        if (p.pull && !this.pulledBy) this.centerMsg('⚓ 닻에 걸렸다! 끌려간다', 1.5);
        this.pulledBy = p.pull || null;
        this.carriedBy = p.carry || null; // 팔척귀신에게 들림
        if (p.st !== this.status) this.setMyStatus(p.st);
        continue;
      }
      const a = this.avatars.get(p.id);
      if (!a) continue;
      this.hpBars.get(p.id)?.set(p.hits);
      // 투명한 암살자: 생존자에게는 위치가 오지 않으므로 아예 숨긴다
      info.hidden = !!p.hidden;
      // 살가죽 변장: 생존자 화면에서는 그 생존자 모습으로 그린다 (심장 박동도 없음)
      info.disguised = !!p.look;
      this.showDisguise(p, a);
      if (p.hidden) {
        a.group.visible = false;
        a.wasHidden = true;
        continue;
      }
      a.setTarget(p.x, p.z, p.yaw, a.wasHidden); // 다시 나타나면 그 자리에 바로
      a.wasHidden = false;
      // 같은 편/관전자 화면에서는 투명화 중인 암살자가 반투명
      a.setGhost(p.invis ? 0.3 : 1);
      a.pitch = p.pitch;
      a.stunned = p.stun > 0;
      a.repairing = !!p.rep;
      // 점프: 서버가 알려 준 경과 시간에서 이어서 높이를 계산
      if (p.jmp > 0 && (a.jumpT == null || Math.abs(a.jumpT - p.jmp) > 0.15)) a.jumpT = p.jmp;
      a.aiming = !!p.aim;
      a.pulled = !!p.pull;
      a.carried = !!p.carry; // 팔척귀신에게 들림
      a.thrown = !!p.thrown; // 팔척귀신이 던짐
      a.dash = p.dash || null;
      // 광대 실에 걸려 빛남 (벽 너머로 보임). 최고의 스파이들: 투명화 순간 암살자에게 생존자가 빛나 보임
      const spySees = info.role === ROLE.SURVIVOR && performance.now() < this.spyRevealUntil;
      a.setReveal(!!p.glow || spySees);
      a.group.visible = p.st === STATUS.ALIVE && p.id !== this.spectateId && !p.look && !p.dive; // 땅속 익사자는 안 보임
    }
    // 떠난 플레이어
    for (const [id, a] of this.avatars) {
      if (!s.players.some((p) => p.id === id)) {
        a.group.visible = false;
        const info = this.info.get(id);
        if (info) info.status = 'left';
      }
    }
    // 닻·끌려옴·유도탄
    this.pulls = s.players.filter((p) => p.pull).map((p) => [p.id, p.pull]);
    // 팔척귀신: 생존자를 들고 있는 팔척귀신 (다음 상태에서 두 팔을 들어 올림)
    const carriers = new Set(s.players.filter((p) => p.carry).map((p) => p.carry));
    for (const [id, a] of this.avatars) a.carrying = carriers.has(id);
    this.syncProjectiles(this.anchorMeshes, s.anchors || [], this.makeAnchorModel);
    this.syncProjectiles(this.wispMeshes, s.wisps || [], makeWisp);
    this.syncThreads(s.threads || []);
    this.syncClones(s.clones || []);
    this.syncSmokes(s.smokes || []);
    this.syncRobots(s.robots || []);
    if (s.me) {
      this.forced = !!s.me.forced;
      if (Math.abs(s.me.stamina - this.stam.stamina) > 0.6) this.stam.stamina = s.me.stamina;
      // 내가 방금 누른 동작은 서버가 아직 처리하기 전일 수 있으므로 잠깐은 서버 값으로 덮어쓰지 않는다
      const now = performance.now();
      const fresh = (t) => now - (t || 0) < 400;
      if (!fresh(this.lastTrapAt)) {
        this.charges = s.me.charges;
        this.chargeLeft = s.me.chargeLeft;
      }
      if (!fresh(this.lastAttackAt) && Math.abs(s.me.attackLeft - this.attackLeft) > 0.25) this.attackLeft = s.me.attackLeft;
      if (this.hasClassSkill && !fresh(this.lastSkillAt)) {
        this.skillLeft = s.me.skillLeft ?? 0;
        if (this.isSkin && !!s.me.disguised !== this.disguised) this.setDisguised(!!s.me.disguised);
      }
      if (!this.isHunter) {
        if (!fresh(this.lastSSkillAt)) this.sskillLeft = s.me.sskillLeft ?? 0;
        this.slowFactor = s.me.slow ?? 1;
        this.noRun = !!s.me.noRun;
      }
      this.smoked = this.isHunter && !!s.me.smoke;
      if (this.isPalcheok && !fresh(this.lastSkillAt)) {
        this.carrying = s.me.carrying || null;
        this.carryLeft = s.me.carryLeft ?? 0;
      }
      if (this.isAssassin && !fresh(this.lastSkillAt)) {
        this.invisLeft = s.me.invisLeft ?? 0;
        this.skillLeft = s.me.skillLeft ?? 0;
        this.slowLeft = s.me.slowLeft ?? 0;
      }
    }
    for (const g of s.gens) {
      const gen = this.gens.get(g.id);
      if (!gen) continue;
      gen.progress = g.p;
      gen.done = !!g.done;
      gen.model.set(g.p, gen.done, !!g.rep);
    }
    this.syncTraps(s.traps);
    this.minimap?.update(s.map, s.exit);
    if (s.exit && !this.exit) this.showExit(s.exit);
    this.updateGenHud();
    this.renderPlayerList();
  }

  syncTraps(list) {
    const ids = new Set(list.map((t) => t.id));
    for (const [id, mesh] of this.traps) {
      if (!ids.has(id)) {
        this.scene.remove(mesh);
        this.traps.delete(id);
      }
    }
    const faint = !this.isHunter && this.status === STATUS.ALIVE;
    for (const t of list) {
      if (this.traps.has(t.id)) continue;
      const mesh = makeTrap(faint);
      mesh.position.set(t.x, 0, t.z);
      this.scene.add(mesh);
      this.traps.set(t.id, mesh);
    }
    // 함정 듀오: 덫이 생존자를 따라 움직인다
    for (const t of list) this.traps.get(t.id).userData.target = { x: t.x, z: t.z };
  }

  /** 광대 실 (함정 듀오에서는 움직인다) */
  syncThreads(list) {
    const ids = new Set(list.map((t) => t.id));
    for (const [id, m] of this.threadMeshes) {
      if (!ids.has(id)) {
        this.scene.remove(m);
        m.geometry.dispose();
        this.threadMeshes.delete(id);
      }
    }
    const faint = !this.isHunter && this.status === STATUS.ALIVE;
    for (const t of list) {
      let m = this.threadMeshes.get(t.id);
      if (!m) {
        m = makeThread(faint);
        this.scene.add(m);
        this.threadMeshes.set(t.id, m);
      }
      m.userData.setEnds(t.ax, t.az, t.bx, t.bz);
    }
  }

  /** 닌자 분신: 주인과 똑같은 모습 (같은 편 생존자 화면에서는 살짝 투명) */
  syncClones(list) {
    const ids = new Set(list.map((c) => c.id));
    for (const [id, a] of this.cloneAvatars) {
      if (!ids.has(id)) {
        this.scene.remove(a.group);
        a.dispose();
        this.cloneAvatars.delete(id);
      }
    }
    for (const c of list) {
      let a = this.cloneAvatars.get(c.id);
      if (!a) {
        const o = this.info.get(c.o);
        a = new Avatar(ROLE.SURVIVOR, o?.index ?? 0, o?.name ?? '?', !this.isHunter, o?.scls);
        a.setTarget(c.x, c.z, c.yaw, true);
        if (!this.isHunter) a.setGhost(0.55);
        this.scene.add(a.group);
        this.cloneAvatars.set(c.id, a);
      }
      a.setTarget(c.x, c.z, c.yaw);
    }
  }

  syncSmokes(list) {
    const ids = new Set(list.map((s) => s.id));
    for (const [id, m] of this.smokeMeshes) {
      if (!ids.has(id)) {
        this.scene.remove(m);
        m.traverse((o) => o.geometry?.dispose());
        m.userData.mat.dispose();
        this.smokeMeshes.delete(id);
      }
    }
    for (const sm of list) {
      if (this.smokeMeshes.has(sm.id)) continue;
      const m = makeSmoke(SOLDIER.RADIUS);
      m.position.set(sm.x, 0, sm.z);
      this.scene.add(m);
      this.smokeMeshes.set(sm.id, m);
    }
  }

  /** 엔지니어 로봇: 발전기 위에 붙어 있다 */
  syncRobots(list) {
    const ids = new Set(list.map((r) => r.id));
    for (const [id, m] of this.robotMeshes) {
      if (!ids.has(id)) {
        this.scene.remove(m);
        this.robotMeshes.delete(id);
      }
    }
    for (const r of list) {
      if (this.robotMeshes.has(r.id)) continue;
      const g = this.gens.get(r.g);
      if (!g) continue;
      const m = makeRobot();
      const n = [...this.robotMeshes.values()].filter((x) => x.userData.gen === r.g).length;
      m.position.set(g.x + (n % 2 ? 0.3 : -0.2), 1.0, g.z);
      m.rotation.y = g.rot;
      m.userData.gen = r.g;
      this.scene.add(m);
      this.robotMeshes.set(r.id, m);
    }
  }

  /** 변장한 술래: 생존자 화면에서는 고른 생존자의 아바타를 대신 보여 준다 */
  showDisguise(p, hunterAvatar) {
    let d = this.disguiseAvatars.get(p.id);
    if (!p.look) {
      if (d) d.avatar.group.visible = false;
      return;
    }
    if (!d || d.look !== p.look) {
      if (d) {
        this.scene.remove(d.avatar.group);
        d.avatar.dispose();
      }
      const as = this.info.get(p.look);
      const avatar = new Avatar(ROLE.SURVIVOR, as?.index ?? 0, as?.name ?? '?', true);
      avatar.setTarget(p.x, p.z, p.yaw, true);
      this.scene.add(avatar.group);
      d = { look: p.look, avatar };
      this.disguiseAvatars.set(p.id, d);
    }
    d.avatar.setTarget(p.x, p.z, p.yaw);
    d.avatar.repairing = !!p.rep; // 발전기 옆에서 수리하는 척
    d.avatar.group.visible = p.st === STATUS.ALIVE;
    hunterAvatar.group.visible = false;
  }

  /** 서버 목록에 맞춰 날아가는 물체(닻, 유도탄) 모델을 만들고 지운다 */
  syncProjectiles(map, list, make) {
    const ids = new Set(list.map((o) => o.id));
    for (const [id, m] of map) {
      if (!ids.has(id)) {
        this.scene.remove(m);
        map.delete(id);
      }
    }
    for (const o of list) {
      let m = map.get(o.id);
      if (!m) {
        m = make();
        m.position.set(o.x, 1.2, o.z);
        this.scene.add(m);
        map.set(o.id, m);
      }
      m.userData.target = { x: o.x, z: o.z };
    }
  }

  showExit(exit) {
    this.exit = exit;
    this.exitMesh = this.isMine ? makeMineExit(exit) : this.isBackrooms ? makeBackroomsExit(exit) : makeExit(exit);
    this.scene.add(this.exitMesh);
    $('hud-exit').classList.remove('hidden');
  }

  onEvent(e) {
    const name = (id) => this.info.get(id)?.name ?? '?';
    const me = e.id === this.myId;
    switch (e.kind) {
      case 'swing':
        if (e.id !== this.myId) {
          this.avatars.get(e.id)?.playSwing();
          if (this.distTo(e.id) < 15) sfx.swing();
        }
        break;
      case 'shot':
        this.onShot(e);
        break;
      case 'bulletEnd':
        this.onBulletEnd(e);
        break;
      case 'hit': {
        this.avatars.get(e.id)?.hitFlash();
        this.damagePop(e);
        const max = e.max ?? this.hitsToCatch;
        const dmg = `-${fmtHits(e.dmg)}칸`;
        const far = e.far
          ? ` · ${e.dist}m 원거리 저격! ${dmg}`
          : e.wisp
            ? ` · 유도탄 ${dmg}`
            : e.dash
              ? ` · 질주 ${dmg}`
              : e.crack
                ? ` · 땅 갈라짐 ${dmg}`
                : e.thrown
                ? e.wall
                  ? ` · 벽에 내던져짐 ${dmg}`
                  : ` · 던져진 생존자와 충돌 ${dmg}`
              : e.ball
                ? ` · 공 ${dmg}`
                : e.dmg !== 1
                  ? ` ${dmg}`
                  : '';
        const hp = `(${fmtHits(e.hits)}/${max})`;
        if (me) {
          sfx.hit();
          this.flash('hit');
          this.shake = e.ball ? 0.2 : 0.35;
          this.centerMsg(
            `맞았다! ${hp}${e.far ? ` 원거리 저격 ${dmg}` : e.ball ? ` 공 ${dmg}` : e.dmg !== 1 ? ` ${dmg}` : ''}${e.aimed ? ' · 조준 저격에 느려졌다' : ''}`,
            1.5,
          );
        } else if (e.by === this.myId) {
          sfx.hit();
          this.hitMarker();
          this.feed(`${name(e.id)} 명중 ${hp}${far}`);
        } else this.feed(`${name(e.id)}이(가) 맞았다 ${hp}${far}`);
        break;
      }
      case 'caught':
        sfx.caught();
        if (e.by === this.myId) this.hitMarker();
        this.damagePop(e);
        if (this.info.get(e.id)?.dummy) {
          this.hpBars.get(e.id)?.set(Infinity);
          this.feed(`💀 ${name(e.id)} 쓰러짐 · ${TRAINING.REVIVE_TIME}초 뒤 다시 일어나요`, 'warn');
          break;
        }
        this.feed(`💀 ${name(e.id)}이(가) 잡혔다${e.spyKill ? ` (${e.dist}m 저격 즉사 · 최고의 스파이들)` : e.far ? ` (${e.dist}m 저격)` : ''}`, 'bad');
        if (me) this.flash('hit');
        break;
      case 'trapped':
        sfx.trapSnap();
        if (me) {
          this.stunLeft = RULES.TRAP_STUN;
          this.flash('stun');
          this.controls.releaseAll();
        }
        this.feed(`🪤 ${name(e.id)}이(가) 덫에 걸렸다`, 'warn');
        break;
      case 'invis': {
        // 투명화 시작은 같은 편에게만, 해제는 모두에게 온다
        if (me) {
          if (!e.on) {
            this.invisLeft = 0;
            this.skillLeft = ASSASSIN.SKILL_COOLDOWN;
            if (e.reason === 'hit') this.slowLeft = ASSASSIN.SLOW_TIME;
            sfx.invisOff();
            this.centerMsg(e.reason === 'hit' ? `기습 성공! 투명화가 풀리고 ${ASSASSIN.SLOW_TIME}초간 느려진다` : '투명화가 풀렸다', 2);
          }
        } else if (!e.on && !this.isHunter && this.status === STATUS.ALIVE && e.reason === 'hit') {
          this.feed(`🥷 암살자가 모습을 드러냈다`, 'bad');
        }
        break;
      }
      case 'anchor':
        if (!me) {
          this.avatars.get(e.id)?.playSwing();
          if (this.distTo(e.id) < 30) sfx.throwAnchor();
        }
        break;
      case 'anchorEnd':
        if (e.hit) {
          sfx.clank();
          if (e.hit !== this.myId) this.feed(`⚓ ${name(e.hit)}이(가) 닻에 걸렸다`, 'warn');
        }
        break;
      case 'dive': {
        // 익사자가 땅속으로: 모두에게 도착 원(경고)과 출발 자리 물보라
        const near = Math.hypot(e.x - this.pos.x, e.z - this.pos.z) < 30 || Math.hypot(e.fx - this.pos.x, e.fz - this.pos.z) < 30;
        this.effects.push(makeDiveWarning(this.scene, e.x, e.z, e.r, e.time));
        this.effects.push(makeSplash(this.scene, e.fx, e.fz, 0.7));
        if (me || near) sfx.diveIn(me ? 1 : 0.6);
        if (me) {
          this.forced = true;
          $('screen-game').classList.add('diving');
        } else if (!this.isHunter && this.status === STATUS.ALIVE && Math.hypot(e.x - this.pos.x, e.z - this.pos.z) < e.r + 3) {
          this.centerMsg('🌊 발밑에 물살이! 원 밖으로 피하세요', 0.8);
        }
        break;
      }
      case 'diveEnd': {
        this.effects.push(makeSplash(this.scene, e.x, e.z, 1.4));
        if (me || Math.hypot(e.x - this.pos.x, e.z - this.pos.z) < 35) sfx.diveOut(me ? 1 : 0.7);
        if (me) {
          $('screen-game').classList.remove('diving');
          this.shake = 0.3;
          if (e.hits.length) {
            this.hitMarker();
            this.feed(`🌊 다이빙! ${e.hits.map(name).join(', ')} 튕겨 냄`, 'good');
          }
        } else if (e.hits.includes(this.myId)) {
          this.flash('hit');
          this.shake = 0.35;
          this.centerMsg(`🌊 물살에 튕겨 나갔다! ${DROWNED.SLOW_TIME}초간 느려진다`, 1.5);
        } else if (e.hits.length) this.feed(`🌊 ${e.hits.map(name).join(', ')}이(가) 다이빙에 튕겨 나갔다`, 'warn');
        break;
      }
      case 'diveFail':
        this.skillLeft = 0;
        this.centerMsg('그곳으로는 다이빙할 수 없어요', 1);
        break;
      case 'spyReveal':
        this.spyRevealUntil = performance.now() + e.time * 1000;
        this.feed('🎯🥷 최고의 스파이들: 생존자 위치 포착!', 'good');
        break;
      case 'ropeHit':
        sfx.clank();
        if (e.hit !== this.myId) this.feed(`⚓ ${name(e.hit)}이(가) 닻 밧줄에 걸렸다`, 'warn');
        break;
      case 'wisps':
        // 보이는 생존자가 없으면 헛방 (쿨타임은 소모됨)
        if (me) {
          if (e.count > 0) this.feed(`🔮 유도탄 ${e.count}개 발사`);
          else this.centerMsg('보이는 생존자가 없어 헛방이었다', 1.5);
        } else if (e.count > 0) {
          sfx.wisp();
          if (!this.isHunter && this.status === STATUS.ALIVE) {
            this.feed(e.legend ? '👻👒 처녀귀신의 유도탄이 어디든 쫓아온다!' : '👻 처녀귀신이 유도탄을 날렸다!', 'bad');
          }
        }
        break;
      case 'disguise':
        if (me) {
          if (!e.on && this.disguised) this.setDisguised(false);
          if (e.on) this.centerMsg(`🎭 ${name(e.as)}의 모습으로 변장했다`, 2);
        } else if (!e.on && !this.isHunter && this.status === STATUS.ALIVE) {
          sfx.reveal();
          this.feed('🎭 생존자인 줄 알았던 자가 술래였다!', 'bad');
        }
        break;
      case 'dash':
        if (e.phase === 'windup') sfx.dashCharge(me ? 1 : Math.max(0.2, 1 - this.distTo(e.id) / 40));
        else if (e.phase === 'dash') {
          sfx.dashWhoosh(me ? 1 : Math.max(0.2, 1 - this.distTo(e.id) / 40));
          if (me) this.shake = 0.25;
        }
        break;
      case 'trapPlaced':
        break;
      // ───── 팔척귀신 ─────
      case 'grab': {
        const vol = me || e.target === this.myId ? 1 : Math.max(0.2, 1 - this.distTo(e.id) / 30);
        sfx.grab(vol);
        if (!me) this.avatars.get(e.id)?.playSwing();
        if (me) {
          this.carrying = e.target;
          this.carryLeft = e.time;
          this.lastSkillAt = performance.now();
          this.feed(`👒 ${name(e.target)} 납치! 다시 스킬 키로 던지기 (${e.time}초)`, 'good');
        } else if (e.target === this.myId) {
          this.controls.releaseAll();
          this.shake = 0.3;
          this.centerMsg('👒 팔척귀신에게 붙잡혔다!', 2);
        } else this.feed(`👒 ${name(e.target)}이(가) 팔척귀신에게 붙잡혔다`, 'warn');
        break;
      }
      case 'grabMiss':
        if (me) {
          this.skillLeft = this.skillCooldown;
          this.centerMsg(e.clone ? '분신이었다!' : '잡을 생존자가 없어 헛손질했다', 1.2);
        }
        break;
      case 'throw':
        if (!me) {
          this.avatars.get(e.id)?.playSwing();
          if (this.distTo(e.id) < 30 || e.target === this.myId) sfx.hurl(e.target === this.myId ? 1 : 0.6);
        }
        if (e.target === this.myId) {
          this.shake = 0.4;
          this.centerMsg('🌀 내던져졌다!', 1.2);
        }
        break;
      case 'drop':
        if (me) {
          this.carrying = null;
          this.carryLeft = 0;
          this.skillLeft = this.skillCooldown;
          this.lastSkillAt = performance.now();
          if (e.reason === 'timeout') {
            this.stunLeft = Math.max(this.stunLeft, PALCHEOK.DROP_STUN);
            this.centerMsg(`힘이 빠져 내려놓았다… ${PALCHEOK.DROP_STUN}초 기절`, 1.5);
          } else if (e.reason === 'taser') this.centerMsg('테이저건에 맞아 놓쳤다!', 1.5);
        } else if (e.target === this.myId) {
          this.centerMsg(e.reason === 'taser' ? '⚡ 팔척귀신이 나를 놓쳤다! 도망쳐요' : '팔척귀신이 나를 내려놓았다! 도망쳐요', 1.5);
        } else if (e.target && e.reason === 'taser') this.feed(`⚡ 팔척귀신이 ${name(e.target)}을(를) 놓쳤다`, 'good');
        break;
      case 'crack': {
        // 도시괴담: 던진 생존자가 떨어진 자리에 지름 5m로 땅이 갈라짐
        const d = Math.hypot(e.x - this.pos.x, e.z - this.pos.z);
        this.effects.push(makeCrack(this.scene, e.x, e.z, e.r));
        if (d < 40) sfx.quake(Math.max(0.25, 1 - d / 40));
        if (d < 12) this.shake = Math.max(this.shake, 0.35 * (1 - d / 12) + 0.1);
        if (e.id === this.myId && e.hits.length) this.feed(`👻👒 땅이 갈라졌다! ${e.hits.map(name).join(', ')}`, 'good');
        break;
      }
      case 'thrownEnd':
        if (e.reason !== 'land') sfx.clank();
        if (e.by === this.myId && e.reason === 'hit') this.feed(`👒 ${name(e.id)}을(를) ${name(e.other)}에게 명중!`, 'good');
        break;
      // ───── 광대 ─────
      case 'ball':
        this.onBall(e);
        break;
      case 'ballEnd': {
        const b = this.balls.get(e.bid);
        if (b) {
          this.scene.remove(b.mesh);
          this.balls.delete(e.bid);
        }
        if (!e.out) {
          this.effects.push(makeImpact(this.scene, new THREE.Vector3(e.x, e.y, e.z), e.hit ? '#ff5a4a' : '#f2c230'));
          sfx.ballBounce(Math.max(0.2, 1 - Math.hypot(e.x - this.pos.x, e.z - this.pos.z) / 30));
        }
        break;
      }
      case 'threadPlaced':
        break;
      case 'threadFail':
        // 양쪽 벽이 없어 실을 못 침 (개수는 그대로)
        this.charges = Math.min(this.trapMax, this.charges + 1);
        this.lastTrapAt = 0;
        this.centerMsg('🧵 좌우 양쪽 10m 안에 벽이 있어야 실을 칠 수 있어요', 2);
        break;
      case 'threaded':
        sfx.threadTwang();
        if (me) {
          this.flash('stun');
          this.centerMsg('🧵 실에 걸렸다! 몸이 빛나 술래에게 보이고 2초간 느려진다', 2);
        }
        this.feed(`🧵 ${name(e.id)}이(가) 광대 실에 걸렸다`, 'warn');
        break;
      // ───── 생존자 직업 ─────
      case 'sskillFail':
        this.sskillLeft = 0;
        this.lastSSkillAt = 0;
        this.centerMsg(e.reason === 'noGen' ? '🔧 발전기 가까이(1.5m 안)에서 써야 해요' : '🩺 회복할 다친 생존자가 없어요', 1.6);
        break;
      case 'healed':
        sfx.heal();
        if (e.target === this.myId) {
          this.hits = e.hits;
          this.centerMsg(e.id === this.myId ? '🩺 스스로 한 칸 회복했다' : `🩺 ${name(e.id)}이(가) 치료해 줬다! (${fmtHits(e.hits)}/${e.max})`, 2);
        }
        if (!this.isHunter || this.status !== STATUS.ALIVE) this.feed(`🩺 ${name(e.target)} 한 칸 회복 (${fmtHits(e.hits)}/${e.max})`, 'good');
        break;
      case 'taser':
        this.onTaser(e);
        break;
      case 'taserEnd': {
        const b = this.bolts.get(e.tid);
        if (b) {
          this.scene.remove(b.mesh);
          this.bolts.delete(e.tid);
        }
        if (e.hit) {
          sfx.zap();
          this.effects.push(makeImpact(this.scene, new THREE.Vector3(e.x, 1.2, e.z), '#7ad7ff'));
          if (e.hit === this.myId) {
            this.stunLeft = POLICE.STUN;
            this.flash('stun');
            this.controls.releaseAll();
            this.centerMsg(`⚡ 테이저건에 맞았다! ${POLICE.STUN}초 동안 움직일 수 없다`, 2);
          } else this.feed(`⚡ ${name(e.id)}의 테이저건이 술래를 맞혔다! (${POLICE.STUN}초 스턴)`, this.isHunter ? 'bad' : 'good');
        }
        break;
      }
      case 'smoke':
        sfx.smoke(Math.max(0.2, 1 - this.distTo(e.id) / 30));
        if (!this.isHunter && e.id !== this.myId) this.feed(`🪖 ${name(e.id)}이(가) 연막탄을 터뜨렸다`, 'good');
        break;
      case 'clone':
        sfx.poof();
        if (me) this.centerMsg('🌀 분신이 앞으로 걸어간다', 1.5);
        break;
      case 'cloneGone':
        if (e.by) {
          sfx.poof();
          this.effects.push(makeImpact(this.scene, new THREE.Vector3(e.x, 1.0, e.z), '#d8d8e8'));
          if (e.by === this.myId) this.centerMsg('🌀 분신이었다!', 1.5);
          else if (e.id === this.myId) this.feed('🌀 술래가 분신을 공격했다', 'good');
        }
        break;
      case 'robot':
        sfx.robot();
        if (me) this.centerMsg('🤖 로봇이 발전기를 수리한다 (5초간 20%)', 1.8);
        break;
      case 'genFound':
        if (!this.isHunter) this.feed('🗺️ 발전기를 찾아 지도에 표시했다', 'good');
        break;
      case 'genDone':
        sfx.genDone();
        this.feed(`💡 발전기 가동 (${e.done}/${this.gens.size})`, 'good');
        break;
      case 'exitOpen':
        sfx.exitOpen();
        this.showExit(e.exit);
        this.centerMsg(
          this.isMine
            ? '탈출구가 열렸다! 빛이 새어 나오는 갱구로 가세요'
            : this.isBackrooms
              ? '탈출구가 열렸다! 초록 EXIT 문을 찾으세요'
              : '탈출구가 열렸다! 빛나는 도리이로 가세요',
          3,
        );
        this.feed(`${this.isMine || this.isBackrooms ? '🚪' : '⛩️'} 탈출구가 열렸다`, 'good');
        break;
      case 'escaped':
        this.feed(`🏁 ${name(e.id)} 탈출 성공`, 'good');
        if (me) this.centerMsg(this.training ? '탈출 성공! 처음부터 다시 시작해요' : '탈출 성공!', 3);
        break;
      case 'revived':
        this.hpBars.get(e.id)?.set(0);
        this.feed(`🎯 ${name(e.id)}이(가) 다시 일어났다`);
        break;
      case 'left':
        this.feed(`${e.name} 님이 나갔어요`);
        break;
      default:
        break;
    }
  }

  /** 훈련장: 허수아비가 맞은 피해량을 머리 위에 띄운다 */
  damagePop(e) {
    if (!this.info.get(e.id)?.dummy || e.dmg == null) return;
    const a = this.avatars.get(e.id);
    if (!a) return;
    this.effects.push(makeDamagePop(this.scene, a.pos, `-${fmtHits(e.dmg)}`, e.dmg >= 2 ? '#ff7a4a' : '#ffd25a'));
  }

  /** 총알 발사 이벤트: 총구에서 궤적을 그린다 */
  onShot(e) {
    const dir = new THREE.Vector3(e.dx, e.dy, e.dz);
    let origin;
    if (e.id === this.myId) {
      // 내 총알은 화면 오른쪽 아래 총구에서 출발하는 것처럼 보이게
      origin = new THREE.Vector3(0.18, -0.12, -0.6).applyQuaternion(this.camera.quaternion).add(this.camera.position);
    } else {
      const a = this.avatars.get(e.id);
      a?.playSwing();
      origin = a ? a.muzzleWorld() : new THREE.Vector3(e.x, e.y, e.z);
      // 멀어도 들리는 총소리 (거리에 따라 작게)
      const d = this.distTo(e.id);
      sfx.gunshot(Math.max(0.15, 1 - d / 120));
    }
    // 서버 기준 출발점과 방향으로 그리되, 화면상 총구 위치에서 시작
    const tracer = new Tracer(this.scene, origin, dir, SNIPER.BULLET_SPEED);
    tracer.serverOrigin = new THREE.Vector3(e.x, e.y, e.z);
    this.tracers.set(e.bid, tracer);
    this.liveTracers.push(tracer);
    this.effects.push(makeImpact(this.scene, origin, '#ffd27a'));
  }

  onBulletEnd(e) {
    const p = new THREE.Vector3(e.x, e.y, e.z);
    const t = this.tracers.get(e.bid);
    if (t) {
      // 화면상 출발점(총구)이 서버 출발점과 조금 달라도, 서버에서 날아간 거리만큼 가서 멈춘다
      t.stopAt(t.start.clone().addScaledVector(t.dir, p.distanceTo(t.serverOrigin)));
      this.tracers.delete(e.bid);
    }
    if (!e.out) this.effects.push(makeImpact(this.scene, p, e.hit ? '#ff5a4a' : '#fff2c0'));
  }

  toggleMap(force) {
    if (this.isHunter || !this.minimap) return;
    this.mapOpen = force ?? !this.mapOpen;
    $('map-overlay').classList.toggle('hidden', !this.mapOpen);
    $('btn-map').classList.toggle('on', this.mapOpen);
    if (this.mapOpen) this.drawMap();
  }

  drawMap() {
    // 살아 있으면 내 위치와 방향, 관전 중이면 위치 표시 없음
    const me = this.status === STATUS.ALIVE ? { x: this.pos.x, z: this.pos.z, yaw: this.yaw } : null;
    this.minimap.draw($('map-canvas'), me);
  }

  setMyStatus(st) {
    this.status = st;
    if (st === STATUS.ALIVE) return;
    this.controls.releaseAll();
    $('screen-game').classList.add('spectating');
    $('hud-repair').classList.add('hidden');
    if (this.viewBat) this.viewBat.root.visible = false;
    if (st === STATUS.CAUGHT) this.centerMsg('잡혔습니다… 관전 모드', 3);
    // 덫이 모두 보이도록 다시 그림
    for (const mesh of this.traps.values()) this.scene.remove(mesh);
    this.traps.clear();
    for (const m of this.threadMeshes.values()) this.scene.remove(m);
    this.threadMeshes.clear();
    this.cycleSpectate();
  }

  cycleSpectate() {
    const alive = [...this.info.values()].filter((p) => p.id !== this.myId && (p.status ?? STATUS.ALIVE) === STATUS.ALIVE);
    if (!alive.length) return;
    const idx = alive.findIndex((p) => p.id === this.spectateId);
    const next = alive[(idx + 1) % alive.length];
    if (this.spectateId) {
      const prev = this.avatars.get(this.spectateId);
      if (prev) prev.group.visible = true;
    }
    this.spectateId = next.id;
    const a = this.avatars.get(next.id);
    if (a) a.group.visible = false;
    $('hud-spectate').classList.remove('hidden');
    $('spectate-name').textContent = `${next.role === ROLE.HUNTER ? `${CLASS_INFO[next.cls ?? HUNTER_CLASS.MANIAC].icon} ` : ''}${next.name}`;
  }

  distTo(id) {
    const a = this.avatars.get(id);
    if (!a) return 0;
    return Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
  }

  // ───────────────────────── 매 프레임 ─────────────────────────

  loop() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    const c = this.controls;
    const alive = this.status === STATUS.ALIVE;

    // 저격수 조준: 조준 키를 누르고 있는 동안 확대
    this.aiming = this.isSniper && alive && c.isHeld('action');
    // 익사자 다이빙 조준: 누르고 있는 동안 원이 따라오고, 떼면 다이빙
    if (this.diveAim) {
      if (!alive || this.stunLeft > 0) this.endDiveAim(false);
      else if (!c.isHeld('action')) this.endDiveAim(true);
      else this.updateDiveAim();
    }

    // 시점 (확대 중에는 확대한 만큼 감도를 낮춰 정밀하게)
    const look = c.consumeLook();
    const gyro = this.gyro.consume();
    const zoom = this.camera.fov / 75;
    // 설정 창이 열려 있을 때는 자이로 회전을 버린다
    const settingsOpen = !$('modal-settings').classList.contains('hidden');
    if (alive) {
      this.yaw -= look.dx * zoom;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - look.dy * zoom));
      if (!settingsOpen) {
        this.yaw += gyro.yaw;
        this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + gyro.pitch));
      }
    }

    // 이동 (덫에 걸리면 3초 이동 불가)
    this.stunLeft = Math.max(0, this.stunLeft - dt);
    const stunned = this.stunLeft > 0;
    // 닻에 끌려오거나 질주 중이면 내 조작 대신 서버 위치를 따라간다
    if (this.forced && this.serverPos) {
      const k = 1 - Math.exp(-dt * 14);
      this.pos.x += (this.serverPos.x - this.pos.x) * k;
      this.pos.z += (this.serverPos.z - this.pos.z) * k;
    }
    this.interact = !this.isHunter && c.isHeld('main');
    // 발전기를 수리하는 동안(수리 키를 누르고 있는 동안)에는 움직일 수 없다
    const repairing = this.isRepairing();
    const mv = alive && !stunned && !this.forced && !repairing ? c.moveVector() : { x: 0, y: 0 };
    this.moving = mv.x !== 0 || mv.y !== 0;
    const wantsRun = !this.isHunter && c.isHeld('action');
    this.wantsRun = wantsRun;
    // 감속(덫이 풀린 뒤·조준 저격·광대 실)과 달리기 불가는 서버가 알려 준 값으로 예측
    if (!this.isHunter) this.running = stepStamina(this.stam, wantsRun && !stunned && !this.noRun, this.moving, dt, this.staminaMax);
    if (alive && this.moving) {
      const speed = speedFor(this.role, this.running, {
        cls: this.isHunter ? this.hunterClass : null,
        scls: this.scls,
        aiming: this.aiming,
        invisible: this.isAssassin && this.invisLeft > 0,
        slowed: this.isAssassin && this.slowLeft > 0,
        wallSlowed: this.isGhost && this.wallSlowLeft > 0,
        disguised: this.disguised,
        slowFactor: this.isHunter ? 1 : this.slowFactor,
        noRun: this.noRun,
      });
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // 앞 = (-sin, -cos), 오른쪽 = (cos, -sin)
      const dx = (-sin * mv.y + cos * mv.x) * speed * dt;
      const dz = (-cos * mv.y - sin * mv.x) * speed * dt;
      const p = this.collision.move(this.pos.x, this.pos.z, dx, dz, RULES.PLAYER_RADIUS);
      // 유령: 벽을 빠져나온 순간부터 1초 동안 느려진다 (서버와 같은 판정)
      if (this.isGhost && ghostWallExit(this.wallState, this.wallWorld, this.pos.x, this.pos.z, p.x, p.z)) this.wallSlowLeft = GHOST.WALL_SLOW_TIME;
      this.pos.x = p.x;
      this.pos.z = p.z;
    }
    if (this.isGhost) {
      this.wallSlowLeft = Math.max(0, this.wallSlowLeft - dt);
      $('screen-game').classList.toggle('slowed', this.wallSlowLeft > 0 && alive);
    }

    this.attackLeft = Math.max(0, this.attackLeft - dt);
    this.sskillLeft = Math.max(0, this.sskillLeft - dt);
    if (this.hasClassSkill) this.skillLeft = Math.max(0, this.skillLeft - dt);
    if (this.carrying) this.carryLeft = Math.max(0, this.carryLeft - dt);
    if (this.isAssassin) {
      if (this.invisLeft > 0) this.invisLeft = Math.max(0, this.invisLeft - dt);
      else this.skillLeft = Math.max(0, this.skillLeft - dt);
      this.slowLeft = Math.max(0, this.slowLeft - dt);
      $('screen-game').classList.toggle('slowed', this.slowLeft > 0 && this.status === STATUS.ALIVE);
      const invis = this.invisLeft > 0 && this.status === STATUS.ALIVE;
      $('screen-game').classList.toggle('invisible', invis);
      this.viewBat?.setGhost(invis);
    }
    this.matchTime = Math.min(RULES.MATCH_TIME, (this.matchTime || 0) + dt);
    if (this.chargeLeft > 0 && this.charges < this.trapMax) this.chargeLeft = Math.max(0, this.chargeLeft - dt);

    // 서버로 입력 전송 (초당 20회)
    this.sendTimer -= dt;
    if (alive && this.sendTimer <= 0) {
      this.sendTimer = 1 / RULES.INPUT_RATE;
      this.net.send({
        t: 'input',
        x: Math.round(this.pos.x * 1000) / 1000,
        z: Math.round(this.pos.z * 1000) / 1000,
        yaw: Math.round(this.yaw * 1000) / 1000,
        pitch: Math.round(this.pitch * 1000) / 1000,
        run: wantsRun,
        moving: this.moving,
        interact: this.interact,
        aim: this.aiming,
        corr: this.corr,
      });
    }

    for (const a of this.avatars.values()) a.update(dt);
    this.liveTracers = this.liveTracers.filter((t) => t.update(dt));
    for (const d of this.disguiseAvatars.values()) d.avatar.update(dt);
    for (const a of this.cloneAvatars.values()) a.update(dt);
    this.updateNewProjectiles(dt);
    this.updateProjectiles(dt);
    this.effects = this.effects.filter((fx) => fx(dt));
    for (const g of this.gens.values()) g.model.update(dt);
    if (this.exitMesh) {
      const portal = this.exitMesh.userData.portal;
      portal.material.opacity = 0.45 + Math.sin(performance.now() / 300) * 0.15;
    }

    this.updateCamera(dt);
    this.updateHud(dt);
    if (this.mapOpen) this.drawMap();
  }

  updateCamera(dt) {
    const cam = this.camera;
    if (this.status !== STATUS.ALIVE && this.spectateId) {
      const a = this.avatars.get(this.spectateId);
      const info = this.info.get(this.spectateId);
      if (!a || (info?.status ?? STATUS.ALIVE) !== STATUS.ALIVE) {
        this.cycleSpectate();
      } else {
        // 팔척귀신은 2.3m, 들리거나 던져진 사람은 몸 높이에서
        const sEye = a.carried || a.thrown ? a.group.position.y + 0.2 : eyeHeightFor(info?.cls) + a.group.position.y;
        cam.position.set(a.pos.x, sEye, a.pos.z);
        cam.rotation.set(a.pitch ?? 0, a.yaw, 0);
        if (cam.fov !== 75) {
          cam.fov = 75;
          cam.updateProjectionMatrix();
          $('screen-game').classList.remove('scoped');
        }
        this.sky.position.copy(cam.position);
        return;
      }
    }
    this.bobT += dt * (this.moving ? (this.running ? 13 : 10) : 0);
    const bob = this.moving ? Math.sin(this.bobT) * 0.035 : 0;
    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      this.shake -= dt;
      sx = (Math.random() - 0.5) * this.shake * 0.2;
      sy = (Math.random() - 0.5) * this.shake * 0.2;
    }
    // 내 점프 높이
    let jy = 0;
    if (this.jumpT !== null) {
      // 프레임이 느려도 서버와 같은 0.5초가 되도록 실제 시계로 잰다
      this.jumpT = (performance.now() - this.jumpStart) / 1000;
      jy = jumpHeight(this.jumpT);
      if (this.jumpT >= RULES.JUMP_TIME) {
        this.jumpT = null;
        sfx.land();
      }
    }
    // 팔척귀신은 2.3m. 팔척귀신에게 들리면 머리 위 높이(2.9m)에서 본다
    const baseEye = this.carriedBy ? 2.9 : this.eyeHeight;
    const eye = (this.stunLeft > 0 ? baseEye - 0.25 : baseEye) + jy;
    cam.position.set(this.pos.x + sx, eye + bob + sy, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0);
    const targetFov = this.aiming ? SNIPER.AIM_FOV : this.running ? 82 : 75;
    if (Math.abs(cam.fov - targetFov) > 0.1) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * (this.aiming ? 14 : 8));
      cam.updateProjectionMatrix();
    }
    this.sky.position.copy(cam.position);
    this.dust?.update(dt, cam.position);
    this.worldGroup.userData.update?.(dt);
    if (this.isBackrooms) ensureHum(); // 형광등 웅웅거림
    this.viewBat?.update(dt, this.moving, this.aiming);
    $('screen-game').classList.toggle('scoped', this.aiming && cam.fov < 40);
  }

  // ───────────────────────── HUD ─────────────────────────

  /** 수리 중: 생존자가 고치지 않은 발전기 옆에서 수리 키를 누르고 있음 (이동·점프 불가) */
  isRepairing() {
    return !this.isHunter && this.status === STATUS.ALIVE && !!this.interact && !this.forced && !!this.nearestGen();
  }

  nearestGen() {
    let best = null;
    let bestD = RULES.GENERATOR_INTERACT_RANGE;
    for (const g of this.gens.values()) {
      if (g.done) continue;
      const d = Math.hypot(g.x - this.pos.x, g.z - this.pos.z);
      if (d <= bestD) {
        best = g;
        bestD = d;
      }
    }
    return best;
  }

  updateHud(dt) {
    // 남은 시간 (훈련장은 제한 시간 없음)
    const left = Math.max(0, Math.ceil(RULES.MATCH_TIME - (this.matchTime || 0)));
    const timerText = this.training ? '🎯 훈련장' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (timerText !== this.lastTimerText) {
      this.lastTimerText = timerText;
      const el = $('hud-timer');
      el.textContent = timerText;
      el.classList.toggle('urgent', left <= 60 && !this.training);
      if (left === 60 && !this.training) this.centerMsg('남은 시간 1분!', 2);
    }
    const alive = this.status === STATUS.ALIVE;
    if (!this.isHunter && alive) {
      const st = this.stam.stamina / this.staminaMax;
      $('stamina-fill').style.transform = `scaleX(${st})`;
      $('stamina').classList.toggle('low', st < 0.25);
      const heartsHtml = this.heartsHtml(this.maxHits, this.hits);
      if (heartsHtml !== this.lastHeartsHtml) {
        this.lastHeartsHtml = heartsHtml;
        $('hearts').innerHTML = heartsHtml;
        $('hearts').classList.toggle('many', this.maxHits > 5);
      }
      this.updateSurvivorSkill();
      const gen = this.nearestGen();
      $('btn-main').classList.toggle('ready', !!gen);
      const repairing = gen && this.interact;
      $('hud-repair').classList.toggle('hidden', !gen);
      if (gen) {
        // 서버 진행도에 내 수리분을 살짝 앞당겨 보여줘서 부드럽게
        if (repairing) gen.progress = Math.min(0.999, gen.progress + dt / RULES.GENERATOR_REPAIR_TIME);
        $('repair-fill').style.transform = `scaleX(${gen.progress})`;
        $('repair-text').textContent = repairing
          ? `수리 중… ${Math.floor(gen.progress * 100)}%`
          : `발전기 ${Math.floor(gen.progress * 100)}% · 수리 버튼을 꾹 누르세요`;
        if (repairing && Math.random() < dt * 6) sfx.repairTick();
      }
      // 심장 박동: 술래가 가까울수록 빠르고 크게
      // 가장 가까운 술래 기준 (술래가 2명일 수 있음)
      let d = 999;
      for (const p of this.info.values()) {
        // 투명한 암살자, 변장한 살가죽은 심장 박동도 울리지 않는다
        if (p.role === ROLE.HUNTER && !p.hidden && !p.disguised && (p.status ?? STATUS.ALIVE) !== 'left') d = Math.min(d, this.distTo(p.id));
      }
      if (d < 24) {
        this.heartbeatT -= dt;
        if (this.heartbeatT <= 0) {
          const k = 1 - d / 24;
          sfx.heartbeat(0.3 + k * 0.7);
          this.heartbeatT = 1.3 - k * 0.85;
        }
      }
      $('screen-game').classList.toggle('danger', d < 12);
      // 배경음악: 24m부터 먹먹해지기 시작해서 8m 안이면 거의 심장 소리만
      this.danger = Math.max(0, Math.min(1, (24 - d) / 16));
    }
    if (this.isHunter) this.updateHunterHud();
    const screen = $('screen-game');
    screen.classList.toggle('smoked', this.smoked && alive);
    screen.classList.toggle('s-slowed', !this.isHunter && alive && this.slowFactor < 1);
    screen.classList.toggle('no-run', !this.isHunter && alive && this.noRun);
    if (this.isHunter || !alive) this.danger = 0; // 술래와 관전자는 늘 보통 배경음악
    this.bgm.update(dt, this.danger);

    const stun = $('hud-stun');
    if (this.stunLeft > 0 && alive) {
      stun.classList.remove('hidden');
      stun.textContent = this.isHunter ? `⚡ 테이저건 스턴! ${this.stunLeft.toFixed(1)}초` : `덫에 걸렸다! ${this.stunLeft.toFixed(1)}초`;
    } else stun.classList.add('hidden');

    if (this.exit) {
      const ref = this.status !== STATUS.ALIVE && this.spectateId ? this.avatars.get(this.spectateId) : null;
      const px = ref ? ref.pos.x : this.pos.x;
      const pz = ref ? ref.pos.z : this.pos.z;
      const yaw = ref ? ref.yaw : this.yaw;
      const dx = this.exit.x - px;
      const dz = this.exit.z - pz;
      // 0 = 정면, +는 왼쪽, -는 오른쪽 (-π ~ π)
      let angle = Math.atan2(-dx, -dz) - yaw;
      angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      // 화살표는 위(정면)를 기준으로 탈출구 쪽으로 돈다
      $('exit-arrow').style.transform = `rotate(${-angle}rad)`;
      const deg = (angle * 180) / Math.PI;
      const a = Math.abs(deg);
      const side = deg > 0 ? '왼쪽' : '오른쪽';
      const dir = a < 22.5 ? '앞으로' : a < 67.5 ? `${side} 앞` : a < 112.5 ? `${side}으로` : a < 157.5 ? `${side} 뒤` : '뒤로';
      $('exit-dir').textContent = dir;
      const dist = Math.hypot(dx, dz);
      $('exit-dist').textContent = `${Math.round(dist)}m`;
      $('hud-exit').classList.toggle('near', dist < 12);
    }
  }

  /** 닻·유도탄 움직임과 닻 사슬 */
  updateProjectiles(dt) {
    const k = 1 - Math.exp(-dt * 18);
    const t = performance.now() / 1000;
    for (const m of this.anchorMeshes.values()) {
      const g = m.userData.target;
      const dx = g.x - m.position.x;
      const dz = g.z - m.position.z;
      // 돌지 않고 날아가는 방향으로 닻 끝을 향한 채 일자로 나아감
      if (Math.hypot(dx, dz) > 0.02) {
        m.rotation.order = 'YXZ';
        m.rotation.set(Math.PI / 2, Math.atan2(-dx, -dz), 0);
      }
      m.position.x += dx * k;
      m.position.z += dz * k;
    }
    for (const [id, m] of this.wispMeshes) {
      const g = m.userData.target;
      m.position.x += (g.x - m.position.x) * k;
      m.position.z += (g.z - m.position.z) * k;
      m.position.y = 1.3 + Math.sin(t * 4 + id) * 0.15;
      m.lookAt(this.camera.position.x, m.position.y, this.camera.position.z);
    }
    // 사슬: 선장 손 → 날아가는 닻 / 끌려오는 사람
    const posOf = (id) => {
      if (id === this.myId) return new THREE.Vector3(this.pos.x, 1.2, this.pos.z);
      const a = this.avatars.get(id);
      return a ? new THREE.Vector3(a.pos.x, 1.2, a.pos.z) : null;
    };
    const arr = this.chain.geometry.attributes.position.array;
    let n = 0;
    const seg = (a, b) => {
      if (!a || !b || n >= 16) return;
      arr.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 6);
      n++;
    };
    for (const m of this.anchorMeshes.values()) seg(this.captainPosForAnchor(m), m.position);
    for (const [who, by] of this.pulls) seg(posOf(by), posOf(who));
    this.chain.geometry.setDrawRange(0, n * 2);
    this.chain.geometry.attributes.position.needsUpdate = true;
  }

  /** 날아가는 닻에서 가장 가까운 선장 (사슬을 그릴 시작점) */
  captainPosForAnchor(m) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.info.values()) {
      if (p.cls !== HUNTER_CLASS.CAPTAIN) continue;
      const pos = p.id === this.myId ? new THREE.Vector3(this.pos.x, 1.2, this.pos.z) : this.avatars.get(p.id)?.pos.clone().setY(1.2);
      if (!pos) continue;
      const d = pos.distanceTo(m.position);
      if (d < bestD) {
        best = pos;
        bestD = d;
      }
    }
    return best;
  }

  updateHunterHud() {
    this.updateHunterButtons();
    this.updatePcCooldowns();
  }

  /** PC: 화면 아래 가운데에 공격(좌클릭)·스킬(E) 쿨타임을 터치 버튼과 같은 모양으로 보여 준다 */
  updatePcCooldowns() {
    const slot = (dst, frac, text, flags, count = '') => {
      dst.style.setProperty('--cd', String(Math.max(0, Math.min(1, frac || 0))));
      for (const f of ['empty', 'aiming', 'ready']) dst.classList.toggle(f, !!flags[f]);
      dst.querySelector('.t').textContent = text;
      const c = dst.querySelector('.count');
      if (c) c.textContent = count;
    };
    const atk = this.attackLeft > 0;
    slot($('cd-main'), this.attackLeft / this.attackCooldown, atk ? `${this.attackLeft.toFixed(1)}s` : '', { empty: atk, ready: !atk });
    const btnT = $('btn-action');
    const frac = parseFloat(btnT.style.getPropertyValue('--cd')) || 0;
    const text = btnT.querySelector('.timer').textContent;
    const aiming = btnT.classList.contains('aiming');
    const empty = btnT.classList.contains('empty');
    const isTrap = !this.hasClassSkill && !this.isAssassin && !this.isSniper;
    slot($('cd-action'), frac, text, { aiming, empty, ready: !aiming && !empty && !text }, isTrap ? String(this.charges) : '');
  }

  updateHunterButtons() {
    const btnA = $('btn-main');
    const btnT = $('btn-action');
    btnA.style.setProperty('--cd', String(this.attackLeft / this.attackCooldown));
    btnA.classList.toggle('cooling', this.attackLeft > 0);
    if (this.hasClassSkill) {
      // 선장·유령·살가죽·질주자: 스킬 쿨타임 링과 남은 초
      const active = this.disguised || (this.isSprinter && !!this.myDash) || !!this.diveAim || !!this.carrying;
      if (this.isPalcheok) {
        // 들고 있으면 스킬 버튼이 던지기로 바뀐다
        const lbl = this.carrying ? ['🌀', '던지기'] : ['🫳', '납치'];
        btnT.querySelector('.ico').textContent = lbl[0];
        btnT.querySelector('.lbl').textContent = lbl[1];
        $('cd-action').querySelector('.ico').textContent = lbl[0];
      }
      btnT.classList.toggle('aiming', active);
      btnT.classList.toggle('empty', !active && this.skillLeft > 0);
      btnT.style.setProperty('--cd', String(active ? 0 : Math.min(1, this.skillLeft / this.skillCooldown)));
      btnT.querySelector('.timer').textContent = active
        ? this.disguised
          ? '변장 중'
          : this.diveAim
            ? '조준'
            : this.carrying
              ? `${Math.ceil(this.carryLeft)}s`
              : '질주!'
        : this.skillLeft > 0
          ? `${Math.ceil(this.skillLeft)}s`
          : '';
      return;
    }
    if (this.isAssassin) {
      // 암살자: 투명화 중이면 남은 시간, 끝나면 쿨타임
      const invis = this.invisLeft > 0;
      btnT.classList.toggle('aiming', invis);
      btnT.classList.toggle('empty', !invis && this.skillLeft > 0);
      btnT.style.setProperty('--cd', String(invis ? 0 : this.skillLeft / ASSASSIN.SKILL_COOLDOWN));
      btnT.querySelector('.timer').textContent = invis ? `${Math.ceil(this.invisLeft)}s` : this.skillLeft > 0 ? `${Math.ceil(this.skillLeft)}s` : '';
      return;
    }
    if (this.isSniper) {
      // 저격수: 발사 쿨타임 숫자, 조준 버튼은 누르는 동안 강조
      btnA.querySelector('.lbl').textContent = this.attackLeft > 0 ? `${this.attackLeft.toFixed(1)}s` : '발사';
      btnT.classList.toggle('aiming', this.aiming);
      return;
    }
    btnT.querySelector('.count').textContent = String(this.charges);
    const frac = this.charges < this.trapMax ? this.chargeLeft / this.trapCooldown : 0;
    btnT.style.setProperty('--cd', String(frac));
    btnT.classList.toggle('empty', this.charges <= 0);
    btnT.querySelector('.timer').textContent = this.charges < this.trapMax ? `${Math.ceil(this.chargeLeft)}s` : '';
  }

  updateGenHud() {
    let done = 0;
    for (const g of this.gens.values()) {
      if (g.done) done++;
      const lamp = document.querySelector(`#hud-gens [data-gen="${g.id}"]`);
      lamp?.classList.toggle('on', g.done);
    }
    $('hud-gen-count').textContent = `${done}/${this.gens.size}`;
  }

  renderPlayerList() {
    const rows = [...this.info.values()].map((p) => {
      const st = p.status ?? STATUS.ALIVE;
      let tag;
      if (p.role === ROLE.HUNTER) tag = CLASS_INFO[p.cls ?? HUNTER_CLASS.MANIAC].icon;
      else if (st === STATUS.CAUGHT) tag = '💀';
      else if (st === STATUS.ESCAPED) tag = '🏁';
      else if (st === 'left') tag = '🚪';
      else {
        const left = Math.max(0, (p.mx ?? this.hitsToCatch) - (p.hits || 0));
        tag = `${SURVIVOR_CLASS_INFO[p.scls]?.icon ?? ''}${'♥'.repeat(Math.floor(left + 1e-9))}${left % 1 > 0.01 ? '½' : ''}`;
      }
      const meCls = p.id === this.myId ? ' me' : '';
      return `<li class="${st}${meCls}"><span class="n">${escapeHtml(p.name)}</span><span class="t">${tag}</span></li>`;
    });
    const html = rows.join('');
    if (html !== this.lastListHtml) {
      $('hud-players').innerHTML = html;
      $('hud-players').classList.toggle('many', this.info.size > 5);
      this.lastListHtml = html;
    }
  }

  /** 체력 하트: 꽉 찬 칸, 반 칸, 잃은 칸 */
  heartsHtml(max, hits) {
    const left = Math.max(0, max - hits);
    const full = Math.floor(left + 1e-9);
    const half = left - full > 0.01 ? 1 : 0;
    return '<b>♥</b>'.repeat(full) + (half ? '<i>♥</i>' : '') + '<s>♥</s>'.repeat(Math.max(0, max - full - half));
  }

  /** 생존자 직업 스킬 버튼과 PC 쿨타임 칸 */
  updateSurvivorSkill() {
    if (!this.hasSSkill) return;
    const frac = Math.min(1, this.sskillLeft / this.sskillCooldown);
    const text = this.sskillLeft > 0 ? `${Math.ceil(this.sskillLeft)}s` : '';
    const btn = $('btn-sskill');
    btn.style.setProperty('--cd', String(frac));
    btn.classList.toggle('cooling', this.sskillLeft > 0);
    btn.querySelector('.timer').textContent = text;
    const slot = $('cd-sskill');
    slot.style.setProperty('--cd', String(frac));
    slot.classList.toggle('empty', this.sskillLeft > 0);
    slot.classList.toggle('ready', this.sskillLeft <= 0);
    slot.querySelector('.t').textContent = text;
  }

  /** 광대 공: 서버와 같은 포물선으로 날린다 (끝은 서버가 알려 줌) */
  onBall(e) {
    const mesh = makeBall();
    mesh.position.set(e.x, e.y, e.z);
    this.scene.add(mesh);
    this.balls.set(e.bid, { mesh, v: new THREE.Vector3(e.vx, e.vy, e.vz), life: 3 });
    if (e.id !== this.myId) {
      this.avatars.get(e.id)?.playSwing();
      sfx.ballThrow(Math.max(0.2, 1 - this.distTo(e.id) / 30));
    }
  }

  onTaser(e) {
    const mesh = makeTaserBolt();
    mesh.position.set(e.x, 1.2, e.z);
    this.scene.add(mesh);
    this.bolts.set(e.tid, { mesh, dir: new THREE.Vector3(e.dx, 0, e.dz), traveled: 0 });
    sfx.zap(e.id === this.myId ? 0.7 : Math.max(0.2, 1 - this.distTo(e.id) / 30));
  }

  updateNewProjectiles(dt) {
    for (const [id, b] of this.balls) {
      b.life -= dt;
      b.v.y -= CLOWN.BALL_GRAVITY * dt;
      b.mesh.position.addScaledVector(b.v, dt);
      b.mesh.rotation.x += dt * 9;
      if (b.mesh.position.y < 0.11) {
        b.mesh.position.y = 0.11;
        b.v.set(0, 0, 0);
      }
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        this.balls.delete(id);
      }
    }
    for (const [id, b] of this.bolts) {
      const step = POLICE.SPEED * dt;
      b.mesh.position.addScaledVector(b.dir, step);
      b.traveled += step;
      b.mesh.scale.setScalar(0.8 + Math.random() * 0.5);
      if (b.traveled > POLICE.RANGE + 2) {
        this.scene.remove(b.mesh);
        this.bolts.delete(id);
      }
    }
    // 함정 듀오에서 움직이는 덫
    const k = 1 - Math.exp(-dt * 12);
    for (const m of this.traps.values()) {
      const t = m.userData.target;
      if (!t) continue;
      m.position.x += (t.x - m.position.x) * k;
      m.position.z += (t.z - m.position.z) * k;
    }
    const now = performance.now();
    for (const m of this.robotMeshes.values()) {
      m.userData.tip.visible = Math.floor(now / 250) % 2 === 0;
      m.position.y = 1.0 + Math.abs(Math.sin(now / 90)) * 0.02;
    }
    for (const m of this.smokeMeshes.values()) m.rotation.y += dt * 0.3;
  }

  feed(text, cls = '') {
    const el = document.createElement('div');
    el.className = `feed-item ${cls}`;
    el.textContent = text;
    const box = $('hud-feed');
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.classList.add('fade'), 3500);
    setTimeout(() => el.remove(), 4200);
  }

  centerMsg(text, seconds) {
    const el = $('hud-center');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.centerTimer);
    this.centerTimer = setTimeout(() => el.classList.remove('show'), seconds * 1000);
  }

  flash(kind) {
    const el = $(kind === 'hit' ? 'vignette-hit' : 'vignette-stun');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  hitMarker() {
    const el = $('crosshair');
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  dispose() {
    this.disposed = true;
    if (this.diveAim) this.endDiveAim(false);
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.gyro.dispose();
    stopHum();
    this.bgm.stop();
    window.removeEventListener('resize', this.onResize);
    $('btn-game-settings').removeEventListener('click', this.onSettingsClick);
    $('btn-map').removeEventListener('click', this.onMapClick);
    $('btn-map').removeEventListener('pointerdown', this.onMapDown);
    window.removeEventListener('keydown', this.onMapKey);
    $('map-overlay').classList.add('hidden');
    $('btn-spectate-next').removeEventListener('click', this.onSpectateNext);
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    $('screen-game').classList.remove('danger', 'spectating', 'role-hunter', 'role-survivor', 'smoked', 's-slowed', 'no-run', 'cls-clown', 'diving');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
