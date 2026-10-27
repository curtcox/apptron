const key = 'apptron:relay';
// A session grant is never restored from persistent origin storage.
let approvedRelay = '';
export function validateRelay(value, protocol = location.protocol) {
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
  approvedRelay = relay;
  return relay;
}

export function approveRelay(confirmChange) {
  const relay = validateRelay(getRelay());
  if (relay !== approvedRelay && relay && !confirmChange(relay)) throw new Error('Network permission declined. VM was not started.');
  approvedRelay = relay;
  return relay;
}
