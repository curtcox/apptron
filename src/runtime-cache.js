// Consumer-owned lazy VM assets, separate from application readiness and VM data grants.
import{sha256}from'./runtime-integrity.js';
import{readLimited}from'./read-limited.js';
const runtime=globalThis.OfflineAssets.runtime,scope=self.registration.scope;
const pins=new Map(Object.entries(runtime.files).map(([path,pin])=>[new URL(path,scope).href,pin]));
const cacheName='apptron-runtime-'+runtime.commit;
function response(data,url){return new Response(data,{headers:{'Content-Type':url.endsWith('.js')?'text/javascript':url.endsWith('.css')?'text/css':url.endsWith('.json')?'application/json':'application/gzip'}});}
async function verified(saved,pin,url){if(!saved?.ok)return null;try{const data=await readLimited(saved,pin.size);if(data.length===pin.size&&await sha256(data)===pin.sha256)return response(data,url);}catch{}return null;}
export function runtimeResponse(request){
 if(request.method!=='GET')return;const parsed=new URL(request.url);parsed.search='';parsed.hash='';const url=parsed.href,pin=pins.get(url);if(!pin)return;
 return(async()=>{const cache=await caches.open(cacheName),saved=await verified(await cache.match(url),pin,url);if(saved)return saved;await cache.delete(url);
  const result=await verified(await fetch(request),pin,url);if(!result)throw Error('VM runtime asset failed checksum verification. Retry Run when connected.');await cache.put(url,result.clone());return result;
 })();
}
