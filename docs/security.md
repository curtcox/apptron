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

## Design principle

> A snapshot should be able to do anything it likes **to its own sandbox**, and
> nothing at all **to the user** without the user's informed, revocable consent.

"Its own sandbox" is the VM and a frame the snapshot may freely manipulate.
"The user" is their credentials, their saved work, their other apps, their files,
their network, and their machine. The job of the architecture is to make the
first set as large and the second set as controlled as possible, and to make the
boundary between them a real security boundary rather than an accident of
implementation.

## Trust model

| Party | Trusted? | Why |
|---|---|---|
| The person at the keyboard | Yes | It is their device and their session. |
| The site code (this repo) | Yes, and reviewed | Committed, code-reviewed, served from the repo. |
| The pinned runtime (Wanix/Apptron) | Yes, with integrity checks | Built in CI, pinned by commit, verified by SHA-256 at load. |
| A **first-party gallery snapshot** | Yes, and reviewed | Committed to `examples/`, changed only through reviewed PRs. |
| A **third-party snapshot** (share link, HashBin load, pasted txtar, dropped file) | **No** | Authored by anyone, delivered to the victim, executed on Run. |
| A **prebuilt overlay** referenced by a snapshot | Depends on source | `gallery/<name>` overlays are first-party; a HashBin-CID overlay is third-party. |

The hard line is between first-party snapshots (vetted) and third-party ones
(arbitrary). Everything below is about containing the third-party case without
crippling it.

## Assets at risk

What an attacker gains by running code in the site's origin, in rough order of
severity:

1. **HashBin OAuth tokens.** Stored in `localStorage` under `apptron:oauth:`
   (`src/app.js`). The refresh token is long-lived, so theft gives durable,
   offline, server-side access to the victim's HashBin account with
   `content:write` and `balance:read` scope: read, overwrite and delete saved
   snapshots, and — because the price quote-and-confirm is client-side UI only —
   incur charges by calling the API directly.
2. **Data from every other `*.github.io` app under the same user.**
   `localStorage`, IndexedDB and Cache Storage are keyed by **origin, not path**,
   so `curtcox.github.io/apptron` shares them with `curtcox.github.io/ManimOnline`
   and every other project the owner publishes. One malicious Apptron snapshot
   reads them all.
