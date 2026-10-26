import { parseSnapshot, snapshotUUID } from './snapshot.js';
import { SnapshotStore } from './store.js';
import { WanixDisk } from './wanix-disk.js';
import { readOverlay, MAX_OVERLAY_BYTES } from './overlay.js';
import { getRelay } from './network.js';
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
export class ApptronHost {
  constructor(container, status = () => {}) { this.container = container; this.status = status; this.store = new SnapshotStore(); this.generation = 0; }
  async config() {
    if (this.lock) return this.lock;
    const response = await fetch(new URL('../runtime.lock', import.meta.url));
    if (!response.ok) throw new Error('runtime.lock is missing.');
    return this.lock = await response.json();
  }
  async run(source, { allowMismatch = async () => false } = {}) {
    this.stop(); const generation = this.generation;
    const snapshot = parseSnapshot(source); const lock = await this.config();
    await ensureServiceWorker();
    const uuid = await snapshotUUID(source, lock.commit);
    let browserId; try { browserId = localStorage.getItem('apptron:browser-id') || crypto.randomUUID(); localStorage.setItem('apptron:browser-id', browserId); } catch { browserId = 'guest'; }
    const user = browserId + '-' + uuid;
    await this.store.seed(uuid, user, snapshot);
    const runtime = new URL(`../runtime/${lock.commit}/`, import.meta.url);
    const manifestResponse = await fetch(new URL('runtime.json', runtime));
    if (!manifestResponse.ok) throw new Error('Runtime is not installed. Run scripts/build-runtime.sh or scripts/fetch-runtime.sh, then try Run again.');
    const manifestText = await manifestResponse.text();
    if (lock.manifestSha256 && await sha256(new TextEncoder().encode(manifestText)) !== lock.manifestSha256) throw new Error('Runtime manifest checksum does not match runtime.lock.');
    const manifest = JSON.parse(manifestText);
    if (manifest.commit !== lock.commit) throw new Error('Runtime manifest commit does not match runtime.lock.');
    if (snapshot.metadata.overlay) {
      this.status('Loading disk overlay…');
      const ref = snapshot.metadata.overlay;
      const gallery = ref.startsWith('gallery/');
      const url = gallery ? new URL(`overlays/${ref.slice(8)}.tar.gz`, runtime) : `https://256t.us/${ref}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`Overlay download failed (HTTP ${response.status}).`);
      const data = await readLimited(response, gallery ? 128 * 1024 * 1024 : MAX_OVERLAY_BYTES);
      if (gallery && manifest.files[`overlays/${ref.slice(8)}.tar.gz`]?.sha256 !== await sha256(data)) throw new Error('Gallery overlay checksum mismatch.');
      const overlay = await readOverlay(data, lock.commit);
      if (overlay.mismatch && !(await allowMismatch(overlay.manifest.commit))) throw new Error('Overlay runtime mismatch. Loading was cancelled.');
      const disk = new WanixDisk(); try { await disk.restore(uuid, overlay.entries); } finally { disk.close(); }
    }
    if (generation !== this.generation) return;
    Object.assign(this, { uuid, user, source, snapshot, manifest });
    const frame = document.createElement('iframe'); frame.title = 'Apptron Linux terminal'; frame.src = new URL('../vm.html', import.meta.url); this.frame = frame;
    const ready = new Promise((resolve, reject) => {
      let settled = false;
      let timeout;
      const armTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => {
        const error = new Error('VM boot timed out. Try Reset VM, then Run again.');
        this.running = false; this.status(error.message); cleanup(); if (!settled) reject(error);
      }, 180000); };
      armTimeout();
      const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', onMessage); };
      const onMessage = event => {
        if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
        if (event.data.type === 'apptron-status') this.status(event.data.message);
        if (event.data.type === 'apptron-ready') {
          clearTimeout(timeout); this.running = true;
          this.status(`Running · ${getRelay() ? 'relay configured' : 'no VM network'} · ${lock.commit.slice(0, 7)}`);
          if (!settled) { settled = true; resolve(); }
        }
        if (event.data.type === 'apptron-error') {
          this.running = false; this.status(event.data.message); cleanup(); if (!settled) reject(new Error(event.data.message));
        }
      };
      window.addEventListener('message', onMessage);
      this.cancelBoot = () => { cleanup(); resolve(); };
      frame.onload = () => {
        this.running = false; armTimeout(); this.status('Booting Linux…');
        frame.contentWindow.postMessage({ type: 'apptron-boot', uuid, user, relay: getRelay(), runtime: runtime.href, manifest }, location.origin);
      };
    });
    this.container.replaceChildren(frame); this.status(`Booting Linux · ${lock.commit.slice(0, 7)}…`);
    await ready;
    if (generation !== this.generation) return;
    this.running = true; this.status(`Running · ${getRelay() ? 'relay configured' : 'no VM network'} · ${lock.commit.slice(0, 7)}`);
  }
  get instance() { return this.frame?.contentWindow?.apptron?.instance; }
  async sendKey(data) { if (this.running) await this.instance.appendFile('#console/data', data); }
  async reset() {
    this.stop(); if (!this.uuid) return;
    await this.store.clear(this.uuid, this.user);
    const disk = new WanixDisk(); try { await disk.clear([`env/${this.uuid}`, `usr/${this.user}`]); } finally { disk.close(); }
  }
  stop() { this.generation++; this.running = false; this.cancelBoot?.(); this.cancelBoot = null; this.frame?.remove(); this.frame = null; }
}
export async function sha256(data) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join(''); }
export async function readLimited(response, limit, progress = () => {}) {
  if (Number(response.headers.get('Content-Length')) > limit) throw new Error('Download exceeds its size limit.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('Download exceeds its size limit.'); chunks.push(value); progress(size); } }
  finally { await reader.cancel(); }
  const data = new Uint8Array(size); let at = 0; for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; } return data;
}
