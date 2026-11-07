async function initialize(page,{url='./',timeout=45000}={}) {
 const messages=[];
 page.on('pageerror',error=>messages.push('page: '+String(error)));
 page.on('console',message=>{if(message.type()==='error')messages.push('console: '+message.text());});
 page.on('requestfailed',request=>messages.push('request: '+request.url()+' '+request.failure()?.errorText));
 try {
  await page.goto(url);
  await page.waitForFunction(()=>crossOriginIsolated&&window.ApptronOnline,null,{timeout});
  await page.evaluate(()=>{window.__startupState='pending';ApptronOnline.initialized.then(()=>{window.__startupState='ready';},error=>{window.__startupState=String(error);});});
  await page.waitForFunction(()=>window.__startupState!=='pending',null,{timeout});
  const state=await page.evaluate(()=>window.__startupState);
  if(state!=='ready')throw Error(state);
 }catch(error){
  const details=await page.evaluate(async()=>({
   isolated:crossOriginIsolated,status:document.getElementById('status')?.textContent,offline:document.getElementById('offline-status')?.textContent,
   workers:await navigator.serviceWorker?.getRegistrations().then(values=>values.map(value=>({scope:value.scope,active:value.active?.state,installing:value.installing?.state,waiting:value.waiting?.state}))),
  })).catch(()=>({}));
  throw Error('Apptron initialization failed: '+error.message+'\n'+JSON.stringify(details)+'\n'+messages.slice(-20).join('\n'));
 }
}
module.exports={initialize};
