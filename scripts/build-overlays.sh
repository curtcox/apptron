#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
commit=$(node -p "JSON.parse(require('fs').readFileSync('runtime.lock')).commit")
[ -d .build/apptron ] || { echo 'Run build-runtime.sh first.' >&2; exit 1; }
docker buildx build --platform linux/amd64 --target rootfs --output type=local,dest=.build/base .build/apptron
for packages in examples/overlays/*.packages; do
  name=$(basename "$packages" .packages)
  # Package files contain only Alpine package identifiers, never shell commands.
  list=$(sed '/^#/d; /^$/d' "$packages" | tr '\n' ' ')
  [[ "$list" =~ ^[a-zA-Z0-9._+@[:space:]-]+$ ]] || { echo 'Invalid package list.' >&2; exit 1; }
  cp .build/apptron/Dockerfile .build/apptron/Dockerfile.overlay
  printf '\nFROM rootfs AS overlay\n' >> .build/apptron/Dockerfile.overlay
  if [ "$name" = fun ]; then
    printf 'RUN echo "@testing https://dl-cdn.alpinelinux.org/alpine/edge/testing" >> /etc/apk/repositories\n' >> .build/apptron/Dockerfile.overlay
  fi
  printf 'RUN apk add --no-cache %s\n' "$list" >> .build/apptron/Dockerfile.overlay
  docker buildx build --platform linux/amd64 -f .build/apptron/Dockerfile.overlay --target overlay --output "type=local,dest=.build/overlay-$name" .build/apptron
  node scripts/build-overlay.mjs "$name" "$commit"
done
