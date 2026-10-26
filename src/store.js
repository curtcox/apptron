import { bytes } from './snapshot.js';
export const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
export const transactionDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('Storage transaction failed.'));
});
export function openDatabase(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Apptron tabs to upgrade browser storage.'));
  });
}
export class SnapshotStore {
  constructor(name = 'apptron-online-v1') { this.name = name; }
  async db() { return this.connection ||= await openDatabase(this.name, 1, db => db.createObjectStore('nodes', { keyPath: 'path' })); }
  async all() { const db = await this.db(); return requestResult(db.transaction('nodes').objectStore('nodes').getAll()); }
  async get(path) { const db = await this.db(); return requestResult(db.transaction('nodes').objectStore('nodes').get(path)); }
  async batch(puts = [], deletes = []) {
    const db = await this.db(); const tx = db.transaction('nodes', 'readwrite'); const done = transactionDone(tx); const store = tx.objectStore('nodes');
    for (const path of deletes) store.delete(path);
    for (const node of puts) store.put(node);
    await done;
  }
  async seed(uuid, user, snapshot) {
    const root = `env/${uuid}/project`;
    if (await this.get(root)) return;
    const nodes = new Map();
    const addDir = path => { if (!nodes.has(path)) nodes.set(path, makeNode(path, '', 0o40755)); };
    for (const path of ['env', `env/${uuid}`, root, `env/${uuid}/public`, 'usr', `usr/${user}`]) addDir(path);
    for (const file of snapshot.files) {
      const parts = `${root}/${file.path}`.split('/'); let parent = parts.shift();
      for (const part of parts.slice(0, -1)) { parent += '/' + part; addDir(parent); }
      nodes.set(`${root}/${file.path}`, makeNode(`${root}/${file.path}`, file.data));
    }
    await this.batch([...nodes.values()]);
  }
  async clear(uuid, user) {
    const roots = [`env/${uuid}`, `usr/${user}`];
    await this.batch([], (await this.all()).filter(n => roots.some(r => n.path === r || n.path.startsWith(r + '/'))).map(n => n.path));
  }
}
export function makeNode(path, data = '', mode = 0o100644, mtime = Math.floor(Date.now() / 1000)) {
  return { path, data: bytes(data), mode, mtime, changed: Date.now() * 1000, attrs: {} };
}
export const isDirectory = node => (node.mode & 0o170000) === 0o40000;
