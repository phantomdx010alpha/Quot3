import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/** Phase 68 - the performance acceptance run (`npm run perf:acceptance`). Kept out of the normal `npm test` because it seeds 5 000 bills and can soak for an hour. */
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { environment: 'node', include: ['src/main/perf/**/*.perf.ts'], testTimeout: 0, hookTimeout: 0, fileParallelism: false }
})
