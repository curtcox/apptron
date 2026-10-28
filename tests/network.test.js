import test from 'node:test';
import assert from 'node:assert/strict';
import { ApptronHost } from '../src/apptron-host.js';
import { NetworkGrants } from '../src/network.js';
const source = '# apptron snapshot v1\n-- file --\nhello\n';
test('relay grants bind exact snapshot, runtime and destination, cannot be forged, and revoke immediately',()=>{
 const grants=new NetworkGrants(),runtime='a'.repeat(40),relay='wss://relay.test/x/net';let prompts=0;const allow=()=>{prompts++;return true};
 assert.equal(grants.request(source,runtime,'',allow),null);assert.equal(prompts,0);
 assert.throws(()=>grants.request(source,runtime,relay,()=>false),/declined/);
 const token=grants.request(source,runtime,relay,allow);assert.equal(grants.resolve(token,source,runtime),relay);assert.equal(prompts,1);
 assert.equal(grants.request(source,runtime,relay,allow),token);assert.equal(prompts,1);
 for(const [src,rev] of [[source+'# change\n',runtime],[source,'b'.repeat(40)]])assert.throws(()=>grants.resolve(token,src,rev),/another snapshot/);
 assert.throws(()=>grants.resolve({},source,runtime),/missing/);
 assert.notEqual(grants.request(source,runtime,'wss://other.test/',allow),token);assert.equal(prompts,2);
 grants.revoke();assert.throws(()=>grants.resolve(token,source,runtime),/revoked/);
});
test('the frame entry rejects an ambient relay and a serialized/forged grant',async()=>{
 const host=new ApptronHost(null),manifest={commit:'a'.repeat(40)};
 await assert.rejects(()=>host.startFrame({source,manifest,relay:'wss://relay.test/'}),/snapshot grant/);
 await assert.rejects(()=>host.startFrame({source,manifest,networkGrant:{}}),/missing|revoked/);
});