3. **The integrity of the editor page itself.** Code in the origin owns the DOM
   and can render convincing phishing prompts on the genuine URL (e.g. "paste
   your GitHub token"), escalating beyond this origin.
4. **The user's local files**, if the snapshot can reach the File System Access
   picker (`/cap/new/pickerfs`) — read and write a directory the user selects.
5. **The user's network position**, if a relay is configured or `/cap/new/ws`
   is reachable: outbound connections from the user's browser/IP.
6. **The user's saved snapshots and share links**, which can be rewritten to
   carry the payload — a worm across HashBin documents and circulated links.

What is **not** reachable, so claims stay honest:

- Other origins. Same-origin policy still holds: the attacker cannot read
  github.com, mail, or any site that is not `curtcox.github.io`. The GitHub
  account is only at risk via phishing (asset 3).
- The pinned runtime cannot be silently replaced: `src/vm-frame.js` verifies
  every bundle's SHA-256 against the manifest, so a poisoned Cache Storage entry
  is rejected. There is no same-origin script a static host could be tricked into
  registering as a service worker, so there is no straightforward persistent
  in-browser implant. The durable damage is the stolen token, not a browser
  rootkit.

## Attack surface: the VM ↔ browser bridge

Inside the guest VM, the whole Wanix namespace is mounted, so a snapshot's shell
can reach browser capabilities as files. This is Apptron's signature feature and
its largest attack surface. From `boot.go` and the Wanix source:

| Path | Capability | Risk to the user |
|---|---|---|
| `/web/dom` | Create DOM elements (`div`, `iframe`, `xterm`, `script`), set attributes, append to the frame body, inject stylesheets | **Code execution in the frame's origin.** The confirmed escape. |
| `/web/dl` | Trigger browser downloads of VM-generated files | File written to the user's Downloads with an attacker-chosen name/type. |
| `/web/opfs`, `/web/caches`, `/web/idbfs` | Read/write origin-private storage | Read/modify same-origin data, including the runtime cache and snapshot state. |
| `/cap/new/pickerfs` | File System Access directory picker | Read/write a real local folder (needs a user gesture). |
| `/cap/new/ws` | Open a browser WebSocket as a file | Network egress from the user's browser without a relay. |
| `/cap/new/{tmpfs,tarfs,loopback}` | In-memory filesystems | Low direct risk; resource use. |
| `/task/new/{wasi,gojs}` | Spawn Wasm/Go workers | Compute; a `gojs` worker runs in the page context. |
| `/vm/new/default` | Allocate another v86 VM | Resource use; nested compute. |
| `/ctl` | `bind`, `cp`, `sync`, `reload`, `bundle` on the namespace | Remap the filesystem; `reload` reloads the page. |

Today, **all of these are reachable from `envrc`**, which is sourced
automatically at session start (`system/bin/start`). So a third-party snapshot
exercises any of them the moment the victim clicks Run, with no further
interaction.

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

## What already helps

Mitigations present today, and the gaps beside them:

- **Runtime integrity.** Every bundle is SHA-256-checked at load
  (`src/vm-frame.js`), blocking cache-poisoning of the runtime. *Gap: none; keep
  it.*
- **Cross-origin isolation.** COOP/COEP are set by the dev server and the data
  service worker. *Gap: isolation enables the WASI/threads features; it does not
  stop same-origin script injection.*
- **No VM network by default.** The relay is opt-in and never stored in share
  links (`AGENTS.md`). *Gap: `/cap/new/ws` is a separate egress path that is not
  governed by the relay setting.*
- **Per-snapshot identity.** Each snapshot gets a UUID so IndexedDB state does
  not leak between snapshots. *Gap: scopes VM state, not origin-level assets like
  tokens.*
- **Endpoint allowlisting in app logic.** HashBin restricts hostnames; the relay
  setter rejects non-`ws(s)` URLs and credentials. *Gap: app-level only; injected
  origin code bypasses it.*
- **postMessage checks.** The host validates `event.source`/`event.origin` on
  frame messages. *Gap: the frame is same-origin, so a compromised frame passes
  trivially. This check only becomes meaningful once the frame is a separate
  origin (see Solution B).*
- **Missing: Content-Security-Policy.** There is none. A policy — even a meta-tag
  one — would be a cheap, high-value exfiltration brake (Solution C2).

## Solution space

Each option lists its **mechanism**, the **power it preserves** (empowerment),
the **safety it adds**, its **cost**, **residual risk**, and **status**. They are
not mutually exclusive; the recommendation is a layering of them.

### A. Gate capabilities inside the runtime

**A1 — Restrict DOM element types and attributes (the stopgap patch).**
A `patches/` change so the guest's `/web/dom` can create only `div` and `xterm`,
and attributes are allowlisted (no `src`/`srcdoc`/`href`, no `on*`, no
`javascript:`/`data:` URLs), with a boot test that the escape fails.
- *Preserves:* terminal, and benign DOM read. *Loses:* snapshot-draws-page,
  snapshot-creates-iframe, snapshot-loaded-scripts.
- *Safety:* closes the confirmed vector.
- *Cost:* small; one patch, applied in the runtime build.
- *Residual risk:* **high as a strategy.** It is a denylist against one surface.
  `/web/dl`, `/cap/*`, `/task/new/gojs` remain. Any future DOM primitive, or a
  new Wanix path, reopens the hole. Fragile because the current block is itself
  an accident.
- *Status:* recommended **now**, as a backstop, not the plan.

**A2 — A capability broker in the runtime.**
Snapshots declare the browser capabilities they intend to use; the host mediates
each, and the user grants per-capability (like the browser's own permission
prompts). `/web/dom`, `/web/dl`, `/cap/*` become brokered rather than ambient.
- *Preserves:* **all** capabilities, behind consent — the most capable model.
- *Safety:* every host-touching action is user-visible and user-approved.
- *Cost:* high; a real permission system in the runtime and UI, likely needing
  upstream Wanix changes (kept in `patches/`, offered upstream).
- *Residual risk:* consent fatigue; correctness of the broker.
- *Status:* desirable long-term, especially for capabilities that reach the
  user's machine (pickerfs, ws). Overkill for in-sandbox DOM once Solution B is
  in place.

### B. Isolate the origin (the foundational fix)

Move the VM frame to an origin that does **not** hold the user's tokens or other
apps. Then DOM power inside that frame is harmless: the snapshot may create
scripts, iframes, stylesheets — anything — and still cannot read the editor's
`localStorage`, other `*.github.io` apps, or act as the user on HashBin. This is
the option that most directly serves "empower fully while safe": it *expands*
what a snapshot may safely do while shrinking what it can harm to nothing but its
own frame.

**B1 — Sandboxed iframe with an opaque origin.**
Load `vm.html` with `sandbox="allow-scripts"` (deliberately **without**
`allow-same-origin`), giving the frame a unique opaque origin.
- *Preserves:* full DOM freedom inside the frame.
- *Safety:* the frame cannot touch the parent origin at all; token theft and
  cross-app reads become impossible from the frame.
- *Cost:* low — an attribute and a postMessage protocol (already partly present).
- *Residual risk / to verify (spike):* whether v86's `SharedArrayBuffer` /
  `crossOriginIsolated` requirements are still met in a sandboxed opaque-origin
  frame; whether the r2fs **service worker** still intercepts the frame's
  requests when the frame's origin is opaque (SW scope is by URL, but opaque
  origins change request semantics); whether OPFS/IndexedDB the VM relies on are
  available to an opaque origin. If any of these break, fall back to B2.
