import { deployment } from './deployment.js';
import { sha256 } from './runtime-integrity.js';
export { sha256 } from './runtime-integrity.js';
import { NetworkGrants } from './network.js';
import { readLimited } from './read-limited.js';
export { readLimited } from './read-limited.js';
import { validMessage, validSession } from './bridge.js';
import { isCID, cidLength, verifyCID } from './content-id.js';
import { parseSnapshot, snapshotUUID } from './snapshot.js';
import { readOverlay, MAX_OVERLAY_BYTES } from './overlay.js';

export function bundleName(name) {
  const filename = name.replace(/^\/?bundles\//, '').replace(/^\//, '').replace(/\.tar\.br$/, '.tar.gz');
  if (!/^(sys|goroot|gocache-386|gocache-wasm)\.tar\.gz$/.test(filename)) throw new Error(`Unknown runtime bundle: ${name}`);
  return filename;
}
export async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) throw new Error('Use HTTPS or localhost for the VM’s browser filesystem.');
  await navigator.serviceWorker.register(new URL('../data-sw.js', import.meta.url), { type: 'module', scope: new URL('../', import.meta.url).pathname });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Filesystem service worker did not take control. Reload this page.')), 15000);
    navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
}
export async function dataGrant(message) {
  const channel = new MessageChannel();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('Filesystem permission timed out.')); }, 15000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); event.data?.ok ? resolve() : reject(new Error(event.data?.error || 'Filesystem permission denied.')); };
    navigator.serviceWorker.controller.postMessage(message, [channel.port2]);
  });
}
export class ApptronHost {
  constructor(container, status = () => {}) { this.container = container; this.status = status; this.generation = 0; this.networkGrants = new NetworkGrants(); }
  async approveNetwork(source, relay, confirm) {
    parseSnapshot(source);
    const lock = await this.config();
    return this.networkGrants.request(source, lock.commit, relay, confirm);
  }
  revokeNetwork() { this.networkGrants.revoke(); this.stop(); }
  async config() {
    if (this.lock) return this.lock;
    const response = await fetch(new URL('../runtime.lock', import.meta.url));
    if (!response.ok) throw new Error('runtime.lock is missing.');
    return this.lock = await response.json();
  }
  async run(source, { allowMismatch = async () => false, networkGrant = null, relay = '' } = {}) {
    if (!document.querySelector('meta[data-apptron-policy]')) throw new Error('Security policy did not load. Reload before Run.');
    if (relay) throw new Error('Network access needs a snapshot grant.');
    this.stop(); const generation = this.generation;
    const snapshot = parseSnapshot(source); const lock = await this.config();
    relay = this.networkGrants.resolve(networkGrant, source, lock.commit);
    await ensureServiceWorker();
    const uuid = await snapshotUUID(source, lock.commit);
    let browserId; try { const stored = localStorage.getItem('apptron:browser-id'); browserId = validSession(stored) ? stored : crypto.randomUUID(); localStorage.setItem('apptron:browser-id', browserId); } catch { browserId = 'guest'; }
    const user = browserId + '-' + uuid;
    const runtime = new URL(`../runtime/${lock.commit}/`, import.meta.url);
    const manifestResponse = await fetch(new URL('runtime.json', runtime));
    if (!manifestResponse.ok) throw new Error('Runtime is not installed. Run scripts/build-runtime.sh or scripts/fetch-runtime.sh, then try Run again.');
    const manifestText = await manifestResponse.text();
    if (!/^[a-f0-9]{64}$/.test(lock.manifestSha256 || '')) throw new Error('Build and verify the patched runtime before Run.');
    if (await sha256(new TextEncoder().encode(manifestText)) !== lock.manifestSha256) throw new Error('Runtime manifest checksum does not match runtime.lock.');
    const manifest = JSON.parse(manifestText);
    if (manifest.securityVersion !== 1) throw new Error('This runtime predates the browser security boundary. Install the patched runtime before Run.');
    if (manifest.commit !== lock.commit) throw new Error('Runtime manifest commit does not match runtime.lock.');
    let overlayData;
    if (snapshot.metadata.overlay) {
      this.status('Loading disk overlay…');
      const ref = snapshot.metadata.overlay;
      const gallery = ref.startsWith('gallery/');
      if (!gallery && (!isCID(ref) || cidLength(ref) > MAX_OVERLAY_BYTES)) throw new Error('Invalid overlay CID or overlay exceeds 5 MiB.');
      const url = gallery ? new URL(`overlays/${ref.slice(8)}.tar.gz`, runtime) : `https://256t.us/${ref}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Overlay download failed (HTTP ${response.status}).`);
      const data = await readLimited(response, gallery ? 128 * 1024 * 1024 : MAX_OVERLAY_BYTES);
      if (gallery && manifest.files[`overlays/${ref.slice(8)}.tar.gz`]?.sha256 !== await sha256(data)) throw new Error('Gallery overlay checksum mismatch.');
      if (!gallery) await verifyCID(ref, data);
      const overlay = await readOverlay(data, lock.commit);
      if (overlay.mismatch && !(await allowMismatch(overlay.manifest.commit))) throw new Error('Overlay runtime mismatch. Loading was cancelled.');
      overlayData = data;
    }
    if (generation !== this.generation) return;
    Object.assign(this, { uuid, user, source, snapshot, manifest });
    return this.startFrame({ uuid, user, source, manifest, networkGrant, overlayData });
  }
  async startFrame({ uuid, user, source, manifest, networkGrant = null, relay = '', overlayData, action = 'run' }) {
    if (relay) throw new Error('Network access needs a snapshot grant.');
    relay = this.networkGrants.resolve(networkGrant, source, manifest.commit);
    const generation = this.generation, settings = deployment();
    let session = crypto.randomUUID(); this.session = session; this.requests = new Map(); this.nextRequest = 0;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.setAttribute('allow', 'cross-origin-isolated'); frame.referrerPolicy = 'no-referrer';
    frame.title = 'Apptron Linux terminal';
    const frameURL = new URL(settings.vmURL); this.frameOrigin = frameURL.origin;
    const runtime = new URL(`runtime/${manifest.commit}/`, new URL('./', frameURL));
    frameURL.hash = new URLSearchParams({ relay, session }); frame.src = frameURL; this.frame = frame;
    const lock = await this.config();
    if (generation !== this.generation || this.frame !== frame) return;
    const ready = new Promise((resolve, reject) => {
      let settled = false;
      let timeout;
      const armTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => {
        const error = new Error('VM boot timed out. Try Reset VM, then Run again.');
        fail(error);
      }, 180000); };
      armTimeout();
      const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', onMessage); };
      const fail = error => {
        cleanup(); this.cancelBoot = null; this.stop(); this.status(error.message);
        if (!settled) { settled = true; reject(error); }
      };
      const onMessage = event => {
        if (generation !== this.generation || this.frame !== frame) return;
        if (event.source !== frame.contentWindow || event.origin !== this.frameOrigin || !validMessage(event.data, session)) return;
        if (event.data.type === 'apptron-result') {
          const pending = this.requests.get(event.data.id);
          if (!pending) return;
          this.requests.delete(event.data.id);
          if (typeof event.data.error === 'string') pending.reject(new Error(event.data.error.slice(0, 1000)));
          else pending.resolve(event.data.value);
          return;
        }
        if (typeof event.data.message !== 'string' && !['apptron-ready','apptron-reset-done'].includes(event.data.type)) return;
        if (event.data.type === 'apptron-status') this.status(event.data.message.slice(0, 1000));
        if (event.data.type === 'apptron-reset-done' && action === 'reset') {
          clearTimeout(timeout); settled = true; cleanup(); resolve(); return;
        }
        if (event.data.type === 'apptron-ready' && action === 'run') {
          clearTimeout(timeout); this.running = true;
          this.status(`Running · ${relay ? 'relay configured' : 'no VM network'} · ${lock.commit.slice(0, 7)}`);
          if (!settled) { settled = true; resolve(); }
        }
        if (event.data.type === 'apptron-error') {
          fail(new Error(event.data.message.slice(0, 1000)));
        }
      };
      window.addEventListener('message', onMessage);
      this.cancelBoot = () => { cleanup(); resolve(); };
      frame.onload = () => {
        if (generation !== this.generation || this.frame !== frame) return;
        for (const pending of this.requests.values()) pending.reject(new Error('VM reloaded.')); this.requests.clear();
        session = crypto.randomUUID(); this.session = session;
        this.running = false; armTimeout(); this.status('Booting Linux…');
        // An envbuild reload must keep the overlay it just built. Restore the
        // downloaded seed only on the first document of an explicit Run.
        const seedOverlay = overlayData; overlayData = undefined;
        frame.contentWindow.postMessage({ type: 'apptron-boot', session, uuid, user, source, relay, overlayData: seedOverlay, action, runtime: runtime.href, manifest, manifestSha256: lock.manifestSha256 }, this.frameOrigin);
      };
    });
    this.container.replaceChildren(frame); this.status(`Booting Linux · ${lock.commit.slice(0, 7)}…`);
    await ready;
    if (generation !== this.generation) return;
    if (action === 'reset') return;
    this.running = true; this.status(`Running · ${relay ? 'relay configured' : 'no VM network'} · ${lock.commit.slice(0, 7)}`);
  }
  command(type, value) {
    if (!this.running) return Promise.reject(new Error('VM is not running.'));
    const id = ++this.nextRequest;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.requests.delete(id); reject(new Error('VM request timed out.')); }, 120000);
      this.requests.set(id, { resolve: data => { clearTimeout(timeout); resolve(data); }, reject: error => { clearTimeout(timeout); reject(error); } });
      this.frame.contentWindow.postMessage({ type, value, id, session: this.session }, this.frameOrigin);
    });
  }
  async sendKey(data) { if (this.running) await this.command('apptron-key', data); }
  resize() { if (this.running) this.command('apptron-resize').catch(() => {}); }
  async captureOverlay() {
    const data = await this.command('apptron-capture-overlay');
    if (!(data instanceof Uint8Array) || data.length > 128 * 1024 * 1024) throw new Error('Invalid captured overlay.');
    await readOverlay(data, this.lock.commit);
    return data;
  }
  async captureSnapshot() {
    const result = await this.command('apptron-capture-snapshot');
    if (!result || typeof result.source !== 'string' || !Array.isArray(result.skipped) || result.skipped.length > 30000 || result.skipped.some(path => typeof path !== 'string' || path.length > 4096)) throw new Error('Invalid captured snapshot.');
    parseSnapshot(result.source);
    return result;
  }
  async reset() {
    const { uuid, user, source, manifest } = this;
    this.stop(); if (!uuid) return;
    try { await this.startFrame({ uuid, user, source, manifest, action: 'reset' }); }
    finally { this.stop(); }
  }
  stop() { if (this.session) { this.frame?.contentWindow?.postMessage({ type: 'apptron-stop', session: this.session }, this.frameOrigin); this.session = null; } this.generation++; this.running = false; this.cancelBoot?.(); this.cancelBoot = null; for (const pending of this.requests?.values() || []) pending.reject(new Error('VM stopped.')); this.requests?.clear(); this.frame?.remove(); this.frame = null; }
}
