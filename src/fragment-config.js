import * as kit from '../vendor/fragment-kit-v0.3.5/src/index.js';
import settings from '../fragment-kit.config.json' with {type:'json'};
import{parseSnapshot,MAX_TEXT_BYTES}from'./snapshot.js';
export const config=kit.createConfig(settings);
export const type={type:'apptron',settingsKeys:[],fileName:'apptron-snapshot.json',contentType:'application/json',
 normalize(value){const src=value?.src??value?.source;kit.bounded(src,MAX_TEXT_BYTES);parseSnapshot(src);return{src};},
 isDefault:()=>true,
 parseLegacy(text){let value;try{value=JSON.parse(text);}catch{return undefined;}if(value?.format||value?.version||value?.type)throw Error('This saved document is not an Apptron v1 snapshot.');return undefined;}
};
export const serializeLegacy=value=>kit.bounded(JSON.stringify({format:'hashbin-diagram',version:1,type:'apptron',src:type.normalize(value).src}),config.maxBytes);
export const legacyWriter=(doc,{url,run,view,compress})=>{
 // Relay and deployment settings are intentionally absent from every share link.
 url.search='';if(run===false)url.searchParams.set('run','0');if(view)url.searchParams.set('view',view);url.hash=encodeURIComponent(doc.src);const long=url.href;
 try{const encoded=compress?.(doc.src);if(encoded){url.hash='';url.searchParams.set('compressed',encoded);}}catch{}
 return url.href.length>7000?long:url.href;
};
export const urlState=kit.createUrlState({config,type,legacyWriter});
export const HashBinDocuments={...urlState.documents,MAX_BYTES:config.maxBytes,serialize:serializeLegacy,parse:text=>({...urlState.documents.parse(text),type:'apptron'}),
 bytes:value=>value instanceof Uint8Array?value:kit.bytes(value),
 ...Object.fromEntries(['decode64','cidLength','isCID'].map(key=>[key,kit[key]])),cid:value=>kit.cid(value,config.allowedHosts),link:urlState.link};
export const ShareLinks={build({url,code,compress}){const doc=type.normalize({src:code}),base=urlState.scrub(url);return Object.freeze({long:legacyWriter(doc,{url:new URL(base),compress:null}),fallback:legacyWriter(doc,{url:new URL(base),compress})});}};
export const readShareURL=input=>{const intent=urlState.parse(input);return intent.kind==='source'?intent.doc.src:null;};
export const LZString={compressToEncodedURIComponent:kit.compress,decompressFromEncodedURIComponent:kit.decompress};
export function publishTransactions(storage,clientId=config.hashbinClientId){if(!storage)return undefined;const current=kit.createStorage({prefix:config.storagePrefix,storage}),owned=key=>key.startsWith('hashbin:publish:'+clientId+':');return{getItem(key){const value=current.getItem(key);if(value!=null||!owned(key))return value;try{return storage.getItem(key);}catch{return null;}},setItem:(key,value)=>current.setItem(key,value),removeItem(key){current.removeItem(key);if(owned(key))try{storage.removeItem(key);}catch{}}};}
export{ShareClient}from'../vendor/fragment-kit-v0.3.5/src/index.js';
