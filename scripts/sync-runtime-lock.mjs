import { patchSetDigest } from './runtime-patches.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const lock = JSON.parse(readFileSync('runtime.lock'));
const commit = execFileSync('git',['-C','upstream/apptron','rev-parse','HEAD'],{encoding:'utf8'}).trim();
const goMod = readFileSync('upstream/apptron/go.mod','utf8');
const revision = /tractor.dev\/wanix v[^\s]+-([a-f0-9]{12})/.exec(goMod)?.[1];
if (!revision) throw new Error('Review upstream: no pinned Wanix pseudo-version was found.');
if (!lock.loaderSource.startsWith(revision)) {
 const response = await fetch(`https://api.github.com/repos/tractordev/wanix/commits/${revision}`);
 if (!response.ok) throw new Error('Could not resolve the Wanix source commit.'); lock.loaderSource = (await response.json()).sha;
}
if (lock.commit !== commit) { lock.commit = commit; lock.release = `runtime-${commit}`; lock.manifestSha256 = null; delete lock.archiveSha256; }
const patchDigest = patchSetDigest();
if (lock.patchSetSha256 !== patchDigest) {
 lock.patchSetSha256 = patchDigest;
 // A new build gets a new immutable name; this does not claim it is published.
 lock.release = `runtime-${commit}-${patchDigest.slice(0, 12)}`;
 lock.manifestSha256 = null; delete lock.archiveSha256;
}
writeFileSync('runtime.lock',JSON.stringify(lock,null,2)+'\n');
