// Apptron’s pinned Wanix IDBFS v2 schema. Used only before starting a VM.
import { openDatabase, transactionDone, requestResult } from './store.js';
import { validateOverlayEntries } from './overlay.js';
import { bytes } from './snapshot.js';
export class WanixDisk {
  async db() {
    return this.connection ||= await openDatabase('apptron-rev1', 2, db => {
      const meta = db.createObjectStore('metadata', { keyPath: 'path' });
      meta.createIndex('parent', 'parent'); meta.createIndex('type', 'type'); meta.createIndex('parent_type', ['parent', 'type']);
      db.createObjectStore('data', { keyPath: 'path' });
    });
  }
  async clear(roots) {
    const db = await this.db(); const nodes = await requestResult(db.transaction('metadata').objectStore('metadata').getAll());
    const tx = db.transaction(['metadata', 'data'], 'readwrite'); const done = transactionDone(tx);
    for (const n of nodes) if (roots.some(r => n.path === r || n.path.startsWith(r + '/'))) {
      tx.objectStore('metadata').delete(n.path); tx.objectStore('data').delete(n.path);
    }
    await done;
  }
  async restore(uuid, entries) {
    if (!/^[a-f0-9]{64}$/.test(uuid)) throw new Error('Invalid snapshot identity.');
    validateOverlayEntries(entries);
    const prefix = `env/${uuid}/overlay`;
    await this.clear([prefix]);
    const db = await this.db(); const tx = db.transaction(['metadata', 'data'], 'readwrite'); const done = transactionDone(tx);
    const records = new Map();
    const add = (path, type = 'dir', mode = 0o40755, data = new Uint8Array(), mtime = Math.floor(Date.now() / 1000)) => {
      records.set(path, { path, parent: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.', type, mode, size: data.length, mtime, atime: mtime, dataExternal: data.length >= 4096, data: data.length >= 4096 ? null : data });
      if (data.length >= 4096) tx.objectStore('data').put({ path, data });
    };
    for (const p of ['.', 'env', `env/${uuid}`, prefix]) add(p);
    const byPath = new Map(entries.map(e => [e.path, e]));
    for (let e of entries) {
      if (e.path === '.apptron-overlay.json') continue;
      if (e.type === '1') {
        const target = byPath.get(e.linkname.replace(/^(\.\/)+/, ''));
        if (!target || target.type !== '0') throw new Error('Overlay has an unsupported hard link.');
        e = { ...target, path: e.path };
      }
      const path = prefix + '/' + e.path;
      const parts = path.split('/'); parts.pop(); let parent = '';
      for (const part of parts) { parent = parent ? parent + '/' + part : part; if (!records.has(parent)) add(parent); }
      const type = e.type === '5' ? 'dir' : e.type === '2' ? 'symlink' : 'file';
      add(path, type, (type === 'dir' ? 0o40000 : type === 'symlink' ? 0o120000 : 0o100000) | (e.mode & 0o7777), e.type === '2' ? bytes(e.linkname) : e.data, e.mtime);
    }
    for (const record of records.values()) tx.objectStore('metadata').put(record);
    await done;
  }
  close() { this.connection?.close(); this.connection = null; }
}
