import { describe, expect, it } from 'vitest'
import { PUSH_BACKOFF_CAP_MS, PUSH_INTERVAL_MS, pushDelayMs } from '../push'

describe('pushDelayMs (Phase 55)', () => {
  it('is the normal interval until something fails, then doubles up to the 10 minute cap', () => {
    expect(pushDelayMs(0)).toBe(PUSH_INTERVAL_MS)
    expect(pushDelayMs(-3)).toBe(PUSH_INTERVAL_MS)
    expect(pushDelayMs(Number.NaN)).toBe(PUSH_INTERVAL_MS)
    expect([1, 2, 3, 4, 5].map(pushDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000])
    expect(pushDelayMs(6)).toBe(PUSH_BACKOFF_CAP_MS)
    expect(pushDelayMs(1000)).toBe(PUSH_BACKOFF_CAP_MS)
  })
})
