import { describe, expect, it, vi } from 'vitest'
import type { MasterAdoptOutcome, MasterStatus } from '../../../../shared/master/clientTypes'
import { ADOPT_FIRST_DELAY_MS, startSilentAdopt } from '../silentAdopt'

const ST = (o: Partial<MasterStatus> = {}): MasterStatus => ({ configured: true, linked: false, companyLabel: null, seatNo: null, seatLabel: null, isAdmin: false, profileVersion: null, lastError: '', ...o })
const OUT = (o: Partial<MasterAdoptOutcome> = {}): MasterAdoptOutcome => ({ status: ST(), adopted: false, error: null, ...o })

function rig(opts: { status?: MasterStatus; shared?: boolean; adopt?: () => Promise<MasterAdoptOutcome> } = {}) {
  const timers: { fn: () => void; ms: number; live: boolean }[] = []
  const adopt = vi.fn(opts.adopt ?? (async () => OUT({ adopted: true })))
  const log = { info: vi.fn(), warn: vi.fn() }
  const h = startSilentAdopt({
    master: { status: () => opts.status ?? ST(), adopt }, sharedActive: () => opts.shared ?? true, log,
    schedule: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false } }
  })
  const fire = async (): Promise<void> => { const t = timers.filter((x) => x.live).pop(); t!.live = false; t!.fn(); await new Promise((r) => setTimeout(r, 0)) }
  return { timers, adopt, log, h, fire }
}

describe('Phase 264 silent adopt', () => {
  it('only schedules at start (never calls adopt synchronously) and waits the first delay', () => {
    const r = rig()
    expect(r.adopt).not.toHaveBeenCalled()
    expect(r.timers[0]!.ms).toBe(ADOPT_FIRST_DELAY_MS)
  })
  it('adopts once when configured, unlinked and shared sync is on; logs one line without secrets', async () => {
    const r = rig()
    await r.fire()
    expect(r.adopt).toHaveBeenCalledTimes(1)
    expect(r.log.info).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(r.log.info.mock.calls)).not.toMatch(/token|key|password/i)
    expect(r.timers.filter((t) => t.live)).toHaveLength(0)
  })
  it.each([
    ['not configured', { status: ST({ configured: false }) }],
    ['already has a device token', { status: ST({ linked: true, seatNo: 2 }) }],
    ['shared sync is off', { shared: false }]
  ])('does nothing when %s', async (_n, o) => {
    const r = rig(o)
    await r.fire()
    expect(r.adopt).not.toHaveBeenCalled()
    expect(r.timers.filter((t) => t.live)).toHaveLength(0)
  })
  it('a company that is simply not linked is not retried', async () => {
    const r = rig({ adopt: async () => OUT() })
    await r.fire()
    expect(r.timers.filter((t) => t.live)).toHaveLength(0)
  })
  it('retries after a failure with growing delays, then gives up; never throws even if adopt throws', async () => {
    const r = rig({ adopt: async () => { throw new Error('boom Bearer abc.def.ghi') } })
    await r.fire(); await r.fire(); await r.fire(); await r.fire()
    expect(r.adopt).toHaveBeenCalledTimes(4)
    expect(r.timers.map((t) => t.ms)).toEqual([8000, 60_000, 300_000, 1_800_000])
    expect(r.timers.filter((t) => t.live)).toHaveLength(0)
    expect(JSON.stringify(r.log.warn.mock.calls)).not.toContain('abc.def.ghi')
  })
  it('a failure outcome (offline) is retried and a later success stops the retries', async () => {
    let n = 0
    const r = rig({ adopt: async () => (n++ === 0 ? OUT({ error: { ok: false, code: 'Q3M90', message: 'x' } }) : OUT({ adopted: true })) })
    await r.fire(); await r.fire()
    expect(r.adopt).toHaveBeenCalledTimes(2)
    expect(r.timers.filter((t) => t.live)).toHaveLength(0)
  })
  it('cancel stops a pending attempt', async () => {
    const r = rig()
    r.h.cancel()
    expect(r.timers.every((t) => !t.live)).toBe(true)
  })
})
