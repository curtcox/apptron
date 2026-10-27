import { verifyRuntimeScript } from './runtime-integrity.js';
import { DataGrants } from './data-access.js';
import { SnapshotStore } from './store.js';
import { handleDataRequest } from './r2fs.js';
const store = new SnapshotStore();
const grants = new DataGrants();
const vmBase = new URL('vm-data/', self.registration.scope).pathname;
const base = new URL('data/', self.registration.scope).pathname;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  event.waitUntil((async () => {
    const client = event.source, message = event.data;
    const vm = new URL('vm.html', self.registration.scope);
    if (!client?.url) return;
    const clientURL = new URL(client.url);
    if (clientURL.origin + clientURL.pathname !== vm.href || new URLSearchParams(clientURL.hash.slice(1)).get('session') !== message?.documentSession) return;
    try {
      if (message?.type === 'apptron-data-grant') await grants.grant(message.session, message.uuid, message.user, client.id);
      else if (message?.type === 'apptron-data-revoke') await grants.revoke(message.session, client.id);
      else return;
      event.ports[0]?.postMessage({ ok: true });
    } catch (error) { event.ports[0]?.postMessage({ error: error.message }); }
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(base)) event.respondWith(handleDataRequest(event.request, store, base, []));
  else if (url.pathname.startsWith(vmBase)) event.respondWith((async () => {
    const session = url.pathname.slice(vmBase.length).split('/')[0];
    const scopedBase = vmBase + session + '/data/';
    const roots = event.clientId ? await grants.get(session, event.clientId) : null;
    return handleDataRequest(event.request, store, scopedBase, roots || []);
  })());
  else event.respondWith((async () => {
    // Pages cannot configure these headers. WASI workers need SharedArrayBuffer,
    // so the service worker adds isolation on subsequent document navigations.
    let response;
    try { response = await verifyRuntimeScript(event.request, await fetch(event.request), self.registration.scope); }
    catch (error) { response = new Response(error.message, { status: 502, headers: { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' } }); }
    if (!response.status || response.status === 304) return response;
    const headers = new Headers(response.headers);
    if (url.pathname === new URL('vm.html', self.registration.scope).pathname) headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  })());
});
