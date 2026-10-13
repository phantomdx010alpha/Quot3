import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSim, billInput, U, type Sim } from './sharedSim'
import { createDoorbell } from '../doorbell'
import type { SharedStoreTransport } from '../sharedTransport'
import { DOORBELL_DEBOUNCE_MS, SHARED_POLL_MS, deliveryText, doorbellReconnectMs, pollDelayMs, pullDelayMs } from '../../../shared/sync/pull'
import { deriveOverview } from '../../../shared/sync/manager'

/** A clock the tests move by hand: timers run only when `advance` passes their time. */
function fakeClock() {
  let t = 0, nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    set: (fn: () => void, ms: number): unknown => { const id = nextId++; timers.set(id, { at: t + ms, fn }); return id },
    clear: (h: unknown): void => { timers.delete(h as number) },
    advance(ms: number): void {
      const end = t + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!due) break
        timers.delete(due[0]); t = due[1].at; due[1].fn()
      }
      t = end
    },
    pending: (): number => timers.size
  }
}

/** A transport whose doorbell the test controls: rings, live / not live, and a connection that can fail. */
function fakeBell() {
  const subs: Array<{ ring: () => void; live: (b: boolean) => void; closed: boolean }> = []
  let connectFails = 0
  const transport = { subscribeDoorbell: (_a: { orgId: string }, ring: () => void, live?: (b: boolean) => void) => {
    const s = { ring, live: live ?? (() => undefined), closed: false }
    subs.push(s)
    return () => { s.closed = true }
  } } as unknown as SharedStoreTransport
  return {
    transport, subs,
    failNextConnects: (n: number): void => { connectFails = n },
    connect: async (): Promise<{ transport: SharedStoreTransport }> => { if (connectFails > 0) { connectFails--; throw new Error('offline') } return { transport } },
    cur: () => subs[subs.length - 1]!
  }
}
const silent = { info: () => undefined, warn: () => undefined }
const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('Phase 138 - doorbell service', () => {
  it('a burst of rings inside the window becomes ONE pull, started after the debounce', async () => {
    const c = fakeClock(); const bell = fakeBell(); const kick = vi.fn()
    const d = createDoorbell({ connect: bell.connect, orgId: () => 'org', kick, log: silent }, { setTimer: c.set, clearTimer: c.clear })
    d.start(); await tick()
    bell.cur().live(true); expect(kick).toHaveBeenCalledTimes(1) // the catch-up pull on connecting
    kick.mockClear()
    for (let i = 0; i < 5; i++) bell.cur().ring()
    c.advance(DOORBELL_DEBOUNCE_MS - 1); expect(kick).not.toHaveBeenCalled()
    c.advance(1); expect(kick).toHaveBeenCalledTimes(1)
    bell.cur().ring(); c.advance(DOORBELL_DEBOUNCE_MS); expect(kick).toHaveBeenCalledTimes(2) // the next ring is a new window
    expect(d.status()).toMatchObject({ rings: 6, kicks: 3, mode: 'live', text: 'Live' })
  })

  it('says Live / Checking every minute, and kicks once when the connection comes back', async () => {
    const c = fakeClock(); const bell = fakeBell(); const kick = vi.fn(); const modes: string[] = []
    const d = createDoorbell({ connect: bell.connect, orgId: () => 'org', kick, log: silent, onMode: (m) => modes.push(m) }, { setTimer: c.set, clearTimer: c.clear })
    d.start(); await tick()
    expect(d.status().text).toBe('Checking every minute') // not live until the socket says so
    bell.cur().live(true)
    bell.cur().live(false)
    expect(d.status()).toMatchObject({ mode: 'polling', text: 'Checking every minute' })
    kick.mockClear()
    bell.cur().live(true) // supabase-js recovered on its own
    expect(kick).toHaveBeenCalledTimes(1)
    expect(modes).toEqual(['live', 'polling', 'live'])
  })

  it('reconnects with backoff 2 s, 4 s, 8 s; a connection that works resets it; a recovered socket cancels the pending retry', async () => {
    const c = fakeClock(); const bell = fakeBell(); const kick = vi.fn()
    expect([0, 1, 2, 3, 20].map(doorbellReconnectMs)).toEqual([2000, 4000, 8000, 16000, 300000])
    const d = createDoorbell({ connect: bell.connect, orgId: () => 'org', kick, log: silent }, { setTimer: c.set, clearTimer: c.clear })
    bell.failNextConnects(2)
    d.start(); await tick()                                  // fails -> retry in 2 s
    expect(bell.subs).toHaveLength(0)
    c.advance(1999); await tick(); expect(bell.subs).toHaveLength(0)
    c.advance(1); await tick()                               // second attempt fails -> retry in 4 s
    c.advance(3999); await tick(); expect(bell.subs).toHaveLength(0)
    c.advance(1); await tick(); expect(bell.subs).toHaveLength(1) // third attempt connects
    bell.cur().live(true)
    expect(d.status().reconnectAttempts).toBe(0)
    bell.cur().live(false)                                   // dropped: first retry is 2 s again
    c.advance(1999); await tick(); expect(bell.subs).toHaveLength(1)
    c.advance(1); await tick(); expect(bell.subs).toHaveLength(2)
    expect(bell.subs[0]!.closed).toBe(true)                  // the dead subscription was let go
    bell.subs[0]!.ring(); c.advance(DOORBELL_DEBOUNCE_MS); expect(kick).toHaveBeenCalledTimes(1) // (only the catch-up kick): a ring from the dead one is ignored
    bell.cur().live(false); expect(c.pending()).toBeGreaterThan(0)
    bell.cur().live(true); expect(c.pending()).toBe(0)       // recovered: the retry is cancelled
  })

  it('does nothing without an organisation, and stop() ends every timer and subscription', async () => {
    const c = fakeClock(); const bell = fakeBell(); const kick = vi.fn(); let org: string | null = null
    const d = createDoorbell({ connect: bell.connect, orgId: () => org, kick, log: silent }, { setTimer: c.set, clearTimer: c.clear })
    d.start(); await tick()
    expect(bell.subs).toHaveLength(0)
    org = 'org'; c.advance(2000); await tick()
    expect(bell.subs).toHaveLength(1)
    bell.cur().live(true); kick.mockClear()
    bell.cur().ring()
    d.stop()
    c.advance(10 * 60_000); await tick()
    expect(kick).not.toHaveBeenCalled()
    expect(bell.subs[0]!.closed).toBe(true)
    expect(c.pending()).toBe(0)
    expect(d.status()).toMatchObject({ started: false, mode: 'polling' })
  })
})

