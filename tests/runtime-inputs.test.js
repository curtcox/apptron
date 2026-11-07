import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
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
test('real VM checks use the newly verified runtime cache metadata',()=>{
 // Serving new runtime bytes with the previous cache pins causes verified
 // fetches to fail before the guest can boot. Preserve this ordering in CI.
 for(const workflow of ['runtime.yml','test.yml']){
  const source=readFileSync(new URL('../.github/workflows/'+workflow,import.meta.url),'utf8');
  const boot=source.indexOf('scripts/test-browser-container.sh tests/browser/boot.spec.cjs');
  const pin=source.indexOf('node scripts/pin-runtime-assets.mjs');
  const offline=source.indexOf('node scripts/update-offline.mjs');
  assert.ok(pin>=0&&offline>pin&&boot>offline,workflow+': refresh and verify hashes before boot');
 }
});
