// 화면 흐름: 메인 → 시작하기(방 만들기/방 참가) → 대기실 → 게임 → 결과 → 대기실
import { Net } from './net.js';
import { settings, saveSettings, SENS_MIN, SENS_MAX } from './settings.js';
import { setSoundEnabled, setBgmEnabled, unlockAudio } from './game/audio.js';
import { matchRules, LARGE_MATCH, DUO_MATCH, CLASS_INFO } from '@shared/constants.js';
import { isGyroDevice, gyroBlockedByInsecure, requestGyroPermission, gyroPermission } from './game/gyro.js';

const $ = (id) => document.getElementById(id);
const net = new Net();

let myId = null;
let room = null;
let session = null;
let GameSessionClass = null;
let pendingAction = null; // 버튼을 눌러 서버 응답을 기다리는 중
let currentScreen = 'screen-main';

// three.js 등 게임 코드를 미리 불러와서 시작 버튼을 누를 때 끊김이 없게 한다
const gameModule = import('./game/session.js').then((m) => (GameSessionClass = m.GameSession));

// ───────────────────────── 화면 전환 ─────────────────────────

function show(id) {
  if (currentScreen === id) return;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  currentScreen = id;
  document.body.dataset.screen = id;
  if (id === 'screen-join') {
    setTimeout(() => {
      if (!matchMedia('(pointer: coarse)').matches) $('input-code').focus();
    }, 50);
  }
}

let toastTimer = null;
function toast(text, kind = '') {
  const el = $('toast');
  el.textContent = text;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2600);
}

/** 서버 응답을 기다리는 버튼: 중복 클릭 방지 + 로딩 표시 */
function busy(btn, on) {
  if (!btn) return;
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

function waitFor(btn) {
  pendingAction?.btn && busy(pendingAction.btn, false);
  busy(btn, true);
  const timer = setTimeout(() => {
    busy(btn, false);
    pendingAction = null;
    if (!net.connected) toast('서버에 연결되지 않았어요. 잠시 후 다시 시도하세요.', 'bad');
  }, 6000);
  pendingAction = { btn, timer };
}

function done() {
  if (!pendingAction) return;
  clearTimeout(pendingAction.timer);
  busy(pendingAction.btn, false);
  pendingAction = null;
}

// 버튼은 손을 떼는 즉시 반응 (모바일 클릭 지연 없음, 연타 방지)
function tap(el, fn) {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    if (el.disabled) return;
    unlockAudio();
    // iPad/iPhone은 버튼을 누른 순간에만 자이로 권한을 물을 수 있다
    if (settings.gyro) requestGyroPermission().then(syncGyroUi);
    fn(e);
  });
}

// ───────────────────────── 메인 화면 ─────────────────────────

const nameInput = $('input-name');
nameInput.value = settings.name || '';

function playerName() {
  const n = nameInput.value.trim().slice(0, 12);
  return n || settings.name || '';
}

nameInput.addEventListener('change', () => {
  saveSettings({ name: nameInput.value.trim().slice(0, 12) });
  if (net.connected && playerName()) net.send({ t: 'hello', name: playerName() });
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    nameInput.blur();
    $('btn-start').click();
  }
});

tap($('btn-start'), () => {
  if (!playerName()) {
    nameInput.focus();
    nameInput.classList.add('shake');
    setTimeout(() => nameInput.classList.remove('shake'), 400);
    toast('닉네임을 입력해 주세요');
    return;
  }
  saveSettings({ name: playerName() });
  show('screen-play');
});

document.querySelectorAll('[data-back]').forEach((b) => tap(b, () => show(b.dataset.back)));

// ───────────────────────── 방 만들기 / 참가 ─────────────────────────

tap($('btn-create'), () => {
  waitFor($('btn-create'));
  net.send({ t: 'create', name: playerName() });
});

tap($('btn-join-open'), () => {
  setCode('');
  show('screen-join');
});

