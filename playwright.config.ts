import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const ci = !!process.env.CI;

/**
 * Real-browser tests against the built playground (which consumes the built
 * package through its public exports).
 *   pnpm test:e2e      → functional + accessibility (Chromium; Firefox/WebKit in CI)
 *   pnpm test:visual   → screenshot comparisons (Linux baselines)
 *   pnpm perf:render   → large-document timings → tests/performance/results.json
 */
export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'chromium', testDir: 'tests/e2e', testIgnore: /visual\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    ...(process.env.E2E_ALL_BROWSERS
      ? [
          { name: 'firefox', testDir: 'tests/e2e', testIgnore: /visual\.spec/, use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
          { name: 'webkit', testDir: 'tests/e2e', testIgnore: /visual\.spec/, use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
        ]
      : []),
    { name: 'visual', testDir: 'tests/e2e', testMatch: /visual\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'performance', testDir: 'tests/performance', testMatch: /\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `pnpm --filter playground exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
