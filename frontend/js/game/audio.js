// 효과음: 파일 없이 WebAudio로 합성한다.
let ctx = null;
let enabled = true;

export function setSoundEnabled(v) {
  enabled = v;
  if (!v) stopHum();
}

/** 배경음악(bgm.js)이 같은 오디오 컨텍스트를 쓰도록 */
export function audioContext() {
  return ctx && ctx.state === 'running' ? ctx : null;
}

let bgmEnabled = true;
export function setBgmEnabled(v) {
  bgmEnabled = v;
}
export function isBgmEnabled() {
  return bgmEnabled;
}

// 백룸 형광등 소리: 낮게 웅웅거리는 소리를 계속 낸다
let hum = null;
export function ensureHum() {
  if (hum || !enabled || !ctx || ctx.state !== 'running') return;
  const gain = ctx.createGain();
  gain.gain.value = 0.028;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  const oscs = [
    [120, 'sawtooth', 0.6],
    [240, 'square', 0.12],
    [60, 'sine', 1],
  ].map(([f, type, v]) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = v;
    o.connect(g).connect(filter);
    o.start();
    return o;
  });
  filter.connect(gain).connect(ctx.destination);
  hum = { oscs, gain };
}

export function stopHum() {
  if (!hum) return;
  try {
    hum.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    for (const o of hum.oscs) o.stop(ctx.currentTime + 0.5);
  } catch {
    /* 이미 멈춤 */
  }
  hum = null;
}

let speechPrimed = false;
export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
  // iPhone/iPad는 사용자가 누른 순간에 한 번 말해 두어야 나중에 음성 안내가 나온다
  if (!speechPrimed && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
    speechPrimed = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      window.speechSynthesis.getVoices(); // 목소리 목록을 미리 불러 둔다
    } catch {
      /* 지원하지 않음 */
    }
  }
}