const codeInput = $('input-code');
function setCode(v) {
  v = v.replace(/\D/g, '').slice(0, 4);
  codeInput.value = v;
  const boxes = $('code-boxes').querySelectorAll('span');
  boxes.forEach((b, i) => {
    b.textContent = v[i] || '';
    b.classList.toggle('filled', !!v[i]);
    b.classList.toggle('cursor', i === v.length);
  });
  $('btn-join').disabled = v.length !== 4;
  if (v.length === 4) joinRoom();
}
codeInput.addEventListener('input', () => setCode(codeInput.value));
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && codeInput.value.length === 4) joinRoom();
});
$('code-boxes').addEventListener('click', () => {
  if (!matchMedia('(pointer: coarse)').matches) codeInput.focus();
});
$('keypad').addEventListener('click', (e) => {
  const k = e.target.closest('button')?.dataset.k;
  if (!k) return;
  if (k === 'back') setCode(codeInput.value.slice(0, -1));
  else if (k === 'clear') setCode('');
  else setCode(codeInput.value + k);
});

let lastJoinAt = 0;
function joinRoom() {
  const code = codeInput.value;
  if (code.length !== 4 || Date.now() - lastJoinAt < 400) return;
  lastJoinAt = Date.now();
  waitFor($('btn-join'));
  net.send({ t: 'join', code, name: playerName() });
}
tap($('btn-join'), joinRoom);

// ───────────────────────── 대기실 ─────────────────────────

function renderLobby() {
  if (!room) return;
  const isHost = room.hostId === myId;
  $('lobby-code').textContent = room.code;
  $('lobby-count').textContent = `${room.players.length} / ${room.maxPlayers}명`;
  const rules = matchRules(room.players.length);
  const n = room.players.length;
  const tag = n >= DUO_MATCH.PLAYERS ? ' (6인 이상 규칙)' : n === LARGE_MATCH.PLAYERS ? ' (5인 규칙)' : '';
  $('lobby-rules').textContent = `이번 판: 술래 ${rules.hunters}명 · 발전기 ${rules.generators}개 · 생존자 체력 ${rules.hitsToCatch}칸${tag}`;
  $('lobby-rules').classList.toggle('large', !!tag);
  const list = $('lobby-players');
  list.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'n';
    name.textContent = p.name;
    li.appendChild(name);
    if (p.id === room.hostId) li.insertAdjacentHTML('beforeend', '<span class="tag host">👑 방장</span>');
    if (p.id === myId) {
      li.classList.add('me');
      li.insertAdjacentHTML('beforeend', '<span class="tag">나</span>');
    }
    if (isHost && p.id !== myId) {
      const kick = document.createElement('button');
      kick.className = 'btn small danger';
      kick.textContent = '강퇴';
      tap(kick, () => {
        if (kick.dataset.confirm) {
          net.send({ t: 'kick', id: p.id });
          kick.disabled = true;
        } else {
          kick.dataset.confirm = '1';
          kick.textContent = '정말 강퇴?';
          setTimeout(() => {
            if (!kick.isConnected) return;
            delete kick.dataset.confirm;
            kick.textContent = '강퇴';
          }, 2500);
        }
      });
      li.appendChild(kick);
    }
    list.appendChild(li);
  }
  for (let i = room.players.length; i < room.maxPlayers; i++) {
    list.insertAdjacentHTML('beforeend', '<li class="empty"><span class="n">빈 자리</span></li>');
  }
  const startBtn = $('btn-lobby-start');
  startBtn.classList.toggle('hidden', !isHost);
  const enough = room.players.length >= room.minPlayers;
  startBtn.disabled = !enough;
  $('lobby-hint').textContent = isHost
    ? enough
      ? `모두 모이면 게임 시작을 누르세요. 술래는 무작위로 ${rules.hunters}명 정해져요.`
      : `최소 ${room.minPlayers}명이 필요해요. 친구에게 참가 코드를 알려주세요.`
    : '방장이 게임을 시작할 때까지 기다려 주세요.';
}

tap($('btn-lobby-start'), () => {
  waitFor($('btn-lobby-start'));
  net.send({ t: 'start' });
});

tap($('btn-leave'), () => {
  net.send({ t: 'leave' });
  room = null;
  show('screen-play');
});

tap($('btn-copy-code'), async () => {
  const code = room?.code;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast(`참가 코드 ${code} 복사됨`, 'good');
  } catch {
    toast(`참가 코드: ${code}`);
  }
});

// ───────────────────────── 설정 ─────────────────────────

