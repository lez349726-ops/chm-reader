const CACHE = 'chm-shelf-v1.0.3';
const DB_NAME = 'chm-shelf-v1';
const DB_VERSION = 1;
const SCOPE = new URL(self.registration.scope).pathname;
const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'db.js',
  'chm.js',
  'chm.wasm',
  'legacy-tables.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const prefix = `${SCOPE}book/`;
  if (url.pathname.startsWith(prefix)) {
    event.respondWith(serveBookFile(request, url, prefix));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, clone));
      }
      return response;
    }).catch(() => caches.match(new URL('index.html', self.registration.scope).href)))
  );
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getFile(bookId, path) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files')
      .get(`${bookId}\u0000${path}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

async function serveBookFile(request, url, prefix) {
  try {
    const remainder = url.pathname.slice(prefix.length);
    const slash = remainder.indexOf('/');
    if (slash < 0) return new Response('Not found', { status: 404 });
    const bookId = decodeURIComponent(remainder.slice(0, slash));
    const path = decodeURIComponent(remainder.slice(slash + 1));
    const record = await getFile(bookId, path);
    if (!record) return new Response('Not found', { status: 404 });

    const bytes = record.data instanceof Uint8Array
      ? record.data
      : new Uint8Array(record.data);
    const range = request.headers.get('range');
    const headers = {
      'Content-Type': record.type || contentType(path),
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    };
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : bytes.length - 1;
        const safeStart = Math.min(start, bytes.length - 1);
        const safeEnd = Math.min(end, bytes.length - 1);
        if (safeStart <= safeEnd) {
          headers['Content-Range'] = `bytes ${safeStart}-${safeEnd}/${bytes.length}`;
          headers['Content-Length'] = String(safeEnd - safeStart + 1);
          return new Response(bytes.slice(safeStart, safeEnd + 1), {
            status: 206,
            headers,
          });
        }
      }
    }
    headers['Content-Length'] = String(bytes.length);
    return new Response(bytes, { status: 200, headers });
  } catch (error) {
    return new Response(`CHM file error: ${error.message}`, { status: 500 });
  }
}

function contentType(path) {
  const extension = path.split('.').pop()?.toLowerCase() || '';
  const types = {
    htm: 'text/html',
    html: 'text/html',
    xhtml: 'application/xhtml+xml',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    txt: 'text/plain; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
  };
  return types[extension] || 'application/octet-stream';
}
