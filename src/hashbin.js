import * as kit from '../vendor/fragment-kit-v0.4.3/src/index.js';
import{config,type,urlState,HashBinDocuments,serializeLegacy,publishTransactions}from'./fragment-config.js';
export{HashBinDocuments};export const REDIRECT_BYTES=512*1024;
/** App-owned gzip overlays and COOP redirect policy, using the shared SDK/CID/store core. */
export class HashBinStore extends kit.HashBinStore{
 constructor(options={}){let session;try{session=globalThis.sessionStorage;}catch{}super({config,type,...options,storage:undefined,legacyStorage:options.storage??options.legacyStorage,transactionStorage:publishTransactions(options.transactionStorage??session,options.clientId??config.hashbinClientId)});this.documents={...this.documents,serialize:serializeLegacy};}
 get redirectOnly(){return Boolean(globalThis.crossOriginIsolated);}
 async load(value){return{...await super.load(value),type:'apptron'};}
 // No await before SDK.publish: isolated editors require the redirect/file handoff.
 publish(payload,snapshot,overlay=typeof payload!=='string'){
  if(!this.client)return Promise.reject(Error('HashBin is still loading. Try again.'));
  const data=payload instanceof Uint8Array?payload:kit.bytes(payload);if(data.length>config.maxBytes)throw Error('Saved content exceeds the 5 MiB limit.');type.normalize(snapshot);
  return this.client.publish(data,{mode:this.redirectOnly?'redirect':'popup',contentType:overlay?'application/gzip':'application/json',fileName:overlay?'apptron-overlay.gz':'apptron-snapshot.json',clientState:{snapshot,overlay}}).then(async result=>{if(!result.redirected)await kit.verify(result.cid,data);return result;},error=>{throw Error(this.message(error));});
 }
 async published(hash){
  const params=new URLSearchParams(hash.replace(/^#/,''));if(!params.has('hashbin_publish'))return null;
  let raw,transaction;
  try{raw=this.transactionStorage.getItem('hashbin:publish:'+this.clientId+':'+params.get('hashbin_publish'));if(raw!=null){kit.bounded(raw,config.maxBytes*3+65536);transaction=JSON.parse(raw);}}
  catch(error){return{error:error.message,snapshot:null,overlay:false};}
  if(transaction?.clientState?.overlay!==true){const result=await super.published(hash);return result?{...result,overlay:false}:result;}
  let snapshot;
  try{
   snapshot=transaction.clientState.snapshot;type.normalize(snapshot);
   if(typeof transaction.bytes!=='string')throw Error('The saved overlay transaction has no original bytes.');
   const original=kit.decode64(transaction.bytes,config.maxBytes),client=await this.init(),result=await client.handlePublishCallback({hash});
   if(JSON.stringify(type.normalize(result.clientState?.snapshot))!==JSON.stringify(type.normalize(snapshot)))throw Error('Publish snapshot does not match its transaction.');
   await kit.verify(result.cid,original);return{cid:result.cid,snapshot,overlay:true};
  }catch(error){return{error:this.message(error),snapshot:snapshot??null,overlay:true};}
 }
}
