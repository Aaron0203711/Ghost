// 효과음: 파일 없이 WebAudio로 합성한다.
let ctx = null;
let enabled = true;

export function setSoundEnabled(v) {
  enabled = v;
  if (!v) stopHum();
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

export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
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
};
