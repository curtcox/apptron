import { ApptronHost, ensureServiceWorker } from './apptron-host.js';
import { parseSnapshot, serializeSnapshot, MAX_TEXT_BYTES } from './snapshot.js';
import { captureSnapshot } from './capture.js';
import { captureOverlay, MAX_OVERLAY_BYTES } from './overlay.js';
import { ShareLinks, ShareClient, readShareURL } from './share-links.js';
import { HashBinDocuments, HashBinStore } from './hashbin.js';
import { HashBinPanel } from './hashbin-panel.js';
import { renderQR } from './qr-panel.js';
import { getRelay, setRelay } from './network.js';
import { loadExample } from './examples.js';
import { setupKeybar } from './keybar.js';
import { installTxtarMode } from './txtar-mode.js';
const $ = id => document.getElementById(id);
const status = message => { $('status').textContent = message; };
const storage = (kind, prefix) => ({
  getItem: key => { try { return window[kind].getItem(prefix + key); } catch { return null; } },
  setItem: (key, value) => window[kind].setItem(prefix + key, value),
  removeItem: key => { try { window[kind].removeItem(prefix + key); } catch { /* Storage may be unavailable. */ } }
});
const local = storage('localStorage', 'apptron:'), session = storage('sessionStorage', '');
installTxtarMode(ace);
const editor = ace.edit('editor');
editor.setTheme('ace/theme/tomorrow_night'); editor.session.setMode('ace/mode/txtar');
editor.setOptions({ fontSize: 13, showPrintMargin: false, useWorker: false, wrap: true, tabSize: 2, scrollPastEnd: .3 });
editor.renderer.setPadding(17); editor.renderer.setScrollMargin(14, 14);
const host = new ApptronHost($('terminal'), status);
const shareClient = new ShareClient();
let dirty = false, applying = false, revision = 0, draftTimer, savedLink, shareVersion, overlayBlob, overlayURL;
const source = () => editor.getValue();
function sourceChanged() {
  revision++; savedLink = null; shareClient.cancel(); panel?.cancelLoad();
  if (!applying) dirty = true;
  const size = new TextEncoder().encode(source()).length;
  $('source-size').textContent = size > 1024 ? (size / 1024).toFixed(1) + ' KiB' : size + ' B';
  try { const snapshot = parseSnapshot(source()); $('file-count').textContent = `${snapshot.files.length} file${snapshot.files.length === 1 ? '' : 's'}`; }
  catch { $('file-count').textContent = size > MAX_TEXT_BYTES ? 'Over 1 MiB limit' : 'Check snapshot format'; }
  clearTimeout(draftTimer); draftTimer = setTimeout(() => { try { local.setItem('draft', source()); } catch { status('Draft could not be stored. Download or share your snapshot to keep a copy.'); } }, 300);
}
function setSource(value) { parseSnapshot(value); applying = true; editor.setValue(value, -1); applying = false; dirty = false; }
function replaceSource(value) { if (dirty && !confirm('Replace your unsaved editor changes with this snapshot?')) return false; setSource(value); return true; }
function view(name) { document.body.dataset.view = name; $('show-code').setAttribute('aria-pressed', String(name === 'code')); $('show-preview').setAttribute('aria-pressed', String(name === 'preview')); editor.resize(); host.frame?.contentWindow.dispatchEvent(new Event('resize')); }
const store = new HashBinStore({ clientId: document.querySelector('meta[name="hashbin-client-id"]').content, redirectUri: new URL('./', location.href).href, storage: storage('localStorage', 'apptron:oauth:'), transactionStorage: session });
let panel = new HashBinPanel({ store, getSnapshot: () => { parseSnapshot(source()); return { src: source(), type: 'apptron' }; }, getFingerprint: source,
  onLoad: (snapshot, cid) => {
    if (!replaceSource(snapshot.src)) return;
    $('hashbin-load-dialog').close(); savedLink = { source: source(), url: HashBinDocuments.link(location.href, cid) }; status('Loaded snapshot. Press Run to boot it.');
  },
  onSaved: (cid, fingerprint, link, overlay) => {
    if (overlay) {
      const snapshot = parseSnapshot(source());
      snapshot.header = snapshot.header.replace(/^overlay:.*\n?/gm, '') + `\noverlay: ${cid}`;
      setSource(serializeSnapshot(snapshot));
      status('Overlay saved. Its CID is now in your snapshot. Share or save the snapshot too.');
    } else { savedLink = { source: fingerprint, url: link }; dirty = false; }
  }
});
editor.session.on('change', sourceChanged);
setupKeybar($('keybar'), host);
$('show-code').onclick = () => view('code'); $('show-preview').onclick = () => view('preview');
$('run').onclick = async () => {
  if ($('run').disabled) return;
  const text = source();
  try {
    parseSnapshot(text); $('run').disabled = true; $('run').textContent = 'Booting…'; $('vm-dot').classList.add('muted');
    if (matchMedia('(max-width:760px)').matches) view('preview');
    await host.run(text, { allowMismatch: commit => confirm(`This overlay was made for runtime ${commit.slice(0, 7)}. It may not work with this runtime. Load it anyway?`) });
    if (host.running) { $('vm-dot').classList.remove('muted'); dirty = false; }
  } catch (error) { status(error.message); }
  finally { $('run').disabled = false; $('run').innerHTML = '<span aria-hidden="true">▶</span> Run'; }
};
$('reset').onclick = async () => {
  if (!host.uuid) { status('Run a snapshot before resetting its VM.'); return; }
  if (!confirm('Reset this VM’s project, home, public files, and disk changes? The editor text is kept.')) return;
  try { await host.reset(); status('VM reset. Press Run for a clean boot.'); $('vm-dot').classList.add('muted'); }
  catch (error) { status(error.message); }
};
$('capture').onclick = async () => {
  if (!host.running) { status('Run a snapshot before capturing project files.'); return; }
  if (source() !== host.source && !confirm('Replace your unsaved editor changes with files from the running VM?')) return;
  const version = revision; $('capture').disabled = true; status('Waiting for Apptron’s file sync…');
  try {
    await new Promise(resolve => setTimeout(resolve, 5500));
    const result = await captureSnapshot(host.store, host.uuid, host.snapshot);
    if (revision !== version) { status('Editor changed during capture. Capture again to replace it.'); return; }
    setSource(result.source); host.source = result.source;
    status(result.skipped.length ? `Captured project. Skipped: ${result.skipped.join(', ')}` : 'Project files captured into the editor.');
    view('code');
  } catch (error) { status(error.message); }
  finally { $('capture').disabled = false; }
};
function links() { parseSnapshot(source()); return ShareLinks.build({ url: location.href, code: source(), compress: LZString.compressToEncodedURIComponent }); }
$('share').onclick = () => {
  try { shareVersion = source(); $('share-url').value = savedLink?.source === source() ? savedLink.url : links().fallback; $('share-message').textContent = ''; $('share-dialog').showModal(); }
  catch (error) { status(error.message); }
};
$('copy-share').onclick = async () => {
  try { await navigator.clipboard.writeText($('share-url').value); $('share-message').textContent = 'Link copied.'; }
  catch { $('share-url').focus(); $('share-url').select(); $('share-message').textContent = 'Select and copy the link above.'; }
};
$('shorten').onclick = async () => {
  $('shorten').disabled = true; $('share-message').textContent = 'Shortening link…';
  try {
    const result = await shareClient.shorten(ShareLinks.build({ url: location.href, code: shareVersion, compress: LZString.compressToEncodedURIComponent }));
    if (!result || source() !== shareVersion || !$('share-dialog').open) return;
    $('share-url').value = result.url; $('share-message').textContent = result.error?.message || 'Short link ready to copy.';
  } finally { $('shorten').disabled = false; }
};
$('share-dialog').addEventListener('close', () => { shareClient.cancel(); $('shorten').disabled = false; });
$('qr').onclick = () => {
  try {
    const link = savedLink?.source === source() ? savedLink.url : links().fallback;
    $('qr-canvas').hidden = true; $('qr-download').hidden = true; $('qr-message').textContent = '';
    $('qr-dialog').showModal();
    try { renderQR(link, $('qr-canvas')); $('qr-canvas').hidden = false; $('qr-download').hidden = false; $('qr-download').href = $('qr-canvas').toDataURL('image/png'); $('qr-message').textContent = 'Scan to open this snapshot. Press Run on the other device to boot it.'; }
    catch (error) { $('qr-message').textContent = error.message; }
  } catch (error) { status(error.message); }
};
$('qr-hashbin').onclick = () => { $('qr-dialog').close(); panel.openSave(); };
$('hashbin-open').onclick = () => $('hashbin-load-dialog').showModal();
const networkLabel = () => { $('network-state').textContent = getRelay() ? '◉ Relay configured' : '○ No VM network'; };
$('network-open').onclick = () => { $('relay-url').value = getRelay(); $('network-message').textContent = ''; $('network-dialog').showModal(); };
$('network-save').onclick = () => {
  try { setRelay($('relay-url').value); networkLabel(); $('network-dialog').close(); status('Network setting saved. Press Run to apply it.'); }
  catch (error) { $('network-message').textContent = error.message; }
};
$('dismiss-notice').onclick = () => { $('network-notice').hidden = true; try { local.setItem('network-notice-dismissed', '1'); } catch { /* Optional preference. */ } };
$('network-notice').hidden = local.getItem('network-notice-dismissed') === '1'; networkLabel();
function download(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('download-source').onclick = () => { try { parseSnapshot(source()); download(source(), 'text/plain', 'snapshot.txtar'); } catch (error) { status(error.message); } };
$('capture-overlay').onclick = async () => {
  if (!host.running) { status('Run a snapshot before capturing a disk overlay.'); return; }
  $('capture-overlay').disabled = true; status('Capturing changed system files…');
  try {
    overlayBlob = await captureOverlay(host.instance, host.lock.commit, host.uuid);
    if (overlayURL) URL.revokeObjectURL(overlayURL);
    overlayURL = URL.createObjectURL(new Blob([overlayBlob], { type: 'application/gzip' }));
    $('overlay-download').href = overlayURL;
    $('overlay-message').textContent = `${(overlayBlob.length / 1048576).toFixed(2)} MiB compressed. ` + (overlayBlob.length > MAX_OVERLAY_BYTES ? 'This overlay exceeds HashBin’s 5 MiB limit. Download it or use a prebuilt gallery overlay.' : 'Download it, or save it to HashBin and add its CID to your snapshot.');
    $('overlay-upload').disabled = overlayBlob.length > MAX_OVERLAY_BYTES;
    $('overlay-dialog').showModal(); status('Disk overlay captured.');
  } catch (error) { status(error.message); }
  finally { $('capture-overlay').disabled = false; }
};
$('overlay-upload').onclick = () => { $('overlay-dialog').close(); panel.openSave(overlayBlob); };
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(button.dataset.close).close();
document.addEventListener('click', event => { if (!event.target.closest('.more')) document.querySelector('.more').open = false; });
new ResizeObserver(() => editor.resize()).observe($('editor'));
async function initialize() {
  let initial = local.getItem('draft') || await loadExample('hello-shell');
  try {
    const callback = await store.callback(location.search);
    if (callback) {
      if (callback.snapshot?.src) initial = callback.snapshot.src;
      const url = new URL(location.href); for (const key of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(key); history.replaceState(null, '', url);
      status(callback.error || 'Connected to HashBin. Choose Save to review the price.');
    } else {
      const cid = HashBinDocuments.cid(location.hash);
      const example = new URL(location.href).searchParams.get('example');
      if (cid) { setSource(initial); await panel.load(cid); return; }
      const shared = readShareURL(location.href, LZString.decompressFromEncodedURIComponent);
      if (shared !== null) initial = shared;
      else if (example) initial = await loadExample(example);
    }
    setSource(initial);
  } catch (error) { status(error.message); try { setSource(local.getItem('draft') || await loadExample('hello-shell')); } catch { setSource(await loadExample('hello-shell')); } }
}
async function initializeWithIsolation() {
  await initialize();
  try {
    await ensureServiceWorker();
    const key = 'apptron:isolation-reload';
    if (!crossOriginIsolated && !session.getItem(key)) {
      local.setItem('draft', source()); session.setItem(key, '1'); location.reload();
    } else if (crossOriginIsolated) session.removeItem(key);
    else status('Browser isolation is unavailable. Wasm executables need a reload or another supported browser.');
  } catch (error) { status(error.message); }
}
window.ApptronOnline = { editor, host, panel, getSource: source, setSource, initialized: initializeWithIsolation() };
host.config().then(lock => { $('runtime-commit').textContent = lock.commit.slice(0, 7); }).catch(error => status(error.message));
