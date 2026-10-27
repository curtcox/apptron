import { configuration, configurationScript } from './deployment-config.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.env.SITE_DIR || process.env.APPTRON_EDITOR_SITE_DIR || '.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.lock': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.gz': 'application/gzip', '.svg': 'image/svg+xml', '.txtar': 'text/plain' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname).replace(/^\/apptron(?=\/|$)/, '');
    const config = configuration({ role: process.env.APPTRON_ROLE || 'editor', vmURL: process.env.APPTRON_VM_URL || '', editorOrigin: process.env.APPTRON_EDITOR_ORIGIN || '' });
    if (pathname === '/deployment-config.js' && (process.env.APPTRON_ROLE || process.env.APPTRON_VM_URL || process.env.APPTRON_EDITOR_ORIGIN)) { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(configurationScript(config)); return; }
    if (config.role === 'vm' && ['/', '/index.html', '/src/app.js', '/src/hashbin.js', '/src/hashbin-panel.js'].includes(pathname)) throw new Error('VM-only deployment.');
    let path = resolve(root, '.' + pathname);
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Outside site.');
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const content = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...(config.role === 'vm' ? { 'Cross-Origin-Resource-Policy': 'cross-origin', 'Permissions-Policy': `cross-origin-isolated=(self "${config.editorOrigin}")`, ...(pathname === '/vm.html' ? { 'Content-Security-Policy': `frame-ancestors ${config.editorOrigin}` } : {}) } : {}), ...(process.env.NO_ISOLATION_HEADERS ? {} : { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }) });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Apptron: http://127.0.0.1:${process.env.PORT || 4173}/apptron/`));