describe('Phase 138 - timing helpers and the status words', () => {
  it('the poll is 60 s and backs off like the worker always did; the old 30 s default is unchanged', () => {
    expect(SHARED_POLL_MS).toBe(60_000)
    expect([0, 1, 2, 3, 5].map((f) => pollDelayMs(f, SHARED_POLL_MS))).toEqual([60_000, 120_000, 240_000, 480_000, 600_000])
    expect(pullDelayMs(0)).toBe(30_000)
  })
  it('the overview carries Live / Checking every minute', () => {
    const base = { activated: true, enabled: true, readOnly: false, push: null, pull: null, counts: { pending: 0, failed: 0, synced: 0 }, oldestPendingAt: null, conflicts: 0 }
    expect(deriveOverview({ ...base, live: true })).toMatchObject({ delivery: 'live', deliveryText: 'Live' })
    expect(deriveOverview(base)).toMatchObject({ delivery: 'polling', deliveryText: 'Checking every minute' })
    expect(deliveryText('polling')).toBe('Checking every minute')
  })
})

describe('Phase 138 - against the in-memory server', () => {
  let sim: Sim | undefined
  afterEach(() => { sim?.close(); sim = undefined })

  it('a push on A rings B: ONE debounced pull brings the bill, no poll needed', async () => {
    const c = fakeClock()
    sim = await createSim({ pullOpts: { pollMs: SHARED_POLL_MS, setTimer: c.set, clearTimer: c.clear } })
    const [A, B] = sim.bs
    const bell = createDoorbell({ connect: async () => ({ transport: B!.transport }), orgId: () => sim!.orgId, kick: () => B!.pull.kick(), log: silent }, { setTimer: c.set, clearTimer: c.clear })
    B!.pull.start(); bell.start(); await tick()
    c.advance(300); await B!.pull.runOnce() // the start-up pull, then quiet
    A!.bills.save(billInput(U('bill-1'), '1'))
    await A!.push.runOnce()                 // the server touches sn_ping once
    expect(B!.q('SELECT id FROM bills')).toHaveLength(0)
    c.advance(DOORBELL_DEBOUNCE_MS)         // debounce over -> kick -> the worker's own short delay
    c.advance(300)
    await vi.waitFor(() => expect(B!.q('SELECT id FROM bills')).toHaveLength(1))
    bell.stop(); B!.pull.stop()
  })

  it('when rings are dropped the 60 s poll catches up', async () => {
    const c = fakeClock()
    sim = await createSim({ pullOpts: { pollMs: SHARED_POLL_MS, setTimer: c.set, clearTimer: c.clear } })
    const [A, B] = sim.bs
    B!.pull.start(); c.advance(300); await vi.waitFor(() => expect(B!.pull.status().lastSuccessAt).not.toBeNull())
    A!.bills.save(billInput(U('bill-2'), '2')); await A!.push.runOnce() // nobody is listening: the ring is lost
    c.advance(SHARED_POLL_MS - 1); await tick()
    expect(B!.q('SELECT id FROM bills')).toHaveLength(0)
    c.advance(1)
    await vi.waitFor(() => expect(B!.q('SELECT id FROM bills')).toHaveLength(1))
    B!.pull.stop()
  })
})
