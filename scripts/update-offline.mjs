import fs from'node:fs/promises';import{generateOffline}from'../vendor/fragment-kit-v0.4.3/tools/offline-assets.mjs';
const config=JSON.parse(await fs.readFile('offline.config.json','utf8')),pins=JSON.parse(await fs.readFile('runtime-assets.json','utf8')),lock=JSON.parse(await fs.readFile('runtime.lock','utf8'));
if(pins.commit!==lock.commit||pins.release!==lock.release||pins.manifestSha256!==lock.manifestSha256)throw Error('Runtime cache pins do not match the locked release.');
const desired={...config,metadata:{runtime:pins}};if(process.argv.includes('--check')){if(JSON.stringify(config)!==JSON.stringify(desired))throw Error('Offline metadata is stale.');}else await fs.writeFile('offline.config.json',JSON.stringify(desired,null,2)+'\n');
const value=await generateOffline('offline.config.json',process.argv.includes('--check'));console.log(value.version+': '+value.assets.length+' verified application assets');
