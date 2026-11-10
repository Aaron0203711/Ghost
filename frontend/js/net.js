// WebSocket 클라이언트: 자동 재연결, 메시지 타입별 구독.

function defaultUrl() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (window.GHOST_SERVER_URL) return window.GHOST_SERVER_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export class Net {
  constructor(url = defaultUrl()) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
    this.queue = [];
    this.retry = 0;
    this.connected = false;
    this.connect();
  }

  connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.emit('_open');
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.emit(msg.t, msg);
      this.emit('*', msg);
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      if (was) this.emit('_close');
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => {};
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) fn(msg);
  }

  send(msg) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    else if (msg.t !== 'input') this.queue.push(data);
  }
}
