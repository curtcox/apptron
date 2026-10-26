import test from 'node:test';
import assert from 'node:assert/strict';
import { packTar, unpackTar, gzip, gunzip } from '../src/tar.js';
import { bytes } from '../src/snapshot.js';
import { readOverlay, captureOverlay } from '../src/overlay.js';
const commit='a'.repeat(40);
test('tar and gzip round trip directories, symlinks, binary files and long names',async()=>{
 const entries=[{path:'etc',type:'5',mode:0o755},{path:'etc/test',data:bytes('\0hi'),mode:0o755},{path:'bin/link',type:'2',linkname:'/etc/test'},{path:'long/'.repeat(25)+'file',data:bytes('long')}];
 const tar=packTar(entries);const round=unpackTar(await gunzip(await gzip(tar)));assert.equal(round.length,4);assert.deepEqual(round[1].data,bytes('\0hi'));assert.equal(round[2].linkname,'/etc/test');assert.equal(round[3].path,entries[3].path);
 const broken=tar.slice();broken[10]=99;assert.throws(()=>unpackTar(broken),/checksum/);assert.throws(()=>unpackTar(tar.slice(0,600)),/Truncated/);
 await assert.rejects(()=>gunzip(tar,1));
});
test('overlay manifest validates commit and file count and reports runtime mismatch',async()=>{
 const manifest={version:1,commit,fileCount:1};const archive=await gzip(packTar([{path:'etc/config',data:bytes('yes')},{path:'.apptron-overlay.json',data:JSON.stringify(manifest)}]));
 assert.equal((await readOverlay(archive,commit)).mismatch,false);assert.equal((await readOverlay(archive,'b'.repeat(40))).mismatch,true);
 const empty = await gzip(packTar([]));
 await assert.rejects(()=>readOverlay(empty,commit), /missing/);
 await assert.rejects(()=>readOverlay(new Uint8Array([1,2,3]),commit));
});
test('scratch capture follows pinned Wanix API and excludes mounts',async()=>{
 const fs={readDir:async p=>p==='#scratch'?['etc/','project/']:['config'],lstat:async p=>p.endsWith('/etc')?{Mode:0x800001ed,Size:0,ModTime:new Date().toISOString()}:{Mode:0o644,Size:2,ModTime:new Date().toISOString()},readFile:async()=>bytes('ok')};
 const captured=await readOverlay(await captureOverlay(fs,commit),commit);assert.deepEqual(captured.entries.map(e=>e.path),['etc','etc/config','.apptron-overlay.json']);
});
