# Gallery expansion plan

Goal: the gallery should show the whole range of what Apptron can do, not only
"hello world in language X". It should cover the ordinary uses, the uses only
Apptron supports, and the extreme ones that test the limits of a Linux VM in a
browser tab.

## Where the gallery is today

Nine examples. Each one shows that a toolchain starts:

| Example | What it shows | Overlay |
|---|---|---|
| hello-shell | busybox shell, `uname` | none |
| go-hello | offline Go toolchain (lazy bundles, tmpfs workaround) | Go bundles |
| python | Python from a prebuilt overlay | python (15 MiB) |
| c-make | C + Make | c (89 MiB) |
| node | Node + npm | node (26 MiB) |
| esbuild | bundle two modules with the preinstalled esbuild | none |
| wasm | native WASI execution through binfmt_misc | none |
| fun | cowsay, figlet, sl | fun (9 MiB) |
| envbuild | `apk add` through a user's relay | relay |

Gaps:

- Every example is a smoke test. None does real work, runs longer than a few
  seconds, or rewards the reader for opening it.
- No example uses what only Wanix and Apptron provide: the browser exposed as
  files (`/web/dom`, `/web/dl`, `/web/opfs`), Wasm tasks (`/task/new/gojs`),
  Plan 9-style namespaces (`/ctl bind`), the framebuffer, or nested VMs.
- No example shows the product's own features: capture, overlays, persistence,
  binary sections, QR-sized snapshots.
- Nothing shows servers, databases, data processing, systems programming,
  teaching, or publishing.
- Cards have only a language label. There are no categories, no download sizes,
  and no "Chromium only" or "uses the screen" badges.

## What the runtime can do

These come from reading the pinned source (`upstream/apptron` at `c4cb2db`,
Wanix `2b310a9cbd1a`). "Verified" means it already runs in this repo's boot
tests. "Source" means the code path exists but has not been run here. Each
"source" item gets a spike before its examples are built.

| Capability | Where | Status |
|---|---|---|
| i386 Alpine 3.22, 1 GiB RAM, busybox, make, git, esbuild, fuse | `Dockerfile` rootfs stage, `boot.go` | Verified |
| Native WASI via binfmt_misc → `aptn exec` → `/task/new/wasi` | `system/bin/init`, `aptn/exec.go` | Verified |
| Go `js/wasm` binaries run as browser workers (`/task/new/gojs`); a `gocache-wasm` bundle is already shipped | `aptn/exec.go` `detectWASMType`, Wanix `web/web.go` | Source |
| Loopback networking without a relay (`ifconfig lo up`) | `system/bin/init` | Source |
| Whole Wanix namespace inside the VM: `/web`, `/task`, `/vm`, `/cap`, `/ctl`, `/bundle` | `boot.go` binds `.` into `vm/1/fsys` | Source |
| DOM from the shell: `/web/dom/new/{div,iframe,xterm,script}`, per-element `attrs`, `ctl append-child`, `/web/dom/style` | Wanix `web/dom` | Source |
| Browser downloads from the shell: write a file under `/web/dl` | Wanix `web/dl` | Source |
| Browser storage as files: `/web/opfs`, `/web/caches`, `/web/idbfs` | Wanix `web/web.go` | Source |
| Capabilities: `/cap/new/{tmpfs,tarfs,loopback,pickerfs,ws}` (`pickerfs` is the File System Access directory picker; `ws` is a browser WebSocket exposed as a file) | Wanix `cap`, `web/web.go` | Source |
| Namespace control: `echo bind <old> <new> >> /ctl`, `bundle`, `cp`, `sync` | `boot.go` ctl file | Source |
| Framebuffer: kernel has `FB_VESA`, `DRM_BOCHS` and fbdev emulation; the host passes an offscreen `#screen` canvas (currently `display:none`) | `kernel.config`, `vm.html`, `vm-frame.js` | Source |
| Nested VMs: `/vm/new/default` allocates another v86 | Wanix `vm/service.go` | Source |
| FUSE in the kernel, libfuse 2 in the rootfs | `kernel.config`, rootfs stage | Source |
| SysV IPC, binfmt_misc for user handlers | `kernel.config` | Source |

Hard limits that set the boundaries:

- **32-bit x86 only.** No x86_64 binaries. Language packages must exist for
  Alpine `x86`.
- **No IPv6, no netfilter, no ext4, no sound.** No KVM, so no fast nested
  hardware virtualization.
- **Overlays are ≤128 MiB each** (gzip), with a 512 MiB decompression ceiling.
  The site is about 299 MiB, and GitHub Pages allows 1 GB.
- **Snapshots are ≤1 MiB of text.** HashBin documents are ≤5 MiB.
- **No VM network by default.** Examples that need it carry `needsRelay`.
- Emulated x86 is roughly 10–50× slower than native. Examples must finish in
  seconds to a minute, not tens of minutes.

