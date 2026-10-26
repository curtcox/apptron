import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const [directory, archive] = process.argv.slice(2);
const lock = JSON.parse(readFileSync('runtime.lock'));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
lock.manifestSha256 = digest(`${directory}/runtime.json`);
if (archive) lock.archiveSha256 = digest(archive);
writeFileSync('runtime.lock', JSON.stringify(lock, null, 2) + '\n');
