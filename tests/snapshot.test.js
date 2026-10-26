import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSnapshot, serializeSnapshot, snapshotUUID, bytes, MAX_TEXT_BYTES } from '../src/snapshot.js';
import { examples } from '../src/examples.js';
test('all gallery snapshots are valid', () => { for (const { id } of examples) assert.ok(parseSnapshot(readFileSync(`examples/${id}.txtar`, 'utf8'))); });
test('round trip preserves unknown headers, binary and non-newline files', () => {
 const snapshot = { header: '# apptron snapshot v1\nfuture: a value\n# keep me', files: [{path:'a',data:bytes('hello')},{path:'b',data:bytes('\0\xff')},{path:'c',data:bytes('-- deceptive --\n')},{path:'literal (base64)',data:bytes('regular text\n')}] };
 const parsed = parseSnapshot(serializeSnapshot(snapshot)); assert.equal(parsed.header,snapshot.header);
 for(const original of snapshot.files) assert.deepEqual(parsed.files.find(f=>f.path===original.path).data,original.data);
});
test('snapshot versions, traversal, duplicate and ambiguous paths are rejected', () => {
 for(const source of ['# apptron snapshot v2\n','not txtar',...['../x','/x','a/../x','a\\b'].map(p=>`# apptron snapshot v1\n-- ${p} --\nx\n`),'# apptron snapshot v1\n-- x --\nx\n-- x --\ny\n','# apptron snapshot v1\n-- a --\nx\n-- a/b --\ny\n']) {
  assert.throws(()=>parseSnapshot(source));
 }
});
test('base64 rejects malformed content and text cap counts UTF-8 bytes', () => {
 assert.throws(()=>parseSnapshot('# apptron snapshot v1\n-- x (base64) --\n%%\n'));
 assert.throws(()=>parseSnapshot('# apptron snapshot v1\n'+'é'.repeat(MAX_TEXT_BYTES/2)));
});
test('UUID is stable, text-sensitive and runtime-sensitive',async()=>{
 const source='# apptron snapshot v1\n'; assert.equal(await snapshotUUID(source),await snapshotUUID(source)); assert.notEqual(await snapshotUUID(source),await snapshotUUID(source+'\n')); assert.notEqual(await snapshotUUID(source,'a'),await snapshotUUID(source,'b'));
});
