const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
test.beforeEach(async({page},testInfo)=>test.skip(process.env.APPTRON_BOOT!=='1'||testInfo.project.name!=='chromium','Real VM boot runs explicitly in Chromium.'));
async function boot(page,source){await page.goto('./');await page.waitForFunction(()=>crossOriginIsolated&&window.ApptronOnline);await page.evaluate(()=>ApptronOnline.initialized);if(source)await page.evaluate(s=>ApptronOnline.setSource(s),source);await page.locator('#run').click();await expect(page.locator('#run')).toBeEnabled({timeout:180000});await expect(page.locator('#status')).toContainText('Running ·');}
async function terminal(page){return page.locator('#terminal iframe').contentFrame().locator('.xterm');}
async function text(page){return page.evaluate(()=>{const b=ApptronOnline.host.frame.contentWindow.apptron.terminal.buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString()).join('\n')});}
test('boots a real shell from a Pages subpath, syncs a VM edit and captures it',async({page})=>{
 test.setTimeout(240000);await boot(page);await expect.poll(()=>text(page),{timeout:90000}).toContain('guest:/project');
 await page.evaluate(()=>ApptronOnline.host.sendKey("printf 'from the VM\\n' > captured.txt\r"));
 await expect.poll(()=>page.evaluate(()=>ApptronOnline.host.frame.contentWindow.apptron.instance.readText('project/captured.txt').catch(()=>'')),{timeout:15000}).toContain('from the VM');
 await page.locator('#capture').click();await expect(page.locator('#status')).toContainText('Project files captured',{timeout:20000});expect(await page.evaluate(()=>ApptronOnline.getSource())).toContain('from the VM');
 const result=await page.evaluate(async()=>{const w=ApptronOnline.host.frame.contentWindow.apptron.instance;await w.writeFile('#scratch/probe','scratch works');return w.readText('#scratch/probe')});expect(result).toBe('scratch works');
});
test('restores the Docker-built Python overlay and executes Python offline',async({page})=>{
 test.setTimeout(240000);await boot(page,readFileSync('examples/python.txtar','utf8'));await expect.poll(()=>text(page),{timeout:90000}).toContain('Hello from Python in Apptron!');
});
test('Go gzip bundles load using upstream tar.br names and compile offline',async({page})=>{
  test.setTimeout(300000);await boot(page,readFileSync('examples/go-hello.txtar','utf8'));await expect.poll(()=>text(page),{timeout:90000}).toContain('guest:/project');await page.evaluate(()=>ApptronOnline.host.sendKey('source /etc/goprofile && go run hello.go\r'));await expect.poll(()=>text(page),{timeout:180000}).toContain('Hello from Go in your browser!');await expect(page.locator('#status')).toContainText('Running ·');
});

test('executes the gallery WASI binary natively',async({page})=>{
 test.setTimeout(180000);await boot(page,readFileSync('examples/wasm.txtar','utf8'));await expect.poll(()=>text(page),{timeout:90000}).toContain('Hello from Wasm!');
});
test('capture overlay preserves loaded packages and restores scratch into a fresh VM',async({page})=>{
 test.setTimeout(240000);await boot(page,readFileSync('examples/python.txtar','utf8'));await expect.poll(()=>text(page),{timeout:90000}).toContain('Hello from Python in Apptron!');
 await page.evaluate(async()=>{
   const host=ApptronOnline.host;await host.frame.contentWindow.apptron.instance.writeFile('#scratch/overlay-probe','overlay restored');
   const {readOverlay}=await import('./src/overlay.js');
   const captured=await readOverlay(await host.captureOverlay(),host.lock.commit);
   if(!captured.entries.some(e=>e.path.startsWith('usr/bin/python')))throw new Error('Loaded Python package is missing from capture.');
   const source='# apptron snapshot v1\n-- .apptron/envrc --\ncd /project\npython3 -c \'print("RESTORED_OVERLAY")\'\n';
   const {snapshotUUID}=await import('./src/snapshot.js');const {WanixDisk}=await import('./src/wanix-disk.js');
   const uuid=await snapshotUUID(source,host.lock.commit);host.stop();
   const disk=new WanixDisk();try{await disk.restore(uuid,captured.entries)}finally{disk.close()}
   await host.run(source);
 });
 await expect.poll(()=>text(page),{timeout:90000}).toContain('RESTORED_OVERLAY');
 expect(await page.evaluate(()=>ApptronOnline.host.frame.contentWindow.apptron.instance.readText('#env/overlay-probe'))).toBe('overlay restored');
});

