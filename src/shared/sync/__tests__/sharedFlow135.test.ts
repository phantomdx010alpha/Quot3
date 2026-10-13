import { describe, expect, it } from 'vitest'
import { cursorAfterCompare, SHARED_PULL_FAIL_CAP } from '../pull'
import { classifySharedWorkerFailure, sharedBlockFor, CLOCK_REMEASURE_MS } from '../push'
import { SHARED_MESSAGES } from '../license'

describe('Phase 135 pure helpers', () => {
  it('cursorAfterCompare: jumps only when nothing has to be downloaded; otherwise starts just below the lowest wanted record; never moves a cursor up past a wanted record', () => {
    expect(cursorAfterCompare(0, null, 1927)).toBe(1927)
    expect(cursorAfterCompare(2000, null, 1927)).toBe(2000)
    expect(cursorAfterCompare(0, 40, 1927)).toBe(0)
    expect(cursorAfterCompare(500, 40, 1927)).toBe(39)
    expect(cursorAfterCompare(10, 40, 1927)).toBe(10)
    expect(cursorAfterCompare(0, 1, 5)).toBe(0)
    expect(cursorAfterCompare(Number.NaN, null, 7)).toBe(7)
  })

  it('every transport failure kind has a class; connection trouble never blames a row; the server refusing the request itself does', () => {
    for (const kind of Object.keys(SHARED_MESSAGES)) expect(['offline', 'paused', 'auth', 'license', 'row']).toContain(classifySharedWorkerFailure(kind))
    for (const k of ['offline', 'timeout', 'server']) expect(classifySharedWorkerFailure(k)).toBe('offline')
    expect(classifySharedWorkerFailure('server_paused')).toBe('paused')
    expect(classifySharedWorkerFailure('auth_failed')).toBe('auth')
    for (const k of ['invalid_input', 'too_large', 'too_many']) expect(classifySharedWorkerFailure(k)).toBe('row')
    for (const k of ['license', 'not_member', 'unknown_branch', 'not_installed', 'seat_in_use', 'branch_conflict']) expect(classifySharedWorkerFailure(k)).toBe('license')
    expect(classifySharedWorkerFailure('SYNC_OFFLINE')).toBe('offline')
    expect(classifySharedWorkerFailure('SERVER_PAUSED')).toBe('paused')
    expect(sharedBlockFor('offline')).toBe('offline')
    expect(sharedBlockFor('paused')).toBe('paused')
  })

  it('constants: the pull gives up after the v1 cap; the clock is measured again after 10 minutes', () => {
    expect(SHARED_PULL_FAIL_CAP).toBe(10)
    expect(CLOCK_REMEASURE_MS).toBe(600_000)
  })
})
