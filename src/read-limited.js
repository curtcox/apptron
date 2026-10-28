export async function readLimited(response, limit, progress = () => {}) {
  if (Number(response.headers.get('Content-Length')) > limit) throw new Error('Download exceeds its size limit.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('Download exceeds its size limit.'); chunks.push(value); progress(size); } }
  finally { await reader.cancel(); }
  const data = new Uint8Array(size); let at = 0; for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; } return data;
}
