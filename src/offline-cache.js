import{bridge,restoreRegistration}from'./offline-bootstrap.js';
import'../vendor/fragment-kit-v0.3.5/src/offline/sw-core.js';
// Static dependency order captures only the kit's fetch handler. Data/grant handlers
// remain ordinary consumer listeners, and exactly one handler responds to each request.
restoreRegistration();
export function offlineResponse(request){
 let response;bridge.fetch({request,respondWith:value=>{response=value;}});return response;
}
