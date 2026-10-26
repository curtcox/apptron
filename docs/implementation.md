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

## Implemented

The editor, VM host, subpath-safe service worker, snapshot parser/capture,
overlay capture/restore, compressed and shortened sharing links, QR generator,
HashBin load/save/OAuth/quote controls, mobile key bar, nine examples, searchable
gallery, docs, runtime scripts, release/Pages workflows, and Dependabot config
are present. Vendored browser dependencies have license notices and a refresh
script. Large runtime files are ignored.

## Verification

- 19 Node tests pass for txtar, limits, UUIDs, r2fs, tar/gzip, overlay storage,
  sharing, HashBin documents and OAuth restoration, QR limits and relay URLs.
- Editor browser checks cover Chromium, Firefox and WebKit at desktop and phone
  sizes (30 checks). Firefox was run in the official Playwright Linux container
  because the cached macOS build could not create its temporary profile.
- Real Chromium boot checks verify a shell, a shell-written file captured into
  the editor, the Docker-built Python overlay offline, offline Go compilation,
  native WASI execution, and a captured overlay restored into a fresh VM with Python and scratch files intact.
- The optional worker relay builds and accepts a localhost WebSocket connection.
- Runtime manifests verify all 11 runtime files, including four overlays.
- Gallery images are actual terminal captures. No sample output is simulated.

## External setup and limits

HashBin registration is intentionally left to the owner: the meta client ID is
empty and save controls explain what is missing. OAuth restoration and saving
are tested with stubs; no real account was charged. Live is.gd availability is
not required by tests. The owner has requested publication to GitHub Pages. Deployment is controlled
by `APPTRON_DEPLOY_ENABLED`, and Pages is configured to use GitHub Actions.
The Runtime workflow can reuse an existing checksum-verified release; new builds
publish an immutable release and commit the generated lock. Runtime verification
also checks that the release contains the patches from the current checkout.

Snapshots do not represent empty directories, symlinks, or executable mode;
capture skips symlinks and reports omissions. Set permissions in envrc.
Overlays preserve files, modes and links, but not deletion of base-image files.
Physical phone keyboard behavior still needs real-device testing. Browser
viewport tests do not establish real-device compatibility.
