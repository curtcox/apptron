// Shared bounded/canonical CID primitives; VM artifacts ship only these pure core modules.
export{decode64}from'../vendor/fragment-kit-v0.3.4/src/core/bytes.js';
export{cidLength,isCID,verify as verifyCID}from'../vendor/fragment-kit-v0.3.4/src/core/cid.js';
