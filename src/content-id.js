// HashBin CID: six-byte big-endian length, then inline bytes (<=64) or SHA-512.
// Keep this independent of the host/OAuth modules to avoid circular imports.
export function decode64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
const encode64 = data => btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function cidLength(cid) { return decode64(cid.slice(0, 8)).reduce((n, b) => n * 256 + b, 0); }
export function isCID(cid) {
  if (typeof cid !== 'string' || !/^[A-Za-z0-9_-]{8,94}$/.test(cid)) return false;
  try {
    const size = cidLength(cid), rest = cid.slice(8);
    return cid.length === 8 + (size <= 64 ? Math.ceil(size * 4 / 3) : 86) && encode64(decode64(rest)) === rest;
  } catch { return false; }
}
export async function verifyCID(cid, data) {
  if (!isCID(cid) || cidLength(cid) !== data.length) throw new Error('HashBin content does not match its CID.');
  const content = data.length <= 64 ? data : new Uint8Array(await crypto.subtle.digest('SHA-512', data));
  if (encode64(content) !== cid.slice(8)) throw new Error('HashBin content does not match its CID.');
}
