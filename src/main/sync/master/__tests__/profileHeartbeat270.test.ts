import { describe, expect, it } from 'vitest'
import { PROFILE_FIRST_DELAY_MS, PROFILE_INTERVAL_MS, startProfileHeartbeat } from '../profileHeartbeat'

function mk(o: { configured?: boolean; linked?: boolean; heartbeat?: () => Promise<unknown> } = {}) {
  const timers: { fn: () => void; ms: number }[] = []
  const logs: unknown[] = []
  let beats = 0
  const master = {
    status: () => ({ configured: o.configured ?? true, linked: o.linked ?? true }),
    heartbeat: async () => { beats++; return o.heartbeat ? o.heartbeat() : { ok: true, profileChanged: true, profileApplied: true, seatStatus: 'active', companyStatus: 'active' } }
  }
  const h = startProfileHeartbeat({
    master: master as never,
    schedule: (fn, ms) => { timers.push({ fn, ms }); return () => { timers.length = 0 } },
    log: { info: (m, x) => logs.push([m, x]), warn: (m, x) => logs.push([m, x]) }
  })
  return { h, timers, logs, beats: () => beats }
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('Phase 270 profile heartbeat', () => {
  it('first beat after the start delay, then every interval', async () => {
    const m = mk()
    expect(m.timers[0]!.ms).toBe(PROFILE_FIRST_DELAY_MS)
    m.timers[0]!.fn(); await flush()
    expect(m.beats()).toBe(1)
    expect(m.timers[m.timers.length - 1]!.ms).toBe(PROFILE_INTERVAL_MS)
  })
  it('does nothing when the master is not configured or this PC is not linked', async () => {
    for (const o of [{ configured: false }, { linked: false }]) {
      const m = mk(o); m.timers[0]!.fn(); await flush()
      expect(m.beats()).toBe(0)
    }
  })
  it('a failed or throwing heartbeat never throws and the next beat is still planned', async () => {
    const m = mk({ heartbeat: async () => { throw new Error('boom') } })
    m.timers[0]!.fn(); await flush()
    expect(m.timers.some((t) => t.ms === PROFILE_INTERVAL_MS)).toBe(true)
    const f = mk({ heartbeat: async () => ({ ok: false, code: 'Q3M90', message: 'x' }) })
    f.timers[0]!.fn(); await flush()
    expect(JSON.stringify(f.logs)).toContain('Q3M90')
  })
  it('cancel stops the schedule', async () => {
    const m = mk(); m.h.cancel(); await m.h.runNow()
    expect(m.beats()).toBe(0)
  })
})
