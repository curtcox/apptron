import {test} from 'node:test';import assert from 'node:assert/strict';
import {config,type} from '../src/fragment-config.js';
import {createAi,parseSuite,validateReferences} from '../vendor/fragment-kit-v0.4.3/src/ai/index.js';
import suite from '../ai-suite.json' with {type:'json'};
test('AI deployment modes remain idle with zero default spending',async()=>{for(const [href,mode] of [[config.canonicalOrigin,'host'],[config.recoveryOrigin,'direct'],['https://unknown.example/','paste']]){let calls=0;const ai=await createAi({config,type,href,fetchSource:()=>{calls++;throw Error('Eager AI request');}});assert.equal(ai.connection,mode);assert.equal(calls,0);assert.equal(ai.budget.spent().total,0);ai.destroy();}assert.deepEqual(config.ai.budget,{total:0,day:0,month:0});});
test('data-only suite has passing good references, failing bad references and preserved state',async()=>{const parsed=parseSuite(suite,type);assert.equal(parsed.cases.length,25);await validateReferences(parsed,type);for(const c of parsed.cases.filter(c=>c.kind==='change')){for(const key of Object.keys(c.base).filter(key=>key!=='src'&&key!=='pages'))assert.deepEqual(c.reference.good[key],c.base[key]);}});

import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('the editor permits its approved AI destination while the VM retains its isolated policy',()=>{
 const script=readFileSync(new URL('../src/page-policy.js',import.meta.url),'utf8');
 const policy=(href,role='editor')=>{let result;vm.runInNewContext(script,{URL,URLSearchParams,location:{href,hash:''},document:{documentElement:{dataset:{apptron:role}},createElement:()=>({dataset:{}}),head:{append:value=>{result=value.content;}}}});return Object.fromEntries(result.split('; ').map(part=>{const [name,...values]=part.split(' ');return[name,values];}));};
 const canonical=policy(config.canonicalOrigin);assert.ok(canonical['frame-src'].includes('https://ai.hashbin.page'));assert.ok(!canonical['connect-src'].includes('https://api.openai.com'));
 const recovery=policy(config.recoveryOrigin);for(const host of ['https://api.openai.com','https://openrouter.ai','https://api.anthropic.com','https://generativelanguage.googleapis.com'])assert.ok(recovery['connect-src'].includes(host));
 for(const url of [config.canonicalOrigin,config.recoveryOrigin]){const isolated=policy(url,'vm');assert.deepEqual(Array.from(isolated['frame-src']),["'none'"]);assert.ok(!isolated['connect-src'].some(value=>/openai|openrouter|anthropic|googleapis|ai\.hashbin/.test(value)));}
 assert.ok(!policy('https://unknown.example/')['connect-src'].includes('https://api.openai.com'));
});
