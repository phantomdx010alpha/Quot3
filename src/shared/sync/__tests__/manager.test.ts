import { describe, expect, it } from 'vitest'
import { deriveOverview, EMPTY_OVERVIEW, lastActivityAt, retrySchema, setEnabledSchema, syncBadge, type OverviewInput } from '../manager'
import type { PullStatus } from '../pull'
import type { PushStatus } from '../push'

const push = (o: Partial<PushStatus> = {}): PushStatus => ({ running: false, block: 'idle', consecutiveFailures: 0, nextDelayMs: 15_000, lastRunAt: null, lastSuccessAt: null, lastError: null, sentTotal: 0, ...o })
const pull = (o: Partial<PullStatus> = {}): PullStatus => ({ running: false, block: 'idle', consecutiveFailures: 0, nextDelayMs: 30_000, lastRunAt: null, lastSuccessAt: null, lastError: null, appliedTotal: 0, cursor: 0, unacked: 0, skipped: [], held: [], ...o })
const base = (o: Partial<OverviewInput> = {}): OverviewInput => ({ activated: true, enabled: true, readOnly: false, push: push(), pull: pull(), counts: { pending: 0, failed: 0, synced: 0 }, oldestPendingAt: null, conflicts: 0, ...o })

describe('deriveOverview (Phase 59)', () => {
  it('not activated = off, whatever the workers say, and the switch reads as on (it is simply unavailable)', () => {
    expect(deriveOverview(base({ activated: false, enabled: false }))).toMatchObject({ mode: 'off', chip: 'Sync: off', enabled: true })
    expect(EMPTY_OVERVIEW.mode).toBe('off')
  })
  it('switched off = paused, and says that queued changes are kept', () => {
    const o = deriveOverview(base({ enabled: false, counts: { pending: 3, failed: 0, synced: 0 } }))
    expect(o).toMatchObject({ mode: 'paused', chip: 'Sync: paused', enabled: false, pending: 3 })
    expect(o.headline).toContain('3 changes are kept')
    expect(deriveOverview(base({ enabled: false, push: push({ block: 'license' }) })).mode).toBe('paused') // a stale block never outranks the owner's switch
  })
  it('ok / working', () => {
    expect(deriveOverview(base())).toMatchObject({ mode: 'ok', chip: 'Sync: up to date', errors: [] })
    expect(deriveOverview(base({ counts: { pending: 1, failed: 0, synced: 0 } }))).toMatchObject({ mode: 'working', headline: '1 change is waiting to be sent.' })
    expect(deriveOverview(base({ pull: pull({ running: true }) }))).toMatchObject({ mode: 'working' })
  })
  it('offline is not an alarm: nothing lost, retries on its own; but it gives way to real problems', () => {
    const off = deriveOverview(base({ push: push({ block: 'offline', consecutiveFailures: 3, lastError: 'No connection' }), counts: { pending: 2, failed: 0, synced: 0 } }))
    expect(off).toMatchObject({ mode: 'offline', chip: 'Sync: offline' })
    expect(off.headline).toContain('2 changes are waiting')
    expect(deriveOverview(base({ pull: pull({ block: 'offline' }) })).mode).toBe('offline')
    expect(deriveOverview(base({ push: push({ block: 'offline' }), counts: { pending: 0, failed: 1, synced: 0 } })).mode).toBe('attention')
  })
  it('attention for: license refused, key missing, unreadable change, failed rows, skipped rows, conflicts', () => {
    expect(deriveOverview(base({ push: push({ block: 'license' }) }))).toMatchObject({ mode: 'attention' })
    expect(deriveOverview(base({ pull: pull({ block: 'no_key' }) })).errors[0]).toContain('encryption key')
    expect(deriveOverview(base({ pull: pull({ block: 'decrypt' }) })).errors[0]).toContain('could not be read')
    expect(deriveOverview(base({ counts: { pending: 0, failed: 2, synced: 0 } })).errors[0]).toContain('2 changes were given up on')
    expect(deriveOverview(base({ pull: pull({ skipped: [{ id: 5, billId: 'b', error: 'x' }] }) }))).toMatchObject({ mode: 'attention', skipped: 1 })
    expect(deriveOverview(base({ conflicts: 1 }))).toMatchObject({ mode: 'attention', conflicts: 1 })
    expect(deriveOverview(base({ conflicts: 1 })).errors[0]).toBe('1 bill was changed on two branches at once. Review the list below.')
  })
  it('a change held for the open bill is working, not an alarm; counts are carried through', () => {
    const o = deriveOverview(base({ pull: pull({ unacked: 4, held: [{ billId: 'b', revision: 2, updatedAt: '2026-10-10T10:00:00.000Z', fromBranch: 'x', receivedAt: '2026-10-10T10:00:00.000Z' } as never] }) }))
    expect(o).toMatchObject({ mode: 'working', held: 1, unacked: 4 })
  })
  it('last push / pull come from the workers\' last SUCCESS; lastActivityAt picks the later one', () => {
    const o = deriveOverview(base({ push: push({ lastSuccessAt: '2026-10-10T10:00:00.000Z', lastRunAt: '2026-10-10T11:00:00.000Z' }), pull: pull({ lastSuccessAt: '2026-10-10T10:30:00.000Z' }) }))
    expect(o.lastPushAt).toBe('2026-10-10T10:00:00.000Z')
    expect(o.lastPullAt).toBe('2026-10-10T10:30:00.000Z')
    expect(lastActivityAt(o)).toBe('2026-10-10T10:30:00.000Z')
    expect(lastActivityAt(EMPTY_OVERVIEW)).toBeNull()
  })
  it('errors are distinct and the first one is the headline of an attention state', () => {
    const o = deriveOverview(base({ push: push({ block: 'license' }), pull: pull({ block: 'license' }), conflicts: 1 }))
    expect(o.errors).toHaveLength(2)
    expect(o.headline).toBe(o.errors[0])
  })
})

describe('syncBadge / schemas', () => {
  it('shows a badge only for synced / pending / conflict', () => {
    expect(syncBadge('local_only')).toBeNull(); expect(syncBadge(undefined)).toBeNull(); expect(syncBadge('weird')).toBeNull()
    expect(syncBadge('synced')).toMatchObject({ text: 'Synced', tone: 'ok' })
    expect(syncBadge('pending')).toMatchObject({ text: 'Waiting', tone: 'wait' })
    expect(syncBadge('conflict')).toMatchObject({ text: 'Conflict', tone: 'bad' })
  })
  it('strict payloads', () => {
    expect(setEnabledSchema.safeParse({ enabled: true }).success).toBe(true)
    expect(setEnabledSchema.safeParse({ enabled: 1 }).success).toBe(false)
    expect(setEnabledSchema.safeParse({ enabled: true, x: 1 }).success).toBe(false)
    expect(retrySchema.safeParse({}).success).toBe(true)
    expect(retrySchema.safeParse({ ids: [1, 2] }).success).toBe(true)
    expect(retrySchema.safeParse({ ids: [-1] }).success).toBe(false)
    expect(retrySchema.safeParse({ ids: new Array(1001).fill(1) }).success).toBe(false)
  })
})
