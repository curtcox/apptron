import { safePath } from './snapshot.js';
export async function sha256(data) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('');
}
// Workers cannot use a script element's SRI attribute. Verify their imported
// runtime scripts in the service worker, against the same locked manifest.
export async function verifyRuntimeScript(request, response, scope, fetchFile = fetch) {
  const runtimeBase = new URL('runtime/', scope), url = new URL(request.url);
  if (!response.ok || url.origin !== runtimeBase.origin || !url.pathname.startsWith(runtimeBase.pathname) || !/\.(js|css)$/.test(url.pathname)) return response;
  const [commit, ...parts] = url.pathname.slice(runtimeBase.pathname.length).split('/');
  const name = safePath(decodeURIComponent(parts.join('/')));
  const lockResponse = await fetchFile(new URL('runtime.lock', scope), { cache: 'no-store' });
  if (!lockResponse.ok) throw new Error('Runtime lock is unavailable.');
  const lock = await lockResponse.json();
  if (commit !== lock.commit || !/^[a-f0-9]{64}$/.test(lock.manifestSha256 || '')) throw new Error('Runtime script is not locked.');
  const manifestResponse = await fetchFile(new URL(`runtime/${commit}/runtime.json`, scope), { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error('Runtime manifest is unavailable.');
  const manifestText = await manifestResponse.text();
  if (await sha256(new TextEncoder().encode(manifestText)) !== lock.manifestSha256) throw new Error('Runtime manifest checksum mismatch.');
  const manifest = JSON.parse(manifestText), expected = manifest.files[name];
  if (manifest.securityVersion !== 1 || manifest.commit !== commit || !expected || expected.size > 8 * 1024 * 1024) throw new Error('Unknown runtime script.');
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length !== expected.size || await sha256(data) !== expected.sha256) throw new Error('Runtime script checksum mismatch.');
  return new Response(data, { status: response.status, statusText: response.statusText, headers: response.headers });
}
