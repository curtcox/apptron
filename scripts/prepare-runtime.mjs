import { cpSync, readFileSync, writeFileSync } from 'node:fs';
const lock = JSON.parse(readFileSync('runtime.lock'));
cpSync('patches/wanix', '.build/apptron/wanix-patches', { recursive: true });
let dockerfile = readFileSync('.build/apptron/Dockerfile', 'utf8')
  .replace('ghcr.io/tractordev/apptron:kernel', lock.images.kernel)
  .replace('ghcr.io/progrium/v86:latest', lock.images.v86)
  .replaceAll('brotli -j', 'brotli -q 1 -j');
dockerfile += `
FROM golang:1.25.0-alpine AS browser-wasm
RUN apk add --no-cache make git patch
WORKDIR /src
COPY . .
RUN go mod download && cp -R \$(go list -m -f '{{.Dir}}' tractor.dev/wanix) /wanix && chmod -R u+w /wanix && \
    for p in /src/wanix-patches/*.patch; do patch -d /wanix -p1 < "$p"; done && \
    go mod edit -replace tractor.dev/wanix=/wanix
RUN make wasm DATE=locked COMMIT=${lock.commit.slice(0, 7)} && cp -R \$(go list -m -f '{{.Dir}}' tractor.dev/wanix)/runtime /matching-loader && mkdir -p /browser-assets && \
    cp /wanix/web/idbfs/idbfs.js /wanix/web/dom/xterm/*.js /wanix/web/dom/xterm/*.css /wanix/runtime/wasm/*.js /browser-assets/ && \
    printf 'var thisWorker = window.vmReadyPort; var process = undefined;\\n' > /browser-assets/v86-page.js && \
    cat /wanix/vm/v86/v86.worker.min.js >> /browser-assets/v86-page.js && \
    mkdir -p /browser-assets/wasi && cp /wanix/runtime/wasi/worker/lib.js /browser-assets/wasi/lib.js
FROM golang:1.25.0-alpine AS matching-loader
RUN apk add --no-cache nodejs npm esbuild
WORKDIR /build/runtime
COPY --from=browser-wasm /matching-loader/ ./
RUN npm ci
RUN esbuild index.ts --outfile=wanix.min.js --bundle --external:util --loader:.go.js=text --loader:.tinygo.js=text --format=esm --minify && esbuild index.ts --outfile=wanix.js --bundle --external:util --loader:.go.js=text --loader:.tinygo.js=text --format=esm
FROM scratch AS export-loader
COPY --from=matching-loader /build/runtime/wanix.min.js /wanix.min.js
COPY --from=matching-loader /build/runtime/wanix.js /wanix.js
FROM scratch AS export-wasm
COPY --from=browser-wasm /src/assets/wanix.wasm /wanix.wasm
COPY --from=browser-wasm /browser-assets/ /
`;
writeFileSync('.build/apptron/Dockerfile', dockerfile);