function tone({ freq = 440, to = null, dur = 0.15, type = 'sine', vol = 0.2, delay = 0 }) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noiseBurst(dur = 0.12, vol = 0.25, freq = 1200) {
  if (!enabled || !ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start();
}

export const sfx = {
  swing: () => noiseBurst(0.18, 0.2, 700),
  jump: () => noiseBurst(0.08, 0.12, 500),
  throwAnchor: () => {
    noiseBurst(0.3, 0.25, 600);
    tone({ freq: 300, to: 120, dur: 0.3, type: 'sawtooth', vol: 0.08 });
  },
  clank: () => {
    tone({ freq: 1400, to: 900, dur: 0.15, type: 'square', vol: 0.12 });
    tone({ freq: 1900, to: 1200, dur: 0.2, type: 'triangle', vol: 0.1, delay: 0.05 });
    noiseBurst(0.12, 0.3, 3000);
  },
  wisp: () => {
    for (let i = 0; i < 3; i++) tone({ freq: 700 + i * 260, to: 1400 + i * 300, dur: 0.6, type: 'sine', vol: 0.06, delay: i * 0.08 });
  },
  disguise: () => {
    noiseBurst(0.4, 0.15, 900);
    tone({ freq: 180, to: 90, dur: 0.5, type: 'sine', vol: 0.12 });
  },
  reveal: () => {
    tone({ freq: 520, to: 260, dur: 0.5, type: 'sawtooth', vol: 0.14 });
    tone({ freq: 555, to: 270, dur: 0.5, type: 'sawtooth', vol: 0.1 });
  },
  dashCharge: (vol = 1) => tone({ freq: 120, to: 480, dur: 0.5, type: 'sawtooth', vol: 0.12 * vol }),
  dashWhoosh: (vol = 1) => noiseBurst(0.6, 0.5 * vol, 800),
  land: () => tone({ freq: 90, to: 50, dur: 0.1, type: 'sine', vol: 0.18 }),
  gunshot: (vol = 1) => {
    noiseBurst(0.35, 0.7 * vol, 900);
    noiseBurst(0.08, 0.5 * vol, 3000);
    tone({ freq: 120, to: 40, dur: 0.3, type: 'square', vol: 0.25 * vol });
  },
  hit: () => {
    tone({ freq: 160, to: 60, dur: 0.25, type: 'square', vol: 0.25 });
    noiseBurst(0.1, 0.35, 400);
  },
  trapSnap: () => {
    noiseBurst(0.08, 0.5, 2500);
    tone({ freq: 900, to: 200, dur: 0.12, type: 'sawtooth', vol: 0.15 });
  },
  trapPlace: () => tone({ freq: 300, to: 180, dur: 0.1, type: 'triangle', vol: 0.15 }),
  invisOn: () => {
    tone({ freq: 900, to: 220, dur: 0.45, type: 'sine', vol: 0.12 });
    noiseBurst(0.3, 0.08, 4000);
  },
  invisOff: () => tone({ freq: 220, to: 700, dur: 0.25, type: 'triangle', vol: 0.12 }),
  genDone: () => {
    tone({ freq: 523, dur: 0.18, vol: 0.18 });
    tone({ freq: 659, dur: 0.18, vol: 0.18, delay: 0.12 });
    tone({ freq: 784, dur: 0.3, vol: 0.18, delay: 0.24 });
  },
  exitOpen: () => {
    for (let i = 0; i < 4; i++) tone({ freq: 392 * (1 + i * 0.25), dur: 0.4, vol: 0.12, delay: i * 0.1 });
  },
  caught: () => tone({ freq: 220, to: 55, dur: 0.8, type: 'sawtooth', vol: 0.2 }),
  heartbeat: (vol) => {
    tone({ freq: 60, to: 40, dur: 0.12, type: 'sine', vol: 0.5 * vol });
    tone({ freq: 55, to: 38, dur: 0.12, type: 'sine', vol: 0.35 * vol, delay: 0.2 });
  },
  repairTick: () => tone({ freq: 1200, dur: 0.03, type: 'square', vol: 0.03 }),
  // 2차 업데이트: 광대, 생존자 직업
  ballThrow: (vol = 1) => tone({ freq: 500, to: 900, dur: 0.12, type: 'triangle', vol: 0.12 * vol }),
  ballBounce: (vol = 1) => tone({ freq: 260, to: 140, dur: 0.1, type: 'sine', vol: 0.18 * vol }),
  threadTwang: () => {
    tone({ freq: 1600, to: 600, dur: 0.35, type: 'triangle', vol: 0.12 });
    tone({ freq: 1610, to: 610, dur: 0.35, type: 'sine', vol: 0.08 });
  },
  heal: () => {
    tone({ freq: 660, dur: 0.15, vol: 0.14 });
    tone({ freq: 990, dur: 0.3, vol: 0.12, delay: 0.1 });
  },
  zap: (vol = 1) => {
    noiseBurst(0.25, 0.4 * vol, 5000);
    tone({ freq: 2200, to: 400, dur: 0.25, type: 'square', vol: 0.08 * vol });
  },
  smoke: (vol = 1) => noiseBurst(0.9, 0.35 * vol, 350),
  poof: () => {
    noiseBurst(0.3, 0.25, 1500);
    tone({ freq: 700, to: 200, dur: 0.25, type: 'sine', vol: 0.1 });
  },
  robot: () => {
    for (let i = 0; i < 3; i++) tone({ freq: 880 + i * 220, dur: 0.07, type: 'square', vol: 0.06, delay: i * 0.08 });
  },
  // 3차 업데이트: 익사자 다이빙
  diveIn: (vol = 1) => {
    noiseBurst(0.5, 0.35 * vol, 500);
    tone({ freq: 300, to: 70, dur: 0.5, type: 'sine', vol: 0.18 * vol });
  },
  diveOut: (vol = 1) => {
    noiseBurst(0.6, 0.6 * vol, 700);
    tone({ freq: 70, to: 260, dur: 0.35, type: 'sine', vol: 0.22 * vol });
  },
};
