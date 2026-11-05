const { test, expect } = require('@playwright/test');
test('B1 feasibility: opaque frame cannot provide durable VM storage', async ({page,browserName}) => {
 // Probe the browser's opaque-origin storage behavior independently of the app CSP.
 await page.goto('about:blank');
 const result = await page.evaluate(()=>new Promise(resolve=>{
   const frame=document.createElement('iframe');frame.sandbox='allow-scripts';
   const listener=e=>{if(e.source===frame.contentWindow){window.removeEventListener('message',listener);frame.remove();resolve(e.data)}};
   window.addEventListener('message',listener);
   frame.srcdoc=`<script>(async()=>{const r={isolated:crossOriginIsolated,sab:typeof SharedArrayBuffer};try{indexedDB.open('opaque-spike');r.idb=true}catch(e){r.idb=e.name}try{await navigator.storage.getDirectory();r.opfs=true}catch(e){r.opfs=e.name}parent.postMessage(r,'*')})()</script>`;
   document.body.append(frame);
 }));
 console.log('B1 feasibility:', JSON.stringify(result));
 expect(result.idb).toBe('SecurityError'); expect(result.opfs).not.toBe(true);
 if(browserName==='chromium'){expect(result.sab).toBe('undefined');expect(result.isolated).toBe(false)}
});
