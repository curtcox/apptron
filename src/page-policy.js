// Runs synchronously before any application/runtime script or untrusted input.
// Derive path-scoped sources from this document so arbitrary hosting subpaths work.
(() => {
  const base = new URL('./', location.href);
  const at = path => new URL(path, base).href;
  const vm = document.documentElement.dataset.apptron === 'vm';
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
  const policy = document.createElement('meta');
  policy.dataset.apptronPolicy = '1';
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = [
    `default-src 'none'`,
    `script-src ${at('deployment-config.js')} ${at('src/')} ${at('vendor/')} ${vm ? at('runtime/') + " 'wasm-unsafe-eval'" : 'https://hashbin.org/sdk/'}`,
    `worker-src ${vm ? "blob: " + at('runtime/') + " " + at('data-sw.js') : at('data-sw.js')}`,
    `style-src ${at('deployment-config.js')} ${at('src/')} ${at('vendor/')} ${at('runtime/')} 'unsafe-inline'`,
    `img-src ${at('')} data: blob:`,
    `font-src ${at('vendor/')} data:`,
    `connect-src ${vm ? 'blob: ' + at('runtime/') + ' ' + at('runtime.lock') + ' ' + at('vm-data/') + ' ' + relaySource : at('') + ' https://256t.us https://hashbin.org https://is.gd https://api.allorigins.win'}`,
    `frame-src ${vm ? "'none'" : vmFrame}`,
    `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`,
  ].join('; ');
  document.head.append(policy);
})();
