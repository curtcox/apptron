# ApptronOnline plan

Goal: a static GitHub Pages site at `https://curtcox.github.io/apptron/` where you
write an Apptron *snapshot* in the browser, boot it in a real Apptron Linux VM in
the same tab, and share it via URL, QR code or HashBin, the way
[ManimOnline](https://curtcox.github.io/ManimOnline/) does for diagrams.

## Decisions

| Topic | Decision |
|---|---|
| Snapshot | Two kinds: a **text snapshot** (project files + Apptron setup scripts) and an optional **disk overlay** (tar.gz of everything changed in the VM, e.g. installed packages), linked from the text snapshot by HashBin CID or gallery path. |
| Runtime | Built in GitHub Actions from [tractordev/apptron](https://github.com/tractordev/apptron) source, pinned as a git submodule, and served from this site. Nothing is loaded from apptron.dev. |
| Network | No VM network by default, because GitHub Pages can't host Apptron's WebSocket relay. Users can point the page at a relay they run themselves (the repo's `worker/cmd/worker`). Gallery samples that need packages get them from overlays prebuilt in CI. |
| UI | Ace editor on the snapshot (left), Apptron "console" mode xterm on the running VM (right). No VS Code workbench. |
| Capture | **Capture snapshot** reads `/project` and the scripts back from the VM into the editor; **Capture overlay** packs the VM's changed files into a tar.gz for HashBin. |
| Publishing | Same as ManimOnline: `.github/workflows/deploy.yml` uploads the site with `actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4` on push to `main`; `test.yml` runs Node unit tests and Playwright browser checks. The deploy adds the built runtime to the Pages artifact. |

## What the Apptron repo provides, and what we use

| Repo item | What it is | Use |
|---|---|---|
| `boot.go` + `go.mod` | Go boot code; `GOOS=js GOARCH=wasm go build` → `wanix.wasm` (~21 MB) | Built unmodified. |
| `Dockerfile` stage `bundle-sys` | i386 Alpine rootfs + `system/` scripts + kernel + v86 → `sys.tar.gz` (~43 MB) | Built unmodified. |
| `Dockerfile` stages `bundle-goroot`, `bundle-gocache-*` | Go 1.25 toolchain and precompiled std library bundles (`.tar.br`) | Built, re-compressed as gzip (see below). Lets the Go sample work offline. |
| `Makefile` `assets/wanix.min.js` | Wanix JS loader, copied from the `ghcr.io/tractordev/wanix:runtime` image | Copied the same way, pinned by image digest. |
| `system/kernel` | Kernel build; the Dockerfile uses the prebuilt `ghcr.io/tractordev/apptron:kernel` image | Used through the Dockerfile, pinned by digest. |
| `worker/cmd/worker` | Network relay (virtual network over WebSocket) and bundle server | Not hosted on Pages; documented as the optional self-hosted relay. |
| `assets/_env.html`, `assets/lib/apptron.js` | apptron.dev page code | Reference for our host module. Not served: it assumes apptron.dev subdomains, Hanko sign-in and absolute paths. |
| `worker/src/r2fs.ts` | apptron.dev's file-sync HTTP API | Reference for the service worker protocol. |
| VS Code web zip, Hanko, Cloudflare worker | apptron.dev's IDE, sign-in and hosting | Not used. |

## Building the runtime

- `upstream/apptron` is a git submodule pinned to a commit (currently `c4cb2db`, v0.7.0).
  Dependabot's `gitsubmodule` ecosystem opens a PR when upstream moves.
- `.github/workflows/runtime.yml` runs when the submodule commit changes (or on demand):
  1. Set up QEMU and Buildx (the rootfs stage runs i386 Alpine).
  2. `docker buildx build --target bundle-sys`, `bundle-goroot`, `bundle-gocache-386`
     and `bundle-gocache-wasm` from the submodule, using the GitHub Actions build cache,
     then copy `/bundles/*` out.
  3. Build `wanix.wasm` with Go 1.25 using the Makefile's `wasm` target.
  4. Copy `wanix.min.js` and `wanix.js` out of `ghcr.io/tractordev/wanix:runtime`.
  5. Build the gallery overlays (below).
  6. Write `runtime.json` (upstream commit, image digests, file sizes, SHA-256s) and
     publish everything as a GitHub Release named `runtime-<commit>`.
- `deploy.yml` downloads the release named in `runtime.lock` into
  `runtime/<commit>/` in the Pages artifact. Runtime files are never committed to git.
  Versioned paths let browsers cache them indefinitely and switch cleanly on upgrade.
- **Compression.** apptron.dev serves bundles with `Content-Encoding: gzip`/`br` so the
  browser unpacks them; GitHub Pages can't set that header. The host module unpacks
  `.tar.gz` with the built-in `DecompressionStream('gzip')`. Brotli has no built-in
  browser decoder, so `runtime.yml` re-compresses the Go bundles as gzip, and the
  host's `_getBundle` maps the `.tar.br` names that `boot.go` asks for to those files.
- **Size.** Pages sites are limited to 1 GB. Expected total is ~64 MB core +
  Go bundles (to be measured; estimate under 300 MB) + overlays. The Go bundles download
  only when the user runs `source /etc/goprofile`.
- Local development: `scripts/build-runtime.sh` runs the same steps with Docker, or
  `scripts/fetch-runtime.sh` downloads the current release into `runtime/`.

## How Apptron boots, and how we drive it unchanged

The Go boot code (in `wanix.wasm`) reads `window.apptron`, then:

1. mounts the Alpine rootfs from `sys.tar.gz` as a copy-on-write layer
   (`#env` = bundle rootfs ∪ IndexedDB `env/<uuid>/overlay`; writes go to `#scratch`);
2. boots v86, with networking only if the runtime is given a relay URL;
3. syncs `/project`, `/home/<user>` and `/public` between IndexedDB and an HTTP file
   API at `<window.apptron.origin>/data/...` (r2fs protocol: GET with `/...` index,
   HEAD, PUT, PATCH tar, DELETE, MOVE/COPY).

Inside the VM, `/bin/init` runs `.apptron/envbuild` (rebuilding the overlay when it is
newer), then `/bin/start` sources `.apptron/envrc` and starts the shell.

Our `src/apptron-host.js` replaces `_env.html` + `lib/apptron.js` for console mode:

- `window.apptron = {mode: "console", embedded: false, user: {username: "guest",
  user_id: <per-browser id>}, env: {uuid: <snapshot id>, name: "snapshot",
  owner: <same user_id>}, origin: <this site>, publishURL: async () => ""}`.
- `WanixRuntime` from `runtime/<commit>/wanix.min.js`, with `network` set only when the
  user has configured a relay URL.
- `_bundle`, `_getBundle` and the wasm loader fetch from `runtime/<commit>/`, unpack gzip,
  and cache in Cache Storage.
- The console is attached the same way `_env.html` does it (`web/dom/new/xterm`, bind
  `#console/data`).
- **A service worker answers `/data/usr/...` and `/data/env/<uuid>/{project,public}`**
  with the r2fs protocol, backed by the current snapshot in IndexedDB. The unchanged boot
  code then treats the snapshot as an Apptron project, and its own 5-second sync pushes
  VM edits back to the service worker, which is where Capture reads them.
- Each snapshot gets a fresh `uuid` (hash of its text), so IndexedDB state from one
  snapshot never leaks into another. "Reset VM" clears that uuid's keys.
- If something requires changing upstream code, the change goes in `patches/*.patch`,
  applied by `runtime.yml` before building (as ManimOnline does for modl), and is
  offered upstream.

**Network relay setting.** A "Network" item in the toolbar's More menu takes a
`ws://` or `wss://` relay URL, stored per browser and never put in share links. The docs
explain running the repo's relay locally (`docker build --target worker` from the
submodule and `docker run -p 8080:8080`, then `ws://localhost:8080/x/net`). Without a
relay, `init` skips DHCP, and `apk add` reports no network. The page says so once,
pointing to the docs and the prebuilt-overlay samples.

## Snapshot format

Text snapshots use **txtar** (the Go tools format: header, then `-- path --` sections),
so they are readable in a URL, a QR code and an editor:

```
# apptron snapshot v1
overlay: gallery/python   (or a HashBin CID; optional)
-- .apptron/envrc --
echo "Try: python3 hello.py"
-- hello.py --
print("hello from Apptron")
```

- Header lines are `key: value`; unknown keys are kept and ignored. `v1` is checked.
- Binary files use `-- name (base64) --`. Limits: 1 MiB of text per snapshot,
  5 MiB per HashBin document (matching ManimOnline).
- A disk overlay is a `tar.gz` of `#scratch` (minus `/project`, `/home`, `/public`,
  `/proc`, `/sys`, `/dev`, `/tmp`), with a `.apptron-overlay.json` manifest (upstream
  commit, created time, file count). On boot it is unpacked into IndexedDB
  `env/<uuid>/overlay`, which Apptron already unions into the root. Overlays record the
  runtime commit they were made on; loading one from a different commit shows a warning.
- `overlay:` is either a HashBin CID or `gallery/<name>`, a prebuilt overlay on this site.
- HashBin documents reuse ManimOnline's `hashbin-diagram` envelope:
  `{format: "hashbin-diagram", version: 1, type: "apptron", src: <txtar>}`; overlays are
  stored as raw `application/gzip`.

## Prebuilt package overlays

Without a relay, the VM can't `apk add`. `runtime.yml` builds overlays for gallery samples
in Docker instead: start from the same i386 Alpine rootfs stage, `apk add <packages>`,
and tar only the files that differ from the base (`examples/overlays/<name>.packages`
lists the packages). These match what Apptron's own `envbuild` would produce, are
published at `runtime/<commit>/overlays/<name>.tar.gz`, and are referenced as
`overlay: gallery/<name>`. Initial set: `python` (python3), `c` (build-base), `node`
(nodejs, npm), `fun` (sl, cowsay, figlet). Each is size-checked in CI.

## Features (parity with ManimOnline, adapted)

1. **Editor + live VM.** Ace with a txtar mode (section headers highlighted, per-file
   syntax by extension). **Run** boots or reboots the VM with the current snapshot;
   unlike Graphviz there is no auto-render on every keystroke (first boot downloads
   ~64 MB, cached afterwards). The status line shows download progress, boot phase,
   network state and the runtime commit.
2. **Capture snapshot / Capture overlay** as above. Capture warns before replacing
   unsaved editor text and skips files over the size cap, listing them.
3. **Share link.** Same scheme as ManimOnline: `?compressed=` LZString (vendored
   lz-string 1.5.0) with a `#` fallback, Copy button, optional is.gd shortening via the
   same `ShareClient`.
4. **QR code.** New compared with ManimOnline's editor: a **QR code** button opens a
   dialog with the share link's QR (vendored MIT `qrcode-generator`), plus PNG download.
   If the link exceeds QR capacity (~2.9 KB) it says so and offers the HashBin link,
   which always fits.
5. **HashBin.** Port `src/hashbin.js` and `src/hashbin-panel.js`: load by CID, by
   `256t.us` link or by `#<cid>` URL; save with OAuth connect, quote, confirm; editor
   source preserved across sign-in; stale loads discarded. Needs a newly registered
   HashBin app for `https://curtcox.github.io/apptron/` (public client ID in a
   `hashbin-client-id` meta tag).
6. **Docs.** `docs.html`: snapshot format, overlays, what persists, limits, running a
   relay, building the runtime locally, links to the
   [Apptron user guide](https://github.com/tractordev/apptron#user-guide),
   [Wanix](https://github.com/tractordev/wanix) and
   [Alpine packages](https://pkgs.alpinelinux.org/packages). Toolbar link "Docs ↗".
7. **Gallery.** `gallery.html` + `src/gallery.js` with searchable cards (title,
   description, captured terminal screenshot, "needs relay" badge where relevant),
   **Load in editor** and `?example=<id>` links, as in ManimOnline. Initial samples, all
   working offline unless marked:
   - Hello shell (files + envrc)
   - Go hello (`source /etc/goprofile`, Go bundles from this site)
   - Python script (`overlay: gallery/python`)
   - C with Make (`overlay: gallery/c`)
   - Node script (`overlay: gallery/node`)
   - esbuild bundle (esbuild is in the base image)
   - Wasm binary (Apptron runs Wasm executables natively)
   - Fun (`overlay: gallery/fun`: sl, cowsay, figlet)
   - `envbuild` with `apk add` (needs relay)
   
   Screenshots are generated by a Playwright script and committed as shipped assets.
8. **Mobile.** ManimOnline's layout rules: ≤760 px stacks toolbar, editor and terminal;
   Preview/Code toggle; wrapping toolbar with a **More** menu; larger touch targets;
   terminal refits on resize and on the virtual keyboard (`visualViewport`); a key bar
   for Ctrl, Esc, Tab and arrows, which phone keyboards lack.

## Repository layout

```
index.html              editor page
gallery.html  docs.html
upstream/apptron        git submodule (tractordev/apptron, pinned)
runtime.lock            release name + SHA-256s of the runtime files to deploy
patches/                upstream patches, empty unless a spike requires one
src/
  apptron-host.js       window.apptron config, runtime loading, console attach
  data-sw.js            service worker: r2fs protocol over IndexedDB snapshot store
  snapshot.js           txtar parse/serialize, limits, uuid
  overlay.js            capture #scratch -> tar.gz, restore into idbfs overlay
  capture.js            read /project back from the store
  hashbin.js  hashbin-panel.js  share-links.js   (ported from ManimOnline)
  qr-panel.js           QR dialog
  network.js            relay URL setting
  examples.js gallery.js gallery.css
  mobile.css  keybar.js
vendor/
  ace/  lz-string.min.js  qrcode-generator.js  (+ LICENSE files)
examples/*.txtar        gallery sources
examples/overlays/*.packages
scripts/build-runtime.sh  fetch-runtime.sh  build-overlays.sh  render-gallery.cjs
tests/*.test.js         node --test unit tests
tests/browser/*.cjs     Playwright checks
.github/workflows/deploy.yml  test.yml  runtime.yml
.github/dependabot.yml
LICENSE-graphvizonline  README.md  AGENTS.md
```

## Milestones

0. **Spikes (go/no-go, before building the UI).** On localhost with a static server:
   (a) build the runtime from the submodule with `scripts/build-runtime.sh`, boot it from
   a subpath (as on Pages) and reach a shell in console mode; (b) the service worker
   satisfies Apptron's project/home/public sync; (c) gzip-unpacked bundles, including the
   Go bundles under their `.tar.br` names, load correctly; (d) a Docker-built overlay
   unions into the root and `python3` runs; (e) write and read back `#scratch` from JS;
   (f) the relay built from `worker/cmd/worker` works from `ws://localhost`.
   Fallbacks: if (b) fails, a small `boot.go` patch to read the project from a JS
   callback instead of HTTP; if (d) fails, overlays become Wanix bundles the snapshot
   mounts and links in with `envrc`.
1. **Runtime pipeline.** Submodule, `runtime.yml`, release, `runtime.lock`, Dependabot.
2. **Skeleton + publishing.** `deploy.yml` with runtime download, `test.yml`, README,
   AGENTS.md, empty editor page live on Pages.
3. **Editor + VM.** Ace txtar mode, Run, terminal, status/progress, Reset VM, relay setting.
4. **Snapshot model.** txtar module with tests, service worker store, Capture snapshot.
5. **Sharing.** Share links, shortening, QR dialog.
6. **HashBin.** Port and adapt with tests; register the app; Save/Load text snapshots.
7. **Overlays.** Prebuilt gallery overlays, Capture overlay, upload, restore on boot,
   size limits.
8. **Gallery + docs.** Samples, screenshots, gallery page, docs page.
9. **Mobile pass.** Layout, key bar, Playwright checks at phone size in Chromium,
   Firefox and WebKit.
10. **Hardening.** Slow-network and quota messages, upgrade between runtime commits,
    error recovery, README feature list.

## Tests

- Unit (`node --test`): txtar round trip and limits, uuid stability, r2fs service worker
  handlers against a fake store, overlay tar pack/unpack, bundle name mapping, share link
  build, HashBin documents, QR capacity decision.
- Browser (Playwright, matrix like ManimOnline): editor loads, share and QR round trip,
  HashBin load with a stubbed `256t.us`, gallery cards load into the editor, phone layout.
- Boot (Chromium, in `test.yml` after downloading the locked runtime): boot to a shell,
  edit a file in the VM, Capture it back; run the Python overlay sample.
- `runtime.yml` smoke check: the built runtime boots to a shell before the release is
  published.

## Needs from you

- Register a HashBin app with return address `https://curtcox.github.io/apptron/` and
  send me its public client ID. A placeholder works until then.
- Set GitHub Pages for this repo to deploy from "GitHub Actions".
- Allow Actions to create releases in this repo (default `GITHUB_TOKEN` with
  `contents: write` in `runtime.yml`).
- The Apptron repo has no license, and this site will publicly redistribute builds of it.
  Ask tractordev for permission or a license before the site goes public.

## Risks

- **Licensing:** as above. Building from source doesn't change that.
- **No network by default:** `apk add` and Apptron's public port URLs need a relay that
  GitHub Pages can't host. Prebuilt overlays cover the gallery; the docs cover running a
  relay.
- **CI build time and fragility:** the Docker build emulates i386 and compiles Go's
  std library twice. It's cached and only reruns on upstream changes, but a first build
  may take 30+ minutes, and it depends on `ghcr.io` images (kernel, v86, wanix runtime)
  staying available. Digests are pinned, and the last good release stays deployable.
- **Wanix loader mismatch:** the Makefile takes `wanix:runtime` at whatever is current,
  which may not match the Wanix version in `go.mod`. The boot smoke check catches it.
- **Overlays across runtime upgrades:** a saved overlay may not fit a newer rootfs; the
  page warns, and gallery overlays rebuild with each runtime.
- First boot downloads ~64 MB, slow on phones; cached afterwards.
- Overlays with large packages exceed HashBin's 5 MiB; the docs steer users to prebuilt
  overlays or `envbuild` with a relay.
- Phone keyboards and xterm interplay needs real-device testing.
