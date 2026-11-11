// 인게임 배경음악: 음원 파일 없이 WebAudio로 합성한다. 맵마다 다른 사운드스케이프.
//  - 마을: 밤의 시골. 풀벌레, 새 지저귐, 멀리서 늑대 울음, 부엉이, 까마귀
//  - 폐광산: 숨 막히는 축축한 갱도. 탁한 저음, 숨 쉬듯 쌕쌕거리는 바람, 물방울, 녹슨 금속 삐걱임, 낙석
//  - 백룸: 오래된 마트 매장 음악(늘어진 테이프 같은 장난감 피아노) + AI 음성 안내 방송
// 생존자에게 술래가 가까워지면 전부 저역 필터로 먹먹해지고 작아져서 심장 소리만 남는다.
import { audioContext, isBgmEnabled } from './audio.js';

const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function noiseBuffer(ctx, seconds = 2, color = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

/** 소리 하나를 만들 때 쓰는 작은 도구들 */
function kit(ctx, dest) {
  const pan = (value) => {
    if (!ctx.createStereoPanner) return dest;
    const p = ctx.createStereoPanner();
    p.pan.value = value;
    p.connect(dest);
    return p;
  };
  const osc = (type, freq, t, dur, out) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  };
  const env = (t, a, peak, d, out) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(out);
    return g;
  };
  const filter = (type, freq, q, out) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(out);
    return f;
  };
  return { pan, osc, env, filter };
}

// ───────────────────────── 마을: 밤의 시골 ─────────────────────────

class VillageScore {
  start(ctx, bus) {
    this.ctx = ctx;
    this.bus = bus;
    this.k = kit(ctx, bus);
    this.loops = [];
    // 바닥에 깔리는 낮고 음산한 패드
    const pad = ctx.createGain();
    pad.gain.value = 0.06;
    const lp = this.k.filter('lowpass', 500, 1, bus);
    pad.connect(lp);
    for (const [n, det] of [
      [33, -6],
      [33, 7],
      [40, 0],
      [44, 3],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = det;
      o.connect(pad);
      o.start();
      this.loops.push(o);
    }
    // 바람
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(ctx, 3, 'brown');
    wind.loop = true;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    wind.connect(this.k.filter('bandpass', 380, 0.7, wg));
    wg.connect(bus);
    wind.start();
    this.loops.push(wind);
    this.timers = { cricket: 0, bird: rnd(1, 3), wolf: rnd(6, 12), owl: rnd(10, 18), crow: rnd(14, 25) };
  }

  tick(dt) {
    const T = this.timers;
    for (const key of Object.keys(T)) T[key] -= dt;
    if (T.cricket <= 0) {
      this.cricket();
      T.cricket = rnd(0.35, 0.9);
    }
    if (T.bird <= 0) {
      this.bird();
      T.bird = rnd(2.5, 7);
    }
    if (T.wolf <= 0) {
      this.wolf();
      if (Math.random() < 0.45) setTimeout(() => this.ctx && this.wolf(true), rnd(900, 1800)); // 다른 늑대가 따라 운다
      T.wolf = rnd(22, 45);
    }
    if (T.owl <= 0) {
      this.owl();
      T.owl = rnd(14, 30);
    }
    if (T.crow <= 0) {
      this.crow();
      T.crow = rnd(18, 40);
    }
  }

  /** 풀벌레: 높은 음이 빠르게 몇 번 떨림 */
  cricket() {
    const t = this.ctx.currentTime;
    const out = this.k.pan(rnd(-0.8, 0.8));
    const f = rnd(4200, 5200);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.055;
      this.k.osc('sine', f, s, 0.04, this.k.env(s, 0.005, 0.012, 0.035, out));
    }
  }

