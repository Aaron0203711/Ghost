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
} from '@shared/constants.js';
import { buildWorld, buildSky } from './world.js';
import { Avatar, makeViewModel, makeAnchor, makeWisp, GeneratorModel, makeTrap, makeExit, Tracer, makeImpact } from './models.js';
import { Controls } from './input.js';
import { MINE_FOG, Dust, makeMineExit } from './mine.js';
import { BACKROOMS_FOG, makeBackroomsExit } from './backrooms.js';
import { Bgm } from './bgm.js';
import { Gyro } from './gyro.js';
import { sfx, unlockAudio, ensureHum, stopHum } from './audio.js';

const $ = (id) => document.getElementById(id);
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
    // 선장·유령·살가죽·질주자: 스킬 키 한 번 누르기 + 쿨타임
    this.hasClassSkill = this.isCaptain || this.isGhost || this.isSkin || this.isSprinter;
    this.skillCooldown = {
      assassin: ASSASSIN.SKILL_COOLDOWN,
      captain: CAPTAIN.SKILL_COOLDOWN,
      ghost: GHOST.SKILL_COOLDOWN,
      skinwalker: SKINWALKER.SKILL_COOLDOWN,
      sprinter: SPRINTER.SKILL_COOLDOWN,
    }[this.hunterClass] || 1;
    this.attackCooldown = this.isSniper ? SNIPER.SHOT_COOLDOWN : (MELEE[this.hunterClass] || MELEE.maniac).cooldown;
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
    this.aiming = false;
    this.tracers = new Map(); // 서버 총알 id → 궤적 (끝 위치를 받기 전)
    this.liveTracers = []; // 화면에 그리는 중인 궤적
    this.effects = [];
    // 이번 판 규칙 (5명이면 발전기 5개, 체력 2칸)
    this.hitsToCatch = start.rules?.hitsToCatch ?? RULES.HITS_TO_CATCH;

    // 내 상태 (클라이언트 예측)
    this.pos = { x: me.x, z: me.z };
    this.yaw = me.yaw;
    this.pitch = 0;
    this.stam = { stamina: RULES.STAMINA_MAX, regenWait: 0 };
    this.running = false;
    this.moving = false;
    this.stunLeft = 0;
    this.status = STATUS.ALIVE;
    this.hits = 0;
    this.corr = 0;
    this.attackLeft = 0;
    this.charges = RULES.TRAP_MAX_CHARGES;
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
      scene.add(new THREE.HemisphereLight('#c9a27a', '#2a2018', 1.15));
      scene.add(new THREE.AmbientLight('#6b5848', 0.55));
      // 벽에 붙어도 하얗게 타지 않도록: 램프를 머리 뒤쪽에 두고, 밝은 부분은 톤 매핑으로 부드럽게
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.25;
      const lamp = new THREE.SpotLight('#ffe2b0', 26, 32, 0.6, 0.55, 1.25);
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
      const showLabel = this.isHunter ? p.role === ROLE.HUNTER : p.role === ROLE.SURVIVOR;
      const a = new Avatar(p.role, p.index, p.name, showLabel, p.cls ?? this.hunterClass);
      a.setTarget(p.x, p.z, p.yaw, true);
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
    screen.classList.remove('disguised');
    screen.classList.remove('invisible');
    screen.classList.remove('spectating', 'scoped');
    const info = CLASS_INFO[this.hunterClass];
    const hunterNames = [...this.info.values()]
      .filter((p) => p.role === ROLE.HUNTER)
      .map((p) => CLASS_INFO[p.cls ?? HUNTER_CLASS.MANIAC].name);
    $('hud-role').textContent = this.isHunter
      ? `${info.icon} 술래 · ${info.name}`
      : `🏃 생존자 · 술래: ${hunterNames.join(', ')}`;
    $('hud-role').className = `badge ${this.isHunter ? 'hunter' : 'survivor'}`;
    const classLabels = {
      captain: { main: ['🪝', '후크'], action: ['⚓', '닻'] },
      ghost: { main: ['💀', '할퀴기'], action: ['🔮', '유도탄'] },
      skinwalker: { main: ['⛓️', '갈고리'], action: ['🎭', '변장'] },
      sprinter: { main: ['🦵', '발차기'], action: ['💨', '질주'] },
    };
    const labels = this.hasClassSkill
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
    $('hud-feed').innerHTML = '';
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
    this.centerMsg(
      ({
        captain: '선장: 닻을 던져 생존자를 끌어오세요!',
        ghost: '유령: 담장을 지나다니며 유도탄으로 몰아붙이세요!',
        skinwalker: '살가죽: 생존자로 변장해 다가가세요. 공격하면 정체가 드러나요',
        sprinter: '질주자: 질주로 단숨에 거리를 좁히세요!',
      }[this.isHunter ? this.hunterClass : ''] ||
      (this.isSniper
        ? '저격수: 조준해서 멀리서 맞히면 2칸!'
        : this.isAssassin
          ? '암살자: 투명해져서 다가가 쿠나이로 기습하세요!'
          : this.isHunter
          ? '생존자를 모두 잡으세요!'
          : `발전기 ${this.gens.size}개를 켜고 탈출하세요! (체력 ${this.hitsToCatch}칸)`)) + mateText,
      3,
    );
  }

  setupControls(onOpenSettings) {
    this.controls = new Controls(
      $('touch-layer'),
      {
        joy: $('joy'),
        knob: $('joy-knob'),
        canvas: this.renderer.domElement,
        buttons: { main: $('btn-main'), action: $('btn-action'), jump: $('btn-jump') },
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
    this.controls.onPress('action', () => {
      unlockAudio();
      if (this.isAssassin) this.trySkill();
      else if (this.hasClassSkill) this.tryClassSkill();
      else if (this.isHunter && !this.isSniper) this.tryTrap(); // 저격수는 누르고 있는 동안 조준
    });
    this.onSettingsClick = () => {
      this.controls.releaseAll();
      onOpenSettings();
    };
    $('btn-game-settings').addEventListener('click', this.onSettingsClick);
    this.onSpectateNext = () => this.cycleSpectate();
    $('btn-spectate-next').addEventListener('click', this.onSpectateNext);
  }

  tryAttack() {
    if (this.status !== STATUS.ALIVE || this.attackLeft > 0 || this.forced) return;
    this.attackLeft = this.attackCooldown;
    this.lastAttackAt = performance.now();
    this.viewBat?.playSwing();
    if (this.isSniper) {
      sfx.gunshot(1);
      this.shake = 0.12;
    } else sfx.swing();
    if (this.disguised) this.setDisguised(false); // 공격하면 변장이 풀린다 (서버도 같은 규칙)
    // 누른 순간의 시점으로 판정하도록 방향을 함께 보낸다
    this.net.send({ t: 'attack', yaw: this.yaw, pitch: this.pitch });
  }

  /** 점프: 땅에 있을 때만, 생존자는 스태미나 1초분 필요. 덫에 걸리면 못 뜀 */
  tryJump() {
    if (this.status !== STATUS.ALIVE || this.jumpT !== null || this.stunLeft > 0) return;
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

  /** 선장 닻 · 유령 유도탄 · 살가죽 변장 · 질주자 질주 */
  tryClassSkill() {
    if (this.status !== STATUS.ALIVE || this.skillLeft > 0 || this.forced || this.disguised) return;
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
    this.net.send({ t: 'skill', yaw: this.yaw, pitch: this.pitch });
    this.updateHunterHud();
  }

  setDisguised(on) {
    this.disguised = on;
    $('screen-game').classList.toggle('disguised', on);
    if (on) sfx.disguise();
  }

  /** 암살자 투명화 */
  trySkill() {
    if (this.status !== STATUS.ALIVE || this.invisLeft > 0 || this.skillLeft > 0) return;
    this.invisLeft = ASSASSIN.INVIS_TIME;
    this.lastSkillAt = performance.now();
    sfx.invisOn();
    this.net.send({ t: 'skill' });
    this.updateHunterHud();
  }

  tryTrap() {
    if (this.status !== STATUS.ALIVE || this.charges <= 0) return;
    this.charges--;
    this.lastTrapAt = performance.now();
    if (this.chargeLeft <= 0) this.chargeLeft = RULES.TRAP_COOLDOWN;
    sfx.trapPlace();
    this.net.send({ t: 'trap' });
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
        if (p.st !== this.status) this.setMyStatus(p.st);
        continue;
      }
      const a = this.avatars.get(p.id);
      if (!a) continue;
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
      a.dash = p.dash || null;
      a.group.visible = p.st === STATUS.ALIVE && p.id !== this.spectateId && !p.look;
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
    this.syncProjectiles(this.anchorMeshes, s.anchors || [], makeAnchor);
    this.syncProjectiles(this.wispMeshes, s.wisps || [], makeWisp);
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
      gen.model.set(g.p, gen.done);
    }
    this.syncTraps(s.traps);
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
        const far = e.far
          ? ` · ${e.dist}m 원거리 저격! -${e.dmg}칸`
          : e.wisp
            ? ' · 유도탄'
            : e.dash
              ? ' · 질주'
              : e.dmg > 1
                ? ` -${e.dmg}칸`
                : '';
        if (me) {
          sfx.hit();
          this.flash('hit');
          this.shake = 0.35;
          this.centerMsg(`맞았다! (${e.hits}/${this.hitsToCatch})${e.far ? ' 원거리 저격 -2칸' : ''}`, 1.5);
        } else if (e.by === this.myId) {
          sfx.hit();
          this.hitMarker();
          this.feed(`${name(e.id)} 명중 (${e.hits}/${this.hitsToCatch})${far}`);
        } else this.feed(`${name(e.id)}이(가) 맞았다 (${e.hits}/${this.hitsToCatch})${far}`);
        break;
      }
      case 'caught':
        sfx.caught();
        if (e.by === this.myId) this.hitMarker();
        this.feed(`💀 ${name(e.id)}이(가) 잡혔다${e.far ? ` (${e.dist}m 저격)` : ''}`, 'bad');
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
      case 'wisps':
        // 보이는 생존자가 없으면 헛방 (쿨타임은 소모됨)
        if (me) {
          if (e.count > 0) this.feed(`🔮 유도탄 ${e.count}개 발사`);
          else this.centerMsg('보이는 생존자가 없어 헛방이었다', 1.5);
        } else if (e.count > 0) {
          sfx.wisp();
          if (!this.isHunter && this.status === STATUS.ALIVE) this.feed('👻 유령이 유도탄을 날렸다!', 'bad');
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
        if (me) this.centerMsg('탈출 성공!', 3);
        break;
      case 'left':
        this.feed(`${e.name} 님이 나갔어요`);
        break;
      default:
        break;
    }
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
    const mv = alive && !stunned && !this.forced ? c.moveVector() : { x: 0, y: 0 };
    this.moving = mv.x !== 0 || mv.y !== 0;
    const wantsRun = !this.isHunter && c.isHeld('action');
    this.wantsRun = wantsRun;
    this.interact = !this.isHunter && c.isHeld('main');
    if (!this.isHunter) this.running = stepStamina(this.stam, wantsRun && !stunned, this.moving, dt);
    if (alive && this.moving) {
      const speed = speedFor(this.role, this.running, {
        cls: this.isHunter ? this.hunterClass : null,
        aiming: this.aiming,
        invisible: this.isAssassin && this.invisLeft > 0,
        slowed: this.isAssassin && this.slowLeft > 0,
        disguised: this.disguised,
      });
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // 앞 = (-sin, -cos), 오른쪽 = (cos, -sin)
      const dx = (-sin * mv.y + cos * mv.x) * speed * dt;
      const dz = (-cos * mv.y - sin * mv.x) * speed * dt;
      const p = this.collision.move(this.pos.x, this.pos.z, dx, dz, RULES.PLAYER_RADIUS);
      this.pos.x = p.x;
      this.pos.z = p.z;
    }

    this.attackLeft = Math.max(0, this.attackLeft - dt);
    if (this.hasClassSkill) this.skillLeft = Math.max(0, this.skillLeft - dt);
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
    if (this.chargeLeft > 0 && this.charges < RULES.TRAP_MAX_CHARGES) this.chargeLeft = Math.max(0, this.chargeLeft - dt);

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
    this.updateProjectiles(dt);
    this.effects = this.effects.filter((fx) => fx(dt));
    for (const g of this.gens.values()) g.model.update(dt);
    if (this.exitMesh) {
      const portal = this.exitMesh.userData.portal;
      portal.material.opacity = 0.45 + Math.sin(performance.now() / 300) * 0.15;
    }

    this.updateCamera(dt);
    this.updateHud(dt);
  }

  updateCamera(dt) {
    const cam = this.camera;
    if (this.status !== STATUS.ALIVE && this.spectateId) {
      const a = this.avatars.get(this.spectateId);
      const info = this.info.get(this.spectateId);
      if (!a || (info?.status ?? STATUS.ALIVE) !== STATUS.ALIVE) {
        this.cycleSpectate();
      } else {
        cam.position.set(a.pos.x, RULES.EYE_HEIGHT + a.group.position.y, a.pos.z);
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
    const eye = (this.stunLeft > 0 ? RULES.EYE_HEIGHT - 0.25 : RULES.EYE_HEIGHT) + jy;
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
    // 남은 시간
    const left = Math.max(0, Math.ceil(RULES.MATCH_TIME - (this.matchTime || 0)));
    const timerText = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (timerText !== this.lastTimerText) {
      this.lastTimerText = timerText;
      const el = $('hud-timer');
      el.textContent = timerText;
      el.classList.toggle('urgent', left <= 60);
      if (left === 60) this.centerMsg('남은 시간 1분!', 2);
    }
    const alive = this.status === STATUS.ALIVE;
    if (!this.isHunter && alive) {
      const st = this.stam.stamina / RULES.STAMINA_MAX;
      $('stamina-fill').style.transform = `scaleX(${st})`;
      $('stamina').classList.toggle('low', st < 0.25);
      $('hearts').innerHTML = '<b>♥</b>'.repeat(Math.max(0, this.hitsToCatch - this.hits)) + '<s>♥</s>'.repeat(Math.min(this.hitsToCatch, this.hits));
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
    if (this.isHunter || !alive) this.danger = 0; // 술래와 관전자는 늘 보통 배경음악
    this.bgm.update(dt, this.danger);

    const stun = $('hud-stun');
    if (this.stunLeft > 0 && alive) {
      stun.classList.remove('hidden');
      stun.textContent = `덫에 걸렸다! ${this.stunLeft.toFixed(1)}초`;
    } else stun.classList.add('hidden');

    if (this.exit) {
      const ref = this.status !== STATUS.ALIVE && this.spectateId ? this.avatars.get(this.spectateId) : null;
      const px = ref ? ref.pos.x : this.pos.x;
      const pz = ref ? ref.pos.z : this.pos.z;
      const yaw = ref ? ref.yaw : this.yaw;
      const dx = this.exit.x - px;
      const dz = this.exit.z - pz;
      const angle = Math.atan2(-dx, -dz) - yaw; // 0 = 정면
      $('exit-arrow').style.transform = `rotate(${-angle}rad)`;
      $('exit-dist').textContent = `${Math.round(Math.hypot(dx, dz))}m`;
    }
  }

  /** 닻·유도탄 움직임과 닻 사슬 */
  updateProjectiles(dt) {
    const k = 1 - Math.exp(-dt * 18);
    const t = performance.now() / 1000;
    for (const m of this.anchorMeshes.values()) {
      const g = m.userData.target;
      m.position.x += (g.x - m.position.x) * k;
      m.position.z += (g.z - m.position.z) * k;
      m.rotation.z += dt * 14; // 빙글빙글 돌며 날아감
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
    const btnA = $('btn-main');
    const btnT = $('btn-action');
    btnA.style.setProperty('--cd', String(this.attackLeft / this.attackCooldown));
    btnA.classList.toggle('cooling', this.attackLeft > 0);
    if (this.hasClassSkill) {
      // 선장·유령·살가죽·질주자: 스킬 쿨타임 링과 남은 초
      const active = this.disguised || (this.isSprinter && !!this.myDash);
      btnT.classList.toggle('aiming', active);
      btnT.classList.toggle('empty', !active && this.skillLeft > 0);
      btnT.style.setProperty('--cd', String(active ? 0 : Math.min(1, this.skillLeft / this.skillCooldown)));
      btnT.querySelector('.timer').textContent = active ? (this.disguised ? '변장 중' : '질주!') : this.skillLeft > 0 ? `${Math.ceil(this.skillLeft)}s` : '';
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
    const frac = this.charges < RULES.TRAP_MAX_CHARGES ? this.chargeLeft / RULES.TRAP_COOLDOWN : 0;
    btnT.style.setProperty('--cd', String(frac));
    btnT.classList.toggle('empty', this.charges <= 0);
    btnT.querySelector('.timer').textContent = this.charges < RULES.TRAP_MAX_CHARGES ? `${Math.ceil(this.chargeLeft)}s` : '';
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
      else tag = '♥'.repeat(Math.max(0, this.hitsToCatch - (p.hits || 0)));
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
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.gyro.dispose();
    stopHum();
    this.bgm.stop();
    window.removeEventListener('resize', this.onResize);
    $('btn-game-settings').removeEventListener('click', this.onSettingsClick);
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
    $('screen-game').classList.remove('danger', 'spectating', 'role-hunter', 'role-survivor');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
