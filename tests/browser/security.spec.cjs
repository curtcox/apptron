const {createHash}=require('node:crypto');
const {test,expect}=require('@playwright/test');
async function ready(page,url='./'){await page.goto(url);await page.waitForFunction(()=>window.ApptronOnline);await page.evaluate(()=>ApptronOnline.initialized);}
test('T3 path-scoped VM CSP blocks data scripts and guest data URLs',async({page})=>{
 await ready(page);
 const result=await page.evaluate(async()=>{
  const f=document.createElement('iframe');f.src='vm.html#session='+crypto.randomUUID();document.querySelector('#terminal').replaceChildren(f);await new Promise(resolve=>f.onload=resolve);
  const w=f.contentWindow;w.violations=[];w.document.addEventListener('securitypolicyviolation',e=>w.violations.push({directive:e.effectiveDirective,url:e.blockedURI}));
  for(const src of ['data:text/javascript,parent.__escaped=true','data/env/'+ 'a'.repeat(64)+'/project/payload.js']){const script=w.document.createElement('script');script.src=new URL(src,location.href).href;w.document.body.append(script)}
  await new Promise(resolve=>setTimeout(resolve,200));
  return {violations:w.violations,escaped:!!window.__escaped,policy:w.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content};
 });
 expect(result.escaped).toBe(false);expect(result.violations.filter(e=>e.directive==='script-src-elem')).toHaveLength(2);expect(result.policy).not.toMatch(/script-src[^;]*'self'/);
});
test('T8 declines incoming links without replacing the stored draft and preserves provenance',async({page})=>{
 await ready(page);const mine='# apptron snapshot v1\n-- mine --\nkeep my work\n';const shared='# apptron snapshot v1\n-- hostile --\nexternal source\n';
 await page.evaluate(({mine})=>ApptronOnline.setSource(mine),{mine});
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('apptron:draft'))).toContain('keep my work');
 const url=await page.evaluate(shared=>new URL('?compressed='+LZString.compressToEncodedURIComponent(shared),location.href).href,shared);
 let prompts=[];page.on('dialog',async dialog=>{prompts.push(dialog.message());await dialog.dismiss()});
 await ready(page,url);expect(prompts).toHaveLength(1);expect(await page.evaluate(()=>ApptronOnline.getSource())).toBe(mine);
 page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept());await ready(page,url);expect(await page.evaluate(()=>ApptronOnline.getSource())).toBe(shared);await expect(page.locator('#source-provenance')).toContainText('Shared link');
 await page.evaluate(()=>ApptronOnline.editor.setValue(ApptronOnline.getSource()+'# edit\n'));await expect.poll(()=>page.evaluate(()=>localStorage.getItem('apptron:draft'))).toContain('"kind":"share"');
 await ready(page,'./');await expect(page.locator('#source-provenance')).toContainText('Shared link');
});
test('T8 persisted relay is visible and requires consent before Run',async({page})=>{
 await ready(page);await page.evaluate(()=>localStorage.setItem('apptron:relay','wss://unexpected.example/x/net'));
 await ready(page);await expect(page.locator('#network-state')).toContainText('wss://unexpected.example/x/net');await expect(page.locator('#run')).toHaveAttribute('title',/unexpected/);
 let prompt;page.on('dialog',async dialog=>{prompt=dialog.message();await dialog.dismiss()});await page.locator('#run').click();await expect(page.locator('#status')).toContainText('Network permission declined');expect(prompt).toContain('wss://unexpected.example/x/net');await expect(page.locator('#terminal iframe')).toHaveCount(0);
});
test('T4 direct data endpoints are inert and deny ungranted clients',async({page})=>{
 await ready(page);
 if (!await page.evaluate(()=>!!navigator.serviceWorker.controller)) {
   await expect(page.locator('#status')).toContainText(/ServiceWorker|service worker/i);
   test.skip(true, 'This browser cannot evaluate the module service worker; VM boot fails closed.');
 }
 const result=await page.evaluate(async()=>{const response=await fetch('data/env/'+ 'a'.repeat(64)+'/project/payload.js');return {status:response.status,csp:response.headers.get('Content-Security-Policy'),sniff:response.headers.get('X-Content-Type-Options')}});
 expect(result).toEqual({status:403,csp:'sandbox',sniff:'nosniff'});
});

test('T8 HashBin loads ask before replacing a restored draft and report cancellation',async({page})=>{
 await ready(page);const mine='# apptron snapshot v1\n-- mine --\nkeep my work\n';
 await page.evaluate(mine=>ApptronOnline.setSource(mine),mine);await expect.poll(()=>page.evaluate(()=>localStorage.getItem('apptron:draft'))).toContain('keep my work');
 const payload=JSON.stringify({format:'hashbin-diagram',version:1,type:'apptron',src:'# apptron snapshot v1\n-- incoming --\nfrom HashBin\n'});
 const size=Buffer.alloc(6);size.writeUIntBE(Buffer.byteLength(payload),0,6);const cid=size.toString('base64url')+createHash('sha512').update(payload).digest('base64url');
 await ready(page,'./index.html');
 let prompts=0;page.on('dialog',async dialog=>{prompts++;await dialog.dismiss()});
 await page.evaluate(async({payload,cid})=>{ApptronOnline.panel.store.fetchSource=async()=>new Response(payload);await ApptronOnline.panel.load(cid)},{payload,cid});
 expect(prompts).toBe(1);expect(await page.evaluate(()=>ApptronOnline.getSource())).toBe(mine);await expect(page.locator('#hashbin-status')).toContainText('Load cancelled');
});

test('unsupported credential-vault configuration disables account actions',async({page})=>{
 const config={role:'editor',vmURL:'',editorOrigin:'',authURL:'https://vault.invalid/auth.html'};
 await page.route('**/deployment-config.js',route=>route.fulfill({contentType:'text/javascript',body:'globalThis.APPTRON_DEPLOYMENT='+JSON.stringify(config)}));
 await page.goto('./');await expect(page.locator('#status')).toContainText('credential vault is not implemented');await expect(page.locator('#hashbin-save')).toBeDisabled();await expect(page.locator('#run')).toBeDisabled();
});
