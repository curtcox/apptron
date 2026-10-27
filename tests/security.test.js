import { verifyRuntimeScript, sha256 } from '../src/runtime-integrity.js';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzip, packTar } from '../src/tar.js';
import { readOverlay } from '../src/overlay.js';
import { WanixDisk } from '../src/wanix-disk.js';
import { SnapshotStore, requestResult } from '../src/store.js';
import { handleDataRequest } from '../src/r2fs.js';
import { verifyCID } from '../src/content-id.js';
import { readDraft, writeDraft, provenance } from '../src/draft.js';
import { validBoot, validMessage, validCommand } from '../src/bridge.js';
import { DataGrants } from '../src/data-access.js';
const commit = 'a'.repeat(40), uuid = 'a'.repeat(64), other = 'b'.repeat(64);
function cid(data) { const size=Buffer.alloc(6);size.writeUIntBE(data.length,0,6);return size.toString('base64url')+(data.length<=64?Buffer.from(data):createHash('sha512').update(data).digest()).toString('base64url'); }
function rawPath(path) {
 const tar=packTar([{path:'safe',data:'bad'},{path:'.apptron-overlay.json',data:JSON.stringify({version:1,commit,fileCount:1})}]);
 tar.fill(0,0,100);tar.set(new TextEncoder().encode(path));tar.fill(32,148,156);
 tar.set(new TextEncoder().encode(tar.subarray(0,512).reduce((n,b)=>n+b,0).toString(8).padStart(6,'0')+'\0 '),148);return tar;
}
test('T7 rejects traversal, absolute and normalized excluded overlay paths',async()=>{
 for(const path of ['../escape','/etc/escape','./project/escape','./home/escape','etc/../escape']) await assert.rejects(()=>gzip(rawPath(path)).then(data=>readOverlay(data,commit)),/Unsafe|excluded/);
});
test('overlay restore validates all entries before clearing existing work',async()=>{
 const disk=new WanixDisk();await disk.restore(uuid,[{path:'etc/keep',type:'0',data:new Uint8Array([1])}]);
 for(const entries of [
  [{path:'../other',type:'0'}],
  [{path:'etc',type:'2',linkname:'/home'},{path:'etc/payload',type:'0'}],
  [{path:'etc/test',type:'0'},{path:'etc/test',type:'0'}],
  [{path:'etc/hard',type:'1',linkname:'../escape'}],
 ]) await assert.rejects(()=>disk.restore(uuid,entries));
 const db=await disk.db();assert.ok(await requestResult(db.transaction('metadata').objectStore('metadata').get(`env/${uuid}/overlay/etc/keep`)));disk.close();
});
test('T7 verifies inline and SHA-512 content IDs, including length and corruption',async()=>{
 for(const data of [new Uint8Array(),new TextEncoder().encode('small'),new Uint8Array(100)]){
  await verifyCID(cid(data),data);
  await assert.rejects(()=>verifyCID(cid(data),new Uint8Array(data.length+1)),/CID/);
  if(data.length){const bad=data.slice();bad[0]^=1;await assert.rejects(()=>verifyCID(cid(data),bad),/CID/)}
 }
});
test('T4 all data responses are inert and T5 grants restrict snapshot mounts',async()=>{
 const store=new SnapshotStore(crypto.randomUUID());
 const roots=[`env/${uuid}/project`,`usr/me-${uuid}`];
 for(const id of [uuid,other])await store.batch([{path:`env/${id}/project/test`,data:new Uint8Array([1]),mode:0o100644,mtime:1,changed:1,attrs:{}}]);
 const base='/apptron/vm-data/session/data/';
 for(const method of ['GET','HEAD','OPTIONS','DELETE']){
  const response=await handleDataRequest(new Request(`https://site.test${base}env/${other}/project/test`,{method}),store,base,roots);
  assert.equal(response.status,403);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Content-Security-Policy'),'sandbox');
 }
 const allowed=await handleDataRequest(new Request(`https://site.test${base}env/${uuid}/project/test`),store,base,roots);assert.equal(allowed.status,200);
 const grants=new DataGrants(),session=crypto.randomUUID();await grants.grant(session,uuid,'user');assert.deepEqual(await grants.get(session),[`env/${uuid}/project`,`env/${uuid}/public`,'usr/user']);await grants.revoke(session);assert.equal(await grants.get(session),null);
 await assert.rejects(()=>grants.grant(session,uuid,'../other'));assert.equal(await grants.get(session),null);
});
test('T8 draft provenance survives reload and old drafts remain untrusted',()=>{
 const source='# apptron snapshot v1\n-- file --\nhi\n';
 const origin=provenance('share');assert.deepEqual(readDraft(writeDraft(source,origin)),{source,provenance:origin});
 assert.equal(readDraft(source).provenance.kind,'stored');assert.equal(readDraft('bad'),null);
});
test('bridge rejects malformed, stale and unknown messages and arbitrary commands',()=>{
 const session=crypto.randomUUID();assert.equal(validMessage(null,session),false);assert.equal(validMessage({session:'stale',type:'apptron-ready'},session),false);
 assert.equal(validCommand({id:1,type:'eval',value:'alert(1)'}),false);assert.equal(validCommand({id:1,type:'apptron-key',value:7}),false);assert.equal(validCommand({id:1,type:'apptron-key',value:'x'}),true);
 assert.equal(validBoot({type:'apptron-boot',session}),false);
});

test('worker script imports are checked against the locked manifest',async()=>{
 const data=new TextEncoder().encode('export const value=1;'),file='wasi/lib.js';
 const manifest=JSON.stringify({commit,securityVersion:1,files:{[file]:{size:data.length,sha256:await sha256(data)}}});
 const lock={commit,manifestSha256:await sha256(new TextEncoder().encode(manifest))};
 const fetchFile=async url=>new Response(String(url).endsWith('runtime.lock')?JSON.stringify(lock):manifest);
 const request=new Request(`https://site.test/apptron/runtime/${commit}/${file}`);
 assert.equal(await (await verifyRuntimeScript(request,new Response(data),'https://site.test/apptron/',fetchFile)).text(),'export const value=1;');
 await assert.rejects(()=>verifyRuntimeScript(request,new Response('malicious'),'https://site.test/apptron/',fetchFile),/checksum/);
 lock.manifestSha256='0'.repeat(64);await assert.rejects(()=>verifyRuntimeScript(request,new Response(data),'https://site.test/apptron/',fetchFile),/manifest checksum/);
});

test('snapshot grants reject forged identity and user paths before mutation',async()=>{
 const grants=new DataGrants(),session=crypto.randomUUID();
 for(const [id,user] of [[uuid,'../../other'],['../other','user'],[uuid,'user/foreign']]) await assert.rejects(()=>grants.grant(session,id,user));
 assert.equal(await grants.get(session),null);
});
