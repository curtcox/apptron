const { test, expect } = require('@playwright/test');
const { createHash } = require('node:crypto');
// Editor API fixtures need network interception; real service-worker/VM behavior runs in boot/security suites.
test.use({serviceWorkers:'block'});
async function more(page){if(!await page.locator('#fk-more-drawer').isVisible())await page.click('#more-toggle');}
async function ready(page) { await page.goto('./'); await page.waitForFunction(()=>window.ApptronOnline);await page.locator('body[data-ready="true"]').waitFor(); }
test('editor, language highlighting, share and QR round trip without boot', async ({ page }) => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
 await expect(page.locator('#file-count')).toHaveText('2 files');
 const tokens=await page.evaluate(()=>ApptronOnline.editor.session.getTokens(1));expect(tokens.some(t=>t.type==='entity.name.section')).toBeTruthy();
 await page.locator('#share').click();const url=await page.locator('#share-link').inputValue();expect(new URL(url).searchParams.has('compressed')).toBe(true);await page.locator('#share-dialog .fk-close').click();
 await page.locator('#qr').click();await expect(page.locator('#qr-code svg')).toBeVisible();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download PNG',exact:true}).click();expect((await download).suggestedFilename()).toBe('apptron-qr.png');
 await page.locator('#qr-dialog .fk-close').click();await page.goto(url);await page.waitForFunction(()=>window.ApptronOnline);await page.locator('body[data-ready="true"]').waitFor();expect(await page.evaluate(()=>ApptronOnline.getSource())).toContain('hello.sh');expect(errors).toEqual([]);
});
test('gallery searches and loads a snapshot into editor',async({page})=>{
 await page.goto('gallery.html');await expect(page.locator('.gallery-card:visible')).toHaveCount(10);await page.locator('#search').fill('gripeline');await expect(page.locator('.gallery-card:visible')).toHaveCount(1);await expect(page.getByRole('link',{name:'Load Draw a pipeline in editor'})).toBeVisible();await page.locator('#search').fill('Python');await expect(page.locator('.gallery-card:visible')).toHaveCount(1);await page.getByRole('link',{name:'Load Python playground in editor'}).click();await page.waitForFunction(()=>window.ApptronOnline);await page.locator('body[data-ready="true"]').waitFor();expect(await page.evaluate(()=>ApptronOnline.getSource())).toContain('overlay: gallery/python');
});
test('HashBin loads apptron documents and discards stale loads after an editor change',async({page})=>{
 const src='# apptron snapshot v1\n-- saved.txt --\nsaved from HashBin\n';const payload=JSON.stringify({format:'hashbin-diagram',version:1,type:'apptron',src});const size=Buffer.alloc(6);size.writeUIntBE(Buffer.byteLength(payload),0,6);const cid=size.toString('base64url')+createHash('sha512').update(payload).digest('base64url');
 await page.route('https://256t.us/**',route=>route.fulfill({body:payload,contentType:'application/json'}));await page.goto('./#'+cid);await page.waitForFunction(()=>window.ApptronOnline);await page.locator('body[data-ready="true"]').waitFor();expect(await page.evaluate(()=>ApptronOnline.getSource())).toBe(src);
 let release;const gate=new Promise(r=>release=r);await page.unroute('https://256t.us/**');await page.route('https://256t.us/**',async route=>{await gate;await route.fulfill({body:payload,contentType:'application/json'});});
 await page.evaluate(cid=>{window.pendingLoad=ApptronOnline.panel.load(cid)},cid);await page.evaluate(()=>ApptronOnline.editor.setValue('# apptron snapshot v1\n-- mine --\nkeep me\n'));release();await page.evaluate(()=>pendingLoad);expect(await page.evaluate(()=>ApptronOnline.getSource())).toContain('keep me');
});
test('HashBin save prepares a registered approval without spending',async({page})=>{
 await ready(page);await more(page);await page.locator('#hashbin-save').click();await expect(page.locator('#hashbin-message')).toContainText('HashBin');await expect(page.locator('#hashbin-confirm')).toBeEnabled();
});
test('layout fits, phone view toggles, and network setting stays out of share links',async({page},testInfo)=>{
 await ready(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 if(testInfo.project.name.endsWith('-phone')){await expect(page.locator('.preview-pane')).toBeHidden();await page.locator('#show-preview').click();await expect(page.locator('.preview-pane')).toBeVisible();await expect(page.locator('.code-pane')).toBeHidden();await page.locator('#show-code').click();}
 await more(page);await page.locator('#network-open').click();await page.locator('#relay-url').fill('wss://private.example/x/net');await page.locator('#network-save').click();await expect(page.locator('#network-state')).toContainText('Relay configured');await page.locator('#share').click();expect(await page.locator('#share-link').inputValue()).not.toContain('private');
});

test('an isolated editor saves through a HashBin Publish redirect and restores the snapshot',async({page})=>{
 // The pinned SDK stand-in records the mode: isolation (COOP same-origin) severs a popup's opener.
 const sdk=`export class HashBinClient{constructor(o){this.o=o}
  publish(bytes,{mode,contentType,clientState}){return window.__publishCID(Array.from(bytes)).then(cid=>{sessionStorage.setItem('test:publish',JSON.stringify({mode,contentType,clientState,cid}));
   location.href='https://hashbin.org/publish?return='+encodeURIComponent(this.o.redirectUri+'#hashbin_publish=t&cid='+cid);return Promise.resolve({redirected:true})})}
  async handlePublishCallback(){return {cid:JSON.parse(sessionStorage.getItem('test:publish')).cid,clientState:JSON.parse(sessionStorage.getItem('test:publish')).clientState}}}`;
 await page.route('**/apptron/',async route=>{const response=await route.fetch();route.fulfill({response,body:(await response.text()).replace(/name="hashbin-client-id" content="[^"]*"/,'name="hashbin-client-id" content="test-client"')});});
 // HashBin Publish approves on its own page and redirects back, so the editor loads afresh.
 await page.route('https://hashbin.org/publish?**',route=>route.fulfill({contentType:'text/html',body:'<script>location.replace(new URL(location.href).searchParams.get("return"))</script>'}));
 await page.route('**/vendor/hashbin-sdk-v0.4.0.mjs',route=>route.fulfill({body:sdk,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'}}));
 await page.exposeFunction('__publishCID',array=>{const bytes=Buffer.from(array),size=Buffer.alloc(6);size.writeUIntBE(bytes.length,0,6);return size.toString('base64url')+(bytes.length<=64?bytes:createHash('sha512').update(bytes).digest()).toString('base64url');});
 await ready(page);expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
 const mine='# apptron snapshot v1\n-- mine.txt --\nkeep me\n';await page.evaluate(src=>ApptronOnline.setSource(src),mine);
 await more(page);await page.locator('#hashbin-save').click();await expect(page.locator('#hashbin-confirm')).toHaveText('Review on HashBin');await expect(page.locator('#hashbin-confirm')).toBeEnabled();
 await expect(page.locator('#hashbin-message')).toContainText('goes to HashBin and returns');
 await Promise.all([page.waitForURL(/hashbin_publish=/),page.locator('#hashbin-confirm').click()]);
 await page.waitForFunction(()=>window.ApptronOnline);await page.locator('body[data-ready="true"]').waitFor();
 const recorded=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('test:publish')));expect(recorded.mode).toBe('redirect');expect(recorded.contentType).toBe('application/json');
 expect(await page.evaluate(()=>ApptronOnline.getSource())).toBe(mine);await expect(page.locator('#hashbin-status')).toHaveText('Saved to HashBin.');expect(page.url()).not.toContain('hashbin_publish');
});

test('shared snapshots always require manual Run and preserve the edited source',async({page})=>{
 await ready(page);const mine='# apptron snapshot v1\n-- manual.txt --\nmanual VM boot only\n';
 await page.evaluate(src=>ApptronOnline.setSource(src),mine);await page.click('#share');
 const url=await page.locator('#share-link').inputValue();expect(new URL(url).searchParams.get('run')).toBe('0');
 await page.goto(url);await page.locator('body[data-ready="true"]').waitFor();
 expect(await page.evaluate(()=>ApptronOnline.getSource())).toBe(mine);await expect(page.locator('#terminal iframe')).toHaveCount(0);
});
