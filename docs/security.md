# Security model, risks, and solutions

## Purpose

Apptron Online runs **untrusted code** — a snapshot someone shares with you — on
**your** device, inside your browser, under an origin that also holds your
credentials and your other GitHub Pages apps. That is the whole point of the
product and also its central danger.

This document exists to find the design that **empowers users as fully as
possible while keeping them safe**. Those two goals pull in opposite directions
only if safety is bought by taking capabilities away. The thesis here is that
they do not have to: with the right trust boundary, a snapshot can keep — even
grow — its power over its own world while losing all power over yours. The bulk
of this document is the menu of solutions and the argument for which combination
reaches that goal.

Read this with [plan.md](plan.md) (architecture) and
[implementation.md](implementation.md) (what is built, including the confirmed
finding under "Security findings"). The gallery expansion in
[gallery-plan.md](gallery-plan.md) is gated on the fixes below.

Conventions: dates are UTC. Code references are to this repo at the time of
writing; Wanix paths are as of the commit pinned in `runtime.lock`, and the
capability table must be rechecked whenever that pin moves. Severity uses the
scale in [Severity scale](#severity-scale).

## Implementation status

The analysis below records the original shared-origin design and its risks. This
checkout implements the immediate containment layer, not the complete target
architecture:

- **A1:** patched DOM allocation/attributes/CSS; guest Go/JS tasks and raw worker
  creation are also closed, since syscall/js would bypass the DOM restrictions.
- **A3:** the guest receives only its snapshot's `/snapshot-storage` tree, plus
  the existing scoped home/project mounts. OPFS and caches are absent. The
  pinned IDBFS backend's cross-root symlink behavior was reproduced with a private
  marker and is patched: direct backend opens fail on symlinks, while Linux
  resolves links through its own namespace. Read, write and rebind regressions
  cover this path. Filesystem
  HTTP requests use revocable per-boot grants restricted to the current mounts.
- **C2/E:** synchronous, path-derived CSP in both documents; no inline/data/blob
  page scripts. Required runtime page scripts are static assets with SRI; worker imports are
  checked by the service worker against the locked manifest.
  Blob workers, their static runtime imports, and Wasm compilation remain allowed. Connections are limited to
  runtime assets, the scoped data endpoint, and the exact selected relay. All
  data responses, including errors, carry `nosniff` and `CSP: sandbox`.
- **W3/W4/D3/D4:** overlay paths, ancestors, links and duplicates are checked
  before restore; downloaded HashBin bytes are verified against their CID.
  Incoming loads confirm before replacing a restored or dirty draft; provenance
  survives edits/reloads. Restored/changed relays require session consent and
  appear beside Run. The snapshot area is labelled; credential and price prompts
  stay in the host.
- **B3:** keyboard, resize, project/overlay capture and reset use a small bridge with
  source/origin/session checks, command validation, bounded captures, timeouts,
  and cancellation. Application code no longer reaches through `host.instance`.

**B1 was rejected by the browser spike:** in Chromium an opaque `allow-scripts`
frame has no SharedArrayBuffer and is not cross-origin isolated. Opening IndexedDB
throws `SecurityError` in all three tested engines, and OPFS is unavailable too. The
other engines expose SharedArrayBuffer, but storage still prevents this design
from supporting this runtime's durable storage and WASI requirements. The executable spike lives in
`tests/browser/isolation-spike.spec.cjs`.

**B2 is prepared, awaiting hosting configuration:** the editor pins a VM entry
URL, the VM pins the editor origin, and storage/capture/reset operations run in
the VM origin behind the bridge. Both sides verify matching runtime locks.
T2 runs against a real VM on a second local origin, including parent DOM/storage
and editor API access denial. Role-specific packaging and required first-response
headers are documented in [deployment.md](deployment.md). No production VM
origin has been selected or activated. With no configured URL the existing
restricted local mode remains; it is not an origin boundary.

**Still pending:** C1's credential vault and A2/D1/D2's capability broker/grant UI.
Picker, download, raw worker, and Go/JS capabilities stay closed. A1 and CSP
remain backstops. Do not enable full DOM code execution on a shared VM origin:
JavaScript can bypass runtime mount scoping and read that origin's other IndexedDB
trees. A separate storage broker or per-snapshot origins are needed before
lifting that restriction.

The VM origin must hold no credentials. A credential vault needs an origin
separate from both the editor and any origin running guest JavaScript. Publishing
another path on the owner's existing `*.github.io` does not create an origin.
Local runtime artifacts and their measured hashes are generated by the build;
the newly named immutable release still needs publication by the Runtime workflow.

## Design principle

> A snapshot should be able to do anything it likes **to its own sandbox**, and
> nothing at all **to the user** without the user's informed, revocable consent.

"Its own sandbox" is the VM, the VM's storage for **that snapshot only**, and a
frame the snapshot may freely manipulate. "The user" is their credentials, their
saved work (including every *other* snapshot's VM state), their settings, their
other apps, their files, their network, and their machine. The job of the
architecture is to make the first set as large and the second set as controlled
as possible, and to make the boundary between them a real security boundary
rather than an accident of implementation.

## Trust model

| Party | Trusted? | Why |
|---|---|---|
| The person at the keyboard | Yes | It is their device and their session. |
| The site code (this repo) | Yes, and reviewed | Committed, code-reviewed, served from the repo. |
| The pinned runtime (Wanix/Apptron) | Yes, with integrity checks | Built in CI, pinned by commit, verified by SHA-256 at load. |
| A **first-party gallery snapshot** | Yes, and reviewed | Committed to `examples/`, changed only through reviewed PRs. |
| A **gallery overlay** (`gallery/<name>`) | Yes, with integrity checks | Built in CI from `examples/overlays/*.packages`, SHA-256 in the runtime manifest. Its contents are only as trustworthy as the Alpine repositories it draws from, including the tagged **testing** repository used for cowsay. |
| A **third-party snapshot** (share link, HashBin load, pasted txtar, dropped file) | **No** | Authored by anyone, delivered to the victim, executed on Run. |
| A **HashBin-CID overlay** | **No** | Third-party content. It is fetched from `256t.us` and is **not** checked against its CID in the browser (`src/apptron-host.js`), so its integrity also rests on that server. |
| **Stored state** in this origin (`apptron:draft`, `apptron:relay`, IndexedDB) | **No, once any untrusted code has run** | Anything that ran in the origin, or in the VM with `/web/idbfs`, can have written it. |

The hard line is between first-party snapshots (vetted) and third-party ones
(arbitrary). Everything below is about containing the third-party case without
crippling it. Two corollaries are easy to miss: trust does not survive a trip
through storage (an untrusted snapshot saved as the draft is still untrusted),
and a broader capability tier for first-party snapshots (D2) extends that trust
to every package in the gallery overlays.

## Assets at risk

What an attacker gains by running code in the site's origin, in rough order of
severity:

1. **HashBin OAuth tokens.** Stored in `localStorage` under `apptron:oauth:`
   (`src/app.js`). The refresh token is long-lived, so theft gives durable,
   offline, server-side access to the victim's HashBin account with
   `content:write` and `balance:read` scope: create documents as the victim and
   — because the price quote-and-confirm is client-side UI only — spend the
   account's balance by calling the API directly. HashBin documents are
   content-addressed (`src/hashbin.js`), so existing documents and the links
   that name them cannot be rewritten. Whether `content:write` also permits
   deletion is unverified (see open questions).
2. **Data from every other `*.github.io` app under the same user.**
   `localStorage`, IndexedDB and Cache Storage are keyed by **origin, not path**,
   so `curtcox.github.io/apptron` shares them with `curtcox.github.io/ManimOnline`
   and every other project the owner publishes. One malicious Apptron snapshot
   reads them all.
3. **The integrity of the editor page itself.** Code in the origin owns the DOM
   and can render convincing phishing prompts on the genuine URL (e.g. "paste
   your GitHub token"), escalating beyond this origin.
4. **The user's saved work in this browser.** The editor draft
   (`apptron:draft`) and every snapshot's VM state in IndexedDB (home, project,
   overlay). These can be read, and rewritten to carry a payload (see
   [Persistence](#persistence)).
5. **The user's settings**, notably the relay URL (`apptron:relay`), which is
   read on every Run.
6. **The user's local files**, if the snapshot can reach the File System Access
   picker (`/cap/new/pickerfs`) — read and write a directory the user selects.
7. **The user's network position**, if a relay is configured or `/cap/new/ws`
   is reachable: outbound connections from the user's browser and IP, including
   to services on `localhost` and the local network that are not exposed to the
   internet (browsers treat `ws://localhost` as trustworthy even from an HTTPS
   page).

What is **not** reachable, so claims stay honest:

- Other origins. Same-origin policy still holds: the attacker cannot read
  github.com, mail, or any site that is not `curtcox.github.io`. The GitHub
  account is only at risk via phishing (asset 3).
- The pinned runtime cannot be silently replaced: `src/vm-frame.js` verifies
  every bundle's SHA-256 against the manifest, so a poisoned Cache Storage entry
  is rejected. The data service worker fetches site files from the network
  rather than from a cache, and there is no same-origin URL serving
  attacker-controlled JavaScript that could be registered as a service worker
  (service-worker script fetches bypass the existing worker). So there is no
  straightforward way to **replace the site's code**.

That does not make a compromise per-Run. See the next section.

### Persistence

The site trusts state it reads back from storage, so an attacker who runs once
can come back without replacing any code:

- **The draft.** `apptron:draft` is restored on every plain visit
  (`initialize` in `src/app.js`). Injected code can plant the payload in it, so
  the next time the user presses Run on what looks like their own work, it runs
  again.
- **The relay.** `apptron:relay` is read on every Run and passed to the VM frame
  (`src/network.js`, `src/apptron-host.js`). One write turns VM networking on
  for every future snapshot and routes it through an attacker's relay. This
  silently defeats "no VM network by default".
- **Other snapshots' VM state.** Through `/web/idbfs` the guest can write into
  other snapshots' home, project and custom-root trees (weakness W1), so a
  payload can wait in a snapshot the user trusts. This one needs no origin
  escape at all.

The durable harms are therefore the stolen token **and** poisoned local state.
Persistence through stored state survives origin isolation unless stored state
is treated as untrusted (Solution D3) and scoped per snapshot (Solution A3).

## Attack surface: the VM ↔ browser bridge

Inside the guest VM, the whole Wanix namespace is mounted, so a snapshot's shell
can reach browser capabilities as files. This is Apptron's signature feature and
its largest attack surface. From `boot.go` and the Wanix source at the pinned
commit:

| Path | Capability | Risk to the user |
|---|---|---|
| `/web/dom` | Create DOM elements (`div`, `iframe`, `xterm`, `script`), set attributes, append to the frame body, inject stylesheets | **Code execution in the frame's origin.** The confirmed escape. Stylesheets can also restyle the frame for spoofing and load `url()` resources as network beacons. |
| `/web/dl` | Trigger browser downloads of VM-generated files | File written to the user's Downloads with an attacker-chosen name/type. |
| `/web/idbfs` | Read/write the IndexedDB filesystem | `boot.go` binds the whole `apptron-rev1` database at `web/idbfs/apptron`. It holds **every** snapshot's local home (`usr/<browser>-<uuid>`), project, overlay and custom root (`env/<uuid>/…`). Cross-snapshot read and write (W1). |
| `/web/opfs`, `/web/caches` | Read/write origin-private storage and Cache Storage | Read/modify same-origin data. Runtime cache tampering is caught by the SHA-256 check. |
| `/cap/new/pickerfs` | File System Access directory picker | Read/write a real local folder (needs a user gesture). |
| `/cap/new/ws` | Open a browser WebSocket as a file | Network egress from the user's browser without a relay, including to `localhost`/LAN. |
| `/cap/new/{tmpfs,tarfs,loopback}` | In-memory filesystems | Low direct risk; resource use. |
| `/task/new/{wasi,gojs}` | Spawn Wasm/Go workers | Compute. Which origin and context a `gojs` task runs in is **unverified** (see open questions). |
| `/vm/new/default` | Allocate another v86 VM | Resource use; nested compute. |
| `/ctl` | `bind`, `cp`, `sync`, `reload`, `bundle` on the namespace | Remap the filesystem; `reload` reloads the page. |

Today, **all of these are reachable from `envrc`**, which is sourced
automatically at session start (`system/bin/start`). So a third-party snapshot
exercises any of them the moment the victim clicks Run, with no further
interaction.

## Attack surface: host-side handling of untrusted input

Untrusted snapshots are also parsed and acted on by the editor itself, in the
trusted origin, before and during Run. Current state:

| Input | Handling | Assessment |
|---|---|---|
| Txtar source (paste, drop, share link, HashBin) | `parseSnapshot` rejects absolute paths, `.`/`..` segments and control characters (`src/snapshot.js`); 1 MiB limit | Adequate. |
| Share link (`readShareURL`, LZ-string) | Decompressed into editor text | Adequate for injection. **Replaces the stored draft without confirmation** (W4). |
| HashBin CID (`#cid`, load dialog) | CID syntax and length validated; 5 MiB limit (`src/hashbin.js`) | Adequate. |
| `?example=` | Allowlisted against the example index (`src/examples.js`) | Adequate. |
| OAuth callback | Handled by the HashBin client with session-stored transaction state | Not separately reviewed here. |
| **Overlay tar** (gallery or HashBin CID) | Gunzipped and untarred in the editor, then written to IndexedDB (`readOverlay` in `src/overlay.js`, `WanixDisk.restore` in `src/wanix-disk.js`) | **Gap (W3).** No `..` or absolute-path check, unlike txtar. The excluded-mount check (`/^(project\|home\|…)(\/\|$)/`) is bypassed by `./project/…`. Non-gallery overlays have no client-side integrity check. |
| DOM output | No `innerHTML` sink receives untrusted data (the only `innerHTML` write is a constant Run label); status text uses `textContent` | Adequate; keep it that way. |

## Confirmed vulnerability: DOM-bridge origin escape

Severity: **critical** (arbitrary code execution in the site origin from an
untrusted snapshot, no interaction beyond opening a shared snapshot and clicking
Run). Status: **open.** Confirmed 2026-10-27 by a local spike against the locked
runtime; mechanism recorded in [implementation.md](implementation.md).

Chain:

1. The VM frame (`vm.html`) is loaded in an iframe that is **same-origin with the
   editor and carries no `sandbox` attribute** (`src/apptron-host.js`).
2. A snapshot's `envrc` does, from the shell:
   - `s=$(cat /web/dom/new/script)` — creates a real `<script>` element in the
     frame's document.
   - `echo "src='data:text/javascript,…'" >> /web/dom/$s/attrs` — sets the `src`.
     (Truncating writes `>` are silently dropped by a 9p quirk; **append writes
     `>>` work**. The quirk is not a security control.)
   - `echo "append-child $s" >> /web/dom/body/ctl` — appends it to the body.
3. The browser runs the `data:` script **in the site origin**, with the browser's
   full network access. In the spike it set a flag on `window.top` (the editor
   page, not just the frame) and read that window's `localStorage`.

Because the injected code runs in the real page, "no VM network by default" does
not contain it, and because the site sets **no Content-Security-Policy**,
exfiltration to an attacker server is unimpeded. See the worst-case walkthrough
at the end of this document.

## Related weaknesses

Found by reviewing the code against this model. None has been exercised by a
spike yet; each needs a test before it is called confirmed.

**W1 — Cross-snapshot storage through `/web/idbfs`.** Severity: **high**
(likely; to confirm). Per-snapshot identity decides which subtree a VM *mounts*,
but `boot.go` also binds the whole `apptron-rev1` database at
`web/idbfs/apptron`, where the guest can see it. That database holds every
snapshot's local home (`usr/<browser>-<uuid>`) and project (`env/<uuid>/project`),
which `syncfs` copies to the `data/` store every few seconds. It also holds
`env/<uuid>/root`, which `boot.go` uses as that snapshot's **entire root
filesystem** when it exists. So a malicious snapshot can read other snapshots'
files, plant files in them, or replace another snapshot's root filesystem
outright. This needs no origin escape, and **origin isolation does not fix
it**, because all snapshots share the VM's origin under B1 and B2 alike. Fix:
Solution A3.

**W2 — Persistence through trusted stored state.** Severity: **high**, given the
confirmed escape. The draft and relay settings described under
[Persistence](#persistence). Fixed in the root by B (frame code can no longer
write the editor's storage); made robust by D3.

**W3 — Overlay paths and integrity.** Severity: **medium** (unanalyzed). Overlay
entries are not path-checked and HashBin-CID overlays are not hash-checked.
Whether a `..` entry escapes `env/<uuid>/overlay` in the IndexedDB filesystem
depends on how Wanix resolves those keys and has not been tested. The overlay is
processed in the trusted origin, so this belongs to the host's attack surface,
not the VM's. Fix: apply `parseSnapshot`'s path rules to overlay entries, check
the excluded mounts after normalizing, and verify the CID against the bytes.

**W4 — Share links overwrite the draft and lose provenance.** Severity:
**medium**. Opening a share link replaces the editor text without the
`replaceSource` confirmation, and the draft timer then writes it to
`apptron:draft` (`initialize` and `sourceChanged` in `src/app.js`). The user's
unsaved work is lost, and after a reload the untrusted snapshot is
indistinguishable from the user's own. Fix: confirm before replacing a dirty
draft, and carry provenance with the draft (D3).

## Severity scale

- **Critical:** code execution in the site origin, or token theft, from an
  untrusted snapshot with no interaction beyond Run.
- **High:** reads or durably modifies the user's assets (saved work, settings,
  local files) without consent, or persists across sessions.
- **Medium:** integrity or confidentiality loss limited in scope or needing an
  unlikely precondition; data loss of the user's own work.
- **Low:** resource use or nuisance the user ends by closing the tab.

## What already helps

Mitigations present today, and the gaps beside them:

- **Runtime integrity.** Every bundle is SHA-256-checked at load
  (`src/vm-frame.js`), and gallery overlays are checked against the manifest,
  blocking cache-poisoning of the runtime. *Gap: HashBin-CID overlays are not
  checked (W3).*
- **Cross-origin isolation.** COOP/COEP are set by the dev server and, on Pages,
  **only** by the data service worker. *Gap: isolation enables the
  WASI/threads features; it does not stop same-origin script injection. Because
  the service worker is the only source of COEP on Pages, it constrains B1.*
- **No VM network by default.** The relay is opt-in and never stored in share
  links (`AGENTS.md`). *Gaps: `/cap/new/ws` is a separate egress path that is
  not governed by the relay setting, and the relay setting itself can be
  rewritten by injected code (W2).*
- **Per-snapshot identity.** Each snapshot gets a UUID so the editor seeds and
  restores VM state per snapshot, and benign snapshots do not see each other's
  files. *Gap: this is a naming convention, not a boundary. The guest reaches
  every snapshot's tree through `/web/idbfs` (W1), and origin-level assets like
  tokens are outside it entirely.*
- **Endpoint allowlisting in app logic.** HashBin restricts hostnames; the relay
  setter rejects non-`ws(s)` URLs and credentials. *Gap: app-level only; injected
  origin code bypasses it.*
- **postMessage checks.** The host and frame each validate
  `event.source`/`event.origin` (`src/apptron-host.js`, `src/vm-frame.js`).
  *Gap: the frame is same-origin, so a compromised frame passes trivially. This
  check only becomes meaningful once the frame is a separate origin, and it must
  then be rewritten, not just kept (B3).*
- **Safe host-side parsing.** Txtar paths, CIDs and example names are validated,
  and no untrusted data reaches an HTML sink. *Gap: overlay tars (W3).*
- **Missing: Content-Security-Policy.** There is none. See C2 for what a policy
  can and cannot do here.

## Solution space

Each option lists its **mechanism**, the **power it preserves** (empowerment),
the **safety it adds**, its **cost**, **residual risk**, and **status**. They are
not mutually exclusive; the recommendation is a layering of them.

### A. Gate capabilities inside the runtime

**A1 — Restrict DOM element types and attributes (the stopgap patch).**
A `patches/` change so the guest's `/web/dom` can create only `div` and `xterm`,
and attributes are allowlisted (no `src`/`srcdoc`/`href`, no `on*`, no `style`,
no `javascript:`/`data:` URLs), with stylesheet injection either removed or
limited to rules without `url()` and `@import`. A boot test proves the escape
fails.
- *Preserves:* terminal, and benign DOM read. *Loses:* snapshot-draws-page,
  snapshot-creates-iframe, snapshot-loaded-scripts.
- *Safety:* closes the confirmed vector.
- *Cost:* small; one patch, applied in the runtime build.
- *Residual risk:* **high as a strategy.** It is a denylist against one surface.
  `/web/dl`, `/web/idbfs`, `/cap/*`, `/task/new/gojs` remain. Any future DOM
  primitive, or a new Wanix path, reopens the hole. And the only thing blocking
  some writes today is the `>` truncation quirk, which is accidental, so the
  patch must assume every write reaches its handler.
- *Status:* recommended **now**, as a backstop, not the plan.

**A2 — A capability broker in the runtime.**
Snapshots declare the browser capabilities they intend to use; the host mediates
each, and the user grants per-capability (like the browser's own permission
prompts). `/web/dom`, `/web/dl`, `/cap/*` become brokered rather than ambient.
- *Preserves:* **all** capabilities, behind consent — the most capable model.
- *Safety:* every host-touching action is user-visible and user-approved.
- *Cost:* high; a real permission system in the runtime and UI, likely needing
  upstream Wanix changes (kept in `patches/`, offered upstream).
- *Residual risk:* consent fatigue; correctness of the broker; prompts must be
  drawn by the host, outside the frame (D4).
- *Status:* desirable long-term, especially for capabilities that reach the
  user's machine (pickerfs, ws, downloads). Overkill for in-sandbox DOM once
  Solution B is in place.

**A3 — Scope storage to the running snapshot.**
Keep the `boot.go` mounts that use the running snapshot's own `env/<uuid>` and
`usr/<browser>-<uuid>` subtrees, but stop exposing the whole database at
`web/idbfs/apptron` to the guest (a `patches/` change). Do the same for
`/web/opfs` and `/web/caches` (the runtime cache can be read-only or hidden).
The editor keeps whole-database access for capture, reset and overlays. The
`data/` endpoint likewise serves any snapshot's path to any same-origin caller;
under B that caller is only the VM frame, so the service worker should accept
only the running snapshot's prefixes.
- *Preserves:* everything a snapshot needs for its own files.
- *Safety:* closes W1, and with it cross-snapshot persistence. Independent of B,
  and B does not provide it.
- *Cost:* small to moderate; a runtime patch to `boot.go`'s binding. Whether the
  guest can rebind the database with `/ctl bind` must be tested: if it can, the
  full tree has to be absent from the guest's namespace, not just shadowed.
- *Residual risk:* any other path that exposes the database.
- *Status:* recommended **now**, beside A1.

### B. Isolate the origin (the foundational fix)

Move the VM frame to an origin that does **not** hold the user's tokens, drafts,
settings or other apps. Then DOM power inside that frame is harmless: the
snapshot may create scripts, iframes, stylesheets — anything — and still cannot
read the editor's `localStorage`, other `*.github.io` apps, or act as the user on
HashBin. This is the option that most directly serves "empower fully while
safe": it *expands* what a snapshot may safely do while shrinking what it can
harm to nothing but its own frame.

What B does **not** do: it does not separate snapshots from each other (A3), it
does not stop the frame from drawing a convincing fake prompt inside the page
(D4), and it does not by itself govern network egress (E).

**B1 — Sandboxed iframe with an opaque origin.**
Load `vm.html` with `sandbox="allow-scripts"` (deliberately **without**
`allow-same-origin`, `allow-popups` or `allow-top-navigation`), giving the frame
a unique opaque origin.
- *Preserves:* full DOM freedom inside the frame. *Loses, unless brokered:*
  downloads (the sandbox blocks them without `allow-downloads`, and adding that
  flag un-gates `/web/dl`) and the File System Access picker (not available to
  sandboxed opaque-origin frames). Both should move behind the bridge (A2).
- *Safety:* the frame cannot touch the parent origin at all; token theft,
  draft and relay tampering, and cross-app reads become impossible from the
  frame.
- *Cost:* **moderate, not low.** Besides the attribute:
  - The host scripts the frame directly today: `host.instance` is
    `frame.contentWindow.apptron.instance` (`src/apptron-host.js`), used by the
    key bar (`sendKey`), overlay capture (`captureOverlay(host.instance, …)` in
    `src/app.js`) and the resize event in `view()`. All of these break under an
    opaque origin and must become bridge messages.
  - Both sides use `location.origin` as the postMessage target and check
    `event.origin === location.origin`; an opaque origin is `"null"`, so the
    protocol has to be redesigned around `event.source` and a per-boot secret
    (B3).
  - Subresource requests from an opaque origin are cross-origin to
    `curtcox.github.io`. Module scripts and `fetch` need CORS (Pages sends
    `Access-Control-Allow-Origin: *`; verify), and the frame's own COEP then
    requires CORP or CORS on everything it loads.
- *The crux — the service worker:* on Pages the data service worker is the
  **only** source of COEP, and the only server of the r2fs `data/` storage. A
  service worker controls only clients of its own origin, so it will not
  control the opaque-origin frame's subresource requests, and whether it still
  intercepts the frame's *navigation* (to add COEP to `vm.html`) must be tested.
  If `vm.html` arrives without COEP, a cross-origin-isolated parent **refuses to
  load the frame at all**; this is a blocker, not a lost feature. Also to test:
  `crossOriginIsolated`/`SharedArrayBuffer` in the frame, and whether OPFS and
  IndexedDB are available to an opaque origin (they are expected to be absent or
  ephemeral, which changes how VM state persists).
- *Status:* **first thing to prototype.** If the spike passes, it is the
  cheapest strong fix; if the service-worker question fails, go to B2.

**B2 — A separate real origin for the VM.**
Serve `vm.html` and the runtime from a distinct origin — a dedicated GitHub Pages
site under a different user/org (e.g. a `*.github.io` that is not the owner's
main one), or a dedicated subdomain if a custom domain is ever added. The editor
embeds it cross-origin and talks to it over a validated postMessage bridge.
- *Preserves:* full DOM freedom inside the frame, with real storage and a service
  worker of its own; also isolates the VM from the owner's *other* Pages apps.
- *Safety:* strongest; a genuine origin boundary, not a sandbox flag.
- *Cost:* medium-high; a second publishing target, cross-origin COOP/COEP and
  CORP wiring, the same `host.instance` refactor as B1, and a careful
  postMessage protocol. The service worker and r2fs move to the VM origin.
  Capture, reset and overlay restore currently read and write the VM's
  IndexedDB from the editor (`src/capture.js`, `src/wanix-disk.js`); those
  become bridge operations too.
- *Residual risk:* complexity of the cross-origin runtime; still needs the
  bridge hardened (B3) and storage scoped (A3), since every snapshot shares the
  VM origin.
- *Status:* the durable target if B1 does not pan out, or alongside it for
  defense in depth. **Needs an owner decision** (a second origin is infra).

**B3 — Harden the postMessage bridge.**
Whichever of B1/B2 lands, treat the frame as hostile: accept messages only from
the frame's `contentWindow` and (for B2) the expected origin, or (for B1) with a
secret the host generates per boot; validate message `type` and schema; never
`eval` or interpolate received data into the DOM; and expose only a minimal,
explicit set of operations (send keys, resize, request capture, report status).
Capture results arriving from the frame are untrusted input and go through
`parseSnapshot` and the overlay checks like any other snapshot.
- *Status:* mandatory companion to B1/B2.

### C. Protect assets even under a shared origin (defense in depth)

**C1 — A token broker / vault.**
Move HashBin tokens out of JS-readable `localStorage` into a dedicated,
minimal-surface holder on a separate origin (an auth-broker iframe) that performs
narrow, user-confirmed operations ("save this document") and never hands the
token to the editor's JS. On a static host this replaces the impossible
httpOnly-cookie approach.
- *Preserves:* HashBin save/load.
- *Safety:* even full code execution in the editor origin cannot read the token.
- *Cost:* medium; an OAuth broker and a messaging protocol.
- *Residual risk:* the broker's own surface. Code in the editor origin can still
  request operations, and a spoofed prompt can still talk the user into
  approving one; B removes the first, and only D4 addresses the second.
- *Status:* high value; pairs naturally with B2's second origin.

**C2 — Content-Security-Policy.**
Pages cannot set headers, so policies are `<meta http-equiv>` tags. There are
two documents with different needs, and the policy is worth very different
amounts in each.

*In `vm.html` (the confirmed vector's document):*
- `script-src` limited to the site's own script paths, **without** `data:` or
  `blob:` unless the runtime proves it needs them, blocks the confirmed
  `<script src="data:…">` vector directly. It must not be plain `'self'`: the
  data service worker serves guest-written bytes at same-origin `data/` URLs as
  `application/octet-stream` without `nosniff` (`src/r2fs.js`), and browsers
  generally still run classic scripts served that way. Use path-scoped sources
  (`…/apptron/src/`, `…/apptron/vendor/`, `…/apptron/runtime/`), plus
  `'wasm-unsafe-eval'` for the runtime.
- `connect-src` governs `fetch` **and WebSocket**, so here it is the natural
  control for `/cap/new/ws` and the relay (E).
- `frame-src`, `object-src 'none'`, `base-uri 'none'`.
- Inside a B1 sandbox this policy is robust: the frame cannot open popups or
  reach a same-origin document without a policy, and `data:`/`srcdoc` frames
  inherit it. It still cannot stop the frame from navigating itself to an
  attacker URL, so it limits network position, not every possible leak. Under B
  there is little of the user's left in the frame to leak.

*In the editor and the shared origin:*
- `script-src` and `frame-src` (only `vm.html`) still help against any future
  injection into the editor's own document.
- As an **exfiltration brake** it is weak, for three reasons. The `connect-src`
  allowlist the app needs includes public endpoints anyone can write to (the
  is.gd shortener, `hashbin.org`/`256t.us` under the attacker's own account), so
  stolen data can leave through them. Code already running in the origin can
  open a same-origin window or frame on a page that has no policy (another
  `curtcox.github.io` app, the Pages 404 page) and use its `fetch`. And
  `connect-src` does not cover top-level navigation, or WebRTC reliably.

*Also, independent of CSP:* have the data service worker add
`X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox` to
every `data/` response, so guest-written bytes are never runnable or renderable
as same-origin content.

*Overall:*
- *Preserves:* everything the app legitimately does.
- *Safety:* closes the confirmed vector in `vm.html` independently of A1;
  governs VM egress once B lands; little protection for the editor origin once
  code runs there.
- *Cost:* low-moderate; a buildless native-ESM site cannot easily use nonces,
  and the runtime's `blob:`/`worker-src`/`wasm-unsafe-eval` needs must be found
  by testing.
- *Status:* `vm.html` policy and the `data/` headers recommended **now**;
  editor policy soon, without relying on it as a brake.

**C3 — Document and reduce the shared-origin blast radius.**
The `*.github.io` shared-origin issue is a general GitHub Pages footgun. Document
it for the owner, and recommend isolating apps that hold credentials onto their
own origins (custom subdomains, or separate org accounts).
- *Status:* documentation + an owner recommendation.

### D. Provenance, consent and trusted UI

**D1 — Mark third-party snapshots untrusted, and ask before running.**
Snapshots arriving by share link, HashBin, paste or drop are untrusted. Before
Run, surface what the snapshot will touch outside its sandbox (does it reference
`/web/dom`, `/web/dl`, `/cap/*`, a relay, a non-gallery overlay?) and require
explicit consent for the host-reaching capabilities.
- *Preserves:* everything, behind a clear choice.
- *Safety:* no silent host access from a link someone sent you.
- *Cost:* moderate; UI plus heuristic txtar inspection.
- *Residual risk:* **static inspection of shell is defeatable** (obfuscation,
  runtime-constructed paths). Consent must therefore be **backed by actual
  gating** (A2 or B), not by a warning alone. A warning without enforcement is
  security theater.
- *Status:* valuable as the consent layer **on top of** enforcement.

**D2 — First-party vs third-party capability tiers.**
Committed gallery snapshots (reviewed in PRs) may use a broader capability set;
third-party snapshots default to the sandbox-only tier (Solution B) and must ask
for anything that reaches the user's machine or accounts. The broader tier
covers whatever the gallery overlays contain, so overlay package lists are
reviewed as part of the trusted code.
- *Status:* the policy that ties A/B/D together.

**D3 — Treat stored state as untrusted input.**
- Store provenance with the draft (where it came from: a share link, HashBin
  CID, example, or the user's own edits) and keep the untrusted marking across
  reloads; edits by the user do not launder it.
- Confirm before a share link or HashBin load replaces a dirty draft (W4).
- Show the active relay on the Run control and require confirmation when it has
  changed since the user last set it in the network dialog, so a rewritten
  relay is visible before it is used (W2).
- *Cost:* small.
- *Status:* recommended with Phase 1. It is the backstop for W2 if isolation
  ever fails.

**D4 — Keep trusted UI outside the frame.**
Even when isolated, the frame can draw anything inside its rectangle, including
a fake "Connect HashBin" or "paste your token" dialog on the genuine URL. Rules:
consent, credential and price prompts are drawn only by the host, outside the
frame (a frame cannot draw over its parent); the site never asks for a
credential inside the terminal area; and the terminal area is visibly bounded
and labelled as snapshot content.
- *Cost:* small; mostly a design rule and copy.
- *Status:* adopt now as a rule; it costs nothing.

### E. Keep egress contained

Networking stays off by default. `/cap/new/ws` must be governed the same way as
the relay — never reachable from `envrc` without consent — so it cannot become a
silent egress path, including to `localhost` and the local network. Neither A1
nor B1 closes it: a sandboxed frame can still open WebSockets. The cheapest
control is `connect-src` in `vm.html`'s policy (C2), allowing only the configured
relay; A2 later turns that into a per-snapshot grant. Document it beside the
relay setting.
- *Status:* the `vm.html` `connect-src` part in Phase 1 with B; the consent part
  with A2/D1.

## Recommended architecture

A layered design that keeps snapshots maximally capable and users safe:

1. **Foundation — origin isolation (B).** Prototype **B1** (sandboxed opaque
   origin) first; if the service-worker, SAB or storage spikes fail, move to
   **B2** (separate origin). Move every direct `host.instance` use behind the
   bridge and harden it (**B3**). This neutralizes the confirmed escape *and*
   lets snapshots keep full DOM power safely, because that power no longer
   reaches the user's origin.
2. **Scope storage per snapshot (A3).** Isolation separates snapshots from the
   user's origin, not from each other. Each snapshot sees only its own trees.
3. **Close the confirmed vector in the frame's own document (C2 in `vm.html`)**
   with a path-scoped `script-src` and a `connect-src` that also governs
   WebSocket egress (E), and make `data/` responses inert.
4. **Vault the credentials (C1).** Even a flaw in the isolation layer does not
   leak tokens. A CSP in the editor origin is added too, but is not relied on as
   an exfiltration brake.
5. **Treat stored state as untrusted (D3)** and **keep trusted UI outside the
   frame (D4).**
6. **Broker the host-reaching capabilities (A2) behind consent (D1/D2).** DOM is
   safe once isolated, but `pickerfs`, `ws` and downloads reach the user's
   *machine and network*, outside any frame sandbox. Those get per-capability,
   per-snapshot, user-granted consent, with first-party gallery snapshots on a
   broader tier.
7. **Backstop (A1) now.** Ship the element-type/attribute patch immediately as a
   stopgap while the above lands, and keep it as defense in depth.
8. **Fix overlay handling (W3)** and **document the Pages shared-origin footgun
   (C3).**

The result: a third-party snapshot can draw to its own page, spawn Wasm, build
a file and offer it for download through a host-drawn prompt, and do everything
the gallery wants to show — and still cannot read a token, touch another app or
another snapshot, change the user's settings, reach a local file, or open the
network without the user knowingly allowing it.

## Phased path

Each phase is done when its acceptance tests (next section) pass in the boot
suite.

- **Phase 0 (before the gallery grows):**
  - A1 stopgap patch + boot test (T1).
  - A3 storage scoping, after a spike confirms W1 (T5).
  - `vm.html` CSP with path-scoped `script-src`, and `nosniff`/`sandbox` on
    `data/` responses (T3, T4).
  - W3 overlay path and CID checks (T7), and W4 draft confirmation.
  - The B1 feasibility spike (service-worker navigation and COEP, SAB, storage
    under a sandboxed opaque origin).

  These are the Phase 0.1 steps in [gallery-plan.md](gallery-plan.md).
- **Phase 1:** Land origin isolation (B1 or B2) with the bridge refactor and
  hardening (B3) (T2); `vm.html` `connect-src` for egress (E) (T6); D3 and D4.
  Retire reliance on A1 for the DOM surface while keeping it as backstop.
- **Phase 2:** Token vault (C1) and the capability broker (A2) with the consent
  UI (D1/D2), covering `ws`, `pickerfs` and downloads.
- **Phase 3:** Owner-facing guidance on isolating credential-holding Pages apps
  (C3); offer the Wanix changes upstream.

Each gallery example that uses a browser-reaching capability ships only after the
capability it needs is gated or isolated per the phase above. Examples that touch
only the VM (most of Wave 1 in the gallery plan) are unaffected.

## Acceptance tests

Each is a boot or browser test using a hostile snapshot, so it fails if the
protection regresses:

- **T1 — DOM escape blocked.** The confirmed `envrc` (script element, `data:`
  `src` via `>>`, append) runs no code: no flag on `window.top`, no
  `localStorage` read. Also try `iframe srcdoc`, `on*` attributes and `style`.
- **T2 — Frame cannot reach the editor.** From injected frame code,
  `window.top.document`, `window.top.localStorage`, `parent.ApptronOnline` and
  same-origin `localStorage`/IndexedDB all fail or are empty.
- **T3 — CSP active in `vm.html`.** A `data:` script and a script loaded from a
  `data/` URL are both blocked, and a `securitypolicyviolation` event fires.
- **T4 — `data/` responses are inert.** They carry `nosniff` and
  `CSP: sandbox`.
- **T5 — Snapshots are separated.** Snapshot A writes a marker file in its home;
  snapshot B cannot list, read or write A's trees through `/web/idbfs`, including
  after attempting `/ctl bind`.
- **T6 — No silent egress.** With no relay configured, a WebSocket from the
  guest (`/cap/new/ws`) to an external host and to `ws://localhost` fails.
- **T7 — Overlays are checked.** An overlay with `../`, absolute or `./project/`
  entries is rejected, and a HashBin overlay whose bytes do not match its CID is
  rejected.
- **T8 — Stored state stays visible.** A relay written directly to
  `apptron:relay` is shown and confirmed before the next Run; a share link
  opened over a dirty draft asks before replacing it.

## Open questions and spikes

- **B1 feasibility:** Does the data service worker intercept the navigation of a
  `sandbox="allow-scripts"` frame, so `vm.html` gets COEP on Pages? Without that
  the frame does not load at all. Then: is the frame `crossOriginIsolated` for
  v86's `SharedArrayBuffer`, and are OPFS and IndexedDB available to it, and
  durable? One spike answers all of these and decides B1 vs B2.
- **W1 reach:** Which `/web/idbfs` paths a guest can actually list and write,
  and whether `/ctl bind` can undo a narrowed namespace (decides how A3 is
  built).
- **W3 traversal:** Whether a `..` overlay entry escapes `env/<uuid>/overlay` in
  Wanix's IndexedDB filesystem.
- **Second origin for B2:** Is the owner willing to publish the VM from a separate
  `*.github.io`/org or a subdomain? Without it, B1 is the only isolation route.
- **CSP vs the runtime:** Which `blob:`/`worker-src`/`wasm-unsafe-eval`
  allowances does the Wanix loader need, and does it ever load scripts from
  `data:`? Determines how tight the `vm.html` policy can be.
- **HashBin scope:** Does `content:write` allow deleting documents, and are there
  any mutable names (aliases) a stolen token could repoint?
- **Consent heuristics (D1):** How to summarize a snapshot's intent without
  overpromising, given that shell inspection is defeatable.
- **`gojs` workers:** A `/task/new/gojs` task may run in the page context rather
  than a worker. Does it run in the frame's origin (safe once B lands) or the
  editor's? Verify.

## Non-goals

- Defending other origins (the browser's same-origin policy already does).
- Defending against a malicious **first-party** change to this repo (that is the
  code-review and CI trust boundary, not this document's).
- Making the VM itself unbreakable from inside — a snapshot may do what it likes
  to its own VM and frame; that is the point. The boundary we defend is between
  the sandbox and the user, which includes the user's other snapshots.
- Preventing resource exhaustion (CPU, memory, nested VMs). The user ends it by
  closing the tab; size limits on downloads and decompression stay in place.

## Appendix: worst-case walkthrough (unpatched, full gallery)

An attacker publishes a snapshot (a community share link, or — once the gallery
exists — a malicious example submitted by PR, or one spread from a victim's
poisoned draft in step 4). A victim opens it and clicks Run. `envrc` injects a
`data:`-URL `<script>` through `/web/dom`; it runs in `curtcox.github.io` with
network access and no CSP. In that moment it:

1. **Steals the HashBin refresh token** from `localStorage` — durable,
   server-side, offline access to the victim's account: create documents as
   them and spend their balance past the client-side quote-and-confirm.
2. **Reads every other `curtcox.github.io/*` app's stored data** (shared origin).
3. **Reads the victim's other snapshots** through `/web/idbfs` — no origin
   escape needed for this step.
4. **Persists and spreads.** It plants itself in `apptron:draft` and in other
   snapshots' home trees, so it runs again on the victim's next Run of their
   "own" work, and rides along in anything the victim saves or shares
   afterwards. It writes an attacker relay to `apptron:relay`, so every future
   session has networking routed through the attacker. Existing HashBin
   documents and links are content-addressed and cannot be rewritten.
5. **Phishes on the real URL** with a convincing fake prompt to harvest a GitHub
   token, escalating beyond this origin.
6. With a gallery that trains users to grant a folder picker, **reads and writes
   the victim's chosen local directory** via `pickerfs`, and probes services on
   the victim's `localhost` through `/cap/new/ws`.

The durable harms are the stolen token and the poisoned local state; the site's
code itself cannot be replaced, because the runtime is integrity-checked and no
service-worker implant is available. The recommended architecture removes steps
1, 2 and the editor-storage half of 4 (origin isolation + token vault), step 3
and the cross-snapshot half of 4 (storage scoping), makes a rewritten relay
visible (D3), keeps step 5's prompts out of the frame's reach (D4), and puts
step 6 and the network behind consent.
