import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ShareLinks, readShareURL, ShareClient } from '../src/share-links.js';
import { HashBinDocuments, HashBinStore } from '../src/hashbin.js';
import { canEncodeQR } from '../src/qr-panel.js';
import { bundleName } from '../src/apptron-host.js';
import { validateRelay } from '../src/network.js';
const require=createRequire(import.meta.url), lz=require('lz-string');
const src='# apptron snapshot v1\n-- hello --\nhello\n';
test('share links round trip with compression and fragments, excluding private settings',()=>{
 for(const compress of [undefined,lz.compressToEncodedURIComponent]){const links=ShareLinks.build({url:'https://site.test/apptron/?example=x&network=wss://private&code=secret#old',code:src,compress});assert.equal(readShareURL(links.fallback,lz.decompressFromEncodedURIComponent),src);assert.doesNotMatch(links.fallback,/private|secret|example/);}
 assert.throws(()=>readShareURL('https://site.test/?compressed=!',()=>null));
});
test('HashBin apptron envelope rejects unrelated formats and invalid versions',()=>{
 assert.deepEqual(HashBinDocuments.parse(HashBinDocuments.serialize({src})),{src,type:'apptron'});assert.deepEqual(HashBinDocuments.parse(src),{src,type:'apptron'});
 assert.throws(()=>HashBinDocuments.parse(JSON.stringify({format:'hashbin-diagram',version:1,type:'manim',src})));assert.throws(()=>HashBinDocuments.parse(JSON.stringify({format:'hashbin-diagram',version:2,type:'apptron',src})));
});
test('CID parsing handles embedded short documents and links',async()=>{
 const text='# apptron snapshot v1\n';const size=Buffer.alloc(6);size.writeUIntBE(Buffer.byteLength(text),0,6);const cid=size.toString('base64url')+Buffer.from(text).toString('base64url');
 assert.equal(HashBinDocuments.isCID(cid),true);assert.equal(HashBinDocuments.cid('https://256t.us/'+cid),cid);assert.equal(HashBinDocuments.cid('https://evil.test/'+cid),null);assert.equal(HashBinDocuments.isCID('not-a-cid'),false);
 const store=new HashBinStore();assert.equal((await store.load(cid)).src,text);
});
function cidOf(data){const bytes=Buffer.from(data),size=Buffer.alloc(6);size.writeUIntBE(bytes.length,0,6);return size.toString('base64url')+(bytes.length<=64?bytes:require('node:crypto').createHash('sha512').update(bytes).digest()).toString('base64url');}
const memoryStore=()=>{const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
test('HashBin Publish saves snapshots and gzip overlays with the pinned SDK and verifies returned CIDs',async()=>{
 await assert.rejects(()=>new HashBinStore().init(),/client ID/);
 const calls=[];const store=new HashBinStore({clientId:'registered',loadSDK:async()=>({HashBinClient:class{publish(bytes,options){calls.push({bytes,options});return Promise.resolve({cid:cidOf(bytes)});}}})});
 const payload=HashBinDocuments.serialize({src}),overlay=new Uint8Array([31,139,8]);
 await assert.rejects(store.publish(payload,{src}),/still loading/);await store.init();
 assert.equal((await store.publish(payload,{src})).cid,cidOf(payload));assert.equal(calls[0].options.contentType,'application/json');assert.deepEqual(calls[0].options.clientState,{snapshot:{src},overlay:false});
 assert.equal((await store.publish(overlay,{src},true)).cid,cidOf(overlay));assert.equal(calls[1].options.contentType,'application/gzip');assert.deepEqual([...calls[1].bytes],[31,139,8]);
 store.client.publish=async()=>({cid:cidOf(payload+' ')});await assert.rejects(store.publish(payload,{src}),/does not match|CID/);
 assert.match(require('node:fs').readFileSync(new URL('../src/hashbin.js',import.meta.url),'utf8'),/hashbin\.org\/sdk\/v0\.3\.0\/hashbin\.js/);
});
test('isolated editors save through a redirect that restores the snapshot after approval or cancellation',async()=>{
 const transactionStorage=memoryStore(),payload=HashBinDocuments.serialize({src});let mode,outcome='approve';
 const store=new HashBinStore({clientId:'registered',transactionStorage,loadSDK:async()=>({HashBinClient:class{publish(_bytes,options){mode=options.mode;return Promise.resolve({redirected:true});}async handlePublishCallback(){if(outcome!=='approve')throw Object.assign(new Error('access_denied'),{clientState:{snapshot:{src},overlay:true}});return {cid:cidOf(payload),clientState:{snapshot:{src},overlay:true}};}}})});
 await store.init();globalThis.crossOriginIsolated=true;
 try{assert.deepEqual(await store.publish(payload,{src},true),{redirected:true});assert.equal(mode,'redirect');}finally{delete globalThis.crossOriginIsolated;}
 assert.equal(await store.published('#'+cidOf('x')),null);
 assert.deepEqual(await store.published('#hashbin_publish=s&cid=x'),{cid:cidOf(payload),snapshot:{src},overlay:true});
 await store.publish(payload,{src},true);outcome='cancel';
 assert.deepEqual(await store.published('#hashbin_publish=s&error=access_denied'),{error:'The save was cancelled on HashBin.',snapshot:{src},overlay:true});assert.equal(transactionStorage.data.size,0);
});
test('tokens from an earlier OAuth flow are revoked server-side before they are cleared',async()=>{
 const storage=memoryStore();let loaded=0,revoked=0;
 const store=new HashBinStore({clientId:'registered',storage,loadSDK:async()=>{loaded++;return {HashBinClient:class{async disconnect(){revoked++;storage.data.clear();}}};}});
 assert.equal(await store.retireLegacyTokens(),false);assert.equal(loaded,0);
 storage.setItem('hashbin:tokens:registered','{"refreshToken":"old"}');assert.equal(await store.retireLegacyTokens(),true);assert.equal(revoked,1);
});
