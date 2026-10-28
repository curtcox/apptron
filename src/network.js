const key = 'apptron:relay';
export function validateRelay(value, protocol = globalThis.location?.protocol || 'https:') {
  const text = value.trim(); if (!text) return '';
  let url; try { url = new URL(text); } catch { throw new Error('Enter a ws:// or wss:// relay URL.'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Enter a ws:// or wss:// relay URL without credentials or a fragment.');
  if (protocol === 'https:' && url.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('An HTTPS page needs a wss:// relay, except on localhost.');
  return url.href;
}
export function getRelay() { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
export function setRelay(value) {
  const relay = validateRelay(value);
  try { if (relay) localStorage.setItem(key, relay); else localStorage.removeItem(key); } catch { throw new Error('Browser storage is unavailable.'); }
  return relay;
}

// Only this in-memory broker can mint grants. A saved relay is configuration,
// never permission; consent binds to exact source, runtime and destination.
export class NetworkGrants {
  #grants = new Map();
  request(source, runtime, value, confirm) {
    const relay = validateRelay(value);
    if (!relay) return null;
    for (const [token, grant] of this.#grants) {
      if (grant.source === source && grant.runtime === runtime && grant.relay === relay) return token;
    }
    if (confirm(relay) !== true) throw new Error('Network permission declined. VM was not started.');
    if (this.#grants.size >= 16) this.#grants.delete(this.#grants.keys().next().value);
    const token = Object.freeze({});
    this.#grants.set(token, { source, runtime, relay });
    return token;
  }
  resolve(token, source, runtime) {
    if (token === null) return '';
    const grant = this.#grants.get(token);
    if (!grant || grant.source !== source || grant.runtime !== runtime) throw new Error('Network grant is missing, revoked or belongs to another snapshot.');
    return grant.relay;
  }
  revoke() { this.#grants.clear(); }
}
