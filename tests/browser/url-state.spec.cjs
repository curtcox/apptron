const { test } = require('@playwright/test');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
test('program URLs are independent of saved drafts', async ({}, info) => {
  test.setTimeout(180000);
  const engine = info.project.use.browserName;
  const { stdout } = await promisify(execFile)(process.execPath, ['tests/browser/url-state.cjs'], {
    env: { ...process.env, BROWSER: engine,
      ...(process.env['PLAYWRIGHT_' + engine.toUpperCase() + '_EXECUTABLE'] ?
        { PLAYWRIGHT_EXECUTABLE_PATH: process.env['PLAYWRIGHT_' + engine.toUpperCase() + '_EXECUTABLE'] } : {}) },
    timeout: 170000
  });
  console.log(stdout);
});