  /** 새 지저귐: 빠르게 오르내리는 짧은 음절 여러 개 */
  bird() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.k.pan(rnd(-0.9, 0.9));
    const base = rnd(2400, 3800);
    const syl = 3 + Math.floor(Math.random() * 5);
    let s = t;
    for (let i = 0; i < syl; i++) {
      const dur = rnd(0.05, 0.12);
      const o = this.k.osc('sine', base * rnd(0.9, 1.15), s, dur, this.k.env(s, 0.01, 0.035, dur, out));
      o.frequency.exponentialRampToValueAtTime(base * rnd(1.2, 1.6), s + dur * 0.5);
      o.frequency.exponentialRampToValueAtTime(base * rnd(0.7, 1.0), s + dur);
      s += dur + rnd(0.03, 0.12);
    }
  }

  /** 늑대 울음: 낮게 시작해 길게 올라갔다 떨리며 내려옴 */
  wolf(far = false) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.k.pan(rnd(-0.7, 0.7));
    const dur = rnd(2.6, 3.6);
    const peak = far ? 0.035 : 0.06;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.6);
    g.gain.setValueAtTime(peak, t + dur - 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const bp = this.k.filter('bandpass', 900, 1.2, g);
    g.connect(out);
    const base = far ? rnd(330, 380) : rnd(300, 350);
    for (const [type, mul, det] of [
      ['triangle', 1, 0],
      ['sine', 2, 8],
    ]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = det;
      o.frequency.setValueAtTime(base * mul, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.9 * mul, t + 0.9);
      o.frequency.setValueAtTime(base * 1.9 * mul, t + dur * 0.6);
      o.frequency.exponentialRampToValueAtTime(base * 1.35 * mul, t + dur);
      // 떨림(비브라토)
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = ctx.createGain();
      lg.gain.value = 9 * mul;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
      o.connect(bp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** 부엉이: 낮은 "부-엉" 두 번 */
  owl() {
    const t = this.ctx.currentTime;
    const out = this.k.pan(rnd(-0.6, 0.6));
    for (const [off, f, d] of [
      [0, 410, 0.35],
      [0.55, 380, 0.6],
    ]) {
      const s = t + off;
      const o = this.k.osc('sine', f, s, d, this.k.env(s, 0.06, 0.05, d, out));
      o.frequency.exponentialRampToValueAtTime(f * 0.92, s + d);
    }
  }

  /** 까마귀: 거칠고 짧은 "까악" */
  crow() {
    const t = this.ctx.currentTime;
    const out = this.k.pan(rnd(-0.8, 0.8));
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.42;
      const bp = this.k.filter('bandpass', 1100, 2, this.k.env(s, 0.02, 0.05, 0.28, out));
      const o = this.k.osc('sawtooth', 620, s, 0.3, bp);
      o.frequency.exponentialRampToValueAtTime(420, s + 0.3);
    }
  }

  stop(t) {
    for (const o of this.loops) o.stop(t);
    this.ctx = null;
  }
}

// ───────────────────────── 폐광산: 숨 막히는 갱도 ─────────────────────────

class MineScore {
  start(ctx, bus) {
    this.ctx = ctx;
    this.k = kit(ctx, bus);
    this.loops = [];
    // 탁하게 맥놀이 치는 저음 (두 음이 살짝 어긋나 울렁거림)
    const low = ctx.createGain();
    low.gain.value = 0.06;
    low.connect(this.k.filter('lowpass', 160, 3, bus));
    for (const f of [41.2, 43.4, 61.7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(low);
      o.start();
      this.loops.push(o);
    }
    // 숨 쉬듯 오르내리는 쌕쌕거리는 바람 (병든 폐 같은 소리)
    const breath = ctx.createBufferSource();
    breath.buffer = noiseBuffer(ctx, 3);
    breath.loop = true;
    const bg = ctx.createGain();
    bg.gain.value = 0.0;
    const bp = this.k.filter('bandpass', 1300, 3.5, bg);
    breath.connect(bp);
    bg.connect(bus);
    // 4.5초 주기로 들이쉬고 내쉼 + 쌕쌕거리는 음색 변화
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / 4.5;
    const lg = ctx.createGain();
    lg.gain.value = 0.014;
    lfo.connect(lg).connect(bg.gain);
    const off = ctx.createConstantSource ? ctx.createConstantSource() : null;
    if (off) {
      off.offset.value = 0.016;
      off.connect(bg.gain);
      off.start();
      this.loops.push(off);
    }
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 1 / 4.5;
    const lg2 = ctx.createGain();
    lg2.gain.value = 500;
    lfo2.connect(lg2).connect(bp.frequency);
    breath.start();
    lfo.start();
    lfo2.start();
    this.loops.push(breath, lfo, lfo2);
    // 반음끼리 부딪히는 불쾌한 화음이 천천히 부풀었다 가라앉음
    const cl = ctx.createGain();
    cl.gain.value = 0.02;
    cl.connect(this.k.filter('lowpass', 900, 0.5, bus));
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.05;
    const sg = ctx.createGain();
    sg.gain.value = 0.018;
    swell.connect(sg).connect(cl.gain);
    swell.start();
    this.loops.push(swell);
    for (const n of [52, 53, 58, 59]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midi(n);
      o.connect(cl);
      o.start();
      this.loops.push(o);
    }
    // 동굴 메아리
    this.echo = ctx.createDelay(2);
    this.echo.delayTime.value = 0.38;
    const fb = ctx.createGain();
    fb.gain.value = 0.5;
    this.echo.connect(fb).connect(this.echo);
    this.echo.connect(bus);
    this.timers = { drip: 1, creak: rnd(6, 12), rock: rnd(15, 30), cough: rnd(25, 50) };
  }

  tick(dt) {
    const T = this.timers;
    for (const key of Object.keys(T)) T[key] -= dt;
    if (T.drip <= 0) {
      this.drip();
      T.drip = rnd(0.8, 3.5);
    }
    if (T.creak <= 0) {
      this.creak();
      T.creak = rnd(8, 20);
    }
    if (T.rock <= 0) {
      this.rockfall();
      T.rock = rnd(20, 45);
    }
    if (T.cough <= 0) {
      this.gasp();
      T.cough = rnd(30, 60);
    }
  }

  /** 물방울: 짧게 떨어지는 소리 + 동굴 메아리 */
  drip() {
    const t = this.ctx.currentTime;
    const out = this.k.pan(rnd(-0.8, 0.8));
    const g = this.k.env(t, 0.002, 0.08, 0.12, out);
    g.connect(this.echo);
    const f = rnd(900, 1500);
    const o = this.k.osc('sine', f, t, 0.12, g);
    o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.1);
  }

  /** 녹슨 금속이 천천히 삐걱이는 소리 */
  creak() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.k.pan(rnd(-0.6, 0.6));
    const dur = rnd(1.2, 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    g.connect(this.echo);
    const bp = this.k.filter('bandpass', 700, 6, g);
    const o = this.k.osc('sawtooth', rnd(90, 140), t, dur, bp);
    for (let i = 1; i <= 6; i++) o.frequency.linearRampToValueAtTime(rnd(80, 170), t + (dur * i) / 6);
  }

  /** 멀리서 돌무더기가 무너지는 소리 */
  rockfall() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 2.5, 'brown');
    const g = this.k.env(t, 0.05, 0.22, 2.2, this.k.pan(rnd(-0.5, 0.5)));
    src.connect(this.k.filter('lowpass', 220, 1, g));
    src.start(t);
  }

  /** 어디선가 들리는 거친 숨 들이마시는 소리 */
  gasp() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    g.connect(this.k.pan(rnd(-0.7, 0.7)));
    g.connect(this.echo);
    const bp = this.k.filter('bandpass', 900, 5, g);
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(1600, t + 0.9);
    src.connect(bp);
    src.start(t);
  }

  stop(t) {
    for (const o of this.loops) o.stop(t);
    this.ctx = null;
  }
}

