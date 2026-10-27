const {test,expect}=require('@playwright/test');
const {spawn}=require('node:child_process');
const vmURL='http://127.0.0.1:4174/apptron/vm.html',editorOrigin='http://127.0.0.1:4173';
let server;
test.beforeAll(async({},info)=>{
 if(process.env.APPTRON_BOOT!=='1'||info.project.name!=='chromium')return;
 server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:'4174',SITE_DIR:process.env.APPTRON_VM_SITE_DIR||'.',APPTRON_ROLE:'vm',APPTRON_VM_URL:vmURL,APPTRON_EDITOR_ORIGIN:editorOrigin,NO_ISOLATION_HEADERS:''}});
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error('VM server exited: '+code)))});
});
test.afterAll(()=>server?.kill());
test.beforeEach(async({page},info)=>{
 test.skip(process.env.APPTRON_BOOT!=='1'||info.project.name!=='chromium','Cross-origin real VM runs explicitly in Chromium.');
 if(!process.env.APPTRON_EDITOR_SITE_DIR)await page.route(editorOrigin+'/apptron/deployment-config.js',route=>route.fulfill({contentType:'text/javascript',body:`globalThis.APPTRON_DEPLOYMENT=Object.freeze(${JSON.stringify({role:'editor',vmURL,editorOrigin,authURL:''})});`}));
});
async function ready(page){await page.goto('./');await page.waitForFunction(()=>crossOriginIsolated&&window.ApptronOnline);await page.evaluate(()=>ApptronOnline.initialized);}
async function run(page,source){await page.evaluate(source=>ApptronOnline.setSource(source),source);await page.locator('#run').click();await expect(page.locator('#run')).toBeEnabled({timeout:180000});await expect(page.locator('#status')).toContainText('Running ·');return page.frames().find(frame=>frame.url().startsWith(vmURL));}
async function text(frame){return frame.evaluate(()=>{const b=apptron.terminal.buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString()).join('\n')});}
test('T2 isolated VM cannot access editor assets; capture, reload, persistence and reset cross the bridge',async({page})=>{
 test.setTimeout(300000);await ready(page);
 await page.evaluate(async()=>{localStorage.setItem('apptron:oauth:sentinel','EDITOR_SECRET');await new Promise((resolve,reject)=>{const r=indexedDB.open('editor-private');r.onsuccess=()=>{r.result.close();resolve()};r.onerror=reject})});
 const source='# apptron snapshot v1\n-- .apptron/envrc --\ncd /project\necho ISOLATED_VM_READY\n-- seed.txt --\nseed\n';
 let frame=await run(page,source);await expect.poll(()=>text(frame),{timeout:90000}).toContain('ISOLATED_VM_READY');
 const boundary=await frame.evaluate(async()=>{
  const denied={};for(const [key,read] of Object.entries({document:()=>top.document,storage:()=>top.localStorage,api:()=>parent.ApptronOnline})){try{read();denied[key]=false}catch{denied[key]=true}}
  return {denied,ownSecret:localStorage.getItem('apptron:oauth:sentinel'),databases:(await indexedDB.databases()).map(db=>db.name),isolated:crossOriginIsolated};
 });
 expect(boundary.denied).toEqual({document:true,storage:true,api:true});expect(boundary.ownSecret).toBeNull();expect(boundary.databases).not.toContain('editor-private');expect(boundary.isolated).toBe(true);
 expect(await page.evaluate(()=>{try{return !!ApptronOnline.host.frame.contentWindow.apptron}catch{return false}})).toBe(false);
 await page.evaluate(()=>ApptronOnline.host.sendKey("printf 'isolated capture\\n' > isolated.txt; echo home > /home/guest/private\r"));
 await expect.poll(()=>frame.evaluate(()=>apptron.instance.readText('project/isolated.txt').catch(()=>'')),{timeout:15000}).toContain('isolated capture');
 await page.locator('#capture').click();await expect(page.locator('#status')).toContainText('Project files captured',{timeout:20000});expect(await page.evaluate(()=>ApptronOnline.getSource())).toContain('isolated capture');
 const oldSession=await page.evaluate(()=>ApptronOnline.host.session);
 await frame.evaluate(()=>location.reload());await expect.poll(()=>page.evaluate(old=>ApptronOnline.host.session!==old,oldSession)).toBe(true);await expect.poll(()=>page.evaluate(()=>ApptronOnline.host.running),{timeout:180000}).toBe(true);
 frame=page.frames().find(frame=>frame.url().startsWith(vmURL));await expect.poll(()=>text(frame),{timeout:90000}).toContain('ISOLATED_VM_READY');expect(await frame.evaluate(()=>apptron.instance.readText('project/isolated.txt'))).toContain('isolated capture');
 const status=await page.locator('#status').textContent();await frame.evaluate(({oldSession,editorOrigin})=>parent.postMessage({type:'apptron-error',session:oldSession,message:'FORGED'},editorOrigin),{oldSession,editorOrigin});await expect(page.locator('#status')).toHaveText(status);
 await page.evaluate(()=>ApptronOnline.host.reset());expect(await page.locator('#terminal iframe').count()).toBe(0);
 frame=await run(page,source);await expect.poll(()=>text(frame),{timeout:90000}).toContain('ISOLATED_VM_READY');
 expect(await frame.evaluate(async()=>{try{await apptron.instance.readText('project/isolated.txt');return false}catch{return true}})).toBe(true);
 expect(await frame.evaluate(async()=>{try{await apptron.instance.readText('home/guest/private');return false}catch{return true}})).toBe(true);
});
test('separate-origin VM runs native WASI with real isolation headers',async({page})=>{
 test.setTimeout(180000);await ready(page);const {readFileSync}=require('node:fs');const frame=await run(page,readFileSync('examples/wasm.txtar','utf8'));await expect.poll(()=>text(frame),{timeout:90000}).toContain('Hello from Wasm!');
});
test('separate-origin Python overlay restores and captures through the bridge',async({page})=>{
 test.setTimeout(240000);await ready(page);const {readFileSync}=require('node:fs');const frame=await run(page,readFileSync('examples/python.txtar','utf8'));await expect.poll(()=>text(frame),{timeout:90000}).toContain('Hello from Python in Apptron!');
 await frame.evaluate(()=>apptron.instance.writeFile('#scratch/isolated-overlay-probe','from the isolated VM'));
 const captured=await page.evaluate(async()=>{const {readOverlay}=await import('./src/overlay.js');const host=ApptronOnline.host;const result=await readOverlay(await host.captureOverlay(),host.lock.commit);return {python:result.entries.some(entry=>entry.path.startsWith('usr/bin/python')),probe:new TextDecoder().decode(result.entries.find(entry=>entry.path==='isolated-overlay-probe').data)}});
 expect(captured).toEqual({python:true,probe:'from the isolated VM'});
 await frame.evaluate(()=>apptron.instance.writeFile('snapshot-storage/overlay/overlay-reload-probe','preserved after reload'));
 const previous=await page.evaluate(()=>ApptronOnline.host.session);await frame.evaluate(()=>location.reload());await expect.poll(()=>page.evaluate(previous=>ApptronOnline.host.session!==previous,previous)).toBe(true);await expect.poll(()=>page.evaluate(()=>ApptronOnline.host.running),{timeout:180000}).toBe(true);
 const reloaded=page.frames().find(frame=>frame.url().startsWith(vmURL));await expect.poll(()=>reloaded.evaluate(()=>apptron.instance.readText('#env/overlay-reload-probe').catch(()=>'')),{timeout:15000}).toBe('preserved after reload');
});
test('missing VM isolation headers fail closed without a local-origin fallback',async({page})=>{
 await ready(page);const requests=[];page.on('request',request=>{if(request.url().endsWith('/wanix.wasm'))requests.push(request.url())});
 await page.route(vmURL,async route=>{const response=await route.fetch();const headers=response.headers();delete headers['cross-origin-embedder-policy'];await route.fulfill({response,headers})});
 const failure=page.waitForEvent('requestfailed',{predicate:request=>request.url()===vmURL,timeout:15000});
 await page.evaluate(()=>{window.failedBoot=ApptronOnline.host.run('# apptron snapshot v1\n-- test --\nhello\n').catch(()=>{})});
 const request=await failure;expect(request.failure().errorText).toMatch(/BLOCKED_BY_RESPONSE/);expect(requests).toEqual([]);
 expect(await page.evaluate(()=>ApptronOnline.host.running)).toBe(false);expect(await page.evaluate(()=>ApptronOnline.host.frameOrigin)).toBe(new URL(vmURL).origin);
 await page.evaluate(()=>ApptronOnline.host.stop());await page.evaluate(()=>window.failedBoot);
});
