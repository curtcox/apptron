import { bytes, safePath } from './snapshot.js';
const decode = data => new TextDecoder().decode(data).replace(/\0.*$/s, '');
const number = data => parseInt(decode(data).trim() || '0', 8);
export function packTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const path = safePath(entry.path);
    const header = new Uint8Array(512);
    const put = (start, length, text) => {
      const data = bytes(text);
      if (data.length > length) throw new Error(`Tar field is too long: ${path}`);
      header.set(data, start);
    };
    let name = path, prefix = '';
    if (bytes(name).length > 100) {
      let at = path.lastIndexOf('/');
      while (at > 0 && bytes(path.slice(at + 1)).length > 100) at = path.lastIndexOf('/', at - 1);
      if (at <= 0) throw new Error(`Tar path is too long: ${path}`);
      prefix = path.slice(0, at); name = path.slice(at + 1);
    }
    const data = entry.type === '5' || entry.type === '2' || entry.type === '1' ? new Uint8Array() : bytes(entry.data || '');
    const oct = (value, length) => Math.floor(value).toString(8).padStart(length - 1, '0') + '\0';
    put(0, 100, name); put(100, 8, oct(entry.mode ?? (entry.type === '5' ? 0o755 : 0o644), 8));
    put(108, 8, oct(0, 8)); put(116, 8, oct(0, 8)); put(124, 12, oct(data.length, 12));
    put(136, 12, oct(entry.mtime ?? Date.now() / 1000, 12));
    header.fill(32, 148, 156); put(156, 1, entry.type || '0'); put(157, 100, entry.linkname || '');
    put(257, 6, 'ustar\0'); put(263, 2, '00'); put(345, 155, prefix);
    put(148, 8, header.reduce((n, b) => n + b, 0).toString(8).padStart(6, '0') + '\0 ');
    chunks.push(header, data, new Uint8Array((512 - data.length % 512) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const output = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
export function unpackTar(input, { maxBytes = 256 * 1024 * 1024, maxFiles = 30000 } = {}) {
  const data = bytes(input);
  if (data.length > maxBytes) throw new Error('Unpacked archive exceeds its size limit.');
  const entries = []; let pax = {}, globalPax = {};
  for (let offset = 0; offset + 512 <= data.length;) {
    const h = data.subarray(offset, offset + 512);
    if (h.every(n => n === 0)) return entries;
    const checksum = h.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0);
    if (checksum !== number(h.subarray(148, 156))) throw new Error('Invalid tar checksum.');
    const size = number(h.subarray(124, 136));
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > data.length) throw new Error('Truncated tar archive.');
    const body = data.slice(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = decode(h.subarray(156, 157)) || '0';
    if (type === 'x' || type === 'g') {
      const attrs = {};
      for (let p = 0; p < body.length;) {
        const space = body.indexOf(32, p); const length = Number(decode(body.subarray(p, space)));
        if (space < 0 || length <= 0 || p + length > body.length) throw new Error('Invalid PAX header.');
        const line = decode(body.subarray(space + 1, p + length - 1)); const eq = line.indexOf('=');
        attrs[line.slice(0, eq)] = line.slice(eq + 1); p += length;
      }
      if (type === 'g') globalPax = { ...globalPax, ...attrs }; else pax = attrs;
      continue;
    }
    const attrs = { ...globalPax, ...pax }; pax = {};
    let path = attrs.path || [decode(h.subarray(345, 500)), decode(h.subarray(0, 100))].filter(Boolean).join('/');
    path = path.replace(/^(\.\/)+/, '').replace(/\/$/, '');
    if (!path || path === '.') continue;
    safePath(path);
    if (!['0', '1', '2', '5'].includes(type)) throw new Error(`Unsupported tar entry type: ${type}`);
    entries.push({ path, type, data: body, mode: number(h.subarray(100, 108)), mtime: Number(attrs.mtime ?? number(h.subarray(136, 148))), linkname: attrs.linkpath || decode(h.subarray(157, 257)), deleted: Object.hasOwn(attrs, 'delete') });
    if (entries.length > maxFiles) throw new Error('Archive has too many files.');
  }
  throw new Error('Truncated tar archive.');
}
export async function gzip(data) {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
export async function gunzip(data, maxBytes = 256 * 1024 * 1024) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error('Unpacked archive exceeds its size limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const result = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
  return result;
}
