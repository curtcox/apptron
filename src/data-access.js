import { openDatabase, requestResult, transactionDone } from './store.js';
import { validSession } from './bridge.js';
export function dataRoots(uuid, user) {
  if (typeof uuid !== 'string' || !/^[a-f0-9]{64}$/.test(uuid) || typeof user !== 'string' || !/^[\w-]{1,160}$/.test(user)) throw new Error('Invalid data grant.');
  return [`env/${uuid}/project`, `env/${uuid}/public`, `usr/${user}`];
}
export class DataGrants {
  async db() { return this.connection ||= await openDatabase('apptron-data-grants', 1, db => db.createObjectStore('grants', { keyPath: 'session' })); }
  async grant(session, uuid, user, clientId) {
    if (!validSession(session)) throw new Error('Invalid data session.');
    const roots = dataRoots(uuid, user), db = await this.db();
    const tx = db.transaction('grants', 'readwrite'), done = transactionDone(tx), records = tx.objectStore('grants');
    let denial;
    const request = records.get(session);
    request.onsuccess = () => {
      const previous = request.result;
      if (previous && (previous.revoked || previous.clientId !== clientId || JSON.stringify(previous.roots) !== JSON.stringify(roots))) {
        denial = new Error('Data session cannot be reassigned.'); tx.abort(); return;
      }
      records.put({ session, roots, clientId, expires: Date.now() + 24 * 60 * 60 * 1000 });
    };
    try { await done; } catch (error) { throw denial || error; }
  }
  async get(session, clientId) {
    if (!validSession(session)) return null;
    const db = await this.db(), grant = await requestResult(db.transaction('grants').objectStore('grants').get(session));
    return grant && !grant.revoked && (clientId === undefined || grant.clientId === clientId) && grant.expires > Date.now() ? grant.roots : null;
  }
  async revoke(session, clientId) {
    if (!validSession(session)) throw new Error('Invalid data session.');
    const db = await this.db(), tx = db.transaction('grants', 'readwrite'), done = transactionDone(tx), records = tx.objectStore('grants');
    let denial;
    const request = records.get(session);
    request.onsuccess = () => {
      if (clientId !== undefined && request.result?.clientId && request.result.clientId !== clientId) { denial = new Error('Cannot revoke another document’s grant.'); tx.abort(); return; }
      records.put({ session, clientId, revoked: true, expires: Date.now() + 24 * 60 * 60 * 1000 });
    };
    try { await done; } catch (error) { throw denial || error; }
  }
}
