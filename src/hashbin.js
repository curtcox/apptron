import { decode64, cidLength, isCID, verifyCID } from './content-id.js';
import { parseSnapshot } from './snapshot.js';
import { readLimited } from './read-limited.js';
/** Adapted from curtcox/ManimOnline; see LICENSE-graphvizonline. */
const HashBinDocuments = {
  MAX_BYTES: 5 * 1024 * 1024,
  bytes(value) { return value instanceof Uint8Array ? value : new TextEncoder().encode(value); },
  decode64, cidLength, isCID,
  cid(input) {
    const text = input.trim().replace(/^#/, '');
    if (this.isCID(text)) return text;
    try {
      const url = new URL(text);
      if (url.protocol !== 'https:' || !['hashbin.org', '256t.us', 'curtcox.github.io'].includes(url.hostname)) return null;
      const candidate = url.hash.slice(1) || url.pathname.split('/').pop();
      return this.isCID(candidate) ? candidate : null;
    } catch (_) { return null; }
  },
  serialize({ src, type = 'apptron' }) {
    if (type !== 'apptron') throw new Error('Expected an Apptron snapshot.');
    parseSnapshot(src);
    const payload = JSON.stringify({ format: 'hashbin-diagram', version: 1, type: 'apptron', src });
    if (this.bytes(payload).length > this.MAX_BYTES) throw new Error('Source exceeds the 5 MiB HashBin limit.');
    return payload;
  },
  parse(text) {
    if (this.bytes(text).length > this.MAX_BYTES) throw new Error('Saved source exceeds the 5 MiB limit.');
    let doc;
    try { doc = JSON.parse(text); } catch { /* Plain txtar is supported. */ }
    let src = text;
    if (doc) {
      if (doc.format !== 'hashbin-diagram' || doc.version !== 1 || doc.type !== 'apptron' || typeof doc.src !== 'string') throw new Error('This HashBin document is not an Apptron v1 snapshot.');
      src = doc.src;
    }
    parseSnapshot(src);
    return { src, type: 'apptron' };
  },
  link(url, cid) {
    if (!this.isCID(cid)) throw new Error('HashBin returned an invalid CID.');
    const link = new URL(url);
    for (const key of ['example', 'raw', 'compressed', 'url', 'modlpos', 'code', 'state', 'error', 'error_description']) link.searchParams.delete(key);
    link.hash = cid;
    return link.href;
  }
};

/** Pinned so a later SDK change cannot reach this app; upgrade deliberately. */
const HASHBIN_SDK_URL = 'https://hashbin.org/sdk/v0.3.0/hashbin.js';
/** Above the SDK's fragment limit, a redirect save hands the document over as a downloaded file. */
const REDIRECT_BYTES = 512 * 1024;

/** Saves go through HashBin Publish, so this origin, which also runs untrusted VMs, never holds a HashBin credential. */
class HashBinStore {
  constructor({ clientId, redirectUri, storage, transactionStorage, fetchSource = (...args) => fetch(...args),
    loadSDK = () => import(HASHBIN_SDK_URL), timeout = 20000, timers = globalThis } = {}) {
    Object.assign(this, { clientId, redirectUri, storage, transactionStorage, fetchSource, loadSDK, timeout, timers });
  }
  async bounded(work) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(() => work(controller.signal)), new Promise((_, reject) => {
        timer = this.timers.setTimeout(() => { controller.abort(); reject(new Error('HashBin request timed out. Try again.')); }, this.timeout);
      })]);
    } finally { this.timers.clearTimeout(timer); }
  }
  async load(cid) {
    if (!HashBinDocuments.isCID(cid)) throw new Error('Enter a valid HashBin CID or saved link.');
    if (HashBinDocuments.cidLength(cid) > HashBinDocuments.MAX_BYTES) throw new Error('Saved source exceeds the 5 MiB limit.');
    return this.bounded(async signal => {
      if (HashBinDocuments.cidLength(cid) <= 64) return HashBinDocuments.parse(new TextDecoder('utf-8', { fatal: true }).decode(HashBinDocuments.decode64(cid.slice(8))));
      const response = await this.fetchSource(`https://256t.us/${cid}`, { signal });
      if (!response.ok) throw new Error(response.status === 404 ? 'Saved source was not found. It may have expired or been deleted.' : `HashBin load failed (HTTP ${response.status}).`);
      const data = await readLimited(response, HashBinDocuments.MAX_BYTES);
      await verifyCID(cid, data);
      return HashBinDocuments.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    });
  }
  async init() {
    if (this.client) return this.client;
    if (!this.clientId) throw new Error('HashBin saving needs a registered client ID.');
    if (!this.initializing) this.initializing = this.bounded(async () => {
      const { HashBinClient } = await this.loadSDK();
      this.client = new HashBinClient({ clientId: this.clientId, redirectUri: this.redirectUri,
        baseUrl: 'https://hashbin.org', contentBaseUrl: 'https://256t.us', storage: this.storage, transactionStorage: this.transactionStorage,
        fetch: this.fetchSource });
      return this.client;
    }).finally(() => { this.initializing = null; });
    return this.initializing;
  }
  /** The isolation headers (COOP same-origin) sever a popup's opener, so an isolated editor saves through a redirect. */
  get redirectOnly() { return Boolean(globalThis.crossOriginIsolated); }
  /** Call synchronously from a click after init(), so a popup is allowed. A blocked popup redirects. */
  publish(payload, snapshot, overlay = false) {
    if (!this.client) return Promise.reject(new Error('HashBin is still loading. Try again.'));
    const bytes = HashBinDocuments.bytes(payload);
    return this.client.publish(bytes, { mode: this.redirectOnly ? 'redirect' : 'popup', contentType: overlay ? 'application/gzip' : 'application/json', clientState: { snapshot, overlay }, fileName: overlay ? 'apptron-overlay.gz' : 'apptron-snapshot.json' }).then(async result => {
      if (result.redirected) return result;
      if (!HashBinDocuments.isCID(result.cid)) throw new Error('HashBin returned an invalid CID.');
      await verifyCID(result.cid, bytes);
      return result;
    }, error => { throw new Error(this.message(error)); });
  }
  message(error) {
    if (error.message === 'access_denied') return 'The save was cancelled on HashBin.';
    if (error.message === 'Publish window closed.') return 'The HashBin window was closed before the save was approved.';
    return error.message;
  }
  /** Completes a redirect save; the SDK verifies the CID. Cancelled and failed saves still return the snapshot (SDK v0.3.0). */
  async published(hash) {
    if (!new URLSearchParams(hash.replace(/^#/, '')).has('hashbin_publish')) return null;
    try {
      const { cid, clientState } = await (await this.init()).handlePublishCallback({ hash });
      return { cid, snapshot: clientState?.snapshot, overlay: Boolean(clientState?.overlay) };
    } catch (error) { return { error: this.message(error), snapshot: error.clientState?.snapshot, overlay: Boolean(error.clientState?.overlay) }; }
  }
  /** Tokens from an earlier OAuth flow are revoked server-side; clearing alone leaves copies valid. */
  async retireLegacyTokens() {
    if (!this.clientId || !this.storage?.getItem(`hashbin:tokens:${this.clientId}`)) return false;
    await this.bounded(async () => (await this.init()).disconnect());
    return true;
  }
}
export { HashBinDocuments, HashBinStore, REDIRECT_BYTES };