// ───────────────────────── 백룸: 오래된 마트 방송 ─────────────────────────

// 늘어진 테이프처럼 출렁이는 밝은 멜로디 (박자 단위: [음, 길이])
const JINGLE = [
  [76, 1], [79, 1], [84, 1], [79, 1], [81, 1], [79, 1], [76, 2],
  [77, 1], [81, 1], [86, 1], [81, 1], [79, 4],
  [76, 1], [79, 1], [84, 1], [88, 1], [86, 1], [84, 1], [81, 1], [79, 1],
  [77, 1], [76, 1], [74, 1], [76, 1], [72, 4],
];
const BASS = [48, 55, 53, 55, 48, 55, 50, 55];

// 가상의 "해피데이 마트" 안내 방송 (밝은 말투인데 내용이 섬뜩함)
const ADS = [
  '딩동. 해피데이 마트를 찾아 주셔서 감사합니다. 오늘도 활짝 웃어 주세요. 활짝.',
  '고객님께 알립니다. 삼번 통로에서 미소 한 상자를 반값에 드립니다. 서두르세요. 아직 남아 있을 때.',
  '길을 잃으셨나요? 걱정 마세요. 해피데이 마트에서는 아무도 길을 잃지 않습니다. 아무도, 나가지 않으니까요.',
  '안내 말씀 드립니다. 해피데이 마트에는 영업 종료 시간이 없습니다. 우리는 영원히 문을 엽니다.',
  '어린이 고객님은 계산대 옆에서 기다려 주세요. 부모님은 곧 오실 거예요. 아마도요.',
  '오늘의 특가 상품입니다. 형광등 하나를 사시면, 어둠은 무료로 드립니다.',
  '고객님, 뒤를 돌아보지 마세요. 쇼핑에만 집중해 주세요. 쇼핑에만.',
  '즐거운 쇼핑 되세요. 즐거운 쇼핑 되세요. 즐거운, 쇼핑, 되세요.',
  '분실물 안내입니다. 노란 벽 사이에서 누군가의 목소리를 찾으셨다면, 돌려주지 마세요.',
  '해피데이 마트는 언제나 고객님을 지켜보고 있습니다. 언제나, 고객님 곁에.',
];

