#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
commit=$(node -p "JSON.parse(require('fs').readFileSync('runtime.lock')).commit")
release=$(node -p "JSON.parse(require('fs').readFileSync('runtime.lock')).release")
archive_hash=$(node -p "JSON.parse(require('fs').readFileSync('runtime.lock')).archiveSha256 || ''")
[ -n "$archive_hash" ] || { echo 'No release archive is locked yet. Build the runtime locally or run the runtime workflow first.' >&2; exit 1; }
repo=${GITHUB_REPOSITORY:-curtcox/apptron}
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
if [ -n "${GH_TOKEN:-}" ]; then
  gh release download "$release" --repo "$repo" --pattern runtime.tar.gz --dir "$temp"
else
  curl --fail --location --retry 3 "https://github.com/$repo/releases/download/$release/runtime.tar.gz" -o "$temp/runtime.tar.gz"
fi
actual=$(node -e "const fs=require('fs'),c=require('crypto');console.log(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$temp/runtime.tar.gz")
[ "$actual" = "$archive_hash" ] || { echo 'Release archive checksum mismatch.' >&2; exit 1; }
mkdir -p "$temp/extracted"
tar -xzf "$temp/runtime.tar.gz" -C "$temp/extracted"
node scripts/verify-runtime.mjs "$temp/extracted"
mkdir -p runtime/"$commit"
cp -R "$temp/extracted/." "runtime/$commit/"
