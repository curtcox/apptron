import { HashBinDocuments, REDIRECT_BYTES } from './hashbin.js';
/** HashBin controls: snapshot and overlay saves approved on hashbin.org, and stale-load guards. */
class HashBinPanel {
  constructor({ store, getSnapshot, getFingerprint, onLoad, onSaved }) {
    Object.assign(this, { store, getSnapshot, getFingerprint, onLoad, onSaved });
    this.revision = 0;
    this.status = document.getElementById('hashbin-status');
    this.dialog = document.getElementById('hashbin-dialog');
    this.message = document.getElementById('hashbin-message');
    this.confirm = document.getElementById('hashbin-confirm');
    document.getElementById('hashbin-load').onclick = () => this.load(document.getElementById('hashbin-cid').value);
    document.getElementById('hashbin-cid').onkeydown = event => { if (event.key === 'Enter') this.load(event.target.value); };
    document.getElementById('hashbin-save').onclick = () => this.openSave();
    document.getElementById('hashbin-close').onclick = () => this.dialog.close();
    this.dialog.addEventListener('close', () => { this.dialogRevision = (this.dialogRevision || 0) + 1; });
    this.confirm.onclick = () => this.commit();
  }
  cancelLoad() {
    this.revision++;
    if (this.status.textContent === 'Loading from HashBin…') this.status.textContent = '';
  }
  async load(input) {
    const cid = HashBinDocuments.cid(input);
    if (!cid) { this.status.textContent = 'Enter a valid HashBin CID or saved link.'; return; }
    const revision = ++this.revision;
    this.status.textContent = 'Loading from HashBin…';
    try {
      const snapshot = await this.store.load(cid);
      if (revision !== this.revision) return;
      if (this.onLoad(snapshot, cid) === false) { this.status.textContent = 'Load cancelled. Current snapshot kept.'; return; }
      this.status.textContent = 'Loaded from HashBin.';
    } catch (error) { if (revision === this.revision) this.status.textContent = error.message; }
  }
  async openSave(overlay = null) {
    if (this.saving) return;
    const revision = this.dialogRevision = (this.dialogRevision || 0) + 1;
    this.confirm.disabled = true;
    this.confirm.textContent = 'Review on HashBin';
    this.message.textContent = 'Preparing save…';
    if (!this.dialog.open) this.dialog.showModal();
    try {
      this.snapshot = this.getSnapshot();
      this.overlay = overlay;
      this.payload = overlay || HashBinDocuments.serialize(this.snapshot);
      this.fingerprint = this.getFingerprint();
      const size = HashBinDocuments.bytes(this.payload).length;
      // Load the SDK now: a popup must open synchronously from the next click.
      await this.store.init();
      if (revision !== this.dialogRevision) return;
      this.message.textContent = `${size} bytes. HashBin shows the retention, exact price and your balance, and you approve the save on hashbin.org. This editor never holds your HashBin sign-in.` +
        (this.store.redirectOnly ? ' The editor goes to HashBin and returns with your snapshot; a running VM stops.' : '') +
        (this.store.redirectOnly && size > REDIRECT_BYTES ? ` It is larger than a link can carry (${REDIRECT_BYTES} bytes), so it downloads as a file first; choose that file on HashBin.` : '');
      this.confirm.disabled = false;
    } catch (error) { if (revision === this.dialogRevision) this.message.textContent = error.message; }
  }
  async commit() {
    if (this.confirm.disabled || this.saving) return;
    if (this.fingerprint !== this.getFingerprint()) { await this.openSave(this.overlay); return; }
    this.confirm.disabled = true;
    this.saving = true;
    try {
      const pending = this.store.publish(this.payload, this.snapshot, Boolean(this.overlay));
      this.message.textContent = 'Waiting for your approval on HashBin…';
      const result = await pending;
      if (result.redirected) return;
      const link = this.saved(result.cid, this.fingerprint, Boolean(this.overlay));
      this.message.replaceChildren(document.createTextNode('Saved. '));
      const a = document.createElement('a');
      a.href = link;
      a.textContent = this.overlay ? 'Download saved overlay' : 'Open saved snapshot';
      this.message.append(a);
      this.confirm.textContent = 'Saved';
    } catch (error) {
      this.message.textContent = error.message;
      this.confirm.disabled = false;
    } finally { this.saving = false; }
  }
  /** Records a verified save, unless the source changed while HashBin was open. */
  saved(cid, fingerprint, overlay) {
    const link = overlay ? `https://256t.us/${cid}` : HashBinDocuments.link(location.href, cid);
    if (fingerprint === this.getFingerprint()) this.onSaved(cid, fingerprint, link, overlay);
    this.status.textContent = 'Saved to HashBin.';
    return link;
  }
}
export { HashBinPanel };

