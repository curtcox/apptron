import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {patchSetDigest} from '../scripts/runtime-patches.mjs';
test('overlay package and binary pins invalidate immutable runtime releases',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'apptron-inputs-'));
 try{
  mkdirSync(path.join(root,'patches'));writeFileSync(path.join(root,'patches/security.patch'),'patch');
  mkdirSync(path.join(root,'examples/overlays'),{recursive:true});
  const file=path.join(root,'examples/overlays/gripeline.packages');writeFileSync(file,'bash\n');
  const initial=patchSetDigest(root);writeFileSync(file,'bash\npython3\n');assert.notEqual(patchSetDigest(root),initial);
  const changed=patchSetDigest(root);writeFileSync(path.join(root,'examples/overlays/gripeline.t256.json'),'pinned-binary');assert.notEqual(patchSetDigest(root),changed);
 }finally{rmSync(root,{recursive:true,force:true});}
});