class BackroomsScore {
  start(ctx, bus) {
    this.ctx = ctx;
    this.k = kit(ctx, bus);
    this.loops = [];
    // 매장 음악 전용 볼륨 (안내 방송 때 줄어듦)
    this.music = ctx.createGain();
    this.music.gain.value = 1;
    // 오래된 스피커처럼 고음·저음을 깎는다
    const speaker = this.k.filter('bandpass', 1400, 0.45, this.music);
    this.music.connect(bus);
    this.speaker = speaker;
    // 테이프가 늘어진 듯한 음 출렁임 (모든 음의 detune에 연결)
    this.wow = ctx.createGain();
    this.wow.gain.value = 22; // cents
    const wowLfo = ctx.createOscillator();
    wowLfo.frequency.value = 0.6;
    wowLfo.connect(this.wow);
    wowLfo.start();
    this.loops.push(wowLfo);
    // 테이프 잡음
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuffer(ctx, 2);
    hiss.loop = true;
    const hg = ctx.createGain();
    hg.gain.value = 0.006;
    hiss.connect(this.k.filter('highpass', 3000, 0.5, hg));
    hg.connect(bus);
    hiss.start();
    this.loops.push(hiss);
    // 낡은 오르간 화음
    const organ = ctx.createGain();
    organ.gain.value = 0.03;
    organ.connect(speaker);
    for (const n of [60, 64, 67]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = midi(n);
      this.wow.connect(o.detune);
      o.connect(organ);
      o.start();
      this.loops.push(o);
    }
    this.beat = 60 / 104;
    this.stretch = 1; // 가끔 템포가 처지는 정도
    this.noteIdx = 0;
    this.nextNote = ctx.currentTime + 0.5;
    this.bassIdx = 0;
    this.nextBass = ctx.currentTime + 0.5;
    this.adTimer = rnd(8, 14);
    this.speaking = false;
    this.danger = 0;
  }

  tick(dt, danger) {
    this.danger = danger;
    const ctx = this.ctx;
    // 템포가 가끔 축 처졌다가 돌아온다
    if (Math.random() < dt * 0.05) this.stretch = rnd(1.15, 1.45);
    this.stretch += (1 - this.stretch) * Math.min(1, dt * 0.25);
    // 0.3초 앞까지 음을 예약
    while (this.nextNote < ctx.currentTime + 0.3) {
      const [n, len] = JINGLE[this.noteIdx % JINGLE.length];
      this.toyPiano(n, this.nextNote, Math.random() < 0.08 ? rnd(-70, -35) : 0);
      this.nextNote += len * this.beat * this.stretch;
      this.noteIdx++;
      if (this.noteIdx % JINGLE.length === 0) this.nextNote += this.beat * 2 * this.stretch; // 한 바퀴 돌면 쉼
    }
    while (this.nextBass < ctx.currentTime + 0.3) {
      this.bass(BASS[this.bassIdx % BASS.length], this.nextBass);
      this.nextBass += this.beat * 2 * this.stretch;
      this.bassIdx++;
    }
    // 안내 방송
    this.adTimer -= dt;
    if (this.adTimer <= 0 && !this.speaking) {
      this.adTimer = rnd(28, 50);
      if (danger < 0.6) this.announce(); // 술래가 가까우면 방송하지 않는다
    }
    // 술래가 아주 가까우면 말하던 방송도 끊는다
    if (this.speaking && danger > 0.8) this.cancelSpeech();
  }

