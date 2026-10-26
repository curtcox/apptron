const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
test.beforeEach(async({},testInfo)=>test.skip(process.env.APPTRON_BOOT!=='1'||testInfo.project.name!=='chromium','Real VM boot runs explicitly in Chromium.'));
async function boot(page,source){await page.goto('./');await page.waitForFunction(()=>window.ApptronOnline);await page.evaluate(()=>ApptronOnline.initialized);if(source)await page.evaluate(s=>ApptronOnline.setSource(s),source);await page.locator('#run').click();await expect(page.locator('#status')).toContainText('Running ·',{timeout:180000});}
async function terminal(page){return page.locator('#terminal iframe').contentFrame().locator('.xterm');}
async function text(page){return page.evaluate(()=>{const b=ApptronOnline.host.frame.contentWindow.apptron.terminal.buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString()).join('\n')});}
test('boots a real shell from a Pages subpath, syncs a VM edit and captures it',async({page})=>{
 test.setTimeout(240000);await boot(page);await expect.poll(()=>text(page),{timeout:90000}).toContain('guest:/project');
 await page.evaluate(()=>ApptronOnline.host.sendKey("printf 'from the VM\\n' > captured.txt\r"));
 await expect.poll(()=>page.evaluate(()=>ApptronOnline.host.instance.readText('project/captured.txt').catch(()=>'')),{timeout:15000}).toContain('from the VM');
 await page.locator('#capture').click();await expect(page.locator('#status')).toContainText('Project files captured',{timeout:20000});expect(await page.evaluate(()=>ApptronOnline.getSource())).toContain('from the VM');
 const result=await page.evaluate(async()=>{const w=ApptronOnline.host.instance;await w.writeFile('#scratch/probe','scratch works');return w.readText('#scratch/probe')});expect(result).toBe('scratch works');
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
   const host=ApptronOnline.host;await host.instance.writeFile('#scratch/overlay-probe','overlay restored');
   const {captureOverlay,readOverlay}=await import('./src/overlay.js');
   const captured=await readOverlay(await captureOverlay(host.instance,host.lock.commit,host.uuid),host.lock.commit);
   if(!captured.entries.some(e=>e.path.startsWith('usr/bin/python')))throw new Error('Loaded Python package is missing from capture.');
   const source='# apptron snapshot v1\n-- .apptron/envrc --\ncd /project\npython3 -c \'print("RESTORED_OVERLAY")\'\n';
   const {snapshotUUID}=await import('./src/snapshot.js');const {WanixDisk}=await import('./src/wanix-disk.js');
   const uuid=await snapshotUUID(source,host.lock.commit);host.stop();
   const disk=new WanixDisk();try{await disk.restore(uuid,captured.entries)}finally{disk.close()}
   await host.run(source);
 });
 await expect.poll(()=>text(page),{timeout:90000}).toContain('RESTORED_OVERLAY');
 expect(await page.evaluate(()=>ApptronOnline.host.instance.readText('#env/overlay-probe'))).toBe('overlay restored');
});
