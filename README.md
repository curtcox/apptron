# Apptron Online

A static Linux playground for GitHub Pages. Edit a txtar snapshot, boot a real
Apptron Linux VM in the same tab, capture project and system changes, and share
via a compressed URL, QR code, or HashBin.

[Open Apptron Online](https://curtcox.github.io/apptron/)

## Run locally

Requirements: Node 22+, Docker with Buildx and i386 emulation, and Git.
Docker Desktop supplies the Docker requirements on macOS.

```sh
git submodule update --init
npm ci
scripts/build-runtime.sh
npm start
```

Open <http://127.0.0.1:4173/apptron/>. A full build includes Go toolchains and four
package overlays. `CORE_ONLY=1 scripts/build-runtime.sh` builds a smaller runtime
for shell, esbuild, and Wasm development. Once a verified release is published,
`scripts/fetch-runtime.sh` downloads the locked release instead.

Runtime files are ignored, versioned by upstream commit, and checked against
`runtime.json`. A fresh build updates the local manifest and checksum lock. To refresh a manifest
after changing locally built runtime files, run:

```sh
node scripts/runtime-manifest.mjs runtime/$(git -C upstream/apptron rev-parse HEAD) --lock
```

## Features

- Vendored Ace editor with txtar sections and per-file syntax highlighting.
- Real Apptron console in an isolated iframe; Run, Reset, progress and checksums.
- Service worker implements Apptron's r2fs file sync on a Pages subpath.
- Capture project files, download snapshots, capture and restore disk overlays.
- Offline package overlays for Python, C/Make, Node and terminal toys; lazy Go bundles.
- Compressed links, optional is.gd shortening, QR preview and PNG download.
- HashBin loading and OAuth saves with price confirmation and stale-load guards.
- Searchable nine-example gallery, documentation, responsive Code/Preview toggle,
  virtual keyboard refitting, and terminal key bar.
- Node tests, browser checks in Chromium/Firefox/WebKit at desktop and phone sizes,
  real VM boot checks, and GitHub Actions build/release/Pages workflows.

The VM has no network by default. Configure your own relay in More → Network.
See [docs.html](docs.html) for snapshot syntax, persistence, limits and relay setup.
Source snapshots are capped at 1 MiB; HashBin uploads at 5 MiB. Capture lists
omitted files. Base-file deletion markers and txtar file permissions are not
preserved; use envrc for permissions. The public client ID is intentionally empty
until a HashBin app is registered.

## Verify

```sh
npm test
npx playwright install --with-deps
npm run test:browser
npm run test:boot
npm run build
```

`test:browser` runs the editor checks in six browser/viewport combinations. Boot
checks run only with `APPTRON_BOOT=1` in Chromium and require the full runtime.
CI uses `scripts/test-browser-container.sh` with the official image matching the
installed Playwright version, avoiding repeated OS and browser installation.
The boot checks verify a real shell, VM edits captured back into txtar, Python running from
an overlay, and Go compiling offline with gzip bundles mapped from `.tar.br` names.
For a locally installed browser, the Playwright config accepts
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`, `PLAYWRIGHT_FIREFOX_EXECUTABLE`, and
`PLAYWRIGHT_WEBKIT_EXECUTABLE`. No runtime is needed for editor-only checks.

`scripts/render-gallery.cjs` takes real terminal screenshots with the local server
running. Set `APPTRON_RELAY=ws://localhost:8080/x/net` to include envbuild.

## Runtime and deployment

Apptron is pinned as a submodule at `c4cb2dba29dd245638b55674f6d38ea9cf97a92b`
(v0.7.0). Kernel and v86 images are pinned by digest in `runtime.lock`. The
current `wanix:runtime` image has an incompatible API; the build therefore
compiles the loader from Apptron's exact Wanix module commit instead. A small
patch skips DHCP when the VM has no network interface. Sources remain unchanged
in the submodule. Go bundles are recompressed as gzip because Pages cannot set
Content-Encoding for Brotli bundles.

The Runtime workflow reuses and verifies an existing immutable release, or builds,
locks and smoke-tests a new runtime before publishing it. New builds also upload
an Actions artifact. Deploy Pages follows that workflow or pushes to main and
verifies the archive, manifest, patch provenance, and every runtime file before
publishing `dist/`.

Publication and CI boot checks are controlled by the owner's repository variable
`APPTRON_DEPLOY_ENABLED=true`. Pages must use **GitHub Actions** in repository
Settings → Pages. The Runtime workflow requests `contents: write` so it can
publish a new `runtime-<commit>` release and commit its generated checksum lock.
Reusing an existing release does not rebuild or overwrite its assets.

For the initial deployment, either run Runtime on main to build the release, or
publish a locally built and smoke-tested `runtime.tar.gz`, `runtime.json` and
`runtime.lock` with matching hashes. The site then deploys from that locked
release. Upstream source and licensing context remain documented in
[the original plan](docs/plan.md).

HashBin is optional for publishing: register an app returning to
`https://curtcox.github.io/apptron/` and set its public ID in the
`hashbin-client-id` meta tag when that integration is ready.

Nothing is fetched from apptron.dev. Core VM assets and package/toolchain bundles
are served by this site. HashBin, OAuth and optional URL shortening use their
respective services. A network relay is separate from Pages hosting.

The original design and milestones are in [docs/plan.md](docs/plan.md).
Implementation notes and verification limits are in
[docs/implementation.md](docs/implementation.md). Planned gallery additions are in
[docs/gallery-plan.md](docs/gallery-plan.md). The security model, risks and the
solution menu are in [docs/security.md](docs/security.md). Adapted sharing modules retain
[GraphvizOnline's BSD notice](LICENSE-graphvizonline); vendored libraries carry
licenses in `vendor/`. Apptron and runtime dependencies retain their own licenses.

## Separate VM hosting

The VM-origin split is prepared but disabled by default. See
[deployment instructions](docs/deployment.md) for the two artifact builds,
origin pins and first-response headers. The VM host must support those headers;
the editor may stay on Pages. A credential vault cannot share the VM origin and
is still separate work.
