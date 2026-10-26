export function setupKeybar(element, host) {
  let ctrl = false;
  element.addEventListener('pointerdown', event => event.preventDefault());
  element.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.key === 'Ctrl') {
      ctrl = !ctrl; button.setAttribute('aria-pressed', String(ctrl));
      const frame = host.frame?.contentWindow;
      if (ctrl && frame) {
        const once = event => {
          if (!ctrl || !/^[a-z]$/i.test(event.key)) return;
          event.preventDefault(); event.stopImmediatePropagation(); host.sendKey(String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64));
          ctrl = false; button.setAttribute('aria-pressed', 'false'); frame.removeEventListener('keydown', once, true);
        };
        frame.addEventListener('keydown', once, true); frame.apptron?.terminal?.focus();
      }
      return;
    }
    const keys = { Esc: '\x1b', Tab: '\t', '←': '\x1b[D', '↑': '\x1b[A', '↓': '\x1b[B', '→': '\x1b[C', C: '\x03', D: '\x04' };
    await host.sendKey(keys[button.dataset.key]);
    host.frame?.contentWindow.apptron?.terminal?.focus();
  });
  window.addEventListener('keydown', event => {
    if (ctrl && /^[a-z]$/i.test(event.key)) {
      event.preventDefault(); host.sendKey(String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64));
      ctrl = false; element.querySelector('[data-key="Ctrl"]').setAttribute('aria-pressed', 'false');
    }
  }, true);
}
