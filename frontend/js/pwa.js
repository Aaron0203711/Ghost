// PWA: 서비스 워커 등록과 "앱 설치" 버튼.
// - Android/PC Chrome·Edge: 브라우저가 설치 가능하다고 알려 주면 메인 화면에 설치 버튼이 나온다.
// - iPhone/iPad Safari: 설치 API가 없어서 공유 → "홈 화면에 추가" 안내를 보여 준다.

const $ = (id) => document.getElementById(id);

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initPWA({ tap = (el, fn) => el.addEventListener('click', fn) } = {}) {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[pwa] 서비스 워커 등록 실패', e));
    });
  }

  const btn = $('btn-install');
  const hint = $('install-hint');
  if (!btn || isStandalone()) return;

  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    btn.classList.add('hidden');
    hint?.classList.add('hidden');
  });

  // iOS Safari는 beforeinstallprompt가 없으므로 안내용으로 버튼을 보여 준다
  if (isIOS()) btn.classList.remove('hidden');

  tap(btn, async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      if (outcome === 'accepted') btn.classList.add('hidden');
      return;
    }
    hint?.classList.toggle('hidden');
  });
}
