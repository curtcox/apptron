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
  if [ "$name" = gripeline ]; then
    node scripts/fetch-t256.mjs .build/apptron/t256-linux-386
  fi
  cp .build/apptron/Dockerfile .build/apptron/Dockerfile.overlay
  printf '\nFROM rootfs AS overlay\n' >> .build/apptron/Dockerfile.overlay
  if [ "$name" = fun ]; then
    printf 'RUN echo "@testing https://dl-cdn.alpinelinux.org/alpine/edge/testing" >> /etc/apk/repositories\n' >> .build/apptron/Dockerfile.overlay
  fi
  printf 'RUN apk add --no-cache %s\n' "$list" >> .build/apptron/Dockerfile.overlay
  if [ "$name" = gripeline ]; then
    printf 'COPY --chmod=0755 t256-linux-386 /usr/local/bin/t256\n' >> .build/apptron/Dockerfile.overlay
  fi
  docker buildx build --platform linux/amd64 -f .build/apptron/Dockerfile.overlay --target overlay --output "type=local,dest=.build/overlay-$name" .build/apptron
  node scripts/build-overlay.mjs "$name" "$commit"
done
