import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { safePath } from '../src/snapshot.js';
const directory = process.argv[2];
const lock = JSON.parse(readFileSync('runtime.lock'));
const digest = data => createHash('sha256').update(data).digest('hex');
const raw = readFileSync(`${directory}/runtime.json`);
if (!lock.manifestSha256 || digest(raw) !== lock.manifestSha256) throw new Error('runtime.json does not match the locked SHA-256.');
const manifest = JSON.parse(raw);
if (manifest.commit !== lock.commit || manifest.loaderSource !== lock.loaderSource) throw new Error('Runtime source mismatch.');
const patches = Object.fromEntries(readdirSync('patches').filter(name => name.endsWith('.patch')).map(name => [name, digest(readFileSync(`patches/${name}`))]));
if (JSON.stringify(Object.entries(manifest.patches || {}).sort()) !== JSON.stringify(Object.entries(patches).sort())) throw new Error('Runtime patches differ from this checkout. Build and lock a new runtime release.');
for (const required of ['sys.tar.gz','wanix.wasm','wanix.min.js','wanix.js','goroot.tar.gz','gocache-386.tar.gz','gocache-wasm.tar.gz','overlays/python.tar.gz','overlays/c.tar.gz','overlays/node.tar.gz','overlays/fun.tar.gz']) if (!manifest.files[required]) throw new Error(`Missing runtime file: ${required}`);
for (const [name, expected] of Object.entries(manifest.files)) {
 safePath(name); const actual = readFileSync(`${directory}/${name}`);
 if (actual.length !== expected.size || digest(actual) !== expected.sha256) throw new Error(`Checksum mismatch: ${name}`);
}
console.log(`Verified ${Object.keys(manifest.files).length} runtime files for ${manifest.commit.slice(0,7)}.`);
