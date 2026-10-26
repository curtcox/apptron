import { readFileSync, writeFileSync } from 'node:fs';
const lock = JSON.parse(readFileSync('runtime.lock'));
let dockerfile = readFileSync('.build/apptron/Dockerfile', 'utf8')
  .replace('ghcr.io/tractordev/apptron:kernel', lock.images.kernel)
  .replace('ghcr.io/progrium/v86:latest', lock.images.v86)
  .replaceAll('brotli -j', 'brotli -q 1 -j');
dockerfile += `
FROM golang:1.25.0-alpine AS browser-wasm
RUN apk add --no-cache make git
WORKDIR /src
COPY . .
RUN make wasm DATE=locked COMMIT=${lock.commit.slice(0, 7)} && cp -R \$(go list -m -f '{{.Dir}}' tractor.dev/wanix)/runtime /matching-loader
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
`;
writeFileSync('.build/apptron/Dockerfile', dockerfile);
