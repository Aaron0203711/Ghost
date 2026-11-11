// 인게임 배경음악: 음원 파일 없이 WebAudio로 합성하는 음산한 앰비언트.
// 낮은 드론 + 어두운 화음 + 바람 소리 + 가끔 울리는 서늘한 단음(메아리).
// 술래가 가까워지면(생존자) 저역 필터로 먹먹해지고 볼륨이 줄어 심장 소리만 남는다.
import { audioContext, isBgmEnabled } from './audio.js';

// 프리지안 음계: 반음 하나가 섞인 어둡고 불안한 느낌
const SCALE = [0, 1, 3, 5, 7, 8, 10];
const THEMES = {
  village: { root: 45, wind: 0.035, chime: 'sine' }, // A
  mine: { root: 40, wind: 0.06, chime: 'triangle' }, // E, 더 낮고 바람이 셈
  backrooms: { root: 47, wind: 0.015, chime: 'sine' }, // B
};
const MASTER = 0.2;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export class Bgm {
  constructor(theme = 'village') {
    this.theme = THEMES[theme] || THEMES.village;
    this.nodes = null;
    this.nextChime = 2;
    this.danger = 0;
  }

  /** 매 프레임 호출: 필요하면 시작/정지, 단음 예약, 위험도 반영 */
  update(dt, danger) {
    const ctx = audioContext();
    const want = !!ctx && isBgmEnabled();
    if (want && !this.nodes) this.start(ctx);
    if (!want && this.nodes) this.stop();
    if (!this.nodes) return;
    this.setDanger(danger);
    this.nextChime -= dt;
    if (this.nextChime <= 0) {
      this.chime();
      this.nextChime = 3 + Math.random() * 6;
    }
  }

  start(ctx) {
    const t = ctx.currentTime;
    const out = ctx.createGain(); // 전체 볼륨 (위험할수록 작아짐)
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(MASTER, t + 3);
    const muffle = ctx.createBiquadFilter(); // 위험할수록 먹먹하게
    muffle.type = 'lowpass';
    muffle.frequency.value = 7000;
    muffle.Q.value = 0.6;
    muffle.connect(out).connect(ctx.destination);

    const oscs = [];
    const osc = (type, freq, gainValue, dest, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gainValue;
      o.connect(g).connect(dest);
      o.start();
      oscs.push(o);
      return { o, g };
    };
    const lfo = (rate, depth, param) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
      oscs.push(o);
    };

    const root = this.theme.root;
    // 1) 낮게 깔리는 드론: 살짝 어긋난 두 톱니파 + 5도, 천천히 열렸다 닫히는 필터
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 380;
    droneFilter.Q.value = 4;
    droneFilter.connect(muffle);
    lfo(0.045, 160, droneFilter.frequency);
    osc('sawtooth', midi(root - 12), 0.32, droneFilter, -7);
    osc('sawtooth', midi(root - 12), 0.32, droneFilter, 6);
    osc('triangle', midi(root - 5), 0.18, droneFilter);
    osc('sine', midi(root - 24), 0.4, muffle);

    // 2) 어두운 화음 패드: 단3도·반음이 섞여 불안하게 부풀었다 가라앉음
    const pad = ctx.createGain();
    pad.gain.value = 0.05;
    pad.connect(muffle);
    lfo(0.07, 0.035, pad.gain);
    for (const step of [0, 3, 8, 13]) osc('sine', midi(root + 12 + step), 0.5, pad);

    // 3) 바람 소리: 걸러낸 잡음
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; // 붉은 잡음 (낮은 소리 위주)
      data[i] = last * 6;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 450;
    windFilter.Q.value = 0.8;
    const wind = ctx.createGain();
    wind.gain.value = this.theme.wind;
    noise.connect(windFilter).connect(wind).connect(muffle);
    lfo(0.11, 260, windFilter.frequency);
    lfo(0.06, this.theme.wind * 0.6, wind.gain);
    noise.start();
    oscs.push(noise);

    // 4) 단음에 쓸 메아리 (딜레이 + 피드백)
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.55;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(muffle);

    this.nodes = { ctx, out, muffle, oscs, delay };
  }

  /** 서늘한 단음 하나 (높은 음역, 길게 사라짐, 메아리) */
  chime() {
    const { ctx, muffle, delay } = this.nodes;
    const t = ctx.currentTime;
    const note = this.theme.root + 24 + SCALE[Math.floor(Math.random() * SCALE.length)] + (Math.random() < 0.3 ? 12 : 0);
    const o = ctx.createOscillator();
    o.type = this.theme.chime;
    o.frequency.value = midi(note);
    o.detune.value = (Math.random() - 0.5) * 20;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    o.connect(g);
    g.connect(muffle);
    g.connect(delay);
    o.start(t);
    o.stop(t + 3.6);
  }

  /** danger 0(안전) ~ 1(술래가 코앞): 먹먹해지고 작아진다 */
  setDanger(k) {
    k = Math.max(0, Math.min(1, k));
    if (Math.abs(k - this.danger) < 0.01) return;
    this.danger = k;
    const { ctx, out, muffle } = this.nodes;
    const t = ctx.currentTime;
    muffle.frequency.setTargetAtTime(7000 * (1 - k) ** 2.2 + 180, t, 0.25);
    out.gain.setTargetAtTime(MASTER * (1 - 0.9 * k), t, 0.3);
  }

  stop() {
    if (!this.nodes) return;
    const { ctx, out, oscs } = this.nodes;
    const t = ctx.currentTime;
    try {
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0, t, 0.25);
      for (const o of oscs) o.stop(t + 1.2);
    } catch {
      /* 이미 멈춤 */
    }
    setTimeout(() => {
      try {
        out.disconnect();
      } catch {
        /* 무시 */
      }
    }, 1500);
    this.nodes = null;
    this.danger = 0;
  }

  /** 디버그/시험용 현재 상태 */
  get state() {
    if (!this.nodes) return null;
    return { cutoff: this.nodes.muffle.frequency.value, gain: this.nodes.out.gain.value, danger: this.danger };
  }
}
