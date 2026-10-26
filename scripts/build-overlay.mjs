import { lstat, readdir, readFile, readlink, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { packTar, gzip } from '../src/tar.js';
const [name, commit] = process.argv.slice(2);
const base = '.build/base', installed = `.build/overlay-${name}`, entries = [];
const hash = b => createHash('sha256').update(b).digest('hex');
async function walk(path = '') {
  for (const item of await readdir(installed + '/' + path)) {
    const relative = path ? path + '/' + item : item;
    if (/^(project|home|public|proc|sys|dev|tmp)(\/|$)/.test(relative)) continue;
    const file = installed + '/' + relative, stat = await lstat(file);
    let original; try { original = await lstat(base + '/' + relative); } catch { /* New package file. */ }
    const type = stat.isSymbolicLink() ? '2' : stat.isDirectory() ? '5' : stat.isFile() ? '0' : null;
    if (!type) continue;
    const data = type === '0' ? await readFile(file) : new Uint8Array();
    const linkname = type === '2' ? await readlink(file) : '';
    const changed = !original || (stat.mode & 0o7777) !== (original.mode & 0o7777) ||
      type === '0' && (!original.isFile() || hash(data) !== hash(await readFile(base + '/' + relative))) ||
      type === '2' && (!original.isSymbolicLink() || linkname !== await readlink(base + '/' + relative));
    if (changed) entries.push({ path: relative, type, data, linkname, mode: stat.mode & 0o7777, mtime: Math.floor(stat.mtimeMs / 1000) });
    if (type === '5') await walk(relative);
  }
}
await walk();
entries.push({ path: '.apptron-overlay.json', data: JSON.stringify({ version: 1, commit, createdAt: new Date().toISOString(), fileCount: entries.length }) + '\n' });
const output = await gzip(packTar(entries));
if (output.length > 128 * 1024 * 1024) throw new Error(`${name} overlay exceeds 128 MiB.`);
await mkdir(`runtime/${commit}/overlays`, { recursive: true });
await writeFile(`runtime/${commit}/overlays/${name}.tar.gz`, output);
console.log(`${name}: ${entries.length - 1} files, ${(output.length / 1048576).toFixed(1)} MiB`);
