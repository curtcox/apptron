const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
export function deploymentURL(value, label) {
  let url; try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute HTTPS URL.`); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error(`${label} must use HTTPS (or HTTP on loopback), without credentials, query or fragment.`);
  return url;
}
export function validateDeployment(value = {}, pageURL) {
  const page = new URL(pageURL), role = value.role || 'editor';
  if (!['editor', 'vm'].includes(role)) throw new Error('Unknown deployment role.');
  const vm = value.vmURL ? deploymentURL(value.vmURL, 'VM URL') : new URL('vm.html', page);
  if (!vm.pathname.endsWith('/vm.html')) throw new Error('VM URL must name vm.html.');
  if (role === 'editor' && value.vmURL && vm.origin === page.origin) throw new Error('The VM must use a separate origin, not another path.');
  if (value.editorOrigin && deploymentURL(value.editorOrigin, 'Editor origin').pathname !== '/') throw new Error('Editor origin must not include a path.');
  let editorOrigin = page.origin;
  if (role === 'editor' && value.editorOrigin && deploymentURL(value.editorOrigin, 'Editor origin').origin !== page.origin) throw new Error('Editor deployment is served from the wrong origin.');
  if (role === 'vm') {
    const editor = deploymentURL(value.editorOrigin, 'Editor origin');
    if (editor.pathname !== '/') throw new Error('Editor origin must not include a path.');
    editorOrigin = editor.origin;
    if (editorOrigin === page.origin) throw new Error('The VM editor must use a separate origin.');
    if (vm.origin !== page.origin) throw new Error('VM URL must belong to this VM deployment.');
  }
  if (vm.protocol === 'http:' && !loopback(new URL(editorOrigin).hostname)) throw new Error('HTTP VM URLs are only supported with a loopback editor.');
  const auth = value.authURL ? deploymentURL(value.authURL, 'Credential broker URL') : null;
  if (auth && [editorOrigin, vm.origin].includes(auth.origin)) throw new Error('The credential broker must have its own origin, separate from editor and VM.');
  if (auth) throw new Error('The credential vault is not implemented yet; leave authURL empty.');
  return { role, vmURL: vm.href, editorOrigin, authURL: auth?.href || '', isolated: role === 'vm' || vm.origin !== page.origin };
}
export function deployment() {
  if (!globalThis.APPTRON_DEPLOYMENT || typeof globalThis.APPTRON_DEPLOYMENT !== 'object') throw new Error('Deployment configuration did not load. Reload before Run.');
  return validateDeployment(globalThis.APPTRON_DEPLOYMENT, location.href);
}
