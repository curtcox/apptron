import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyT256} from '../scripts/fetch-t256.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('overlay binary must match both pinned bytes and its release checksum list',()=>{
 const bytes=Buffer.from('test binary'),sha=hash(bytes),sums=Buffer.from(sha+'  t256-linux-386\n');
 const lock={version:1,repo:'curtcox/256t.org',release:'t256-v0.1.0',asset:'t256-linux-386',size:bytes.length,sha256:sha,sumsSha256:hash(sums)};
 assert.equal(verifyT256(bytes,sums,lock),bytes);
 assert.throws(()=>verifyT256(Buffer.from('tampered'),sums,lock),/binary checksum/);
 assert.throws(()=>verifyT256(bytes,Buffer.from('tampered'),lock),/SHA256SUMS/);
 assert.throws(()=>verifyT256(bytes,sums,{...lock,sha256:'0'.repeat(64)}),/release checksum/);
});
