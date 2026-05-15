/**
 * service-worker.js
 * Service Worker — 將靜態資源快取到本機，讓 App 可在無網路時開啟
 *
 * 策略：
 *  - install：預先快取核心檔案
 *  - activate：清掉舊版本快取
 *  - fetch：先看本地快取，沒有再走網路；網路回應成功的 GET 順手快取起來
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `mobile-ledger-${CACHE_VERSION}`;

/** 預先快取的核心資源 */
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/app.js',
  './js/export.js',
  './icons/icon.svg',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

// 安裝：預先快取
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 用 add 個別處理，避免一個失敗整批 reject
      return Promise.all(
        CORE_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('快取失敗:', url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

// 啟用：清理舊版本
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// 攔截請求：Cache First
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      // 沒命中，走網路；成功就順便寫入快取
      return fetch(event.request)
        .then(resp => {
          if (resp && resp.status === 200 && resp.type !== 'opaque') {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => new Response('', { status: 503, statusText: '離線且無快取' }));
    })
  );
});
