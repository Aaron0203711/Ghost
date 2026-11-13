// 서비스 워커: 앱 설치(PWA)와 빠른 재실행을 위한 캐시.
// - 게임 파일은 "네트워크 먼저": 서버에 연결되면 항상 최신 파일을 받고, 받은 파일을 캐시에 넣어 둔다.
// - 네트워크가 안 되면 캐시에 있는 파일로 화면을 띄운다. (게임 자체는 서버 연결이 있어야 한다)
// - three.js(/vendor/)는 버전이 고정이라 "캐시 먼저"로 내려받는 시간을 줄인다.
// 파일 구성이 크게 바뀌면 CACHE 이름의 숫자를 올린다.

const CACHE = 'ghost-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/main.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {}) // 일부 파일을 못 받아도 설치는 계속한다
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 게임 연결과 상태 확인은 캐시하지 않는다
  if (url.pathname.endsWith('/ws') || url.pathname.endsWith('/health')) return;
  if (url.pathname.includes('/vendor/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});