## Phase 0: preconditions

### 0.1 Contain the DOM bridge (security, do first)

The VM iframe (`vm.html`) is same-origin with the editor and has no `sandbox`
attribute (`src/apptron-host.js:58`). From the source, any snapshot's `envrc`
looks able to create a `script` or `iframe` element through `/web/dom`, set its
`src` or `srcdoc` through `attrs`, and run JavaScript in the site's origin. That
origin holds HashBin OAuth tokens (`localStorage` key prefix `apptron:oauth:`,
`src/app.js:42`). On GitHub Pages, `curtcox.github.io` is also the origin of the
owner's other Pages sites. Share links and HashBin loads run untrusted snapshots,
so this matters whether or not the gallery ever uses `/web/dom`.

**Confirmed exploitable (2026-10-27).** The spike ran a snapshot whose `envrc`
created a `<script>` through `/web/dom`, set `src='data:text/javascript,…'` on it
with an append write (`>>`), and appended it to the VM frame's body. The code
executed in the site origin: it set a flag on `window.top` (the editor page) and
read that window's `localStorage`, where HashBin OAuth tokens live. Details and
the exact mechanism are in `docs/implementation.md` under "Security findings".
The containment patch below is therefore required, not optional. Steps:

1. ~~Spike~~ Done. Recorded in `docs/implementation.md`.
2. Add a patch in `patches/` that limits the DOM element types the
   VM can create to `div` and `xterm`. The patch also allowlists attributes:
   no `src`, `srcdoc` or `href`, no `on*` handlers, and no `javascript:` or
   `data:` URLs. Add a boot test that the bypass fails.
3. Longer term, consider serving the VM frame from a separate origin. That
   needs a host other than `curtcox.github.io`, so it is the owner's decision.

Examples that use `/web/dom` (B3 below) wait on this, and they use only what
survives the patch.

### 0.2 Gallery data model and tooling

- Extend each `examples.js` entry with:
  - `category`: one of the groups below.
  - `tags`.
  - `try`: the command the card suggests. It replaces the hard-coded
    `commands` map in `scripts/render-gallery.cjs`.
  - `expect`: text the terminal must show.
  - `timeout`.
  - `needs`: a set of `relay`, `chromium`, `screen`, `go-bundles`.
  - Overlay download size, read from `runtime.json`, never typed by hand.
- Add a parametrized boot spec (`tests/browser/gallery.spec.cjs`) that boots
  every example, runs `try`, and waits for `expect`. Examples that need a relay
  or a specific browser are skipped with a reason.
- Add a unit test that every entry has a txtar file, a screenshot, and an
  existing `.packages` file for any `overlay: gallery/<name>` header.
- `scripts/probe-overlay.sh <packages…>`: build a throwaway overlay and print its
  compressed size before anyone commits a `.packages` file.
- Budget: about 450 MiB of new overlays, keeping the site under 800 MiB. Prefer
  extending a shared overlay over adding one per example. Any overlay over
  40 MiB needs a reason in this file.

### 0.3 Gallery UI

- Category chips above the search box, plus a "Start here" row of three or four
  examples.
- Card badges for download size, "Needs relay", "Chromium only" and "Uses
  screen".
- Search also matches tags.

### 0.4 Screen pane (for C3 and G4)

The VM pane gets a Terminal/Screen toggle that shows the existing `#screen`
canvas. An example asks for it with a new header line, `screen: true`. Unknown
header keys are already kept and ignored, so older pages stay compatible.
A spike must first show that `/dev/fb0` exists and that pixels reach the canvas
in console mode.

## The catalog

IDs are proposed names. Each example's "Overlay" column says what it needs:
"none" means the base image or a shipped bundle is enough; "reuse" names an
existing overlay; "new" names a new one, with its size unknown until probed. A
"Spike" mark means the capability is "Source" above and gets proven first.

### A. Languages, wide and odd

The goal is breadth and surprise, not one card per language. Group small
runtimes into shared overlays.

| ID | What it does | Overlay | Notes |
|---|---|---|---|
| polyglot-fizzbuzz | One Makefile runs FizzBuzz in shell, awk, Lua, Tcl, Scheme, Forth, Perl, and C, and diffs the outputs | new `polyglot` (lua5.4, tcl, chibi-scheme, gforth, perl) + reuse c | One overlay, eight languages |
| x86-asm | 32-bit x86 assembly with raw `int 0x80` syscalls, no libc. The browser emulates the CPU the code targets | new `asm` (nasm, binutils) | Shows that v86 runs real x86 code |
| tiny-compiler | An original ~200-line Python compiler for a toy expression language that emits x86 assembly, assembles it with `as`, and runs it | reuse python + c | Source to machine code in one tab |
| go-to-wasm | Compile Go to `js/wasm` inside the VM, then run the result as a browser worker through `/task/new/gojs` | Go bundles | Spike. Uses the shipped `gocache-wasm` |
| c-to-wasi | Compile C to wasm32-wasi with clang and wasi-libc, then run it natively through binfmt | new `wasi-sdk` (clang, lld, wasi-libc) | Probe size. If over 128 MiB, drop it and note why |
| two-machines | Compile the same original C benchmark to i386 and to WASI, then time both. Emulated x86 against native Wasm in one tab | depends on c-to-wasi | The clearest "why this is interesting" demo |
| retro-langs | COBOL, Fortran, or Pascal: whichever has small enough x86 packages | probe gnucobol, gfortran, fpc | Ship the one or two that fit |

