const { test, expect } = require('@playwright/test');
const { createHash } = require('node:crypto');
async function ready(page) { await page.goto('./'); await page.waitForFunction(()=>window.ApptronOnline);await page.evaluate(()=>window.ApptronOnline.initialized); }
test('editor, language highlighting, share and QR round trip without boot', async ({ page }) => {
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
 await expect(page.locator('#file-count')).toHaveText('2 files');
 const tokens=await page.evaluate(()=>ApptronOnline.editor.session.getTokens(1));expect(tokens.some(t=>t.type==='entity.name.section')).toBeTruthy();
 await page.locator('#share').click();const url=await page.locator('#share-url').inputValue();expect(url).toContain('?compressed=');await page.getByLabel('Close share dialog').click();
 await page.locator('#qr').click();await expect(page.locator('#qr-canvas')).toBeVisible();await expect(page.locator('#qr-download')).toHaveAttribute('href',/^data:image\/png/);
 await page.getByLabel('Close QR dialog').click();await page.goto(url);await page.waitForFunction(()=>window.ApptronOnline);await page.evaluate(()=>ApptronOnline.initialized);expect(await page.evaluate(()=>ApptronOnline.getSource())).toContain('hello.sh');expect(errors).toEqual([]);
});
test('gallery searches and loads a snapshot into editor',async({page})=>{
 await page.goto('gallery.html');await expect(page.locator('.gallery-card:visible')).toHaveCount(9);await page.locator('#search').fill('Python');await expect(page.locator('.gallery-card:visible')).toHaveCount(1);await page.getByRole('link',{name:'Load Python playground in editor'}).click();await page.waitForFunction(()=>window.ApptronOnline);await page.evaluate(()=>ApptronOnline.initialized);expect(await page.evaluate(()=>ApptronOnline.getSource())).toContain('overlay: gallery/python');
});
test('HashBin loads apptron documents and discards stale loads after an editor change',async({page})=>{
 const src='# apptron snapshot v1\n-- saved.txt --\nsaved from HashBin\n';const payload=JSON.stringify({format:'hashbin-diagram',version:1,type:'apptron',src});const size=Buffer.alloc(6);size.writeUIntBE(Buffer.byteLength(payload),0,6);const cid=size.toString('base64url')+createHash('sha512').update(payload).digest('base64url');
 await page.route('https://256t.us/**',route=>route.fulfill({body:payload,contentType:'application/json'}));await page.goto('./#'+cid);await page.waitForFunction(()=>window.ApptronOnline);await page.evaluate(()=>ApptronOnline.initialized);expect(await page.evaluate(()=>ApptronOnline.getSource())).toBe(src);
 let release;const gate=new Promise(r=>release=r);await page.unroute('https://256t.us/**');await page.route('https://256t.us/**',async route=>{await gate;await route.fulfill({body:payload,contentType:'application/json'});});
 await page.evaluate(cid=>{window.pendingLoad=ApptronOnline.panel.load(cid)},cid);await page.evaluate(()=>ApptronOnline.editor.setValue('# apptron snapshot v1\n-- mine --\nkeep me\n'));release();await page.evaluate(()=>pendingLoad);expect(await page.evaluate(()=>ApptronOnline.getSource())).toContain('keep me');
});
test('HashBin save explains the missing public client registration',async({page})=>{
 await ready(page);await page.locator('#hashbin-save').click();await expect(page.locator('#hashbin-message')).toContainText('registered client ID');await expect(page.locator('#hashbin-confirm')).toBeDisabled();
});
test('layout fits, phone view toggles, and network setting stays out of share links',async({page},testInfo)=>{
 await ready(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 if(testInfo.project.name.endsWith('-phone')){await expect(page.locator('.preview-pane')).toBeHidden();await page.locator('#show-preview').click();await expect(page.locator('.preview-pane')).toBeVisible();await expect(page.locator('.code-pane')).toBeHidden();await page.locator('#show-code').click();}
 await page.locator('.more summary').click();await page.locator('#network-open').click();await page.locator('#relay-url').fill('wss://private.example/x/net');await page.locator('#network-save').click();await expect(page.locator('#network-state')).toContainText('Relay configured');await page.locator('#share').click();expect(await page.locator('#share-url').inputValue()).not.toContain('private');
});

test('an isolated editor saves through a HashBin Publish redirect and restores the snapshot',async({page})=>{
 // The pinned SDK stand-in records the mode: isolation (COOP same-origin) severs a popup's opener.
 const sdk=`export class HashBinClient{constructor(o){this.o=o}
  publish(bytes,{mode,contentType,clientState}){sessionStorage.setItem('test:publish',JSON.stringify({mode,contentType,clientState}));
   location.href='https://hashbin.org/publish?return='+encodeURIComponent(this.o.redirectUri+'#hashbin_publish=t&cid=AAAAAAACaGk');return Promise.resolve({redirected:true})}
  async handlePublishCallback(){return {cid:'AAAAAAACaGk',clientState:JSON.parse(sessionStorage.getItem('test:publish')).clientState}}}`;
 await page.route('**/apptron/',async route=>{const response=await route.fetch();route.fulfill({response,body:(await response.text()).replace('name="hashbin-client-id" content=""','name="hashbin-client-id" content="test-client"')});});
 // HashBin Publish approves on its own page and redirects back, so the editor loads afresh.
 await page.route('https://hashbin.org/publish?**',route=>route.fulfill({contentType:'text/html',body:'<script>location.replace(new URL(location.href).searchParams.get("return"))</script>'}));
 await page.route('https://hashbin.org/sdk/v0.3.0/hashbin.js',route=>route.fulfill({body:sdk,contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'}}));
 await ready(page);expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
 const mine='# apptron snapshot v1\n-- mine.txt --\nkeep me\n';await page.evaluate(src=>ApptronOnline.setSource(src),mine);
 await page.locator('#hashbin-save').click();await expect(page.locator('#hashbin-confirm')).toHaveText('Review on HashBin');await expect(page.locator('#hashbin-confirm')).toBeEnabled();
 await expect(page.locator('#hashbin-message')).toContainText('goes to HashBin and returns');
 await Promise.all([page.waitForURL(/hashbin_publish=/),page.locator('#hashbin-confirm').click()]);
 await page.waitForFunction(()=>window.ApptronOnline);await page.evaluate(()=>window.ApptronOnline.initialized);
 const recorded=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('test:publish')));expect(recorded.mode).toBe('redirect');expect(recorded.contentType).toBe('application/json');
 expect(await page.evaluate(()=>ApptronOnline.getSource())).toBe(mine);await expect(page.locator('#hashbin-status')).toHaveText('Saved to HashBin.');expect(page.url()).not.toContain('hashbin_publish');
});
