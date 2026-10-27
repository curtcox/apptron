import { parseSnapshot } from './snapshot.js';
const kinds = new Set(['local', 'share', 'hashbin', 'example', 'stored']);
export function provenance(kind = 'local', detail = '') {
  return { kind: kinds.has(kind) ? kind : 'stored', detail: typeof detail === 'string' ? detail.slice(0, 128) : '' };
}
export function readDraft(value) {
  if (!value) return null;
  try {
    const draft = JSON.parse(value);
    if (draft.version !== 1 || typeof draft.source !== 'string') throw new Error('Invalid draft.');
    parseSnapshot(draft.source);
    return { source: draft.source, provenance: provenance(draft.provenance?.kind, draft.provenance?.detail) };
  } catch {
    // Old plain-text drafts have no trustworthy origin information.
    try { parseSnapshot(value); return { source: value, provenance: provenance('stored') }; } catch { return null; }
  }
}
export function writeDraft(source, origin) {
  parseSnapshot(source);
  return JSON.stringify({ version: 1, source, provenance: provenance(origin.kind, origin.detail) });
}
export function provenanceLabel(origin) {
  const names = { local: 'Local edits · untrusted', share: 'Shared link · untrusted', hashbin: 'HashBin · untrusted', example: 'Gallery example', stored: 'Restored draft · untrusted' };
  return names[origin.kind] || names.stored;
}
