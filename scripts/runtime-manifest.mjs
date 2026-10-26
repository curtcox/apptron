import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const directory = process.argv[2];
const lock = JSON.parse(readFileSync('runtime.lock'));
const files = {};
for (const name of readdirSync(directory, { recursive: true }).sort()) {
  if (!/\.(wasm|js|gz|css)$/.test(name)) continue;
  const data = readFileSync(`${directory}/${name}`);
  files[name] = { size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
const patches = Object.fromEntries(readdirSync('patches').filter(n => n.endsWith('.patch')).map(n => [n, createHash('sha256').update(readFileSync(`patches/${n}`)).digest('hex')]));
const manifest = JSON.stringify({ version: 1, commit: lock.commit, images: lock.images, loaderSource: lock.loaderSource, rejectedLoaderImage: lock.rejectedLoaderImage, patches, files }, null, 2) + '\n';
writeFileSync(`${directory}/runtime.json`, manifest);
if (process.argv.includes('--lock')) {
  const digest = createHash('sha256').update(manifest).digest('hex');
  if (lock.manifestSha256 !== digest) delete lock.archiveSha256;
  lock.manifestSha256 = digest;
  writeFileSync('runtime.lock', JSON.stringify(lock, null, 2) + '\n');
}
