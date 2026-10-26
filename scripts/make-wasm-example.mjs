// A tiny WASI executable: fd_write(1, [{ptr: 16, len: 17}], 1, 8).
// No compiler or external service is needed to reproduce this gallery asset.
import { writeFileSync } from 'node:fs';
const string = text => [text.length, ...new TextEncoder().encode(text)];
const section = (id, body) => [id, body.length, ...body];
const binary = new Uint8Array([0,97,115,109,1,0,0,0,
  ...section(1,[2,0x60,4,0x7f,0x7f,0x7f,0x7f,1,0x7f,0x60,0,0]),
  ...section(2,[1,...string('wasi_snapshot_preview1'),...string('fd_write'),0,0]),
  ...section(3,[1,1]), ...section(5,[1,0,1]),
  ...section(7,[2,...string('memory'),2,0,...string('_start'),0,1]),
  ...section(10,[1,13,0,0x41,1,0x41,0,0x41,1,0x41,8,0x10,0,0x1a,0x0b]),
  ...section(11,[2,0,0x41,0,0x0b,8,16,0,0,0,17,0,0,0,0,0x41,16,0x0b,...string('Hello from Wasm!\n')])]);
await WebAssembly.compile(binary);
writeFileSync('examples/wasm.txtar', '# apptron snapshot v1\n-- .apptron/envrc --\ncd /project\nchmod +x hello.wasm\n./hello.wasm\n-- hello.wasm (base64) --\n' + Buffer.from(binary).toString('base64') + '\n');
