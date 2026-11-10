// 화면 흐름: 메인 → 시작하기(방 만들기/방 참가) → 대기실 → 게임 → 결과 → 대기실
import { Net } from './net.js';
import { settings, saveSettings, SENS_MIN, SENS_MAX } from './settings.js';
import { setSoundEnabled, unlockAudio } from './game/audio.js';

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
      ? '모두 모이면 게임 시작을 누르세요. 술래는 무작위로 1명 정해져요.'
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
  setSoundEnabled(settings.sound);
}
syncSettingsUi();
sens.addEventListener('input', () => {
  saveSettings({ sensitivity: Number(sens.value) });
  $('sens-value').textContent = Number(sens.value).toFixed(1);
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
  const title = msg.winner === 'hunter' ? '👹 술래 승리' : '🏁 생존자 승리';
  const reasons = {
    escaped: '생존자가 탈출에 성공했습니다',
    allCaught: '생존자가 모두 잡혔습니다',
    hunterLeft: '술래가 게임을 나갔습니다',
    survivorsLeft: '생존자가 모두 나갔습니다',
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
    t.textContent = p.role === 'hunter' ? '👹 술래' : label[p.status] || p.status;
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

net.on('start', (m) => {
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
