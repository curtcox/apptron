# Preparing separate editor and VM deployments

The separate-origin VM path is implemented and tested with a real VM on local
origins. It stays disabled until an owner-controlled VM URL is configured.
Leaving that URL empty keeps the current restricted local VM; a configured URL
never falls back to the editor origin on failure.

## Build the two artifacts

Use the editor's **origin** (scheme and hostname, plus port when relevant) and
the full VM entry URL, including its hosting subpath. The following hosts are
examples to replace after hosting is chosen:

```sh
npm run build -- --role vm \
  --editor-origin https://editor.example \
  --vm-url https://vm.example/linux/vm.html

npm run build -- --role editor \
  --editor-origin https://editor.example \
  --vm-url https://vm.example/linux/vm.html
```

The first command writes the VM artifact to ignored `.build/vm-site/`; the
second writes the editor to ignored `dist/`. Both verify the installed runtime
against `runtime.lock`. Deploy matching artifacts from the same checkout and
lock. A mismatch fails before VM state is seeded, reset, or executed.

The VM artifact excludes editor pages, OAuth/HashBin UI modules, and editor
vendor dependencies. The editor artifact omits its local VM entry when a remote
VM URL is selected. The public configuration in `deployment-config.js` pins the
VM URL on the editor and the allowed editor origin on the VM. Nothing in share
links, snapshot headers, localStorage, or frame messages can choose those pins.
An ordinary static server can serve the artifacts without a site build step.

The editor's Pages workflow accepts repository variables `APPTRON_VM_URL` and
`APPTRON_EDITOR_ORIGIN`; both are empty by default. They are also environment
variables for `npm run build`. The VM artifact is not published by that workflow.
The runtime release still must be published by the existing Runtime workflow.
No new hostname or hosting account has been created by this implementation.

## Required VM hosting headers

The VM host must send these headers on the **first** document response, before a
service worker controls it:

- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: cross-origin`
- `Cross-Origin-Opener-Policy: same-origin`
- `Permissions-Policy: cross-origin-isolated=(self "https://editor.example")`
- `Content-Security-Policy: frame-ancestors https://editor.example` on `vm.html`

The editor embeds with `allow="cross-origin-isolated"` and a restricted sandbox.
The VM artifact includes a `_headers` template with the correct VM entry path.
Apply it if your host supports that format; otherwise configure equivalent HTTP
headers. Merely uploading a `_headers` file to an arbitrary static host does not
set HTTP headers. Plain GitHub Pages cannot supply this first-response setup;
a suitable header-capable host or proxy is needed for the VM deployment. The
editor may remain on Pages, where its own service worker supplies isolation.
The VM registers its own service worker after its first document is loaded.

VM state is stored on the VM origin (and may be partitioned by the embedding
site). Cookies or credentials must never be installed on that origin. Do not use
domain-wide credential cookies that also cover the VM host. Local
loopback HTTP is accepted for development; deployed URLs must use HTTPS.

## Storage, capture and reset

The editor sends validated source, authenticated runtime metadata, and checked
overlay bytes. The VM verifies its own matching lock, validates the source and
overlay again, and scopes its mounts before running. Keys, resize, project
capture, overlay capture, reset and status all use source/origin/session-checked
messages. Capture results are parsed and bounded again by the editor.

Filesystem grants bind to a single browser document. Reload obtains a fresh
bridge session and retains its current overlay (including envbuild output); stale sessions and other clients cannot reuse its data grant.
Reset disposes the running VM first, then clears only its identity from a fresh
management frame before that frame is removed. It stops the current VM's background sync before clearing. Close other tabs
running the same snapshot before resetting shared state.

Existing local VM files remain on the editor origin; enabling a new VM origin
does not migrate or delete them. Capture project work and overlays before
switching. Copy home files you want to keep into the project before capture;
observe the existing snapshot size limit. You can temporarily return to the
unconfigured local mode to recover the original VM state. Text drafts and
HashBin settings stay on the editor origin.

## What remains restricted

The stopgap DOM, storage, raw worker, Go/JS, picker and download restrictions
remain enabled. Origin isolation protects the editor, but arbitrary JavaScript
on one shared VM origin would still reach other snapshots in that origin's
IndexedDB. Do not lift those restrictions before per-snapshot storage brokering
and capability consent are implemented.

No credential vault is needed: HashBin saves are approved on hashbin.org through
HashBin Publish, so neither editor nor VM holds a HashBin credential. `authURL`
is retired and rejects nonempty configuration. A HashBin registration for the
editor needs its exact return URL (for Pages, `https://curtcox.github.io/apptron/`).

## Local verification

```sh
npm test
APPTRON_BOOT=1 scripts/test-browser-container.sh \
  tests/browser/boot.spec.cjs tests/browser/isolation.spec.cjs --project=chromium
```

The isolation suite starts a second local server, boots the real VM there, and
checks editor DOM/storage access denial, native WASI, Python overlays, capture,
reload persistence, stale messages and reset through the bridge. It uses a fresh
browser profile and account stubs; no real OAuth account is charged.
