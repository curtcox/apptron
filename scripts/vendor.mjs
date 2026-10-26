import { cpSync } from 'node:fs';
cpSync('node_modules/lz-string/libs/lz-string.min.js','vendor/lz-string.min.js');
cpSync('node_modules/lz-string/LICENSE','vendor/LICENSE-lz-string');
cpSync('node_modules/qrcode-generator/qrcode.js','vendor/qrcode-generator.js');
cpSync('node_modules/ace-builds/LICENSE','vendor/ace/LICENSE');
for (const name of ['ace','theme-tomorrow_night',...['sh','python','javascript','c_cpp','golang','makefile','text'].map(n=>'mode-'+n)]) cpSync(`node_modules/ace-builds/src-min-noconflict/${name}.js`,`vendor/ace/${name}.js`);
console.log('Updated pinned browser assets. Retain the qrcode-generator MIT notice.');
