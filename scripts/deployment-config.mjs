import { validateDeployment } from '../src/deployment.js';
export function configuration({ role = 'editor', vmURL = '', editorOrigin = '', authURL = '' } = {}) {
  if (vmURL && !editorOrigin) throw new Error('Supply the editor origin when configuring a VM deployment.');
  const page = role === 'vm' ? vmURL : (editorOrigin ? new URL('index.html', editorOrigin).href : 'https://editor.invalid/index.html');
  const validated = validateDeployment({ role, vmURL, editorOrigin, authURL }, page);
  return { role, vmURL: vmURL ? validated.vmURL : '', editorOrigin: editorOrigin ? new URL(editorOrigin).origin : '', authURL: '' };
}
export const configurationScript = config => `globalThis.APPTRON_DEPLOYMENT = Object.freeze(${JSON.stringify(config).replace(/</g, '\\u003c')});\n`;
export function vmHeaders(editorOrigin, vmURL) {
  const origin = new URL(editorOrigin).origin;
  const path = vmURL ? new URL(vmURL).pathname : '/vm.html';
  return `/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n  Cross-Origin-Resource-Policy: cross-origin\n  Permissions-Policy: cross-origin-isolated=(self "${origin}")\n  X-Content-Type-Options: nosniff\n\n${path}\n  Content-Security-Policy: frame-ancestors ${origin}\n`;
}
