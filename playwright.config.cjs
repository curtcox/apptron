const { defineConfig } = require('@playwright/test');
const browsers = ['chromium', 'firefox', 'webkit'];
module.exports = defineConfig({
 testDir: './tests/browser', timeout: 30000, expect: { timeout: 10000 }, fullyParallel: false, workers: process.env.CI ? 2 : 1,
 reporter: 'list', use: { baseURL: 'http://127.0.0.1:4173/apptron/', trace: 'retain-on-failure' },
 webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4173/apptron/', reuseExistingServer: !process.env.CI },
 projects: browsers.flatMap(browserName => [false, true].map(mobile => ({ name: browserName + (mobile ? '-phone' : ''), use: { browserName, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, launchOptions: process.env[`PLAYWRIGHT_${browserName.toUpperCase()}_EXECUTABLE`] ? { executablePath: process.env[`PLAYWRIGHT_${browserName.toUpperCase()}_EXECUTABLE`] } : {} } })))
});
