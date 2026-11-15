// 서비스 워커: (1) 앱 파일을 저장해 오프라인에서도 열리게 하고,
// (2) 응답에 교차 출처 격리 헤더를 붙여 WASM 멀티스레드(빠른 인식)를 켠다.
const SHELL = 'shell-v2';      // 앱 화면 파일: 온라인이면 최신 것으로 갱신
const VENDOR = 'vendor-v1';    // 음성 인식 라이브러리: 버전이 폴더 이름에 고정돼 있어 한 번만 받음
const FILES = ['./', './index.html', './worker.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // 이 서비스 워커가 만든 예전 저장소만 지운다. 내려받은 모델 저장소(transformers-cache)는 건드리지 않는다.
    for (const k of await caches.keys()) {
      if (/^(shell|vendor|cdn)-/.test(k) && k !== SHELL && k !== VENDOR) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

function isolated(resp) {
  if (!resp || resp.status === 0) return resp;
  const headers = new Headers(resp.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  const body = [101, 204, 205, 304].includes(resp.status) ? null : resp.body;
  return new Response(body, { status: resp.status, statusText: resp.statusText, headers });
}

async function networkFirst(req) {        // 앱 파일: 온라인이면 최신, 아니면 저장본
  const cache = await caches.open(SHELL);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return isolated(resp);
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return isolated(hit);
    throw new Error('offline');
  }
}

async function cacheFirst(req) {          // 라이브러리: 저장본 우선 (약 22MB를 매번 다시 받지 않도록)
  const cache = await caches.open(VENDOR);
  const hit = await cache.match(req);
  if (hit) return isolated(hit);
  const resp = await fetch(req);
  if (resp.ok) cache.put(req, resp.clone());
  return isolated(resp);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 모델 내려받기(Hugging Face) 등은 그대로 통과
  e.respondWith(url.pathname.includes('/vendor/') ? cacheFirst(req) : networkFirst(req));
});
