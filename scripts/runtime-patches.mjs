import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export const runtimePatches = (root='.') => Object.fromEntries(readdirSync(path.join(root,'patches'), { recursive: true })
  .filter(name => name.endsWith('.patch')).sort()
  .map(name => [name, digest(path.join(root,'patches',name))]));
export function runtimeBuildInputs(root='.') {
 const overlays=path.join(root,'examples/overlays');
 const files=[...(existsSync(overlays)?readdirSync(overlays).map(name=>'examples/overlays/'+name):[]),
  'scripts/build-runtime.sh','scripts/build-overlays.sh','scripts/build-overlay.mjs','scripts/prepare-runtime.mjs','scripts/fetch-t256.mjs','scripts/runtime-patches.mjs'];
 return Object.fromEntries(files.filter(file=>existsSync(path.join(root,file))).sort().map(file=>[file,digest(path.join(root,file))]));
}
export const patchSetDigest = (root='.') => createHash('sha256').update(JSON.stringify({patches:runtimePatches(root),buildInputs:runtimeBuildInputs(root)})).digest('hex');
