import { deployment } from './deployment.js';
import { readDraft, writeDraft, provenance, provenanceLabel } from './draft.js';
import { ApptronHost, ensureServiceWorker } from './apptron-host.js';
import { parseSnapshot, serializeSnapshot, MAX_TEXT_BYTES } from './snapshot.js';
import { MAX_OVERLAY_BYTES } from './overlay.js';
import {config,urlState,LZString}from'./fragment-config.js';
import{LocalDrafts,compactShell,createShell,mountMobileTabs,createShareDialog,createQrDialog,OfflineClient}from'../vendor/fragment-kit-v0.3.5/src/index.js';
import { HashBinDocuments, HashBinStore } from './hashbin.js';
import { HashBinPanel } from './hashbin-panel.js';
import { getRelay, setRelay } from './network.js';
import { loadExample } from './examples.js';
import { setupKeybar } from './keybar.js';
import { installTxtarMode } from './txtar-mode.js';
const $ = id => document.getElementById(id);
Object.assign(globalThis,{LZString,HashBinDocuments});
let navigationError=null;const status = message => { if(!navigationError)$('status').textContent = message; };
try { deployment(); } catch (error) { status(error.message); for (const button of document.querySelectorAll('button')) button.disabled = true; throw error; }
const storage = (kind, prefix) => ({
  getItem: key => { try { return window[kind].getItem(prefix + key); } catch { return null; } },
  setItem: (key, value) => window[kind].setItem(prefix + key, value),
  removeItem: key => { try { window[kind].removeItem(prefix + key); } catch { /* Storage may be unavailable. */ } }
});
const oldHeader=document.querySelector('.topbar'),brand=oldHeader.querySelector('.brand');
const shell=createShell({config});shell.header.querySelector('.fk-brand').replaceChildren(...brand.childNodes);shell.header.querySelector('.fk-brand').href='./';
for(const link of shell.header.querySelectorAll('a')){if(link.textContent==='Docs ↗')link.href='docs.html';if(link.textContent==='Gallery ↗')link.href='gallery.html';}
for(const link of shell.drawer.body.querySelectorAll('a')){if(link.textContent==='Docs ↗')link.href='docs.html';if(link.textContent==='Gallery ↗')link.href='gallery.html';}
shell.header.querySelector('.fk-more').id='more-toggle';
compactShell({header:shell.header,status:document.querySelector('.statusbar')});oldHeader.remove();
const toolbar=document.querySelector('.toolbar'),menu=document.querySelector('.more .menu');
for(const id of ['run','share','qr'])shell.toolbar.append($(id));
$('share').textContent='Share';$('qr').textContent='QR';
shell.drawer.body.append($('capture'),...menu.children);
for(const id of ['hashbin-save','hashbin-open','hashbin-status','share-dialog','qr-dialog','hashbin-load-dialog','hashbin-dialog'])$(id).remove();
toolbar.remove();document.querySelector('.mobile-tabs').remove();
let tabs,navigationRevision=0,lastNavigation=location.href;
const closeMore=()=>shell.drawer.dialog.close();
const local = storage('localStorage', 'apptron:'), session = storage('sessionStorage', '');
const drafts = new LocalDrafts({ storage: local, key: 'draft', serialize: value => writeDraft(value.source, value.provenance), parse: readDraft });
installTxtarMode(ace);
const editor = ace.edit('editor');
editor.setTheme('ace/theme/tomorrow_night'); editor.session.setMode('ace/mode/txtar');
editor.setOptions({ fontSize: 13, showPrintMargin: false, useWorker: false, wrap: true, tabSize: 2, scrollPastEnd: .3 });
editor.renderer.setPadding(17); editor.renderer.setScrollMargin(14, 14);
const host = new ApptronHost($('terminal'), status);
let dirty = false, applying = false, revision = 0, savedLink, overlayBlob, overlayURL,qrSave=false;
let sourceOrigin = provenance();
const saveDraft = () => drafts.attempt({source:source(),provenance:sourceOrigin});
const source = () => editor.getValue();
function sourceChanged() {
  revision++; savedLink = null;if(!applying){navigationError=null;navigationRevision++;panel?.cancelLoad();urlState.cancel();}
  if (!applying) { dirty = true; if (sourceOrigin.kind === 'example') sourceOrigin = provenance('local'); drafts.attempt({source:source(),provenance:sourceOrigin},true); }
  $('source-provenance').textContent = provenanceLabel(sourceOrigin);
  const size = new TextEncoder().encode(source()).length;
  $('source-size').textContent = size > 1024 ? (size / 1024).toFixed(1) + ' KiB' : size + ' B';
  try { const snapshot = parseSnapshot(source()); $('file-count').textContent = `${snapshot.files.length} file${snapshot.files.length === 1 ? '' : 's'}`; }
  catch { $('file-count').textContent = size > MAX_TEXT_BYTES ? 'Over 1 MiB limit' : 'Check snapshot format'; }
  if(!applying)try{lastNavigation=urlState.write({src:source()},{run:false});}catch(error){status(error.message);}
}
function setSource(value, origin = provenance('local')) { parseSnapshot(value); drafts.opened();urlState.cancel(); sourceOrigin = origin; applying = true; editor.setValue(value, -1); applying = false; dirty = false; }
function replaceSource(value, origin = sourceOrigin) { if (dirty && !confirm('Replace your unsaved editor changes with this snapshot?')) return false; setSource(value, origin); return true; }
function view(name){tabs?.select(name==='code'?0:1);editor.resize();host.resize();}
tabs=mountMobileTabs({desktop:true,container:document.querySelector('.workspace'),panels:[{label:'Code',panel:document.querySelector('.code-pane')},{label:'Preview',panel:document.querySelector('.preview-pane')}],onChange:index=>{document.body.dataset.view=index===-1?'split':index?'preview':'code';editor.resize();host.resize();}});
[...document.querySelectorAll('.fk-tabs button')].slice(0,2).forEach((button,index)=>button.id=index?'show-preview':'show-code');
if(matchMedia('(max-width:767px)').matches)tabs.select(0);
const store = new HashBinStore({ clientId: document.querySelector('meta[name="hashbin-client-id"]').content, redirectUri: new URL('./', location.href).href, storage: storage('localStorage', 'apptron:oauth:'), transactionStorage: session });
let panel = new HashBinPanel({ store, container:shell.drawer.body, getSnapshot: () => { parseSnapshot(source()); return { src: source(), type: 'apptron' }; }, getFingerprint: source,
  onLoad: (snapshot, cid) => {
    setSource(snapshot.src, provenance('hashbin', cid));
    closeMore();urlState.cancel();history.replaceState(null,'',urlState.link(location.href,cid));lastNavigation=location.href;savedLink = { source: source(), url: HashBinDocuments.link(location.href, cid) }; status('Loaded snapshot. Press Run to boot it.');
  },
  onSaved: (cid, fingerprint, link, overlay) => {
    if (overlay) {
      const snapshot = parseSnapshot(source());
      snapshot.header = snapshot.header.replace(/^overlay:.*\n?/gm, '') + `\noverlay: ${cid}`;
      setSource(serializeSnapshot(snapshot),sourceOrigin.kind==='example'?provenance('local'):sourceOrigin);writeURL();
      status('Overlay saved. Its CID is now in your snapshot. Share or save the snapshot too.');
    } else { urlState.cancel();history.replaceState(null,'',link);lastNavigation=link;savedLink = { source: fingerprint, url: link }; dirty = false;if(qrSave){qrSave=false;panel.dialog.close();qr.open(link);} }
  }
});
editor.session.on('change', sourceChanged);
setupKeybar($('keybar'), host);
$('run').onclick = async () => {
  if ($('run').disabled) return;
  const text = source(), version = revision;
  try {
    parseSnapshot(text);
    const networkGrant = await host.approveNetwork(text, getRelay(), value => confirm(`Allow this snapshot to use the network through ${value}? It can reach services on your network. Permission is for this exact snapshot and runtime in this tab. Use Network to revoke access.`));
    if (revision !== version) throw new Error('Snapshot changed while permissions were checked. Press Run again.');
    networkLabel();
    $('run').disabled = true; $('run').textContent = 'Booting…'; $('vm-dot').classList.add('muted');
    if (matchMedia('(max-width:767px)').matches) view('preview');
    await host.run(text, { networkGrant, allowMismatch: commit => confirm(`This overlay was made for runtime ${commit.slice(0, 7)}. It may not work with this runtime. Load it anyway?`) });
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
    const result = await host.captureSnapshot();
    if (revision !== version) { status('Editor changed during capture. Capture again to replace it.'); return; }
    setSource(result.source, sourceOrigin.kind === 'example' ? provenance('local') : sourceOrigin);writeURL(); host.source = result.source;
    status(result.skipped.length ? `Captured project. Skipped: ${result.skipped.join(', ')}` : 'Project files captured into the editor.');
    view('code');
  } catch (error) { status(error.message); }
  finally { $('capture').disabled = false; }
};
function links(){return urlState.build({src:source()},{run:false});}
const share=createShareDialog({urlState,getSnapshot:()=>({src:source()}),onSave:()=>{closeMore();panel.openSave(null);}});
// VM execution remains an explicit Run action; sharing never arms or boots it.
share.dialog.querySelector('#share-run').closest('label').hidden=true;
const openShare=share.open;share.open=()=>{openShare();const run=share.dialog.querySelector('#share-run');run.checked=false;run.dispatchEvent(new Event('change'));};
const qr=createQrDialog({config,urlState,onLoad:outcome=>openURL(outcome.kind==='cid'?urlState.link(location.href,outcome.cid):outcome.href),onSave:()=>{qrSave=true;qr.dialog.close();return panel.openSave(null);}});
panel.dialog.addEventListener('close',()=>{qrSave=false;});
$('share').onclick=()=>{try{share.open();}catch(error){status(error.message);}};
$('qr').onclick=()=>{try{qr.open(savedLink?.source===source()?savedLink.url:links().href);}catch(error){status(error.message);}};
const networkLabel = () => { const relay = getRelay(); $('network-state').textContent = relay ? `◉ Relay configured: ${relay}` : '○ No VM network'; $('run').title = relay ? `Run with relay ${relay}` : 'Run without VM network'; };
window.addEventListener('storage', event => { if (event.key === 'apptron:relay' || event.key === null) { host.revokeNetwork(); $('vm-dot').classList.add('muted'); networkLabel(); status('Network setting changed in another tab. VM stopped; press Run to review access.'); } });
$('network-open').onclick = () => { $('relay-url').value = getRelay(); $('network-message').textContent = ''; $('network-dialog').showModal(); };
$('network-save').onclick = () => {
  try { setRelay($('relay-url').value); host.revokeNetwork(); $('vm-dot').classList.add('muted'); networkLabel(); $('network-dialog').close(); status('Network setting saved. VM stopped; press Run to apply it.'); }
  catch (error) { $('network-message').textContent = error.message; }
};
$('network-revoke').onclick = () => { host.revokeNetwork(); $('vm-dot').classList.add('muted'); $('network-dialog').close(); status('Network grants revoked. VM stopped; the next networked Run needs approval.'); };
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
    overlayBlob = await host.captureOverlay();
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
new ResizeObserver(() => editor.resize()).observe($('editor'));
function writeURL(){urlState.cancel();history.replaceState(null,'',links().href);lastNavigation=location.href;}
async function openURL(href,{initial=false}={}){
 if(!initial&&lastNavigation===href)return;lastNavigation=href;
 const current=++navigationRevision;navigationError=null;urlState.cancel();panel.cancelLoad();
 try{
  const intent=urlState.parse(href);
  if(intent.kind==='publish'){
   const result=await store.published(intent.hash);if(current!==navigationRevision)return;
   if(result?.snapshot){setSource(result.snapshot.src,provenance('stored'));writeURL();}
   if(result?.cid)panel.saved(result.cid,source(),result.overlay);
   if(result?.error)status(result.error);else if(result)status('Saved to HashBin.');
  }else if(intent.kind==='cid'){
   status('Loading from HashBin…');const doc=await store.load(intent.cid);if(current!==navigationRevision)return;
   setSource(doc.src,provenance('hashbin',intent.cid));const link=urlState.link(href,intent.cid);history.replaceState(null,'',new URL(link).pathname+new URL(link).search+new URL(link).hash);lastNavigation=location.href;savedLink={source:source(),url:location.href};status('Loaded snapshot. Press Run to boot it.');
  }else if(intent.kind==='source'){setSource(intent.doc.src,provenance('share'));writeURL();}
  else if(intent.kind==='example'||initial){const id=intent.kind==='example'?intent.id:'hello-shell',text=await loadExample(id);if(current!==navigationRevision)return;setSource(text,provenance('example',id));if(intent.kind==='example')writeURL();}
 }catch(error){if(current===navigationRevision){navigationError=error;$('status').textContent=error.message;}}
}
const offline=new OfflineClient({url:'./data-sw.js',timeout:90000,onStatus:result=>{shell.offlineStatus.textContent=result.ready?'Available offline':'Offline setup incomplete';},onUpdate:()=>{update.hidden=false;shell.offlineStatus.textContent='Offline update ready';}});
const repair=document.createElement('button'),update=document.createElement('button');repair.id='offline-repair';repair.textContent='Repair offline copy';update.id='offline-update';update.textContent='Update and reload';update.hidden=true;shell.drawer.body.append(repair,update);
repair.onclick=()=>offline.repair().catch(error=>{shell.offlineStatus.textContent=error.message;});
update.onclick=()=>{saveDraft();writeURL();offline.activateUpdate();};
let controlled=Boolean(navigator.serviceWorker?.controller);
navigator.serviceWorker?.addEventListener('controllerchange',()=>{if(controlled){saveDraft();writeURL();location.reload();}else controlled=true;});
async function initializeWithIsolation(){
 await openURL(location.href,{initial:true});document.body.dataset.ready='true';
 try{
  await ensureServiceWorker();offline.registration=await navigator.serviceWorker.getRegistration(new URL('./',location.href));
  const announce=()=>{if(offline.registration?.waiting)offline.onUpdate();};announce();offline.registration?.addEventListener('updatefound',()=>offline.registration.installing?.addEventListener('statechange',announce));await offline.status();
  const key='apptron:isolation-reload';
  if(!crossOriginIsolated&&!session.getItem(key)){saveDraft();writeURL();session.setItem(key,'1');location.reload();}
  else if(crossOriginIsolated)session.removeItem(key);else status('Browser isolation is unavailable. Wasm executables need a reload or another supported browser.');
 }catch(error){status(error.message);shell.offlineStatus.textContent='Offline saving unavailable';}
}
for(const id of ['capture','capture-overlay','reset','network-open','download-source']){const button=$(id),action=button.onclick;button.onclick=event=>{closeMore();return action.call(button,event);};}
store.retireLegacyTokens().catch(()=>{});
drafts.mount(shell.drawer.body, async value => {
  let origin = value.provenance;
  if (origin.kind === 'example') {
    try { if (value.source !== await loadExample(origin.detail)) origin = provenance('stored'); }
    catch { origin = provenance('stored'); }
  }
  panel.cancelLoad(); setSource(value.source,origin); writeURL();
  status('Saved work restored — press Run.');
}, value => {
  const files = parseSnapshot(value.source).files;
  const file = files.find(file => !file.binary && !file.path.startsWith('.apptron/'));
  const line = file && new TextDecoder().decode(file.data).split('\n').find(line => line.trim() && !line.startsWith('#!'));
  return (file ? file.path + ' · ' + (line || '(empty file)') : 'Snapshot · ' + files.length + ' files') + '\n' + value.source;
});
window.addEventListener('hashchange',()=>openURL(location.href));
window.addEventListener('popstate',()=>openURL(location.href));
window.addEventListener('offline-before-reload',()=>{saveDraft();writeURL();});
window.ApptronOnline = { editor, host, panel, getSource: source, setSource:(value,origin)=>{setSource(value,origin);writeURL();},openURL, initialized: initializeWithIsolation() };
host.config().then(lock => { $('runtime-commit').textContent = lock.commit.slice(0, 7); }).catch(error => status(error.message));
