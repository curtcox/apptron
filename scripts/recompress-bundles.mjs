import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { brotliDecompressSync, gzipSync } from 'node:zlib';
const directory = process.argv[2];
for (const name of readdirSync(directory).filter(n => n.endsWith('.tar.br'))) {
  writeFileSync(`${directory}/${name.replace(/\.br$/, '.gz')}`, gzipSync(brotliDecompressSync(readFileSync(`${directory}/${name}`))));
  unlinkSync(`${directory}/${name}`);
}
