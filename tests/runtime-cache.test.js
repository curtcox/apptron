import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
test('deferred runtime cache bounds and verifies network and cached bytes', async () => {
 const url='https://editor.test/apptron/runtime/locked/loader.js',data='export const ready=true;';
 globalThis.self={registration:{scope:'https://editor.test/apptron/'}};
 globalThis.OfflineAssets={runtime:{commit:'locked',files:{'runtime/locked/loader.js':{size:Buffer.byteLength(data),sha256:createHash('sha256').update(data).digest('hex')}}}};
 const stored=new Map();let calls=0,network=data;
 globalThis.caches={open:async name=>{assert.equal(name,'apptron-runtime-locked');return {match:async key=>stored.get(key)?.clone(),delete:async key=>stored.delete(key),put:async(key,value)=>stored.set(key,value)}}};
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{calls++;return new Response(network);};
 try {
  const {runtimeResponse}=await import('../src/runtime-cache.js');
  for(const request of [new Request('https://other.test/apptron/runtime/locked/loader.js'),new Request(url,{method:'POST'}),new Request('https://editor.test/apptron/data/env/untrusted/loader.js')])assert.equal(runtimeResponse(request),undefined);
  const first=await runtimeResponse(new Request(url+'?cache=1'));assert.equal(await first.text(),data);assert.equal(first.headers.get('Content-Type'),'text/javascript');
  network='tampered';assert.equal(await (await runtimeResponse(new Request(url))).text(),data);assert.equal(calls,1);
  stored.set(url,new Response('poisoned'));await assert.rejects(runtimeResponse(new Request(url)),/checksum/);assert.equal(stored.has(url),false);
  network=data+'oversized';await assert.rejects(runtimeResponse(new Request(url)),/checksum/);assert.equal(stored.has(url),false);
  network=data;assert.equal(await(await runtimeResponse(new Request(url))).text(),data);
 } finally {globalThis.fetch=originalFetch;delete globalThis.self;delete globalThis.OfflineAssets;delete globalThis.caches;}
});