test('T1 T5 T6 hostile envrc cannot execute browser code, cross snapshot storage, or open sockets',async({page})=>{
 test.setTimeout(240000);
 const source=`# apptron snapshot v1
-- .apptron/envrc --
cd /project
s=$(cat /web/dom/new/script 2>/dev/null)
if [ -n "$s" ]; then
 echo "src='data:text/javascript,window.top.__apptron_escape=1;window.top.__apptron_stolen=window.top.localStorage.length'" >> /web/dom/$s/attrs
 echo "append-child $s" >> /web/dom/body/ctl
fi
i=$(cat /web/dom/new/iframe 2>/dev/null)
if [ -n "$i" ]; then
 echo "srcdoc='<script>top.__apptron_escape=1</script>'" >> /web/dom/$i/attrs
 echo "append-child $i" >> /web/dom/body/ctl
fi
d=$(cat /web/dom/new/div)
echo "class='security-probe'" >> /web/dom/$d/attrs
echo "onmouseover='top.__apptron_escape=1'" >> /web/dom/$d/attrs
echo "style='background:url(https://egress.invalid/beacon)'" >> /web/dom/$d/attrs
echo "append-child $d" >> /web/dom/body/ctl
echo '@import url(https://egress.invalid/style);' >> /web/dom/style
for url in wss://egress.invalid/socket ws://localhost:65530/socket; do
 r=$(cat /cap/new/ws)
 echo "mount $url" >> /cap/$r/ctl
done
echo LOCAL_SYMLINK_WORKS > /project/local-marker
ln -s local-marker /project/local-link
cat /project/local-link
printf 'SECURITY_PROBE_DONE\\n'
`;
 let sockets=[];page.on('websocket',socket=>sockets.push(socket.url()));
 // Snapshot A writes a real home marker before hostile snapshot B boots.
 await boot(page,'# apptron snapshot v1\n-- .apptron/envrc --\necho PRIVATE_OTHER_SNAPSHOT > /home/guest/private-marker\n');
 await expect.poll(()=>page.evaluate(()=>ApptronOnline.host.frame.contentWindow.apptron.instance.readText('home/guest/private-marker').catch(()=>'')),{timeout:30000}).toContain('PRIVATE_OTHER_SNAPSHOT');
 const previous = await page.evaluate(()=>({uuid:ApptronOnline.host.uuid,user:ApptronOnline.host.user}));
 await page.evaluate(()=>{localStorage.setItem('security-canary','do not read');ApptronOnline.host.stop()});
 await boot(page,source);await expect.poll(()=>text(page),{timeout:90000}).toContain('SECURITY_PROBE_DONE');
 const result=await page.evaluate(async previous=>{
  const frame=ApptronOnline.host.frame.contentWindow,w=frame.apptron.instance;
  const denied={};
  for(const path of ['web/idbfs/apptron','web/opfs','web/caches','web/dl','web/worker','cap/new/pickerfs','task/new/gojs']){
   try {if(path.includes('/new/'))await w.readText(path);else await w.readDir(path);denied[path]=false}catch{denied[path]=true}
  }
  try {await w.readText('web/idbfs/apptron/usr/'+previous.user+'/private-marker');denied.otherHome=false}catch{denied.otherHome=true}
  const target='usr/'+previous.user+'/private-marker';
  await w.symlink(target,'snapshot-storage/leak');
  try {await w.readText('snapshot-storage/leak');denied.symlinkRead=false}catch{denied.symlinkRead=true}
  try {await w.appendFile('snapshot-storage/leak','CORRUPTED');denied.symlinkWrite=false}catch{denied.symlinkWrite=true}
  await w.appendFile('ctl','bind snapshot-storage scoped-again');
  try {await w.readText('scoped-again/leak');denied.symlinkRebind=false}catch{denied.symlinkRebind=true}
  const {WanixDisk}=await import('./src/wanix-disk.js');const {requestResult}=await import('./src/store.js');
  const disk=new WanixDisk();try {
   const db=await disk.db();const marker=await requestResult(db.transaction('metadata').objectStore('metadata').get(target));
   denied.otherHomeIntact=new TextDecoder().decode(marker.data).includes('PRIVATE_OTHER_SNAPSHOT');
  }finally{disk.close()}

  const response=await frame.fetch('vm-data/'+ApptronOnline.host.session+'/data/env/'+previous.uuid+'/project/');
  denied.http=response.status===403;
  // A rebind cannot uncover the backing store: the original module lacks it.
  await w.appendFile('ctl','bind #web rebound');
  try {await w.readText('rebound/idbfs/apptron/env/'+ 'b'.repeat(64)+'/overlay/canary');denied.rebind=false}catch{denied.rebind=true}
  const divs=[...frame.document.querySelectorAll('.security-probe')];
  return {denied,escaped:window.__apptron_escape,stolen:window.__apptron_stolen,unsafe:divs.some(el=>el.hasAttribute('onmouseover')||el.hasAttribute('style')),styles:[...frame.document.querySelectorAll('style')].some(el=>el.textContent.includes('egress.invalid'))};
 },previous);
 expect(result.escaped).toBeUndefined();expect(result.stolen).toBeUndefined();for(const [path,denied] of Object.entries(result.denied))expect(denied,path).toBe(true);expect(result.unsafe).toBe(false);expect(result.styles).toBe(false);expect(sockets).toEqual([]);expect(await text(page)).toContain('LOCAL_SYMLINK_WORKS');
});
