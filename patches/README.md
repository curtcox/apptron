# Upstream patches

All changes apply to disposable build sources. The pinned Apptron submodule is
never modified. Wanix patches apply to the exact module revision in Apptron's
`go.mod`, copied inside Docker before building the wasm and matching loader.

- `0001-skip-dhcp-without-network.patch` skips DHCP when no eth0 exists.
- `0002-private-snapshot-storage.patch` keeps the origin-wide IDBFS handle out
  of the guest namespace. Only `env/<running uuid>` is exposed at
  `/snapshot-storage`. Init, rebuild, custom-root handling, and Go module cache
  paths use that tree. Project and home sync retain their own scoped handles.
- `wanix/0001-browser-capability-boundary.patch` restricts DOM creation to div
  and xterm, allows only class/title/role/aria-label attributes, and rejects
  guest stylesheets. It removes guest access to OPFS, caches, raw workers,
  downloads, pickerfs and gojs tasks. WASI remains available. WebSockets may
  connect only to the exact host-selected relay, with no default relay.
  Required page scripts (Go support, v86, xterm and IDBFS) load from static,
  integrity-checked runtime assets; blob URLs remain necessary for workers.

The last patch is a stopgap while separate-origin isolation and a real capability
broker are pending. It deliberately keeps browser-reaching capabilities closed
until they have host-drawn consent. Do not restore gojs under the shared origin:
Go's syscall/js gives it browser-code execution, independent of the DOM bridge.

The build manifest records every patch SHA-256, including dependency patches.
`sync-runtime-lock.mjs` derives a fresh immutable release name when that patch set
changes. A local lock identifies generated artifacts; the Runtime workflow must
publish that release before Pages can fetch it. No upstream PR is included here.
