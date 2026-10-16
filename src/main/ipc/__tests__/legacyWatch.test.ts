import { describe, expect, it, vi } from 'vitest'
import { legacyWatchHandlers } from '../legacyWatch'
import type { LegacyWatchService } from '../../services/legacyWatchService'
import { emptyCounts, INTERVAL_RANGE, LEGACY_WATCH_DEFAULTS, LEGACY_WATCH_KEYS, legacyWatchSettingsSchema, readLegacyWatchSettings, type LegacyWatchStatus } from '../../../shared/legacyWatch/watchConfig'
import { SETTING_DEFAULTS, SETTING_KEY_RE } from '../../../shared/settings'
import { AppError } from '../envelope'

const status: LegacyWatchStatus = { state: 'off', enabled: false, paused: false, folderLabel: '', intervalSeconds: 120, lastScanAt: null, filesSeen: 0, lastCounts: emptyCounts(), totals: emptyCounts(), waiting: 0, syncOn: false, message: null }

const svc = (): LegacyWatchService => ({
  start: vi.fn(), stop: vi.fn(),
  status: vi.fn(() => status),
  scan: vi.fn(async () => status),
  scanNow: vi.fn(async () => { throw new AppError('VALIDATION', 'Turn watching on and choose the legacy folder first.') }),
  setPaused: vi.fn((p: boolean) => ({ ...status, paused: p }))
})

