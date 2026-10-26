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
test('HashBin OAuth round trip preserves source and validates missing ID',async()=>{
 const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 await assert.rejects(()=>new HashBinStore().init(),/client ID/);
 const oauth={authorize:async()=>({state:'nonce',url:'https://hashbin.org/auth'}),handleCallback:async()=>{}};
 const store=new HashBinStore({clientId:'registered',transactionStorage:storage,loadSDK:async()=>({HashBinClient:class{constructor(){return oauth;}}})});
 assert.equal(await store.connect({src}),'https://hashbin.org/auth');assert.deepEqual(await store.callback('?state=nonce&code=ok'),{snapshot:{src},connected:true});assert.match((await store.callback('?state=nonce&code=ok')).error,/restored/);
});
test('shortener failure retains copyable source link and validates provider URL',async()=>{
 const links={long:'https://site.test/#source',fallback:'https://site.test/?compressed=source'};
 const client=new ShareClient({fetchLink:async()=>new Response(JSON.stringify({contents:'https://evil.test/a'}))});const result=await client.shorten(links);assert.equal(result.shortened,false);assert.equal(result.url,links.fallback);
});
test('QR capacity, bundle mapping, and relay validation',()=>{
 assert.equal(canEncodeQR('x'.repeat(2953)),true);assert.equal(canEncodeQR('x'.repeat(2954)),false);assert.equal(canEncodeQR('é'.repeat(1477)),false);
 assert.equal(bundleName('bundles/goroot.tar.br'),'goroot.tar.gz');assert.equal(bundleName('/bundles/sys.tar.gz'),'sys.tar.gz');assert.throws(()=>bundleName('../private'));
 assert.equal(validateRelay(' ws://localhost:8080/x/net ','https:'),'ws://localhost:8080/x/net');assert.throws(()=>validateRelay('https://relay.test','https:'));assert.throws(()=>validateRelay('ws://relay.test','https:'));assert.equal(validateRelay('','https:'),'');
});
test('HashBin quote uses document bytes and raw overlay saves use gzip content',async()=>{
 const calls=[];
 const store=new HashBinStore({clientId:'registered',fetchSource:async()=>new Response(JSON.stringify({cost_cents:2}))});
 store.oauth={getTokens:()=>({refreshToken:'refresh',expiresAt:Date.now()+600000}),authorizedFetch:async(path,options)=>{
  calls.push({path,options});
  if(path==='/api/account/settings')return new Response(JSON.stringify({default_retention_months:3}));
  if(path==='/api/balance')return new Response(JSON.stringify({balance_cents:100}));
  if(path==='/api/content'){const content=options.body.get('content');assert.equal(content.type,'application/gzip');const data=new Uint8Array(await content.arrayBuffer());assert.deepEqual(data,new Uint8Array([31,139,8]));return new Response(JSON.stringify({cid:'AAAAAAAA'}));}
 }};
 const quote=await store.quote('x'.repeat(100));assert.deepEqual(quote,{months:3,cost:2,balance:100,size:100});
 assert.equal((await store.save(new Uint8Array([31,139,8]),true)).cid,'AAAAAAAA');assert.equal(calls.filter(c=>c.path==='/api/content').length,1);
});