- *Status:* **first thing to prototype.** If it holds, it is the cheapest strong
  fix.

**B2 — A separate real origin for the VM.**
Serve `vm.html` and the runtime from a distinct origin — a dedicated GitHub Pages
site under a different user/org (e.g. a `*.github.io` that is not the owner's
main one), or a dedicated subdomain if a custom domain is ever added. The editor
embeds it cross-origin and talks to it over a validated postMessage bridge.
- *Preserves:* full DOM freedom inside the frame; also isolates the VM from the
  owner's *other* Pages apps even if they share nothing else.
- *Safety:* strongest; a genuine origin boundary, not a sandbox flag.
- *Cost:* medium-high; a second publishing target, cross-origin COOP/COEP and
  CORP wiring, and a careful postMessage protocol. The SW/r2fs design has to move
  or be duplicated to the VM origin.
- *Residual risk:* complexity of the cross-origin runtime; still needs the
  bridge hardened (B3).
- *Status:* the durable target if B1 does not pan out, or alongside it for
  defense in depth. **Needs an owner decision** (a second origin is infra).

**B3 — Harden the postMessage bridge.**
Whichever of B1/B2 lands, treat the frame as hostile: validate `origin` against
the *expected* VM origin, validate message `type` and schema, never `eval` or
interpolate received data into the DOM, and expose only a minimal, explicit set
of operations across the bridge.
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
- *Residual risk:* the broker's own surface; still allows user-confirmed abuse if
  the UI is spoofed (mitigated by B).
- *Status:* high value; pairs naturally with B2's second origin.

**C2 — Content-Security-Policy.**
Add a CSP (via `<meta http-equiv>` since Pages cannot set headers) that at least
restricts `connect-src` to the endpoints the app actually uses (`hashbin.org`,
`256t.us`, the is.gd proxy, the relay, self), and tightens `script-src`,
`frame-src`, `object-src`.
- *Preserves:* everything the app legitimately does.
- *Safety:* turns "exfiltrate anything anywhere" into "exfiltrate only to a short
  allowlist" — a large brake on the worst outcome, and independent of B.
- *Cost:* low-moderate; a buildless native-ESM site cannot easily use nonces, and
  the VM frame's own needs must be scoped, but `connect-src` alone is a big win.
- *Residual risk:* a meta CSP is weaker than a header CSP and cannot be the only
  control; `data:`/`blob:` needs of the runtime must be accommodated carefully.
- *Status:* recommended **soon**, regardless of B.

**C3 — Document and reduce the shared-origin blast radius.**
The `*.github.io` shared-origin issue is a general GitHub Pages footgun. Document
it for the owner, and recommend isolating apps that hold credentials onto their
own origins (custom subdomains, or separate org accounts).
- *Status:* documentation + an owner recommendation.

### D. Provenance and informed consent

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
for anything that reaches the user's machine or accounts.
- *Status:* the policy that ties A/B/D together.

### E. Keep egress contained

Networking stays off by default. `/cap/new/ws` must be governed the same way as
the relay — never reachable from `envrc` without consent — so it cannot become a
silent egress path. Document it beside the relay setting.
- *Status:* fold into A2/D1.

## Recommended architecture

A layered design that keeps snapshots maximally capable and users safe:

1. **Foundation — origin isolation (B).** Prototype **B1** (sandboxed opaque
   origin) first; if the SW/SAB/OPFS spikes fail, move to **B2** (separate
   origin). Harden the bridge (**B3**). This single change neutralizes the
   confirmed escape *and* lets snapshots keep full DOM power safely, because that
   power no longer reaches the user's origin.
2. **Vault the credentials (C1)** and **add a CSP (C2).** Now even a flaw in the
   isolation layer does not leak tokens, and exfiltration is capped to a short
   allowlist. These are independent of B and worth doing regardless.