  /** 장난감 피아노: 맑은 사인 + 약간의 배음, 금방 사라짐 */
  toyPiano(n, t, detune) {
    const g = this.k.env(t, 0.004, 0.2, 0.55, this.speaker);
    for (const [mul, vol] of [
      [1, 1],
      [3, 0.18],
      [4.2, 0.08],
    ]) {
      const vg = this.ctx.createGain();
      vg.gain.value = vol;
      vg.connect(g);
      const o = this.k.osc('sine', midi(n) * mul, t, 0.6, vg);
      o.detune.value = detune;
      this.wow.connect(o.detune);
    }
  }

  bass(n, t) {
    const o = this.k.osc('triangle', midi(n), t, 0.4, this.k.env(t, 0.01, 0.16, 0.38, this.speaker));
    this.wow.connect(o.detune);
  }

  /** 딩동 소리 뒤에 AI 음성(브라우저 음성 합성)으로 안내 방송 */
  announce() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // 딩동
    for (const [off, n] of [
      [0, 76],
      [0.45, 72],
    ]) {
      const s = t + off;
      this.k.osc('sine', midi(n), s, 1.2, this.k.env(s, 0.01, 0.09, 1.1, this.speaker));
    }
    // 방송 동안 음악을 줄인다
    this.music.gain.setTargetAtTime(0.35, t, 0.3);
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      setTimeout(() => this.endSpeech(), 4000);
      this.speaking = true;
      return;
    }
    const u = new SpeechSynthesisUtterance(pick(ADS));
    const voices = synth.getVoices();
    u.voice = voices.find((v) => v.lang?.startsWith('ko')) || null;
    u.lang = 'ko-KR';
    // 밝은 척하는데 어딘가 어긋난 목소리
    u.pitch = pick([0.55, 1.35, 1.6, 0.8]);
    u.rate = pick([0.85, 0.92, 1.05]);
    u.volume = Math.max(0.15, 0.85 * (1 - this.danger));
    u.onend = () => this.endSpeech();
    u.onerror = () => this.endSpeech();
    this.speaking = true;
    this.utterance = u;
    setTimeout(() => {
      if (this.ctx && this.utterance === u) synth.speak(u);
    }, 1100);
    // 음성이 끝나지 않아도 20초 뒤엔 음악을 되돌린다
    this.speechGuard = setTimeout(() => this.endSpeech(), 20000);
  }

  endSpeech() {
    clearTimeout(this.speechGuard);
    this.speaking = false;
    this.utterance = null;
    if (this.ctx) this.music.gain.setTargetAtTime(1, this.ctx.currentTime, 0.6);
  }

  cancelSpeech() {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* 무시 */
    }
    this.endSpeech();
  }

  stop(t) {
    this.cancelSpeech();
    for (const o of this.loops) o.stop(t);
    this.ctx = null;
  }
}

const SCORES = { village: VillageScore, mine: MineScore, backrooms: BackroomsScore };
const MASTER = 0.55;

export class Bgm {
  constructor(theme = 'village') {
    this.Score = SCORES[theme] || VillageScore;
    this.nodes = null;
    this.danger = 0;
  }

  /** 매 프레임 호출: 필요하면 시작/정지, 소리 예약, 위험도 반영 */
  update(dt, danger) {
    const ctx = audioContext();
    const want = !!ctx && isBgmEnabled();
    if (want && !this.nodes) this.start(ctx);
    if (!want && this.nodes) this.stop();
    if (!this.nodes) return;
    this.setDanger(danger);
    this.nodes.score.tick(Math.min(dt, 0.1), this.danger);
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
    const score = new this.Score();
    score.start(ctx, muffle);
    this.nodes = { ctx, out, muffle, score };
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
    const { ctx, out, score } = this.nodes;
    const t = ctx.currentTime;
    try {
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0, t, 0.25);
      score.stop(t + 1.2);
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
    const s = this.nodes.score;
    return {
      cutoff: this.nodes.muffle.frequency.value,
      gain: this.nodes.out.gain.value,
      danger: this.danger,
      score: s.constructor.name,
      speaking: !!s.speaking,
    };
  }
}
