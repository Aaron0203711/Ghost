// 음성 채팅: 같은 방 사람들과 WebRTC로 직접(P2P) 목소리를 주고받는다.
// 서버는 연결 신호만 전달하고, 게임 중에는 사람마다 들릴 크기(거리·벽·관전 여부)를 정해서 보내 준다.
// 대기실·직업 선택·결과 화면에서는 모두 같은 크기로 들린다.

const ICE_SERVERS = window.GHOST_ICE_SERVERS || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const OPEN_FREQ = 20000; // 먹먹하지 않을 때 저역 통과 필터
const MUFFLED_FREQ = 1200; // 벽 너머: 고음을 깎아 먹먹하게
const SMOOTH = 0.08; // 크기 변화를 부드럽게 (초)

const idNum = (id) => Number(String(id).replace(/\D/g, '')) || 0;

export class Voice {
  /** @param {import('../net.js').Net} net */
  constructor(net) {
    this.net = net;
    this.myId = null;
    this.peers = new Map(); // id -> peer
    this.micStream = null;
    this.micOn = false;
    this.ctx = null;
    this.gains = null; // null이면 모두 최대(대기실), 아니면 서버가 보낸 { id: [크기, 먹먹함] }
    net.on('rtc', (m) => this.onSignal(m.from, m.sig));
  }

  get supported() {
    return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** 사용자가 버튼을 누른 순간 불러야 소리가 나온다(브라우저 자동재생 정책) */
  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      this.ctx = null;
    }
    for (const p of this.peers.values()) {
      this.attachAudio(p);
      p.el?.play?.().catch(() => {});
    }
  }

  /** 방 인원이 바뀔 때마다: 새로 온 사람과 연결하고, 나간 사람은 끊는다 */
  setMembers(myId, ids) {
    if (!this.supported) return;
    if (myId !== this.myId) this.closeAll();
    this.myId = myId;
    const want = new Set(ids.filter((id) => id !== myId));
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.closePeer(id);
    for (const id of want) {
      // 번호가 작은 쪽이 연결을 시작한다(양쪽이 동시에 시작하지 않도록)
      if (!this.peers.has(id) && idNum(myId) < idNum(id)) this.createPeer(id, true);
    }
  }

  leave() {
    this.closeAll();
    this.myId = null;
    this.gains = null;
  }

  /** 게임 중 서버가 보낸 목소리 크기. null이면 모두 최대 */
  setGains(gains) {
    this.gains = gains || null;
    for (const p of this.peers.values()) this.applyGain(p);
  }

  async setMic(on) {
    if (on === this.micOn) return true;
    if (on) {
      if (!this.supported) return false;
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        this.micStream = null;
        return false;
      }
      this.micOn = true;
    } else {
      this.micOn = false;
      for (const t of this.micStream?.getTracks() || []) t.stop();
      this.micStream = null;
    }
    const track = this.micStream?.getAudioTracks()[0] || null;
    for (const p of this.peers.values()) p.tx?.sender.replaceTrack(track).catch(() => {});
    this.net.send({ t: 'mic', on: this.micOn });
    return true;
  }

  // ───────── 연결 ─────────

  createPeer(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer = { id, pc, tx: null, stream: null, el: null, nodes: null, pendingIce: [], initiator };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(id, { ice: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      peer.stream = e.streams[0] || new MediaStream([e.track]);
      this.attachAudio(peer);
    };
    pc.onconnectionstatechange = () => {
      // 끊기면 연결을 시작한 쪽이 다시 시도한다
      if (pc.connectionState === 'failed' && peer.initiator && this.peers.get(id) === peer) this.offer(peer, true);
    };
    if (initiator) {
      peer.tx = pc.addTransceiver('audio', { direction: 'sendrecv' });
      this.useMic(peer);
      this.offer(peer);
    }
    return peer;
  }

  useMic(peer) {
    const track = this.micStream?.getAudioTracks()[0] || null;
    if (peer.tx && track) peer.tx.sender.replaceTrack(track).catch(() => {});
  }

  async offer(peer, iceRestart = false) {
    try {
      const offer = await peer.pc.createOffer({ iceRestart });
      await peer.pc.setLocalDescription(offer);
      this.signal(peer.id, { sdp: peer.pc.localDescription.toJSON() });
    } catch {
      /* 연결이 이미 닫힘 */
    }
  }

  async onSignal(from, sig) {
    if (!this.supported || !sig || !this.myId) return;
    let peer = this.peers.get(from);
    try {
      if (sig.sdp) {
        if (sig.sdp.type === 'offer') {
          if (!peer || peer.initiator) {
            if (peer) this.closePeer(from);
            peer = this.createPeer(from, false);
          }
          await peer.pc.setRemoteDescription(sig.sdp);
          if (!peer.tx) {
            peer.tx = peer.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio') || null;
            if (peer.tx) peer.tx.direction = 'sendrecv';
            this.useMic(peer);
          }
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          this.signal(from, { sdp: peer.pc.localDescription.toJSON() });
        } else if (peer) {
          await peer.pc.setRemoteDescription(sig.sdp);
        }
        for (const c of peer?.pendingIce.splice(0) || []) await peer.pc.addIceCandidate(c).catch(() => {});
      } else if (sig.ice && peer) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(sig.ice).catch(() => {});
        else peer.pendingIce.push(sig.ice);
      }
    } catch {
      /* 잘못된 신호는 무시 */
    }
  }

  signal(to, sig) {
    this.net.send({ t: 'rtc', to, sig });
  }

  // ───────── 소리 ─────────

  /** 받은 목소리를 (저역 통과 필터 → 크기) 로 연결한다 */
  attachAudio(peer) {
    if (!peer.stream) return;
    // 크롬은 WebRTC 소리를 오디오 요소에 붙여 두어야 WebAudio로 소리가 흐른다(요소 자체는 음소거)
    if (!peer.el) {
      peer.el = new Audio();
      peer.el.autoplay = true;
      peer.el.playsInline = true;
      peer.el.srcObject = peer.stream;
      peer.el.muted = true;
      peer.el.play().catch(() => {});
    }
    if (peer.nodes || !this.ctx) {
      this.applyGain(peer);
      return;
    }
    const src = this.ctx.createMediaStreamSource(peer.stream);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = OPEN_FREQ;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    peer.nodes = { src, filter, gain };
    this.applyGain(peer);
  }

  applyGain(peer) {
    const n = peer.nodes;
    if (!n) return;
    const [g, muffled] = this.gains ? this.gains[peer.id] || [0, 0] : [1, 0];
    const t = this.ctx.currentTime;
    n.gain.gain.setTargetAtTime(g, t, SMOOTH);
    n.filter.frequency.setTargetAtTime(muffled ? MUFFLED_FREQ : OPEN_FREQ, t, SMOOTH);
  }

  closePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    try {
      p.pc.close();
    } catch {
      /* 이미 닫힘 */
    }
    if (p.nodes) p.nodes.gain.disconnect();
    if (p.el) p.el.srcObject = null;
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }
}