Out of scope, and why: Rust (toolchain far over 128 MiB), Haskell and pandoc
(no i386 GHC), LaTeX (size), Java (size and speed). These are listed in the
gallery note so readers know the limit is deliberate.

### B. Only in a browser (Wanix-native)

The examples that most justify the project.

| ID | What it does | Overlay | Notes |
|---|---|---|---|
| plan9-namespace | Tour `/task`, `/vm`, `/web`, `/cap`, then `echo bind … >> /ctl` to remix the filesystem, Plan 9 style | none | Spike for `ctl` from inside the VM |
| download-from-shell | Build a tarball or report in the VM and copy it to `/web/dl/`. The browser downloads it | none | Spike. Playwright asserts the download event |
| shell-draws-page | Create a `div` and a stylesheet from the shell. The terminal decorates its own page | none | Waits on 0.1. Uses only what survives containment |
| browser-storage-ls | `ls` and `du` on `/web/caches` and `/web/opfs`: the runtime's own cache, seen from inside Linux | none | Same-origin data only. Read-only |
| mount-my-folder | Mount a real folder from your disk with `/cap/new/pickerfs` and `grep` through it | none | Spike: whether the picker's user gesture survives the trip through the VM. Chromium only |
| wasm-binfmt-explained | Show `/proc/sys/fs/binfmt_misc/wasm` and run the same `.wasm` file directly, through `aptn exec`, and as a renamed file | none | Builds on the existing wasm example |

Moonshots, each a spike before any commitment:

- **vm-in-vm**: allocate a second v86 through `/vm/new/default` and boot a tiny
  image on it.
- **ws-from-shell**: a browser WebSocket through `/cap/new/ws`. This is network
  access without a relay, so it runs only when the user types the command,
  never from `envrc`, and only after 0.1. It needs the owner's approval because
  `AGENTS.md` keeps VM networking off by default.

### C. Systems: it's a real kernel

| ID | What it does | Overlay | Notes |
|---|---|---|---|
| inside-linux | Guided tour of `/proc`, `/sys`, `dmesg`, `ps`, `top`, mounts, the 9p root, and the 1 GiB memory map | none | Zero download |
| my-binfmt | Register your own binfmt_misc handler, so files with a made-up magic header run through a shell interpreter you wrote | none | Uses the same mechanism Apptron uses for Wasm |
| framebuffer-art | An original C plasma or Mandelbrot written straight to `/dev/fb0`, shown in the Screen pane | reuse c | Waits on 0.4 |
| python-fuse | A FUSE filesystem in Python: fusepy (one ISC-licensed file, shipped in the snapshot with its notice) over the base libfuse 2 | reuse python | Spike: does FUSE mount on the 9p root |
| processes-ipc | Pipelines, FIFOs, signals, job control, SysV shared memory between two C programs | reuse c | |
| users-and-jails | `adduser`, file permissions, setuid, and a `chroot` jail built by hand | none | |
| memory-safety-lab | Compile one original program with and without `-fstack-protector` and watch the canary abort | reuse c | Teaching only. No exploit payloads |

### D. Servers and networks, inside one tab

Loopback works without a relay, so client and server can share the VM.

| ID | What it does | Overlay | Notes |
|---|---|---|---|
| tab-web-server | Serve `/project` over HTTP and fetch it with `wget` from a second process | none, or reuse python (`http.server`) | Spike: busybox `httpd` applet availability |
| sqlite-sql | A real SQL session on a CSV loaded into SQLite through Python's `sqlite3` module | reuse python | |
| postgres-in-a-tab | `initdb`, start Postgres, run queries | new `postgres` | Probe size and `initdb` time. Push the corner, drop it if it takes minutes |
| git-offline | `git init`, branches, a merge conflict, and `git bisect` finding a planted bug | none | git is in the base image |
| two-tab-chat | Two browser tabs on the same relay talk over their session IPs with `nc` | none | `needsRelay` |

### E. Data

