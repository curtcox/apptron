export const MAX_TEXT_BYTES = 1024 * 1024;
export const encoder = new TextEncoder();
export const decoder = new TextDecoder('utf-8', { fatal: true });
export const bytes = value => typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
export function safePath(path) {
  if (!path || path.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Unsafe file path: ${path}`);
  return path;
}
export function toBase64(data) {
  let text = '';
  for (let i = 0; i < data.length; i += 8192) text += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(text);
}
export function fromBase64(text) {
  const value = text.replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid base64 file.');
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
export function parseSnapshot(source) {
  if (typeof source !== 'string' || bytes(source).length > MAX_TEXT_BYTES) throw new Error('Snapshot exceeds the 1 MiB text limit.');
  source = source.replace(/\r\n/g, '\n');
  if (!/^# apptron snapshot v1(?:\n|$)/.test(source)) throw new Error('Expected # apptron snapshot v1.');
  const matches = [...source.matchAll(/^-- (.+?) --\n?/gm)];
  const header = source.slice(0, matches[0]?.index ?? source.length).replace(/\n+$/, '');
  const metadata = Object.create(null);
  for (const line of header.split('\n').slice(1)) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (match) metadata[match[1]] = match[2];
  }
  if (metadata.overlay && !/^gallery\/[a-z0-9-]+$/.test(metadata.overlay) && !/^[\w-]{8,94}$/.test(metadata.overlay)) throw new Error('Overlay must be gallery/<name> or a HashBin CID.');
  const seen = new Set();
  const files = matches.map((match, i) => {
    const binary = match[1].endsWith(' (base64)');
    const path = safePath(binary ? match[1].slice(0, -9) : match[1]);
    if (seen.has(path)) throw new Error(`Duplicate file: ${path}`);
    seen.add(path);
    const content = source.slice(match.index + match[0].length, matches[i + 1]?.index ?? source.length);
    return { path, data: binary ? fromBase64(content) : bytes(content), binary };
  });
  for (const path of seen) {
    const parts = path.split('/');
    while (parts.pop(), parts.length) if (seen.has(parts.join('/'))) throw new Error('A file cannot also be a directory.');
  }
  return { header, metadata, files };
}
export function serializeSnapshot(snapshot) {
  let source = (snapshot.header || '# apptron snapshot v1').replace(/\n+$/, '') + '\n';
  const sorted = [...snapshot.files].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of sorted) {
    safePath(file.path);
    const data = bytes(file.data);
    let text;
    try { text = decoder.decode(data); } catch { /* Preserve arbitrary binary bytes. */ }
    const binary = file.binary || file.path.endsWith(' (base64)') || text === undefined || text.includes('\0') || (text.length && !text.endsWith('\n')) || /^-- .+ --$/m.test(text);
    source += `-- ${file.path}${binary ? ' (base64)' : ''} --\n${binary ? toBase64(data) + '\n' : text}`;
  }
  parseSnapshot(source);
  return source;
}
export async function snapshotUUID(source, commit = '') {
  parseSnapshot(source);
  const hash = await crypto.subtle.digest('SHA-256', bytes(commit + '\0' + source));
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}