const sens = $('input-sens');
sens.min = String(SENS_MIN);
sens.max = String(SENS_MAX);
function syncSettingsUi() {
  sens.value = String(settings.sensitivity);
  $('sens-value').textContent = Number(settings.sensitivity).toFixed(1);
  $('input-sound').checked = settings.sound;
  $('input-bgm').checked = settings.bgm;
  setBgmEnabled(settings.bgm);
  setSoundEnabled(settings.sound);
  syncGyroUi();
}

function syncGyroUi() {
  const box = $('gyro-settings');
  if (!isGyroDevice()) {
    box.classList.add('hidden'); // 노트북/PC에서는 자이로 설정을 숨긴다
    return;
  }
  box.classList.remove('hidden');
  $('input-gyro').checked = settings.gyro;
  $('input-gyro-sens').value = String(settings.gyroSensitivity);
  $('gyro-sens-value').textContent = Number(settings.gyroSensitivity).toFixed(1);
  $('gyro-sens-field').classList.toggle('disabled', !settings.gyro);
  $('input-gyro-inv-x').checked = !!settings.gyroInvertX;
  $('input-gyro-inv-y').checked = !!settings.gyroInvertY;
  $('gyro-invert').classList.toggle('disabled', !settings.gyro);
  let status = '';
  if (gyroBlockedByInsecure()) status = '⚠ 자이로는 https:// 주소로 접속했을 때만 동작해요.';
  else if (gyroPermission() === 'denied') status = '⚠ 동작 및 방향 접근이 거부됐어요. 브라우저 설정에서 허용해 주세요.';
  else if (settings.gyro) status = '기기를 좌우·위아래로 돌리면 시점이 따라 움직여요.';
  $('gyro-status').textContent = status;
}
syncSettingsUi();
sens.addEventListener('input', () => {
  saveSettings({ sensitivity: Number(sens.value) });
  $('sens-value').textContent = Number(sens.value).toFixed(1);
});
$('input-gyro').addEventListener('change', (e) => {
  saveSettings({ gyro: e.target.checked });
  if (settings.gyro) requestGyroPermission().then(syncGyroUi);
  syncGyroUi();
});
$('input-gyro-sens').addEventListener('input', (e) => {
  saveSettings({ gyroSensitivity: Number(e.target.value) });
  $('gyro-sens-value').textContent = Number(e.target.value).toFixed(1);
});
$('input-gyro-inv-x').addEventListener('change', (e) => saveSettings({ gyroInvertX: e.target.checked }));
$('input-gyro-inv-y').addEventListener('change', (e) => saveSettings({ gyroInvertY: e.target.checked }));
$('input-bgm').addEventListener('change', (e) => {
  saveSettings({ bgm: e.target.checked });
  setBgmEnabled(settings.bgm);
});
$('input-sound').addEventListener('change', (e) => {
  saveSettings({ sound: e.target.checked });
  setSoundEnabled(settings.sound);
});

// 감도 시험판: 드래그하면 점이 감도만큼 움직인다
{
  const pad = $('sens-test');
  const dot = $('sens-dot');
  let last = null;
  let pos = { x: 0, y: 0 };
  pad.addEventListener('pointerdown', (e) => {
    last = { x: e.clientX, y: e.clientY };
    pad.setPointerCapture(e.pointerId);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!last) return;
    const r = pad.getBoundingClientRect();
    pos.x = Math.max(-r.width / 2, Math.min(r.width / 2, pos.x + (e.clientX - last.x) * settings.sensitivity));
    pos.y = Math.max(-r.height / 2, Math.min(r.height / 2, pos.y + (e.clientY - last.y) * settings.sensitivity));
    last = { x: e.clientX, y: e.clientY };
    dot.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  });
  const end = () => (last = null);
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
}

function openSettings() {
  syncSettingsUi();
  $('btn-quit-game').classList.toggle('hidden', !session);
  $('modal-settings').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeSettings() {
  $('modal-settings').classList.add('hidden');
}
tap($('btn-settings-main'), openSettings);
tap($('btn-settings-lobby'), openSettings);
tap($('btn-settings-close'), closeSettings);
$('modal-settings').addEventListener('click', (e) => {
  if (e.target.id === 'modal-settings') closeSettings();
});
tap($('btn-quit-game'), () => {
  closeSettings();
  net.send({ t: 'leave' });
  endSession();
  room = null;
  show('screen-play');
  toast('게임에서 나왔어요');
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modal-settings').classList.contains('hidden')) closeSettings();
});

// ───────────────────────── 게임 ─────────────────────────

async function startSession(msg) {
  await gameModule;
  endSession();
  closeSettings();
  show('screen-game');
  tryFullscreen();
  session = new GameSessionClass({ net, start: msg, settings, onOpenSettings: openSettings });
  maybeRotateHint();
}

function endSession() {
  if (session) {
    session.dispose();
    session = null;
  }
}

function tryFullscreen() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' });
    p?.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } catch {
    /* 지원하지 않는 브라우저 */
  }
}

