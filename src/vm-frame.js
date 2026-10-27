import { deployment } from './deployment.js';
import { parseSnapshot, snapshotUUID } from './snapshot.js';
import { SnapshotStore } from './store.js';
import { WanixDisk } from './wanix-disk.js';
import { readOverlay } from './overlay.js';
import { captureSnapshot } from './capture.js';
import { validBoot, validMessage, validCommand } from './bridge.js';
import { captureOverlay } from './overlay.js';
import { bundleName, readLimited, sha256, ensureServiceWorker, dataGrant } from './apptron-host.js';
import { gunzip } from './tar.js';
const settings = deployment();
const hostOrigin = settings.editorOrigin;
const store = new SnapshotStore();
let originalSnapshot;
const documentSession = new URLSearchParams(location.hash.slice(1)).get('session');
let session = documentSession;
const grant = message => dataGrant({ ...message, documentSession });
const send = (type, message, extra = {}) => parent.postMessage({ type, message, session, ...extra }, hostOrigin);
let runtimeInstance, runtimeCommit, snapshotID, fitTerminal = () => {};
window.addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== hostOrigin || !validMessage(event.data, session) || !validCommand(event.data) || !runtimeInstance) return;
  const { type, id, value } = event.data;
  try {
    let result;
    if (type === 'apptron-key') await runtimeInstance.appendFile('#console/data', value);
    if (type === 'apptron-resize') fitTerminal();
    if (type === 'apptron-capture-snapshot') result = await captureSnapshot(store, snapshotID, originalSnapshot);
    if (type === 'apptron-capture-overlay') result = await captureOverlay(runtimeInstance, runtimeCommit, snapshotID);
    send('apptron-result', '', { id, value: result });
  } catch (error) { send('apptron-result', '', { id, error: error.message }); }
});
window.addEventListener('error', event => send('apptron-error', event.message));
window.addEventListener('unhandledrejection', event => send('apptron-error', event.reason?.message || String(event.reason)));
let started = false;
window.addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== hostOrigin || !validBoot(event.data) || started) return;
  started = true;
  session = event.data.session;
  try {
    if (!document.querySelector('meta[data-apptron-policy]')) throw new Error('Security policy did not load.');
    const { uuid, user, relay, runtime, manifest } = event.data;
    if (new URL(runtime).href !== new URL(`./runtime/${manifest.commit}/`, location.href).href || relay !== (new URLSearchParams(location.hash.slice(1)).get('relay') || '')) throw new Error('Invalid boot configuration.');
    // The host manifest is authenticated by its lock. The VM deployment must
    // carry that same lock before any of its persistent state is touched.
    const localLockResponse = await fetch(new URL('./runtime.lock', location.href));
    if (!localLockResponse.ok) throw new Error('VM runtime lock is unavailable.');
    const localLock = await localLockResponse.json();
    if (localLock.commit !== manifest.commit || localLock.manifestSha256 !== event.data.manifestSha256) throw new Error('Editor and VM runtime locks differ. Deploy matching artifacts.');
    const manifestResponse = await fetch(new URL('runtime.json', runtime));
    const manifestText = await manifestResponse.text();
    if (!manifestResponse.ok || await sha256(new TextEncoder().encode(manifestText)) !== localLock.manifestSha256 || JSON.stringify(JSON.parse(manifestText)) !== JSON.stringify(manifest)) throw new Error('VM runtime manifest checksum mismatch.');
    await ensureServiceWorker();
    if (!crossOriginIsolated) throw new Error('VM isolation headers are missing. Configure COEP/CORP and cross-origin-isolated delegation.');
    if (event.data.action === 'reset') {
      await store.clear(uuid, user);
      const disk = new WanixDisk(); try { await disk.clear([`env/${uuid}`, `usr/${user}`]); } finally { disk.close(); }
      send('apptron-reset-done'); return;
    }
    originalSnapshot = parseSnapshot(event.data.source);
    if (await snapshotUUID(event.data.source, manifest.commit) !== uuid) throw new Error('Snapshot identity does not match its source.');
    if (event.data.overlayData) {
      const overlay = await readOverlay(event.data.overlayData, manifest.commit);
      const disk = new WanixDisk(); try { await disk.restore(uuid, overlay.entries); } finally { disk.close(); }
    }
    await store.seed(uuid, user, originalSnapshot);
    await grant({ type: 'apptron-data-grant', session, uuid, user });
    const status = message => send('apptron-status', message);
    const load = async name => {
      const expected = manifest.files[name];
      if (!expected) throw new Error(`Runtime file is missing from its manifest: ${name}`);
      const url = new URL(name, runtime);
      let cache; try { cache = await caches.open('apptron-runtime-' + manifest.commit); } catch { /* Private browsing can disable Cache Storage. */ }
      const cached = await cache?.match(url); let data;
      if (cached) data = new Uint8Array(await cached.arrayBuffer());
      else {
        const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
        if (!response.ok) throw new Error(`${name}: HTTP ${response.status}.`);
        data = await readLimited(response, expected.size, count => status(`${name} · ${(count / 1048576).toFixed(1)} / ${(expected.size / 1048576).toFixed(1)} MiB`));
      }
      if (data.length !== expected.size || await sha256(data) !== expected.sha256) { await cache?.delete(url); throw new Error(`${name}: runtime checksum mismatch. Retry Run.`); }
      if (!cached) try { await cache?.put(url, new Response(data)); } catch { status('Browser cache is full. Continuing without caching.'); }
      return data;
    };
    const runtimeIntegrity = Object.fromEntries(Object.entries(manifest.files).filter(([name]) => /\.(js|css)$/.test(name)).map(([name, file]) => [new URL(name, runtime).href, 'sha256-' + btoa(String.fromCharCode(...file.sha256.match(/../g).map(byte => parseInt(byte, 16))))]));
    window.apptron = { runtimeIntegrity, mode: 'console', embedded: false, user: { username: 'guest', user_id: user }, env: { uuid, name: 'snapshot', owner: user }, runtimeURL: runtime, origin: new URL(`./vm-data/${session}`, location.href).href, publishURL: async () => '', refreshEnv: async () => {} };
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.type = 'module';
      script.src = new URL('wanix.min.js', runtime); script.integrity = runtimeIntegrity[script.src];
      script.onload = resolve; script.onerror = () => reject(new Error('Could not load verified Wanix loader.'));
      document.head.append(script);
    });
    const { WanixRuntime } = window;
    const config = { screen: true, helpers: true, wasm: null, ...(relay ? { network: relay } : {}) };
    const w = new WanixRuntime(config); window.apptron.instance = w;
    w.screen = document.querySelector('#screen').transferControlToOffscreen();
    window.handleAudio = () => {};
    w._getBundle = async name => {
      const data = await gunzip(await load(bundleName(name)), 768 * 1024 * 1024);
      if (window.apptron.terminal) status(`Running · ${relay ? 'relay configured' : 'no VM network'} · ${manifest.commit.slice(0, 7)}`);
      return data.buffer;
    };
    w._bundle = w._getBundle('sys.tar.gz');
    const wasm = await load('wanix.wasm');
    await w._bundle;
    await w._loadWasm(wasm.buffer);
    await w.ready();
    const xid = (await w.readText('web/dom/new/xterm')).trim();
    await w.writeFile('task/1/ctl', `bind #console/data web/dom/${xid}/data`);
    await w.writeFile('web/dom/body/ctl', `append-child ${xid}`);
    document.querySelector('#loader')?.remove();
    const terminal = document.querySelector('.wanix-terminal').term;
    window.apptron.terminal = terminal;
    const fit = () => { try { terminal.fitAddon.fit(); } catch { /* Hidden mobile panel has no size. */ } };
    new ResizeObserver(fit).observe(document.body); window.visualViewport?.addEventListener('resize', fit);
    runtimeInstance = w; runtimeCommit = manifest.commit; snapshotID = uuid; fitTerminal = fit;
    terminal.focus(); send('apptron-ready');
  } catch (error) { send('apptron-error', error.message); }
});

window.addEventListener('message', event => {
  if (event.source === parent && event.origin === hostOrigin && validMessage(event.data, session) && event.data.type === 'apptron-stop') grant({ type: 'apptron-data-revoke', session }).catch(() => {});
});
