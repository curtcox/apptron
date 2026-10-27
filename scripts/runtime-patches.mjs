import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const runtimePatches = () => Object.fromEntries(readdirSync('patches', { recursive: true })
  .filter(name => name.endsWith('.patch')).sort()
  .map(name => [name, createHash('sha256').update(readFileSync(`patches/${name}`)).digest('hex')]));
export const patchSetDigest = () => createHash('sha256').update(JSON.stringify(runtimePatches())).digest('hex');
