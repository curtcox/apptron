import { configuration, configurationScript, vmHeaders } from './deployment-config.mjs';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const known = new Set(['--role','--vm-url','--editor-origin','--out']);
for (let i = 0; i < args.length; i += 2) if (!known.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid build option: ${args[i]}`);
const option = (name, fallback = '') => { const at = args.indexOf('--' + name); if (at < 0) return fallback; if (!args[at + 1] || args[at + 1].startsWith('--')) throw new Error(`Missing --${name} value.`); return args[at + 1]; };
const config = configuration({ role: option('role', process.env.APPTRON_ROLE || 'editor'), vmURL: option('vm-url', process.env.APPTRON_VM_URL || ''), editorOrigin: option('editor-origin', process.env.APPTRON_EDITOR_ORIGIN || '') });
const output = option('out', config.role === 'vm' ? '.build/vm-site' : 'dist');
if (!['dist', '.build/vm-site', '.build/editor-site'].includes(output)) throw new Error('Output must be dist, .build/vm-site or .build/editor-site.'); rmSync(output, { recursive: true, force: true }); mkdirSync(output);
for (const file of ['deployment-config.js','index.html', 'gallery.html', 'docs.html', 'vm.html', 'data-sw.js', 'favicon.svg', 'runtime.lock', 'src', 'vendor', 'examples', 'LICENSE-graphvizonline']) cpSync(file, `${output}/${file}`, { recursive: true });
writeFileSync(`${output}/deployment-config.js`, configurationScript(config));
if (config.role === 'vm') {
 for (const file of ['index.html','gallery.html','docs.html','examples','vendor']) rmSync(`${output}/${file}`, { recursive: true, force: true });
 for (const file of ['app.js','hashbin.js','hashbin-panel.js','share-links.js','qr-panel.js','gallery.js','examples.js','keybar.js','txtar-mode.js']) rmSync(`${output}/src/${file}`, { force: true });
 writeFileSync(`${output}/_headers`, vmHeaders(config.editorOrigin, config.vmURL));
}
if (config.role === 'editor' && config.vmURL) rmSync(`${output}/vm.html`);
const lock = JSON.parse(readFileSync('runtime.lock'));
const runtime = `runtime/${lock.commit}`;
if (!existsSync(`${runtime}/runtime.json`)) throw new Error('Install the locked runtime before packaging.');
execFileSync(process.execPath, ['scripts/verify-runtime.mjs', runtime], { stdio: 'inherit' });
cpSync(runtime, `${output}/${runtime}`, { recursive: true });
writeFileSync(output + '/.nojekyll', '');
const walk = path => readdirSync(path).reduce((size, name) => size + (statSync(`${path}/${name}`).isDirectory() ? walk(`${path}/${name}`) : statSync(`${path}/${name}`).size), 0);
const size = walk(output); if (size >= 1_000_000_000) throw new Error('Pages artifact exceeds 1 GB.');
console.log(`Site packaged in ${output}/: ${(size / 1048576).toFixed(1)} MiB`);
