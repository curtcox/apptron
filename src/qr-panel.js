export const QR_MAX_BYTES = 2953; // Version 40, level L, byte mode.
export function canEncodeQR(link) { return new TextEncoder().encode(link).length <= QR_MAX_BYTES; }
export function renderQR(link, canvas, generator = globalThis.qrcode) {
  if (!canEncodeQR(link)) throw new Error('This link is too long for a QR code. Save to HashBin, then make a QR code for the saved link.');
  const qr = generator(0, 'L'); qr.addData(link, 'Byte'); qr.make();
  const count = qr.getModuleCount(), scale = Math.max(2, Math.floor(420 / (count + 8)));
  canvas.width = canvas.height = (count + 8) * scale;
  const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#000';
  for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (qr.isDark(y, x)) context.fillRect((x + 4) * scale, (y + 4) * scale, scale, scale);
}
