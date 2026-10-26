# Vendored browser dependencies

Copied from the exact npm versions in package-lock.json:

- ace-builds 1.43.3: core, Tomorrow Night, shell/Python/JavaScript/C/Go/Make modes.
- lz-string 1.5.0: libs/lz-string.min.js.
- qrcode-generator 1.4.4: qrcode.js (MIT notice also embedded in source).

These files are served from the site, with no CDN dependency. Keep their license
files when updating. `npm ci` supplies the development/test copies.
