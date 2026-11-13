import{HashBinPanel as SharedPanel,bytes}from'../vendor/fragment-kit-v0.4.3/src/index.js';
import{urlState,serializeLegacy}from'./fragment-config.js';
import{REDIRECT_BYTES}from'./hashbin.js';
/** The shared panel handles text. The consumer adds gzip attachment selection and warnings. */
export class HashBinPanel extends SharedPanel{
 constructor(options){const onSaved=options.onSaved;super({...options,urlState,onSaved:(cid,fingerprint,link)=>onSaved(cid,fingerprint,this.overlay?'https://256t.us/'+cid:link,Boolean(this.overlay))});this.appOnSaved=onSaved;this.saveButton.onclick=()=>this.openSave(null);}
 async openSave(overlay=this.overlay??null){
  this.overlay=overlay;this.store.documents={...this.store.documents,serialize:doc=>this.overlay??serializeLegacy(doc)};
  await super.openSave();
  if(this.confirm.disabled)return;
  const size=typeof this.payload==='string'?bytes(this.payload).length:this.payload.byteLength;this.message.textContent=this.message.textContent.replace(/^\d+ bytes\./,size+' bytes.');
  if(this.store.redirectOnly){this.message.textContent+=' The editor goes to HashBin and returns with your snapshot; a running VM stops.';if(size>REDIRECT_BYTES)this.message.textContent+=' It downloads as a file first; choose that file on HashBin.';}
 }
 async commit(){const overlay=this.overlay;await super.commit();if(overlay&&this.confirm.textContent==='Saved'){const link=this.message.querySelector('a');if(link){link.href='https://256t.us/'+new URL(link.href).hash.slice(1);link.textContent='Download saved overlay';}}}
 saved(cid,fingerprint,overlay=false){const link=overlay?'https://256t.us/'+cid:urlState.link(location.href,cid);if(fingerprint===this.getFingerprint())this.appOnSaved(cid,fingerprint,link,overlay);this.status.textContent='Saved to HashBin.';return link;}
}
