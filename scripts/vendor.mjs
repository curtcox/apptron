import { cpSync } from 'node:fs';
cpSync('node_modules/ace-builds/LICENSE','vendor/ace/LICENSE');
for (const name of ['ace','theme-tomorrow_night',...['sh','python','javascript','c_cpp','golang','makefile','text'].map(n=>'mode-'+n)]) cpSync(`node_modules/ace-builds/src-min-noconflict/${name}.js`,`vendor/ace/${name}.js`);
console.log('Updated pinned Ace assets; shared libraries come from the immutable Fragment Kit pin.');
