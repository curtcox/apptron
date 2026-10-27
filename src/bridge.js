// The bridge deliberately has no arbitrary property, filesystem or eval command.
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validSession = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
export function validMessage(data, session) {
  return isRecord(data) && data.session === session && typeof data.type === 'string';
}
export function validBoot(data) {
  return isRecord(data) && validSession(data.session) && data.type === 'apptron-boot' &&
    /^[a-f0-9]{64}$/.test(data.uuid) && typeof data.user === 'string' && /^[\w-]{1,160}$/.test(data.user) &&
    typeof data.runtime === 'string' && typeof data.relay === 'string' && isRecord(data.manifest) &&
    ['run', 'reset'].includes(data.action) && typeof data.source === 'string' && data.source.length <= 1024 * 1024 &&
    (!data.overlayData || data.overlayData instanceof Uint8Array && data.overlayData.length <= 128 * 1024 * 1024) &&
    /^[a-f0-9]{64}$/.test(data.manifestSha256 || '') && data.manifest.securityVersion === 1 && /^[a-f0-9]{40}$/.test(data.manifest.commit) && isRecord(data.manifest.files);
}
export function validCommand(data) {
  if (!Number.isSafeInteger(data.id) || data.id < 1) return false;
  return data.type === 'apptron-resize' || data.type === 'apptron-capture-overlay' || data.type === 'apptron-capture-snapshot' ||
    data.type === 'apptron-key' && typeof data.value === 'string' && data.value.length <= 4096;
}
