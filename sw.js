// 서비스 워커: (1) 앱 파일을 저장해 오프라인에서도 열리게 하고,
// (2) 응답에 교차 출처 격리 헤더를 붙여 WASM 멀티스레드(빠른 인식)를 켠다.
const SHELL = 'shell-v1';
const CDN = 'cdn-v1';
const FILES = ['./', './index.html', './worker.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== CDN) await caches.delete(k);
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

async function shellFirstNetwork(req) {   // 앱 파일: 온라인이면 최신, 아니면 저장본
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

async function cdnFirstCache(req) {       // 버전이 고정된 라이브러리: 저장본 우선
  const cache = await caches.open(CDN);
  const hit = await cache.match(req);
  if (hit) return hit;
  const resp = await fetch(req);
  if (resp.ok) cache.put(req, resp.clone());
  return resp;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(shellFirstNetwork(req));
  else if (url.hostname === 'cdn.jsdelivr.net') e.respondWith(cdnFirstCache(req));
});
