#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./node_modules/@playwright/test/package.json').version")
# Use the browser builds shipped for the exact installed Playwright version.
# Docker downloads are resumable; no per-job apt or browser ZIP install is needed.
docker run --rm --ipc=host \
  -e CI=true -e "APPTRON_BOOT=${APPTRON_BOOT:-0}" -e "NO_ISOLATION_HEADERS=${NO_ISOLATION_HEADERS:-}" \
  -e "APPTRON_VM_SITE_DIR=${APPTRON_VM_SITE_DIR:-}" -e "APPTRON_EDITOR_SITE_DIR=${APPTRON_EDITOR_SITE_DIR:-}" \
  -v "$PWD:/work" -w /work \
  "mcr.microsoft.com/playwright:v${version}-noble" \
  npx playwright test "$@"
