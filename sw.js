// オフラインで開けるようにする ＋ 端末内AIを速く動かすための設定（Cross-Origin Isolation）
const VERSION = 'minutes-v3';
const CDN = 'minutes-cdn-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/main.js', 'js/ui.js', 'js/db.js', 'js/audio.js', 'js/pcm-worklet.js', 'js/recorder.js', 'js/recording.js', 'js/device.js',
  'js/ml-client.js', 'js/ml-worker.js', 'js/cluster.js', 'js/diarize.js', 'js/transcribe.js', 'js/external.js', 'js/simple-nlp.js',
  'js/llm-local.js', 'js/llm-worker.js', 'js/summarize.js', 'js/export.js', 'js/jobs.js', 'js/notify.js', 'js/announce.js', 'js/version.js',
  'js/views/home.js', 'js/views/common.js', 'js/views/rec.js', 'js/views/detail.js', 'js/views/d-summary.js', 'js/views/d-trans.js',
  'js/views/d-speakers.js', 'js/views/d-questions.js', 'js/views/d-info.js', 'js/views/settings.js', 'js/views/setup.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-64.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('minutes-') && k !== VERSION && k !== CDN) await caches.delete(k);
    await self.clients.claim();
  })());
});

function isolate(res) {
  if (!res || res.type === 'opaque' || res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/announce-data.json')) {
      e.respondWith(fetch(req).catch(() => new Response('[]', { headers: { 'Content-Type': 'application/json' } })));
      return;
    }
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      if (req.mode === 'navigate') {
        try {
          const r = await fetch(req);
          if (r.ok) cache.put('index.html', r.clone());
          return isolate(r);
        } catch (err) {
          return isolate((await cache.match('index.html')) || (await cache.match('./')) || new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
        }
      }
      // 新しい版をすぐ使えるよう、まずネットから取る。つながらないときは保存してある版を使う
      try {
        const r = await fetch(req);
        if (r.ok) cache.put(req, r.clone());
        return isolate(r);
      } catch (err) {
        const cached = await cache.match(req, { ignoreSearch: true });
        return isolate(cached || new Response('オフラインです', { status: 503 }));
      }
    })());
    return;
  }

  // ライブラリ（CDN）は一度取ったら保存して使う
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith((async () => {
      const cache = await caches.open(CDN);
      const hit = await cache.match(req.url);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok && (r.type === 'cors' || r.type === 'basic')) cache.put(req.url, r.clone());
      return r;
    })());
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '#/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { c.postMessage({ type: 'open', url }); return c.focus(); }
    return self.clients.openWindow('./' + url);
  })());
});
