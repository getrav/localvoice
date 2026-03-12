import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  retries: 0,
  outputDir: 'test-results/',
    webServer: {
      command: 'bun "./server.ts"',
      url: 'http://localhost:7003',
      reuseExistingServer: false,
      env: {
        PORT: '7003',
        DB_PATH: '../data/3cx.db3',
      },
      timeout: 60_000,
    },
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 0,
    },
  },
  use: {
    baseURL: "http://localhost:7003",
    headless: true,
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