| ID | What it does | Overlay | Notes |
|---|---|---|---|
| unix-data | An awk, sed, sort, uniq and join pipeline over a CSV in the snapshot | none | |
| data-tools | `jq`, `mlr` and SQLite on the same data, plus a terminal chart | new `data` (jq, miller, sqlite) | Small. Also lets the envbuild example run its `jq` offline |
| numpy-offline | NumPy array math with no network | new `science` (py3-numpy) on top of python | Probe size |

### F. Make things and take them home

These pair a build with `/web/dl` or the editor's capture.

| ID | What it does | Overlay | Notes |
|---|---|---|---|
| static-site | Markdown to HTML with a Makefile, zipped and downloaded | new small (lowdown or cmark) | |
| diagram-to-svg | Graphviz `dot` renders an SVG that the browser downloads | new `graphviz` | Probe size |
| synth-wav | Synthesize an original tune in Python and download the WAV. Sound with no sound card | reuse python | |
| man-page | Write and render a man page with mandoc | new small | |

### G. Play (all original)

| ID | What it does | Overlay | Notes |
|---|---|---|---|
| shell-adventure | An original text adventure written in POSIX shell | none | |
| life-in-awk | Conway's Life animated in awk with ANSI escapes | none | |
| dialog-forms | A small terminal UI built with `dialog` | new tiny or add to `fun` | |
| framebuffer-toy | An original interactive framebuffer demo | reuse c | Waits on 0.4. Input is a spike |

### H. The product itself

Examples that teach Apptron Online's own features.

| ID | What it does | Overlay | Notes |
|---|---|---|---|
| what-persists | Write to `/project`, `/home`, `/tmp` and `/usr`, press Reset, see what survives | none | Explains the storage model |
| capture-and-share | Build something from source, install it to `/usr/local`, use Capture overlay, then share | reuse c | A walkthrough card. HashBin save stays behind quote-and-confirm |
| binary-snapshot | A snapshot that carries an image as a base64 section and shows it (in the Screen pane, or by checking its hash) | none | |
| qr-sized | The smallest useful snapshot: fits in a QR code and still does something delightful | none | A unit test checks QR capacity |
| tdd-kata | Failing tests in the snapshot. Make them pass and share your solution link | none or reuse python | Sharing as a teaching workflow |
| agent-sandbox | Run an untrusted script and watch it fail to reach the network or the page | none | Only after 0.1 makes "the page" true |

## Order of work

1. **Phase 0.1** spike and, if needed, the containment patch.
2. **Phase 0.2** data model, parametrized gallery boot spec, probe script.
3. **Wave 1: zero-download and existing overlays.** inside-linux, my-binfmt,
   git-offline, unix-data, shell-adventure, life-in-awk, what-persists,
   sqlite-sql, synth-wav, tiny-compiler, processes-ipc, users-and-jails,
   tdd-kata, qr-sized. About 14 examples and no new site bytes. Phase 0.3 UI
   lands here, because 23 cards need categories.
4. **Wave 2: Wanix spikes.** plan9-namespace, download-from-shell, go-to-wasm,
   tab-web-server, browser-storage-ls, wasm-binfmt-explained. Each spike either
   produces an example or a line in `docs/implementation.md` saying why not.
5. **Wave 3: small new overlays.** polyglot, asm, data, mandoc/lowdown,
   graphviz, after `probe-overlay.sh` sizes are recorded here.
6. **Wave 4: screen and big corners.** Phase 0.4, then framebuffer-art,
   python-fuse, c-to-wasi, two-machines, postgres-in-a-tab, numpy-offline,
   mount-my-folder, shell-draws-page.
7. **Moonshots.** vm-in-vm, ws-from-shell. Spikes only, with owner sign-off
   for ws-from-shell.

## Definition of done for each example

- A txtar in `examples/` with a short `envrc` banner that says what to try.
- An entry in `examples.js` with category, tags, `try`, `expect` and `needs`.
- It passes the gallery boot spec in Chromium from a cold cache, under its
  timeout.
- A real screenshot from `scripts/render-gallery.cjs`. No simulated output.
- Any new overlay has a `.packages` file, a recorded probe size, and a line in
  `runtime.json` from the runtime build. No hand-written sizes or hashes.
- Third-party code shipped inside a snapshot carries its license notice.
- No relay settings in the example and no network by default.
- `docs.html` gets a sentence for any new capability the example relies on.

## Risks

- **Spikes may fail.** The "Source" capabilities are unexercised here. Each
  failure is recorded and the example dropped. Upstream fixes go in `patches/`,
  never in the submodule.
- **Size creep.** Enforced by the 0.2 budget and the probe step.
- **Runtime upgrades** can change package availability or Wanix paths. The
  gallery boot spec catches it, and overlays rebuild with each runtime.
- **Slow examples** feel broken. Every example has a timeout and prints progress.
- **Browser differences.** pickerfs and some worker features are Chromium only.
  These are badged and skipped in other browsers' tests.
