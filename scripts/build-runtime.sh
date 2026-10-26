#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker with Buildx is required.' >&2; exit 1; }
docker info >/dev/null
commit=$(node -p "JSON.parse(require('fs').readFileSync('runtime.lock')).commit")
actual=$(git -C upstream/apptron rev-parse HEAD)
[ "$actual" = "$commit" ] || { echo 'Submodule and runtime.lock commits differ.' >&2; exit 1; }
mkdir -p .build runtime/"$commit"
# A disposable source tree keeps the upstream submodule unmodified.
rm -rf .build/apptron
mkdir -p .build/apptron
git -C upstream/apptron archive HEAD | tar -x -C .build/apptron
for patchfile in patches/*.patch; do
  [ -f "$patchfile" ] || continue
  (cd .build/apptron && patch -p1 < "../../$patchfile")
done
node scripts/prepare-runtime.mjs
cache=()
if [ "${GITHUB_ACTIONS:-}" = true ]; then
  cache=(--cache-from type=gha --cache-to type=gha,mode=max)
fi
out="$PWD/runtime/$commit"
for target in bundle-sys bundle-goroot bundle-gocache-386 bundle-gocache-wasm; do
  if [ "${CORE_ONLY:-0}" = 1 ] && [ "$target" != bundle-sys ]; then continue; fi
  docker buildx build --platform linux/amd64 "${cache[@]}" --target "$target" --load -t "apptron-online:$target" .build/apptron
  container=$(docker create "apptron-online:$target")
  docker cp "$container:/bundles/." "$out/"
  docker rm "$container" >/dev/null
done
docker buildx build --platform linux/amd64 "${cache[@]}" --target export-wasm --output "type=local,dest=$out" .build/apptron
# The current image API is incompatible with Apptron v0.7; compile the loader
# from Apptron's exact Go module revision instead (recorded in runtime.lock).
docker buildx build --platform linux/amd64 "${cache[@]}" --target export-loader --output "type=local,dest=$out" .build/apptron
# Pages cannot set Content-Encoding. Decode Brotli at build time, serve gzip.
node scripts/recompress-bundles.mjs "$out"
if [ "${CORE_ONLY:-0}" != 1 ]; then scripts/build-overlays.sh; fi
node scripts/runtime-manifest.mjs "$out" --lock
echo "Runtime built in $out. Run npm run test:boot before publishing."
