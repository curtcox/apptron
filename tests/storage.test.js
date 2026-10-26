import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotStore, requestResult } from '../src/store.js';
import { parseSnapshot, bytes } from '../src/snapshot.js';
import { handleDataRequest } from '../src/r2fs.js';
import { packTar } from '../src/tar.js';
import { captureSnapshot } from '../src/capture.js';
import { WanixDisk } from '../src/wanix-disk.js';
const uuid='a'.repeat(64), root=`env/${uuid}/project`, base='/apptron/data/';
async function fixture(){const store=new SnapshotStore(crypto.randomUUID());await store.seed(uuid,'user',parseSnapshot('# apptron snapshot v1\n-- dir/test --\nhello\n'));return store;}
function request(method,path,body,headers={}){return new Request('https://site.test'+base+root+path,{method,body,headers});}
test('r2fs supports file metadata, listings, multipart tree, range and scope',async()=>{
 const store=await fixture(); let response=await handleDataRequest(request('GET','/dir/test'),store,base);assert.equal(await response.text(),'hello\n');assert.equal(response.headers.get('Content-Mode'),'33188');
 response=await handleDataRequest(request('GET','/...'),store,base);const listing=await response.text();assert.match(listing,/multipart|content-location/i);assert.match(listing,/dir 16877/);assert.match(listing,/bytes 0-0\/6/);
 response=await handleDataRequest(request('GET','/dir/test',undefined,{Range:'bytes=1-3'}),store,base);assert.equal(response.status,206);assert.equal(await response.text(),'ell');
 response=await handleDataRequest(new Request('https://site.test/apptron/data/env/other/project'),store,base);assert.equal(response.status,404);
});
test('r2fs PUT PATCH attrs COPY MOVE DELETE and overwrite are consistent',async()=>{
 const store=await fixture();
 assert.equal((await handleDataRequest(request('PUT','/a','one'),store,base)).status,200);
 await handleDataRequest(request('PATCH','/a',undefined,{'Content-Mode':'33261'}),store,base);
 assert.equal((await store.get(root+'/a')).mode,33261);
 await handleDataRequest(request('COPY','/a',undefined,{Destination:base+root+'/copy'}),store,base);
 await handleDataRequest(request('MOVE','/copy',undefined,{Destination:base+root+'/moved'}),store,base);
 assert.equal(await store.get(root+'/copy'),undefined);assert.equal(new TextDecoder().decode((await store.get(root+'/moved')).data),'one');
 await handleDataRequest(request('PUT','/a/:attr/test','value'),store,base);
 assert.equal(await (await handleDataRequest(request('GET','/a/:attr/test'),store,base)).text(),'value\n');
 assert.equal((await handleDataRequest(request('COPY','/a',undefined,{Destination:base+root+'/moved',Overwrite:'F'}),store,base)).status,412);
 assert.equal((await handleDataRequest(request('MOVE','/a',undefined,{Destination:'/apptron/data/usr/other/leak'}),store,base)).status,400);
 await handleDataRequest(request('DELETE','/a'),store,base);assert.equal(await store.get(root+'/a'),undefined);
});
test('tar PATCH imports files, creates parents, and capture reads synced data',async()=>{
 const store=await fixture();const tar=packTar([{path:'new/file',data:bytes('synced\n'),mode:0o755}]);
 assert.equal((await handleDataRequest(request('PATCH','',tar,{'Content-Type':'application/x-tar'}),store,base)).status,200);
 const result=await captureSnapshot(store,uuid,parseSnapshot('# apptron snapshot v1\nfuture: kept\n'));
 assert.match(result.source,/future: kept/);assert.match(result.source,/synced/);assert.equal(result.skipped.length,0);
 await store.seed(uuid,'user',parseSnapshot('# apptron snapshot v1\n-- other --\nno\n'));assert.equal(await store.get(root+'/other'),undefined);
 await store.clear(uuid,'user');assert.equal(await store.get(root),undefined);
});
test('disk overlay restore writes IDBFS schema including external data and symlinks',async()=>{
 const disk=new WanixDisk();await disk.restore(uuid,[{path:'usr/bin/test',type:'0',mode:0o755,data:new Uint8Array(6000),mtime:1},{path:'bin/link',type:'2',mode:0o777,linkname:'/usr/bin/test',data:bytes(''),mtime:1}]);
 const db=await disk.db();const node=await requestResult(db.transaction('metadata').objectStore('metadata').get(`env/${uuid}/overlay/usr/bin/test`));assert.equal(node.dataExternal,true);assert.equal(node.mode,0o100755);
 const link=await requestResult(db.transaction('metadata').objectStore('metadata').get(`env/${uuid}/overlay/bin/link`));assert.equal(link.type,'symlink');assert.equal(new TextDecoder().decode(link.data),'/usr/bin/test');
 await disk.clear([`env/${uuid}`]);disk.close();
});