function maybeRotateHint() {
  const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)').matches;
  $('rotate-hint').classList.toggle('hidden', !portrait || !session);
}
window.addEventListener('resize', maybeRotateHint);
tap($('btn-rotate-ok'), () => $('rotate-hint').classList.add('hidden'));

function showResult(msg) {
  const meEntry = msg.players.find((p) => p.id === myId);
  const iWon = meEntry ? (msg.winner === 'hunter') === (meEntry.role === 'hunter') : false;
  const classes = (msg.hunterClasses?.length ? msg.hunterClasses : [msg.hunterClass]).map((c) => CLASS_INFO[c] || CLASS_INFO.maniac);
  const title =
    msg.winner === 'hunter'
      ? `${classes.map((c) => c.icon).join('')} 술래(${classes.map((c) => c.name).join('·')}) 승리`
      : '🏁 생존자 승리';
  const reasons = {
    escaped: '생존자가 탈출에 성공했습니다',
    allCaught: '생존자가 모두 잡혔습니다',
    hunterLeft: '술래가 게임을 나갔습니다',
    survivorsLeft: '생존자가 모두 나갔습니다',
    timeUp: '7분 동안 아무도 탈출하지 못했습니다',
    timeUpEscaped: '시간 종료 · 탈출한 생존자가 있습니다',
  };
  $('result-title').textContent = title;
  $('result-sub').textContent = `${reasons[msg.reason] || ''}${meEntry ? (iWon ? ' · 승리!' : ' · 패배') : ''}`;
  $('screen-result').classList.toggle('win', iWon);
  const list = $('result-list');
  list.innerHTML = '';
  const label = { alive: '생존', caught: '💀 잡힘', escaped: '🏁 탈출' };
  for (const p of msg.players) {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = p.name;
    li.appendChild(n);
    const t = document.createElement('span');
    t.className = 'tag';
    const cls = CLASS_INFO[p.cls || msg.hunterClass] || CLASS_INFO.maniac;
    t.textContent = p.role === 'hunter' ? `${cls.icon} 술래 · ${cls.name}` : label[p.status] || p.status;
    li.appendChild(t);
    if (p.id === myId) li.classList.add('me');
    list.appendChild(li);
  }
  show('screen-result');
}

tap($('btn-result-lobby'), () => {
  if (room) {
    renderLobby();
    show('screen-lobby');
  } else show('screen-play');
});

// ───────────────────────── 서버 메시지 ─────────────────────────

net.on('_open', () => {
  $('conn-dot').className = 'on';
  $('conn-text').textContent = '서버 연결됨';
  if (playerName()) net.send({ t: 'hello', name: playerName() });
});

net.on('_close', () => {
  $('conn-dot').className = 'off';
  $('conn-text').textContent = '연결이 끊겼어요. 다시 연결 중…';
  done();
  if (room || session) {
    endSession();
    room = null;
    show('screen-main');
    toast('서버와 연결이 끊겼어요', 'bad');
  }
});

net.on('welcome', (m) => (myId = m.id));

net.on('room', (m) => {
  done();
  room = m;
  if (session) return; // 게임 중에는 결과 화면 뒤에 대기실로
  if (currentScreen === 'screen-result') return;
  renderLobby();
  if (m.state === 'lobby') show('screen-lobby');
});

net.on('error', (m) => {
  done();
  toast(m.message || '오류가 발생했어요', 'bad');
  if (m.code === 'notFound' || m.code === 'badCode' || m.code === 'full' || m.code === 'inGame') {
    if (currentScreen === 'screen-join') setCode('');
  }
});

net.on('kicked', () => {
  endSession();
  room = null;
  show('screen-main');
  toast('방장에 의해 강퇴되었어요', 'bad');
});

net.on('left', () => {
  room = null;
});

// ───────────────────────── 술래 직업 선택 ─────────────────────────

