import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { validateDeployment, deployment } from '../src/deployment.js';
import { configuration, configurationScript, vmHeaders } from '../scripts/deployment-config.mjs';
import { DataGrants } from '../src/data-access.js';
const page='https://editor.test/apptron/index.html', vmURL='https://vm.test/linux/vm.html';
test('deployment configuration pins distinct origins and preserves subpaths',()=>{
 assert.throws(()=>deployment(),/configuration did not load/);
 assert.equal(validateDeployment({},page).vmURL,'https://editor.test/apptron/vm.html');
 assert.equal(validateDeployment({vmURL},page).vmURL,vmURL);
 const vm=validateDeployment({role:'vm',vmURL,editorOrigin:'https://editor.test'},vmURL);assert.equal(vm.editorOrigin,'https://editor.test');assert.equal(vm.isolated,true);
 for(const value of [
  {vmURL:'https://editor.test/other/vm.html'}, {vmURL:'http://127.0.0.1/vm.html'}, {vmURL:'http://vm.test/vm.html'}, {vmURL:'https://vm.test/vm.html#source'},
  {vmURL:'https://user:password@vm.test/vm.html'}, {vmURL:'https://vm.test/other.html'},
  {vmURL,authURL:'https://vm.test/auth.html'}, {vmURL,authURL:'https://editor.test/auth.html'},
  {vmURL,authURL:'https://vault.test/auth.html'},
 ]) assert.throws(()=>validateDeployment(value,page));
 assert.throws(()=>configuration({role:'vm',vmURL,editorOrigin:'https://editor.test/path'}));
 assert.match(configurationScript(configuration({vmURL,editorOrigin:'https://editor.test'})),/Object.freeze/);assert.match(vmHeaders('https://editor.test',vmURL),/\/linux\/vm.html/);assert.match(vmHeaders('https://editor.test',vmURL),/frame-ancestors https:\/\/editor.test/);
});
test('data grants bind atomically to one document and cannot be reminted after revocation',async()=>{
 const grants=new DataGrants(),session=crypto.randomUUID(),uuid='a'.repeat(64);
 const outcomes=await Promise.allSettled([grants.grant(session,uuid,'user','client-a'),grants.grant(session,'b'.repeat(64),'other','client-b')]);
 assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
 const winner=outcomes[0].status==='fulfilled'?'client-a':'client-b',loser=winner==='client-a'?'client-b':'client-a';
 assert.ok(await grants.get(session,winner));assert.equal(await grants.get(session,loser),null);
 await assert.rejects(()=>grants.revoke(session,loser),/another document/);assert.ok(await grants.get(session,winner));
 await grants.revoke(session,winner);assert.equal(await grants.get(session,winner),null);
 await assert.rejects(()=>grants.grant(session,uuid,'user',winner),/reassigned/);
});
