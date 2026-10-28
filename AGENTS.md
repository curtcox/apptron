# Apptron Online

This is a buildless static ES-module site. Keep every site URL relative so it
works at `/apptron/` on GitHub Pages and at any localhost subpath.

- Read `docs/plan.md` and `docs/implementation.md` for architecture and remaining
  external setup. Do not replace the real VM with a terminal simulation.
- `upstream/apptron` is a pinned submodule. Do not edit its tracked files. Put
  necessary upstream fixes in `patches/` and apply them in the runtime build.
- Runtime binaries and build outputs belong in ignored `runtime/` and `.build/`.
  Never commit them. Check manifests and SHA-256s; never invent a release or hash.
- Node 22+ is supported. Browser code uses native ES modules. Dependencies under
  `vendor/` are pinned in `package-lock.json` and include license notices.
- Run `npm test` for parser, storage, archive and sharing changes; use relevant
  Playwright checks for UI changes. `npm run test:boot` needs a complete runtime.
- The worker entry is `data-sw.js` at the site root; handlers are under `src/`.
  Match the pinned Wanix API: `readDir` returns name strings and `stat`/`lstat`
  return `Mode`, `Size`, `IsDir`, `ModTime` (Go file-mode bits).
- Do not turn on VM networking by default or put relay settings in share links.
  HashBin saves are quoted and confirmed on hashbin.org through HashBin Publish (pinned SDK); never reintroduce HashBin tokens on this origin, which runs untrusted VMs. Isolated editors must use the redirect handoff.
- Publication is controlled by the owner's `APPTRON_DEPLOY_ENABLED` repository
  variable. The owner has requested GitHub Pages deployment in this chat.
