import { SnapshotStore } from './store.js';
import { handleDataRequest } from './r2fs.js';
const store = new SnapshotStore();
const base = new URL('data/', self.registration.scope).pathname;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(base)) event.respondWith(handleDataRequest(event.request, store, base));
  else event.respondWith((async () => {
    // Pages cannot configure these headers. WASI workers need SharedArrayBuffer,
    // so the service worker adds isolation on subsequent document navigations.
    const response = await fetch(event.request);
    if (!response.status || response.status === 304) return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  })());
});
