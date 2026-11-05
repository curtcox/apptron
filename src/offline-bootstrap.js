// The shared cache owns verification/lifecycle; the consumer owns response isolation.
import '../offline-assets.js';
export const bridge={fetch:null};
const register=self.addEventListener;
self.FragmentKitOfflineConfig={};
self.addEventListener=function(name,listener,options){
 if(name==='fetch'){bridge.fetch=listener;return;}
 return register.call(this,name,listener,options);
};
export function restoreRegistration(){self.addEventListener=register;}
