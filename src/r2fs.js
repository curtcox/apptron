import { makeNode, isDirectory } from './store.js';
import { safePath, bytes } from './snapshot.js';
import { unpackTar } from './tar.js';
const METHODS = 'GET, HEAD, PUT, PATCH, DELETE, MOVE, COPY, OPTIONS';
const metadataNames = ['Content-Mode', 'Content-Modified', 'Change-Timestamp', 'Content-Ownership'];
const within = (path, root) => path === root || path.startsWith(root + '/');
function pathIn(url, base) {
  if (!url.pathname.startsWith(base)) throw new Error('Invalid data path.');
  return safePath(decodeURIComponent(url.pathname.slice(base.length)).replace(/\/$/, ''));
}
export async function handleDataRequest(request, store, base = '/data/') {
  try {
    const url = new URL(request.url); let index = false;
    if (url.pathname.endsWith('/...') || url.pathname.endsWith('/:')) { index = true; url.pathname = url.pathname.replace(/\/(\.\.\.|:)$/, ''); }
    let path = pathIn(url, base);
    if (!/^(env\/[a-f0-9]{64}\/(project|public)|usr\/[\w-]+)(\/|$)/.test(path)) return new Response('Unknown snapshot mount.', { status: 404 });
    const mount = path.startsWith('env/') ? path.split('/').slice(0, 3).join('/') : path.split('/').slice(0, 2).join('/');
    let attr;
    if (path.includes('/:attr')) [path, attr = ''] = path.split('/:attr/');
    if (path.endsWith('/:attr')) { path = path.slice(0, -6); attr = ''; }
    const all = await store.all(); const map = new Map(all.map(n => [n.path, n])); let node = map.get(path);
    const descendants = root => all.filter(n => n.path.startsWith(root + '/'));
    const listing = root => all.filter(n => n.path.startsWith(root + '/') && !n.path.slice(root.length + 1).includes('/')).sort((a, b) => a.path.localeCompare(b.path)).map(n => `${n.path.slice(root.length + 1)} ${n.mode}\n`).join('');
    const headersFor = (n, empty = false) => {
      const headers = new Headers({ 'Content-Type': isDirectory(n) ? 'application/x-directory' : (n.mode & 0o170000) === 0o120000 ? 'application/x-symlink' : 'application/octet-stream',
        'Content-Location': base + n.path.split('/').map(encodeURIComponent).join('/'), 'Content-Mode': String(n.mode), 'Content-Modified': String(n.mtime), 'Change-Timestamp': String(n.changed), 'Content-Ownership': '0:0', 'Cache-Control': 'no-store', ETag: `"${n.changed}-${n.data.length}"` });
      const size = isDirectory(n) ? bytes(listing(n.path)).length : n.data.length;
      headers.set(empty ? 'Content-Range' : 'Content-Length', empty ? `bytes 0-0/${size}` : String(size));
      for (const [key, value] of Object.entries(n.attrs || {})) headers.set('Attribute-' + key, value);
      return headers;
    };
    const applyHeaders = (n, headers) => {
      for (const key of metadataNames) if (headers.has(key)) {
        const value = headers.get(key);
        if (key === 'Content-Mode') n.mode = Number(value);
        if (key === 'Content-Modified') n.mtime = Number(value);
        if (key === 'Change-Timestamp') n.changed = Number(value);
      }
      if (!Number.isFinite(n.mode) || !Number.isFinite(n.mtime) || !Number.isFinite(n.changed)) throw new Error('Invalid file metadata.');
      headers.forEach((value, key) => { if (key.startsWith('attribute-')) n.attrs[key.slice(10)] = value; });
      return n;
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: { Allow: METHODS } });
    if (['GET', 'HEAD', 'DELETE', 'MOVE', 'COPY'].includes(request.method) && !node) return new Response('Object not found.', { status: 404 });
    if (request.headers.has('If-Match') && node && request.headers.get('If-Match') !== headersFor(node).get('ETag')) return new Response(null, { status: 412 });
    if (request.headers.get('If-None-Match') === '*' && node) return new Response(null, { status: 412 });
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (attr !== undefined) {
        if (attr && !Object.hasOwn(node.attrs, attr)) return new Response(null, { status: 404 });
        return new Response(request.method === 'HEAD' ? null : attr ? node.attrs[attr] + '\n' : Object.keys(node.attrs).map(k => `${k} 33188\n`).join(''), { headers: { 'Content-Type': attr ? 'text/plain' : 'application/x-directory' } });
      }
      if (isDirectory(node) && (index || request.headers.get('Accept')?.includes('multipart/mixed'))) {
        const boundary = 'apptron-entry';
        const nodes = [node, ...descendants(path).filter(n => index || !n.path.slice(path.length + 1).includes('/'))];
        let body = '';
        for (const n of nodes) {
          const headers = headersFor(n, !isDirectory(n));
          body += `--${boundary}\r\n` + [...headers].map(([k, v]) => `${k}: ${v}\r\n`).join('') + '\r\n' + (isDirectory(n) ? listing(n.path) : '') + '\r\n';
        }
        body += `--${boundary}--\r\n`;
        return new Response(request.method === 'HEAD' ? null : body, { headers: { 'Content-Type': `multipart/mixed; boundary=${boundary}` } });
      }
      const headers = headersFor(node);
      let body = isDirectory(node) ? bytes(listing(path)) : node.data;
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') || '');
      if (range && !isDirectory(node)) {
        const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        if (start > end) return new Response(null, { status: 416 });
        headers.set('Content-Range', `bytes ${start}-${end}/${body.length}`); body = body.slice(start, end + 1); headers.set('Content-Length', String(body.length));
      }
      return new Response(request.method === 'HEAD' ? null : body, { status: range ? 206 : 200, headers });
    }
    const puts = [], deletes = [];
    if (request.method === 'PUT') {
      if (attr !== undefined) {
        if (!node || !attr) return new Response(null, { status: 404 });
        node.attrs[attr] = (await request.text()).replace(/\n+$/, ''); node.changed = Date.now() * 1000; puts.push(node);
      } else {
        const data = new Uint8Array(await request.arrayBuffer());
        if (data.length > 5 * 1024 * 1024) return new Response('File exceeds 5 MiB.', { status: 413 });
        let mode = node?.mode ?? 0o100644;
        if (new URL(request.url).pathname.endsWith('/') || request.headers.get('Content-Type') === 'application/x-directory') mode = 0o40755;
        if (request.headers.get('Content-Type') === 'application/x-symlink') mode = 0o120777;
        puts.push(applyHeaders(makeNode(path, data, mode), request.headers));
      }
    } else if (request.method === 'PATCH') {
      if (request.headers.get('Content-Type')?.includes('application/x-tar')) {
        const entries = unpackTar(await request.arrayBuffer());
        for (const entry of entries) {
          const target = path + '/' + entry.path;
          if (!within(target, mount)) throw new Error('Invalid tar destination.');
          if (entry.deleted) deletes.push(target, ...descendants(target).map(n => n.path));
          else puts.push(makeNode(target, entry.type === '2' ? entry.linkname : entry.data, (entry.type === '5' ? 0o40000 : entry.type === '2' ? 0o120000 : 0o100000) | entry.mode, entry.mtime));
        }
      } else {
        if (!node) return new Response(null, { status: 404 });
        puts.push(applyHeaders(node, request.headers));
      }
    } else if (request.method === 'DELETE') {
      if (attr) { delete node.attrs[attr]; puts.push(node); }
      else deletes.push(path, ...descendants(path).map(n => n.path));
    } else if (request.method === 'MOVE' || request.method === 'COPY') {
      const destination = request.headers.get('Destination');
      if (!destination) throw new Error('Missing Destination header.');
      const destURL = new URL(destination, request.url);
      if (destURL.origin !== url.origin) throw new Error('Invalid Destination origin.');
      const dest = pathIn(destURL, base);
      if (!within(dest, mount) || dest === path || dest.startsWith(path + '/') || dest === mount) throw new Error('Invalid Destination path.');
      if (map.has(dest) && request.headers.get('Overwrite')?.toLowerCase() === 'f') return new Response(null, { status: 412 });
      deletes.push(dest, ...descendants(dest).map(n => n.path));
      for (const n of [node, ...descendants(path)]) {
        puts.push({ ...n, path: dest + n.path.slice(path.length), changed: Date.now() * 1000 });
        if (request.method === 'MOVE') deletes.push(n.path);
      }
    } else return new Response('Method not allowed.', { status: 405, headers: { Allow: METHODS } });
    // Ensure parents exist, as the bucket API does for project imports.
    for (const n of [...puts]) {
      let parent = n.path.slice(0, n.path.lastIndexOf('/'));
      while (within(parent, mount)) {
        if (!map.has(parent) && !puts.some(p => p.path === parent)) puts.push(makeNode(parent, '', 0o40755));
        if (parent === mount) break;
        parent = parent.slice(0, parent.lastIndexOf('/'));
      }
    }
    await store.batch(puts, deletes);
    return new Response('OK\n');
  } catch (error) { return new Response(error.message, { status: error.name === 'QuotaExceededError' ? 507 : 400 }); }
}
