import { defineConfig, devices } from '@playwright/test'

const PORT = 4174

// E2E tests run against the production build, with every external API mocked in tests/e2e/mockApis.ts.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    // A subpath, like a github.io project site, proves the relative asset paths work.
    baseURL: `http://localhost:${PORT}/nyc-apt-check/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort --base /nyc-apt-check/`,
    url: `http://localhost:${PORT}/nyc-apt-check/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
