import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyT256(binary,sums,lock) {
 if(lock.version!==1||lock.repo!=='curtcox/256t.org'||!/^t256-v[0-9]+\.[0-9]+\.[0-9]+$/.test(lock.release)||lock.asset!=='t256-linux-386'||!Number.isSafeInteger(lock.size)||lock.size<=0)throw Error('Invalid t256 binary lock');
 if(hash(sums)!==lock.sumsSha256)throw Error('t256 SHA256SUMS checksum mismatch');
 const entries=sums.toString('utf8').trim().split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(parts=>parts[1]?.replace(/^\*/,'')===lock.asset);
 if(entries.length!==1||entries[0][0]!==lock.sha256)throw Error('t256 release checksum does not match the pinned binary');
 if(binary.length!==lock.size||hash(binary)!==lock.sha256)throw Error('t256 binary checksum mismatch');
 return binary;
}
export async function fetchT256(output,fetcher=fetch) {
 const lock=JSON.parse(await readFile('examples/overlays/gripeline.t256.json','utf8'));
 const base='https://github.com/curtcox/256t.org/releases/download/'+lock.release+'/';
 const get=async name=>{const response=await fetcher(base+name);if(!response.ok)throw Error('t256 download failed: '+response.status);return Buffer.from(await response.arrayBuffer());};
 const [binary,sums]=await Promise.all([get(lock.asset),get('SHA256SUMS')]);verifyT256(binary,sums,lock);
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,binary);await chmod(output,0o755);
 console.log('Verified '+lock.release+' '+lock.asset);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await fetchT256(process.argv[2]??'.build/apptron/t256-linux-386');
