// Compatibility for the original consumer tests; the editor uses the shared QR dialog.
import{bytes,encodeQr}from'../vendor/fragment-kit-v0.4.3/src/index.js';
export const QR_MAX_BYTES=2953;
export const canEncodeQR=link=>bytes(link).length<=QR_MAX_BYTES&&Boolean(encodeQr(link));
export function renderQR(link,canvas){
 const qr=canEncodeQR(link)&&encodeQr(link);if(!qr)throw Error('This link is too long for a QR code. Save to HashBin, then make a QR code for the saved link.');
 const scale=Math.max(2,Math.floor(420/(qr.size+8)));canvas.width=canvas.height=(qr.size+8)*scale;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='#000';qr.modules.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)context.fillRect((x+4)*scale,(y+4)*scale,scale,scale);}));
}
