import { MAX_TEXT_BYTES, serializeSnapshot, decoder } from './snapshot.js';
export async function captureSnapshot(store, uuid, original) {
  const prefix = `env/${uuid}/project/`; const skipped = [], files = [];
  let size = new TextEncoder().encode(original.header).length + 1;
  for (const node of (await store.all()).filter(n => n.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path))) {
    if ((node.mode & 0o170000) === 0o40000) continue;
    const path = node.path.slice(prefix.length);
    if ((node.mode & 0o170000) === 0o120000) { skipped.push(path + ' (symlink)'); continue; }
    let binary = false; try { const text = decoder.decode(node.data); binary = text.includes('\0') || (text.length && !text.endsWith('\n')) || /^-- .+ --$/m.test(text); } catch { binary = true; }
    const cost = (binary ? Math.ceil(node.data.length / 3) * 4 + 1 : node.data.length) + new TextEncoder().encode(path).length + 24;
    if (size + cost > MAX_TEXT_BYTES) { skipped.push(path); continue; }
    size += cost; files.push({ path, data: node.data, binary });
  }
  return { source: serializeSnapshot({ ...original, files }), skipped };
}
