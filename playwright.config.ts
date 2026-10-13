import { defineConfig } from '@playwright/test'

/**
 * Phase 66 - Playwright-Electron e2e. Needs a built app (`npm run build` -> out/) and a display
 * (a real one, or `xvfb-run -a`). Run with `npm run test:e2e` / `npm run test:e2e:xvfb`.
 * One worker and no retries: every spec launches its own app with its own empty data folder, and a flaky pass hides a real bug.
 */
export default defineConfig({
  testDir: './tests-e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results'
})
