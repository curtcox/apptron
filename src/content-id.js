// Shared bounded/canonical CID primitives; VM artifacts ship only these pure core modules.
export{decode64}from'../vendor/fragment-kit-v0.3.5/src/core/bytes.js';
export{cidLength,isCID,verify as verifyCID}from'../vendor/fragment-kit-v0.3.5/src/core/cid.js';
