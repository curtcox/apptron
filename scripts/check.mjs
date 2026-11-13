import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {verifyManifest} from '../vendor/fragment-kit-v0.4.3/tools/vendor-sync.mjs';
import {patchSetDigest} from './runtime-patches.mjs';
const run=(...args)=>{const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.status!==0)throw Error('Check failed: '+args.join(' '));};
async function syntax(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=directory+'/'+entry.name;if(entry.isDirectory())await syntax(file);else if(/\.(m?js|cjs)$/.test(file))run('--check',file);}}
for(const dir of ['src','scripts','tests'])await syntax(dir);
for(const file of ['data-sw.js','deployment-config.js','testing-contract.config.mjs'])run('--check',file);
await verifyManifest('vendor/fragment-kit-v0.4.3');
const lock=JSON.parse(await fs.readFile('runtime.lock'));
if(lock.patchSetSha256!==patchSetDigest())console.log('Runtime build inputs changed; the Runtime workflow must publish and verify a new release before deployment.');
run('scripts/gallery-catalog.mjs','--check');run('scripts/render-kit-gallery.mjs','--check');run('scripts/update-offline.mjs','--check');
if(await fs.stat('runtime/'+lock.commit+'/runtime.json').catch(()=>null))run('scripts/pin-runtime-assets.mjs','--check');
console.log('Syntax, immutable kit, runtime patches, gallery and offline manifests verified.');
