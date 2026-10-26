import { bundleName, readLimited, sha256 } from './apptron-host.js';
import { gunzip } from './tar.js';
const send = (type, message) => parent.postMessage({ type, message }, location.origin);
window.addEventListener('error', event => send('apptron-error', event.message));
window.addEventListener('unhandledrejection', event => send('apptron-error', event.reason?.message || String(event.reason)));
let started = false;
window.addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== location.origin || event.data.type !== 'apptron-boot' || started) return;
  started = true;
  try {
    const { uuid, user, relay, runtime, manifest } = event.data;
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
    window.apptron = { mode: 'console', embedded: false, user: { username: 'guest', user_id: user }, env: { uuid, name: 'snapshot', owner: user }, origin: new URL('./', location.href).href.replace(/\/$/, ''), publishURL: async () => '', refreshEnv: async () => {} };
    const { WanixRuntime } = await import(new URL('wanix.min.js', runtime));
    const config = { screen: true, helpers: true, wasm: null, ...(relay ? { network: relay } : {}) };
    const w = new WanixRuntime(config); window.apptron.instance = w;
    w.screen = document.querySelector('#screen').transferControlToOffscreen();
    window.handleAudio = () => {};
    w._getBundle = async name => (await gunzip(await load(bundleName(name)), 768 * 1024 * 1024)).buffer;
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
    terminal.focus(); send('apptron-ready');
  } catch (error) { send('apptron-error', error.message); }
});
