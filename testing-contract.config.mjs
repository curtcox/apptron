import{test}from'@playwright/test';
test.setTimeout(120000);
export default{
 installHashBinMock:async(context,source)=>context.route('**/vendor/hashbin-sdk-v0.4.0.mjs',route=>route.fulfill({contentType:'text/javascript',body:source.replace('new TextEncoder().encode(text)', '(text instanceof Uint8Array ? text : new TextEncoder().encode(text))')})),
 source:text=>'# apptron snapshot v1\n-- note.txt --\n'+text+'\n',
 ready:'body[data-ready="true"]',editor:'#editor',status:'#status',draftKey:'apptron:draft',more:'#more-toggle',share:'#share',qr:'#qr',tabs:['Code','Preview'],example:'hello-shell',cachePrefix:'apptron-offline-',offlineAsset:'src/fragment-ui.css',kitURL:'./vendor/fragment-kit-v0.3.4/src/index.js',
 isWrittenURL:href=>{const url=new URL(href);return url.hash.length>1||url.searchParams.has('compressed');},getSource:page=>page.evaluate(()=>ApptronOnline.getSource()),getDocument:page=>page.evaluate(()=>({src:ApptronOnline.getSource()})),
 edit:(page,src)=>page.evaluate(src=>ApptronOnline.editor.setValue(src,-1),src),openMore:async page=>{if(!await page.locator('#fk-more-drawer').isVisible())await page.click('#more-toggle');},
 configureHashBin:async(context,clientId)=>context.route('**/apptron/',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace(/name="hashbin-client-id" content="[^"]*"/,'name="hashbin-client-id" content="'+clientId+'"')});}),
 build:(page,doc,canonical=false)=>page.evaluate(async({doc,canonical})=>{const{urlState,config}=await import('./src/fragment-config.js');return urlState.build(doc,{run:false,...canonical?{url:config.canonicalOrigin}:{}}).href;},{doc,canonical})
};
