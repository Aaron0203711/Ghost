// 한 판의 게임 클라이언트: 렌더링, 내 이동 예측, 서버 상태 반영, HUD, 관전.
import * as THREE from 'three';
import { CollisionWorld } from '@shared/collision.js';
import { RULES, ROLE, STATUS, stepStamina, speedFor } from '@shared/constants.js';
import { buildWorld, buildSky } from './world.js';
import { Avatar, BatViewModel, GeneratorModel, makeTrap, makeExit } from './models.js';
import { Controls } from './input.js';
import { Gyro } from './gyro.js';
import { sfx, unlockAudio } from './audio.js';

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
    scene.fog = new THREE.Fog('#4a3c4f', 14, 78);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
    camera.rotation.order = 'YXZ';
    scene.add(camera);
    this.camera = camera;

    scene.add(new THREE.HemisphereLight('#b9a3c9', '#3b3226', 1.6));
    const sun = new THREE.DirectionalLight('#ffb27a', 1.4);
    sun.position.set(-60, 40, 30);
    scene.add(sun);
    scene.add(new THREE.AmbientLight('#6c6280', 0.5));

    this.sky = buildSky(scene);
    this.worldGroup = buildWorld(scene, start.map);

    this.collision = new CollisionWorld(start.map.boxes);
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
      const showLabel = !this.isHunter && p.role === ROLE.SURVIVOR;
      const a = new Avatar(p.role, p.index, p.name, showLabel);
      a.setTarget(p.x, p.z, p.yaw, true);
      scene.add(a.group);
      this.avatars.set(p.id, a);
    }

    if (this.isHunter) this.viewBat = new BatViewModel(camera);

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
    screen.classList.remove('spectating');
    $('hud-role').textContent = this.isHunter ? '👹 술래' : '🏃 생존자';
    $('hud-role').className = `badge ${this.isHunter ? 'hunter' : 'survivor'}`;
    $('btn-main').querySelector('.lbl').textContent = this.isHunter ? '공격' : '수리';
    $('btn-main').querySelector('.ico').textContent = this.isHunter ? '🏏' : '🔧';
    $('btn-action').querySelector('.lbl').textContent = this.isHunter ? '덫' : '달리기';
    $('btn-action').querySelector('.ico').textContent = this.isHunter ? '🪤' : '👟';
    $('hud-feed').innerHTML = '';
    $('hud-exit').classList.add('hidden');
    $('hud-repair').classList.add('hidden');
    $('hud-spectate').classList.add('hidden');
    $('hud-gens').innerHTML = [...this.gens.keys()].map((id) => `<i class="lamp" data-gen="${id}"></i>`).join('');
    this.updateGenHud();
    this.renderPlayerList();
    this.centerMsg(
      this.isHunter ? '생존자를 모두 잡으세요!' : `발전기 ${this.gens.size}개를 켜고 탈출하세요! (체력 ${this.hitsToCatch}칸)`,
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
        buttons: { main: $('btn-main'), action: $('btn-action') },
      },
      () => this.settings.sensitivity,
    );
    this.gyro = new Gyro(() => ({ enabled: this.settings.gyro, sensitivity: this.settings.gyroSensitivity }));
    this.controls.onPress('main', () => {
      unlockAudio();
      if (this.isHunter) this.tryAttack();
    });
    this.controls.onPress('action', () => {
      unlockAudio();
      if (this.isHunter) this.tryTrap();
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
    if (this.status !== STATUS.ALIVE || this.attackLeft > 0) return;
    this.attackLeft = RULES.ATTACK_COOLDOWN;
    this.viewBat?.playSwing();
    sfx.swing();
    this.net.send({ t: 'attack' });
  }

  tryTrap() {
    if (this.status !== STATUS.ALIVE || this.charges <= 0) return;
    this.charges--;
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
        if (p.st !== this.status) this.setMyStatus(p.st);
        continue;
      }
      const a = this.avatars.get(p.id);
      if (!a) continue;
      a.setTarget(p.x, p.z, p.yaw);
      a.pitch = p.pitch;
      a.stunned = p.stun > 0;
      a.repairing = !!p.rep;
      a.group.visible = p.st === STATUS.ALIVE && p.id !== this.spectateId;
    }
    // 떠난 플레이어
    for (const [id, a] of this.avatars) {
      if (!s.players.some((p) => p.id === id)) {
        a.group.visible = false;
        const info = this.info.get(id);
        if (info) info.status = 'left';
      }
    }
    if (s.me) {
      if (Math.abs(s.me.stamina - this.stam.stamina) > 0.6) this.stam.stamina = s.me.stamina;
      this.charges = s.me.charges;
      this.chargeLeft = s.me.chargeLeft;
      if (Math.abs(s.me.attackLeft - this.attackLeft) > 0.25) this.attackLeft = s.me.attackLeft;
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

  showExit(exit) {
    this.exit = exit;
    this.exitMesh = makeExit(exit);
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
      case 'hit':
        this.avatars.get(e.id)?.hitFlash();
        if (me) {
          sfx.hit();
          this.flash('hit');
          this.shake = 0.35;
          this.centerMsg(`맞았다! (${e.hits}/${this.hitsToCatch})`, 1.5);
        } else if (e.by === this.myId) {
          sfx.hit();
          this.hitMarker();
          this.feed(`${name(e.id)} 명중 (${e.hits}/${this.hitsToCatch})`);
        } else this.feed(`${name(e.id)}이(가) 맞았다 (${e.hits}/${this.hitsToCatch})`);
        break;
      case 'caught':
        sfx.caught();
        if (e.by === this.myId) this.hitMarker();
        this.feed(`💀 ${name(e.id)}이(가) 잡혔다`, 'bad');
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
      case 'trapPlaced':
        break;
      case 'genDone':
        sfx.genDone();
        this.feed(`💡 발전기 가동 (${e.done}/${this.gens.size})`, 'good');
        break;
      case 'exitOpen':
        sfx.exitOpen();
        this.showExit(e.exit);
        this.centerMsg('탈출구가 열렸다! 빛나는 도리이로 가세요', 3);
        this.feed('⛩️ 탈출구가 열렸다', 'good');
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
    $('spectate-name').textContent = `${next.role === ROLE.HUNTER ? '👹 ' : ''}${next.name}`;
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

    // 시점
    const look = c.consumeLook();
    const gyro = this.gyro.consume();
    // 설정 창이 열려 있을 때는 자이로 회전을 버린다
    const settingsOpen = !$('modal-settings').classList.contains('hidden');
    if (alive) {
      this.yaw -= look.dx;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - look.dy));
      if (!settingsOpen) {
        this.yaw += gyro.yaw;
        this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + gyro.pitch));
      }
    }

    // 이동 (덫에 걸리면 3초 이동 불가)
    this.stunLeft = Math.max(0, this.stunLeft - dt);
    const stunned = this.stunLeft > 0;
    const mv = alive && !stunned ? c.moveVector() : { x: 0, y: 0 };
    this.moving = mv.x !== 0 || mv.y !== 0;
    const wantsRun = !this.isHunter && c.isHeld('action');
    this.wantsRun = wantsRun;
    this.interact = !this.isHunter && c.isHeld('main');
    if (!this.isHunter) this.running = stepStamina(this.stam, wantsRun && !stunned, this.moving, dt);
    if (alive && this.moving) {
      const speed = speedFor(this.role, this.running);
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
        corr: this.corr,
      });
    }

    for (const a of this.avatars.values()) a.update(dt);
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
        cam.position.set(a.pos.x, RULES.EYE_HEIGHT, a.pos.z);
        cam.rotation.set(a.pitch ?? 0, a.yaw, 0);
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
    const eye = this.stunLeft > 0 ? RULES.EYE_HEIGHT - 0.25 : RULES.EYE_HEIGHT;
    cam.position.set(this.pos.x + sx, eye + bob + sy, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0);
    const targetFov = this.running ? 82 : 75;
    if (Math.abs(cam.fov - targetFov) > 0.1) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 6);
      cam.updateProjectionMatrix();
    }
    this.sky.position.copy(cam.position);
    this.viewBat?.update(dt, this.moving);
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
      const hunterId = [...this.info.values()].find((p) => p.role === ROLE.HUNTER)?.id;
      const d = hunterId ? this.distTo(hunterId) : 999;
      if (d < 24) {
        this.heartbeatT -= dt;
        if (this.heartbeatT <= 0) {
          const k = 1 - d / 24;
          sfx.heartbeat(0.3 + k * 0.7);
          this.heartbeatT = 1.3 - k * 0.85;
        }
      }
      $('screen-game').classList.toggle('danger', d < 12);
    }
    if (this.isHunter) this.updateHunterHud();

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

  updateHunterHud() {
    const btnA = $('btn-main');
    const btnT = $('btn-action');
    btnA.style.setProperty('--cd', String(this.attackLeft / RULES.ATTACK_COOLDOWN));
    btnA.classList.toggle('cooling', this.attackLeft > 0);
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
      if (p.role === ROLE.HUNTER) tag = '👹';
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