let selectTimer = null;
function showClassSelect(m) {
  const isHunter = m.hunterIds.includes(myId);
  const duo = m.hunterIds.length > 1;
  $('select-hunter').classList.toggle('hidden', !isHunter);
  $('select-wait').classList.toggle('hidden', isHunter);
  $('select-hunter-name').textContent = m.hunterNames.join(', ');
  $('select-wait-title').textContent = duo ? `술래 ${m.hunterIds.length}명이 정해졌어요` : '술래가 정해졌어요';
  // 술래가 2명이면 동료 이름과 동료가 고른 직업을 보여 준다
  const mate = m.hunterNames.filter((_, i) => m.hunterIds[i] !== myId);
  $('select-mate').classList.toggle('hidden', !duo || !isHunter);
  $('select-mate').textContent = mate.length ? `동료 술래: ${mate.join(', ')} · 고르는 중…` : '';
  $('select-status').textContent = '';
  // 이번 판 맵 (술래가 고르는 동안 무작위로 정해짐)
  $('select-map').textContent = m.map ? `이번 맵: ${m.map.icon} ${m.map.name}` : '';
  $('select-map').classList.toggle('mine', m.map?.id === 'mine');
  $('select-map').classList.toggle('backrooms', m.map?.id === 'backrooms');
  document.querySelectorAll('.class-card').forEach((c) => {
    c.disabled = false;
    c.classList.remove('picked');
  });
  const end = Date.now() + m.time * 1000;
  const ring = $('select-ring');
  const tick = () => {
    const left = Math.max(0, (end - Date.now()) / 1000);
    $('select-time').textContent = String(Math.ceil(left));
    ring.style.strokeDashoffset = String(100.5 * (1 - left / m.time));
    ring.classList.toggle('urgent', left <= 5);
  };
  clearInterval(selectTimer);
  tick();
  selectTimer = setInterval(tick, 200);
  closeSettings();
  show('screen-select');
}

// 직업 카드: 공통 규칙(CLASS_INFO)에서 만든다
{
  const list = $('class-list');
  for (const [id, c] of Object.entries(CLASS_INFO)) {
    const card = document.createElement('button');
    card.className = 'class-card';
    card.dataset.cls = id;
    card.innerHTML = `<span class="cls-icon">${c.icon}</span><strong></strong><span class="cls-desc"></span>`;
    card.querySelector('strong').textContent = c.name;
    card.querySelector('.cls-desc').textContent = c.desc;
    list.appendChild(card);
  }
}

document.querySelectorAll('.class-card').forEach((card) =>
  tap(card, () => {
    document.querySelectorAll('.class-card').forEach((c) => {
      c.disabled = true;
      c.classList.toggle('picked', c === card);
    });
    net.send({ t: 'pickClass', cls: card.dataset.cls });
    $('select-status').textContent = $('select-mate').classList.contains('hidden') ? '' : '다른 술래가 고르기를 기다리는 중…';
  }),
);

net.on('classPicked', (m) => {
  const c = CLASS_INFO[m.cls];
  $('select-mate').textContent = `동료 술래: ${m.name} · ${c.icon} ${c.name} 선택`;
});

net.on('classSelect', (m) => {
  done();
  showClassSelect(m);
});

net.on('notice', (m) => {
  clearInterval(selectTimer);
  toast(m.message);
});

net.on('start', (m) => {
  clearInterval(selectTimer);
  if (m.autoPicked && m.players.find((p) => p.id === myId)?.role === 'hunter') {
    toast(`시간이 지나 직업이 무작위로 정해졌어요: ${(CLASS_INFO[m.hunterClass] || CLASS_INFO.maniac).name}`);
  }
  done();
  startSession(m);
});

for (const t of ['state', 'event', 'correct']) net.on(t, (m) => session?.handle(m));

net.on('end', (m) => {
  // 마지막 장면을 잠깐 보여준 뒤 결과 화면
  const s = session;
  setTimeout(() => {
    if (session === s) endSession();
    showResult(m);
  }, 1800);
});

// 모바일: 핀치 줌 방지 (더블탭 확대는 CSS touch-action: manipulation으로 막는다)
document.addEventListener('gesturestart', (e) => e.preventDefault());

document.body.dataset.screen = currentScreen;
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });
// 디버그/자동 테스트용: 현재 게임 세션 확인
window.__ghostSession = () => session;
