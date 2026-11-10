// HTTP + WebSocket 서버.
// - /ws : 게임 WebSocket
// - 그 외 : 프론트엔드 정적 파일(편의용). 프론트엔드를 따로 배포해도 된다.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const FRONTEND_DIR = path.resolve(process.env.FRONTEND_DIR || path.join(ROOT, 'frontend'));
const SHARED_DIR = path.join(ROOT, 'shared');

function resolveThreeDir() {
  const candidates = [
    path.join(FRONTEND_DIR, 'node_modules/three'),
    path.join(ROOT, 'node_modules/three'),
    path.join(ROOT, 'backend/node_modules/three'),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, 'build/three.module.js')));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/** URL 경로를 실제 파일 경로로 바꾼다. 디렉터리 밖으로 나가는 경로는 거부한다. */
function mapPath(urlPath, threeDir) {
  const mounts = [
    ['/shared/', SHARED_DIR],
    ['/vendor/three/', threeDir],
    ['/', FRONTEND_DIR],
  ];
  for (const [prefix, dir] of mounts) {
    if (!dir || !urlPath.startsWith(prefix)) continue;
    const rel = urlPath.slice(prefix.length) || 'index.html';
    const full = path.resolve(dir, rel);
    if (full !== dir && !full.startsWith(dir + path.sep)) return null;
    if (prefix === '/' && full.includes(`${path.sep}node_modules${path.sep}`)) return null;
    return full;
  }
  return null;
}

export function createServer({ port = 3000, host = '0.0.0.0' } = {}) {
  const threeDir = resolveThreeDir();
  if (!threeDir) console.warn('[ghost] three.js를 찾지 못했어요. `npm run setup`을 실행하세요.');

  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (urlPath === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: manager.rooms.size, players: manager.clients.size }));
      return;
    }
    const file = mapPath(urlPath, threeDir);
    if (!file) {
      res.writeHead(404).end('Not found');
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
  });

  const manager = new RoomManager();
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    const client = manager.connect((msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    });
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      manager.handle(client, msg);
    });
    ws.on('close', () => manager.disconnect(client));
  });

  // 끊긴 연결 정리
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 10000);
  wss.on('close', () => clearInterval(heartbeat));

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({ server, wss, manager, port: addr.port, close: () => closeAll(server, wss, heartbeat) });
    });
  });
}

function closeAll(server, wss, heartbeat) {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.terminate();
  wss.close();
  return new Promise((r) => server.close(() => r()));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  createServer({ port }).then(({ port: p }) => {
    console.log(`[ghost] 서버 실행 중: http://localhost:${p}  (WebSocket: ws://localhost:${p}/ws)`);
  });
}
