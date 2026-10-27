# Implementation notes

The implementation follows `plan.md` with these changes found by real runtime
spikes, rather than assumptions about the upstream API:

- The current `wanix:runtime` image no longer exports `WanixRuntime`. Its image
  digest is recorded as the rejected candidate; the working loader is built
  from the exact Wanix source revision in Apptron's `go.mod`. The pinned source
  loader reproduced Apptron's committed loader byte for byte.
- Upstream init attempts DHCP for a guest even without a relay. The checked-in
  patch skips it when eth0 is absent.
- Native WASI workers require browser isolation. The data service worker adds
  COOP/COEP headers to same-origin responses and the initial page reloads once.
  This was verified on a server with no isolation headers, matching Pages.
- The Go linker cannot mmap its output on the upstream 9p filesystem. The Go
  sample mounts `/tmp` as tmpfs before loading the toolchain.
- The C overlay is about 89 MiB compressed, so gallery overlays are limited to
  128 MiB each, with a 512 MiB decompression ceiling. HashBin stays at 5 MiB.
  The complete site is about 299 MiB, below the 1 GB Pages limit.
- Cowsay is absent from Alpine 3.22 stable. The fun package list uses the tagged
  Alpine testing repository for cowsay; its dependencies come from stable.
- Capturing an overlay merges the loaded overlay with scratch files, preserving
  preinstalled packages when a new overlay CID replaces the original one.
- Every VM runs in a disposable iframe, so rebooting terminates the old Go
  runtime. The host also handles upstream envbuild reloading that iframe.
- Home is scoped to both the browser and snapshot identity to prevent files
  leaking between snapshots. Runtime upgrades receive isolated identities.

## Security findings

### DOM-bridge escape (original finding; immediate containment implemented)

A shared snapshot can run arbitrary JavaScript in the site's own origin. This was
confirmed with a local spike against the locked runtime
(`c4cb2dba…`) and the isolation-header server. It is tracked as Phase 0.1 in
`gallery-plan.md` and must be fixed before the gallery grows, because it already
affects every share link, gallery load and HashBin load today. The full threat
model, asset inventory, and the menu of solutions are in `security.md`; this entry
is only the reproduction.

- The guest VM can reach the whole Wanix namespace, including `/web/dom`. From
  the shell, `cat /web/dom/new/script` creates a real `document.createElement`
  element in the VM frame (`vm.html`), and `echo "append-child <id>" >> /web/dom/body/ctl`
  appends it to that frame's body. The frame is same-origin with the editor and
  carries no `sandbox` attribute (`src/apptron-host.js`).
- Element attributes are set by writing the element's `attrs` file. Truncating
  writes (`>`) do not reach the upstream `FieldFile`/`FuncFile` close handler over
  9p and silently do nothing, but **append writes (`>>`) do**. So a snapshot sets
  `src='data:text/javascript,…'` on a `<script>` with `>>`, appends it with `>>`,
  and the browser runs that code in the site origin.
- Confirmed effect: the injected script set a flag on `window.top` (the editor
  page, not just the VM frame) and that window's `localStorage` — where HashBin
  OAuth tokens live under `apptron:oauth:*` — was readable from the injected
  context. The code runs in the real browser page, which has network access, so
  "no VM network by default" does not contain it.
- `envrc` is sourced automatically at session start (`system/bin/start`), so the
  payload needs only that the visitor open a shared/gallery/HashBin snapshot and
  click Run.
- An `<iframe srcdoc>` variant did not execute in the spike (COOP/COEP appears to
  block it), but the `<script src="data:">` vector is sufficient. The truncate-vs-append
  behavior is a 9p quirk, not a security control, so it must not be relied on.

The current containment patches close script/iframe allocation, unsafe attributes,
CSS injection, raw workers and gojs, origin-wide storage, pickerfs and downloads.
The exact relay is the only permitted WebSocket target. The runtime exports
static page support scripts with SRI so the frame CSP does not need inline,
data, or blob page scripts. It still allows blob workers and Wasm compilation.
The host uses a validated bridge for key input, resize, project/overlay capture
and reset; filesystem operations execute in the VM document.
HTTP data mounts require revocable boot grants and all data responses are inert.
Overlay validation, CID integrity, draft provenance/replacement consent, relay
session consent and trusted-area labels are implemented too.