describe('legacyWatch IPC', () => {
  it('registers exactly status, scanNow and pause', () => {
    expect(Object.keys(legacyWatchHandlers(svc())).sort()).toEqual(['legacyWatch:pause', 'legacyWatch:scanNow', 'legacyWatch:status'])
  })

  it('pickFolder exists only when the picker is given; cancel changes nothing, a choice is saved then the status returned', async () => {
    expect(legacyWatchHandlers(svc())['legacyWatch:pickFolder']).toBeUndefined()
    const saveFolder = vi.fn()
    const pickFolder = vi.fn<() => Promise<string | null>>()
    const s = svc()
    const h = legacyWatchHandlers(s, { pickFolder, saveFolder })
    expect(Object.keys(h).sort()).toEqual(['legacyWatch:pause', 'legacyWatch:pickFolder', 'legacyWatch:scanNow', 'legacyWatch:status'])
    pickFolder.mockResolvedValueOnce(null)
    expect(await h['legacyWatch:pickFolder']!({})).toEqual({ ok: true, data: null })
    expect(saveFolder).not.toHaveBeenCalled()
    pickFolder.mockResolvedValueOnce('D:\\synthetic\\bills')
    expect(await h['legacyWatch:pickFolder']!({})).toEqual({ ok: true, data: status })
    expect(saveFolder).toHaveBeenCalledWith('D:\\synthetic\\bills')
    expect(await h['legacyWatch:pickFolder']!({ x: 1 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })

  it('review / activity channels exist only with the review deps; input is strict; undo returns a plain message', async () => {
    expect(legacyWatchHandlers(svc())['legacyWatch:reviewList']).toBeUndefined()
    const review = {
      reviewLists: vi.fn(() => ({ open: [], ignored: [] })),
      reviewCount: vi.fn(() => 3),
      activityItems: vi.fn(() => []),
      resolveReview: vi.fn(async (_id: string, action: string) => ({ action, message: 'ok', billId: null })),
      undo: vi.fn(() => ({ kind: 'imported' as const, billId: 'b1', revision: 2 }))
    }
    const h = legacyWatchHandlers(svc(), undefined, review as never)
    expect(Object.keys(h).sort()).toEqual(['legacyWatch:activityList', 'legacyWatch:activityUndo', 'legacyWatch:pause', 'legacyWatch:reviewCount', 'legacyWatch:reviewList', 'legacyWatch:reviewResolve', 'legacyWatch:scanNow', 'legacyWatch:status'])
    expect(await h['legacyWatch:reviewCount']!({})).toEqual({ ok: true, data: { count: 3 } })
    expect(await h['legacyWatch:reviewList']!({})).toEqual({ ok: true, data: { open: [], ignored: [] } })
    expect(await h['legacyWatch:reviewResolve']!({ id: 'r1', action: 'ignore' })).toMatchObject({ ok: true, data: { action: 'ignore' } })
    expect(review.resolveReview).toHaveBeenCalledWith('r1', 'ignore', undefined)
    expect(await h['legacyWatch:reviewResolve']!({ id: 'r1', action: 'delete' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await h['legacyWatch:reviewResolve']!({ id: 'r1', action: 'replace', extra: 1 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await h['legacyWatch:activityUndo']!({ id: 'a1' })).toMatchObject({ ok: true, data: { billId: 'b1', message: expect.stringContaining('Recently deleted') } })
    expect(await h['legacyWatch:activityUndo']!({})).toMatchObject({ ok: false })
  })

  it('status returns the service status; extra input is refused (strict)', async () => {
    const h = legacyWatchHandlers(svc())
    expect(await h['legacyWatch:status']!({})).toEqual({ ok: true, data: status })
    expect(await h['legacyWatch:status']!({ x: 1 })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })

  it('pause needs a boolean', async () => {
    const s = svc()
    const h = legacyWatchHandlers(s)
    expect(await h['legacyWatch:pause']!({ paused: true })).toMatchObject({ ok: true, data: { paused: true } })
    expect(s.setPaused).toHaveBeenCalledWith(true)
    expect(await h['legacyWatch:pause']!({ paused: 'yes' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(await h['legacyWatch:pause']!({})).toMatchObject({ ok: false })
  })

  it('a refused scan comes back as a stable VALIDATION error, not a throw', async () => {
    const r = await legacyWatchHandlers(svc())['legacyWatch:scanNow']!({})
    expect(r).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })
})

describe('legacy watch settings', () => {
  it('keys are valid setting keys and everything is OFF by default', () => {
    for (const k of Object.values(LEGACY_WATCH_KEYS)) { expect(SETTING_KEY_RE.test(k)).toBe(true); expect(SETTING_DEFAULTS[k]).toBe(LEGACY_WATCH_DEFAULTS[k]) }
    expect(readLegacyWatchSettings(SETTING_DEFAULTS as Record<string, unknown>)).toEqual({ enabled: false, folder: '', intervalSeconds: 120 })
  })

  it('the reader is tolerant: bad values fall back, the interval is clamped', () => {
    expect(readLegacyWatchSettings({ [LEGACY_WATCH_KEYS.enabled]: 'yes', [LEGACY_WATCH_KEYS.folder]: 5, [LEGACY_WATCH_KEYS.intervalSeconds]: 'x' })).toEqual({ enabled: false, folder: '', intervalSeconds: INTERVAL_RANGE.default })
    expect(readLegacyWatchSettings({ [LEGACY_WATCH_KEYS.intervalSeconds]: 1 }).intervalSeconds).toBe(INTERVAL_RANGE.min)
    expect(readLegacyWatchSettings({ [LEGACY_WATCH_KEYS.intervalSeconds]: 999999 }).intervalSeconds).toBe(INTERVAL_RANGE.max)
    expect(readLegacyWatchSettings({ [LEGACY_WATCH_KEYS.folder]: '  C:\\x  ', [LEGACY_WATCH_KEYS.enabled]: true })).toMatchObject({ enabled: true, folder: 'C:\\x' })
  })

  it('the Zod schema accepts good values and refuses bad ones', () => {
    expect(legacyWatchSettingsSchema.safeParse({ enabled: true, folder: 'C:\\x', intervalSeconds: 120 }).success).toBe(true)
    expect(legacyWatchSettingsSchema.safeParse({ enabled: true, folder: 'C:\\x', intervalSeconds: 5 }).success).toBe(false)
    expect(legacyWatchSettingsSchema.safeParse({ enabled: 1, folder: '', intervalSeconds: 120 }).success).toBe(false)
    expect(legacyWatchSettingsSchema.safeParse({ enabled: true, folder: '', intervalSeconds: 120, extra: 1 }).success).toBe(false)
  })
})
