import { packTar, unpackTar, gzip, gunzip } from './tar.js';
import { bytes, decoder, safePath } from './snapshot.js';
export const MAX_OVERLAY_BYTES = 5 * 1024 * 1024;
export const excluded = /^(project|home|public|proc|sys|dev|tmp)(\/|$)/;
export async function readOverlay(data, commit) {
  const entries = unpackTar(await gunzip(data, 512 * 1024 * 1024), { maxBytes: 512 * 1024 * 1024 });
  const entry = entries.find(e => e.path === '.apptron-overlay.json');
  if (!entry) throw new Error('Overlay is missing .apptron-overlay.json.');
  const manifest = JSON.parse(decoder.decode(entry.data));
  if (manifest.version !== 1 || !/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.fileCount !== entries.length - 1) throw new Error('Invalid overlay manifest.');
  validateOverlayEntries(entries);
  return { entries, manifest, mismatch: manifest.commit !== commit };
}
// Called again by disk restore, including for frame-produced captures. Symlinks
// may target absolute guest paths (Alpine uses them), but entries may never be
// written underneath a symlink/file from the same archive.
export function validateOverlayEntries(entries) {
  const paths = new Map();
  for (const entry of entries) {
    safePath(entry.path);
    if (excluded.test(entry.path)) throw new Error('Overlay contains excluded VM mounts.');
    if (paths.has(entry.path)) throw new Error('Duplicate overlay path.');
    if (!['0', '1', '2', '5'].includes(entry.type)) throw new Error('Unsupported overlay entry.');
    paths.set(entry.path, entry);
  }
  for (const entry of entries) {
    const parts = entry.path.split('/');
    while (parts.pop(), parts.length) {
      const parent = paths.get(parts.join('/'));
      if (parent && parent.type !== '5') throw new Error('Overlay entry has a non-directory parent.');
    }
    if (entry.type === '1') {
      const target = paths.get(safePath(entry.linkname.replace(/^(\.\/)+/, '')));
      if (!target || target.type !== '0') throw new Error('Overlay has an unsupported hard link.');
    }
    if (entry.type === '2' && (!entry.linkname || /[\\\x00-\x1f\x7f]/.test(entry.linkname))) throw new Error('Invalid overlay symlink.');
  }
}
export async function captureOverlay(w, commit, uuid) {
  const files = new Map();
  const visit = async entry => { if (!excluded.test(entry.path)) files.set(entry.path, entry); };
  if (uuid) {
    const path = 'snapshot-storage/overlay';
    try { await w.stat(path); await walkWanix(w, path, visit, p => p !== '.apptron-overlay.json' && !excluded.test(p)); }
    catch (error) { if (!String(error.message).includes('not exist')) throw error; }
  }
  await walkWanix(w, '#scratch', visit, path => !excluded.test(path));
  const entries = [...files.values()];
  const manifest = { version: 1, commit, createdAt: new Date().toISOString(), fileCount: entries.length };
  entries.push({ path: '.apptron-overlay.json', data: bytes(JSON.stringify(manifest) + '\n'), type: '0' });
  return gzip(packTar(entries));
}
export async function walkWanix(w, root, visit, descend = () => true) {
  let count = 0, total = 0;
  async function walk(directory, relative = '') {
    for (const info of (await w.readDir(directory)) || []) {
      const name = info.replace(/\/$/, ''); const path = relative ? relative + '/' + name : name;
      if (!descend(path)) continue;
      if (++count > 30000) throw new Error('Capture has too many files.');
      const full = directory + '/' + name;
      const stat = await w.lstat(full);
      const mode = stat.Mode;
      // Wanix API exposes Go fs.FileMode, whose directory and symlink bits are high.
      const type = mode & 0x80000000 ? '5' : mode & 0x08000000 ? '2' : '0';
      if (type === '0') { total += stat.Size; if (total > 256 * 1024 * 1024) throw new Error('Capture exceeds 256 MiB unpacked.'); }
      const entry = { path, type, mode: mode & 0o7777, mtime: Math.floor(new Date(stat.ModTime).getTime() / 1000), size: stat.Size };
      if (type === '2') entry.linkname = await w.readlink(full);
      if (type === '0') entry.data = await w.readFile(full);
      await visit(entry);
      if (type === '5') await walk(full, path);
    }
  }
  await walk(root);
}