The B1 spike in `tests/browser/isolation-spike.spec.cjs` rules out an opaque
origin for this runtime: no IndexedDB or OPFS in the tested engines, and no
SharedArrayBuffer in Chromium. B2 is prepared with configurable, pinned origins and a storage/capture/reset
bridge, validated against a real VM on a second local origin. Production hosting
is not activated; see `deployment.md` for artifact builds and required headers. The token vault and
capability broker are still pending. Same-origin frame execution remains unsafe;
full DOM and Go/JS access must stay closed. See `security.md`'s implementation
status for the remaining architecture and its storage-isolation caveat.

## Implemented

The editor, VM host, subpath-safe service worker, snapshot parser/capture,
overlay capture/restore, compressed and shortened sharing links, QR generator,
HashBin load/save/OAuth/quote controls, mobile key bar, nine examples, searchable
gallery, docs, runtime scripts, release/Pages workflows, and Dependabot config
are present. Vendored browser dependencies have license notices and a refresh
script. Large runtime files are ignored.

## Verification

- 29 Node tests pass for txtar, limits, UUIDs, r2fs, tar/gzip, overlay storage,
  sharing, HashBin documents and OAuth restoration, QR limits and relay URLs.
- Editor browser checks cover Chromium, Firefox and WebKit at desktop and phone
  sizes, plus hostile-input/CSP/consent checks and the opaque-origin spike
  (70 pass, two Firefox service-worker cases skipped). Firefox cannot evaluate
  this module service worker; it reports the error and VM boot fails closed.
  All three engines reject IndexedDB in the opaque frame; only Chromium loses
  SharedArrayBuffer too.
- Real Chromium boot checks verify a shell, a shell-written file captured into
  the editor, the Docker-built Python overlay offline, offline Go compilation,
  native WASI execution, and a captured overlay restored into a fresh VM with Python and scratch files intact.
- The optional worker relay builds and accepts a localhost WebSocket connection.
- Four separate-origin checks verify editor DOM/storage denial, bridge capture,
  reload/reset, WASI, Python overlays and failure when VM headers are missing.
- Runtime manifests verify all 19 runtime files, including four overlays.
- Gallery images are actual terminal captures. No sample output is simulated.

## Public deployment verification

This section records the earlier public release. The security hardening above
is verified locally; its new immutable runtime release has not been published.

The site is published at <https://curtcox.github.io/apptron/> using the locked
runtime release. Browser checks against that public URL verified first-visit
isolation, shell boot, a VM edit captured into the editor, Python, native WASI,
Go compilation using the deployed gzip bundles, sharing/QR, gallery/docs, and
phone layout. No browser page errors or apptron.dev runtime requests occurred.
Go's status line now returns to Running after lazy bundle downloads finish.
HashBin integration was left unchanged during deployment work.

## External setup and limits

HashBin registration is intentionally left to the owner: the meta client ID is
empty and save controls explain what is missing. OAuth restoration and saving
are tested with stubs; no real account was charged. Live is.gd availability is
not required by tests. The owner has requested publication to GitHub Pages. Deployment is controlled
by `APPTRON_DEPLOY_ENABLED`, and Pages is configured to use GitHub Actions.
CI runners are pinned to Ubuntu 24.04, which supports the pinned Playwright
version; Ubuntu 26.04 from ubuntu-latest does not. Browser and VM checks run
in the matching official Playwright container to avoid intermittent per-job
browser-download hangs. The Runtime workflow can reuse
an existing checksum-verified release; new builds
publish an immutable release and commit the generated lock. Runtime verification
also checks that the release contains the patches from the current checkout.

Snapshots do not represent empty directories, symlinks, or executable mode;
capture skips symlinks and reports omissions. Set permissions in envrc.
Overlays preserve files, modes and links, but not deletion of base-image files.
Physical phone keyboard behavior still needs real-device testing. Browser
viewport tests do not establish real-device compatibility.

The pinned upstream drops the leading slash when Linux creates an absolute
symlink (`ln -s /...`). This was reproduced with the original checksum-verified
runtime too. Relative symlinks remain the supported creation path; prebuilt
archive symlink targets are preserved by overlay restore. The security backend
rejects direct symlink dereferencing against the database root and provides
read-only no-follow inspection for namespace adapters.
