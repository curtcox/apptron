// Runs synchronously before any application/runtime script or untrusted input.
// Derive path-scoped sources from this document so arbitrary hosting subpaths work.
(() => {
  const base = new URL('./', location.href);
  const at = path => new URL(path, base).href;
  const vm = document.documentElement.dataset.apptron === 'vm';
  const aiFrame = !vm && base.href === 'https://apptron.hashbin.page/' ? ' https://ai.hashbin.page' : '';
  const aiProviders = !vm && base.href === 'https://curtcox.github.io/apptron/' ? ' https://api.openai.com https://openrouter.ai https://api.anthropic.com https://generativelanguage.googleapis.com' : '';
  const params = new URLSearchParams(location.hash.slice(1));
  const configuredVM = globalThis.APPTRON_DEPLOYMENT?.vmURL;
  const vmFrame = configuredVM ? new URL(configuredVM).href : at('vm.html');
  const relay = params.get('relay') || '';
  let relaySource = '';
  if (vm && relay) {
    const url = new URL(relay);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Invalid VM relay.');
    relaySource = url.href;
  }
  // Firefox checks synthetic cached responses against the worker entry URL.
  // Keep the exception exact; user-data and arbitrary origin scripts remain excluded.
  const cachedResponseSource=at('data-sw.js'),vmCacheSource=new URL('data-sw.js',vmFrame).href;
  const serviceWorkerSources=['data-sw.js','offline-assets.js','src/data-sw.js','src/offline-cache.js','src/offline-bootstrap.js','src/runtime-integrity.js','src/runtime-cache.js','src/data-access.js','src/bridge.js','src/store.js','src/r2fs.js','src/tar.js','src/snapshot.js','src/read-limited.js','src/content-id.js','vendor/fragment-kit-v0.4.3/src/offline/sw-core.js','vendor/fragment-kit-v0.4.3/src/core/cid.js','vendor/fragment-kit-v0.4.3/src/core/bytes.js'].map(at).join(' ');
  const policy = document.createElement('meta');
  policy.dataset.apptronPolicy = '1';
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = [
    `default-src 'none'`,
    `script-src ${cachedResponseSource} ${at('deployment-config.js')} ${at('offline-assets.js')} ${at('src/')} ${at('vendor/')} ${vm ? at('runtime/') + " 'wasm-unsafe-eval'" : ''}`,
    `worker-src ${vm ? "blob: " + at('runtime/') + " " : ""}${serviceWorkerSources}`,
    `style-src ${cachedResponseSource} ${at('deployment-config.js')} ${at('src/')} ${at('vendor/')} ${at('runtime/')} 'unsafe-inline'`,
    `img-src ${at('')} data: blob:`,
    `font-src ${cachedResponseSource} ${at('vendor/')} data:`,
    `connect-src ${cachedResponseSource} ${vm ? 'blob: ' + at('runtime/') + ' ' + at('runtime.lock') + ' ' + at('vm-data/') + ' ' + relaySource : at('') + ' https://256t.us https://hashbin.org https://is.gd https://api.allorigins.win' + aiProviders}`,
    `frame-src ${vm ? "'none'" : vmFrame + " " + vmCacheSource + aiFrame}`,
    `media-src ${vm ? "'none'" : 'blob:'}`,
    `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`,
  ].join('; ');
  document.head.append(policy);
})();