3. **Broker the host-reaching capabilities (A2) behind consent (D1/D2).** DOM is
   safe once isolated, but `pickerfs`, `ws` and downloads reach the user's
   *machine and network*, outside any frame sandbox. Those get per-capability,
   per-snapshot, user-granted consent, with first-party gallery snapshots on a
   broader tier.
4. **Backstop (A1) now.** Ship the element-type/attribute patch immediately as a
   stopgap while the above lands, and keep it as defense in depth.
5. **Document the Pages shared-origin footgun (C3).**

The result: a third-party snapshot can draw to its own page, spawn Wasm, build
and offer a download, and do everything the gallery wants to show — and still
cannot read a token, touch another app, reach a local file, or open the network
without the user knowingly allowing it.

## Phased path

- **Phase 0 (before the gallery grows):** A1 stopgap patch + boot test; C2 CSP
  with a `connect-src` allowlist; the B1 feasibility spike (SW, SAB, OPFS under a
  sandboxed opaque origin). These are the Phase 0.1 items in
  [gallery-plan.md](gallery-plan.md).
- **Phase 1:** Land origin isolation (B1 or B2) with the hardened bridge (B3);
  retire reliance on A1 for the DOM surface while keeping it as backstop.
- **Phase 2:** Token vault (C1) and the capability broker (A2) with the consent
  UI (D1/D2); govern `ws` egress (E).
- **Phase 3:** Owner-facing guidance on isolating credential-holding Pages apps
  (C3); offer the Wanix changes upstream.

Each gallery example that uses a browser-reaching capability ships only after the
capability it needs is gated or isolated per the phase above. Examples that touch
only the VM (most of Wave 1 in the gallery plan) are unaffected.

## Open questions and spikes

- **B1 feasibility:** Does a `sandbox="allow-scripts"` frame (opaque origin) keep
  `crossOriginIsolated` for v86's `SharedArrayBuffer`? Does the r2fs service
  worker still intercept its requests? Are OPFS/IndexedDB available to it? One
  spike answers all three and decides B1 vs B2.
- **Second origin for B2:** Is the owner willing to publish the VM from a separate
  `*.github.io`/org or a subdomain? Without it, B1 is the only isolation route.
- **CSP vs the runtime:** Which `data:`/`blob:`/`worker-src` allowances does the
  Wanix loader need? Determines how tight C2 can be.
- **Consent heuristics (D1):** How to summarize a snapshot's intent without
  overpromising, given that shell inspection is defeatable.
- **`gojs` workers:** A `/task/new/gojs` worker runs in the page context — does it
  inherit the frame's origin (safe once B lands) or the editor's? Verify.

## Non-goals

- Defending other origins (the browser's same-origin policy already does).
- Defending against a malicious **first-party** change to this repo (that is the
  code-review and CI trust boundary, not this document's).
- Making the VM itself unbreakable from inside — a snapshot may do what it likes
  to its own VM and frame; that is the point. The boundary we defend is between
  the sandbox and the user.

## Appendix: worst-case walkthrough (unpatched, full gallery)

An attacker publishes a snapshot (a community share link, or — once the gallery
exists — a malicious example submitted by PR, or one spread by the worm in step
4). A victim opens it and clicks Run. `envrc` injects a `data:`-URL `<script>`
through `/web/dom`; it runs in `curtcox.github.io` with network access and no CSP.
In that moment it:

1. **Steals the HashBin refresh token** from `localStorage` — durable,
   server-side, offline access to the victim's account: read, overwrite, delete
   their saved snapshots, and incur charges past the client-side quote-and-confirm.
2. **Reads every other `curtcox.github.io/*` app's stored data** (shared origin).
3. **Self-propagates** by rewriting the victim's HashBin snapshots and share
   links with the payload; if the **owner** ever runs a malicious snapshot, their
   token lets the attacker rewrite any HashBin-hosted content the site points at.
4. **Phishes on the real URL** with a convincing fake prompt to harvest a GitHub
   token, escalating beyond this origin.
5. With a gallery that trains users to grant a folder picker, **reads and writes
   the victim's chosen local directory** via `pickerfs`.

The durable harm is the stolen token (it outlives the browser session); the
in-browser compromise is per-Run because the runtime is integrity-checked and no
service-worker implant is available. The recommended architecture removes step 1
and 2 entirely (origin isolation + token vault), caps step-any exfiltration (CSP),
and puts steps 5 and the network behind consent.
