import { afterEach, describe, expect, it } from 'vitest'
import { createBillRepo } from '../../db/billRepo'
import { createItemRulesRepo } from '../../db/itemRulesRepo'
import { createItemsRepo } from '../../db/itemsRepo'
import { getLocalBranch } from '../../db/seed'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createItemsService } from '../itemsService'
import { createEmptyBill, createEmptyRow, serializeBill } from '../../../shared/billModel'
import type { Bill } from '../../../shared/types'

/**
 * Phase 115 - Milestone 10 perf gate: 5 000 bills / 60 000 lines (invented names, no owner data).
 * Logic + SQLite only (no Electron, no renderer). The numbers are printed; the assertions are loose
 * ceilings so a slow CI box does not fail, while a real regression (seconds -> minutes) does.
 */
const BILLS = 5000
const LINES = 12
const WORDS = ['AMETO', 'CLIP', 'HOOK', 'ZIP', 'BUTTON', 'LACE', 'TAPE', 'RING', 'PIN', 'NEEDLE', 'THREAD', 'BUCKLE', 'SPRING', 'WASHER', 'SCREW', 'HINGE', 'LATCH', 'CHAIN', 'ROPE', 'BELT']
const KIND = ['SMALL', 'BIG', 'STEEL', 'BRASS', 'RED', 'BLUE', 'LONG', 'SHORT', 'FLAT', 'ROUND']
const SIZE = ['10', '12', '16', '20', '25', '32', '40', '50', '63', '75', '100', '125']

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

const nameOf = (i: number): string => `${WORDS[i % WORDS.length]} ${KIND[Math.floor(i / WORDS.length) % KIND.length]} ${SIZE[Math.floor(i / (WORDS.length * KIND.length)) % SIZE.length]}`

describe('Phase 115 - items perf at 5 000 bills / 60 000 lines', () => {
  it('rebuild, page open, one save and the three windows stay within budget', async () => {
    const t = openTestDb(); open.push(t)
    const sqlite = t.handle.sqlite
    const branchId = getLocalBranch(sqlite).id
    const billRepo = createBillRepo(sqlite)
    const rulesRepo = createItemRulesRepo(sqlite)
    let tick = 0
    const stamp = (): string => `2026-10-11T${String(Math.floor(tick / 3600) % 24).padStart(2, '0')}:${String(Math.floor(tick / 60) % 60).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}.000Z`
    const mk = (n: number, revision: number, extra?: string): Bill => {
      const date = `2026-${String(1 + (n % 9)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`
      const b = createEmptyBill({ branchId, formatId: n % 5 === 0 ? 'gst' : 'non_gst', rowCount: 0, billDate: date, now: `${date}T09:00:00.000Z`, newId: () => `b${n}` })
      const rows = Array.from({ length: LINES }, (_, i) => ({
        ...createEmptyRow(i, () => `b${n}-r${i}`),
        nameRuns: [{ t: extra !== undefined && i === 0 ? extra : nameOf((n * 7 + i * 13) % 2400) }],
        qty: String(1 + ((n + i) % 20)), rate: String(5 + ((n * 3 + i) % 400)), gstRate: n % 5 === 0 ? '18' : null, totalOverride: null
      }))
      return { ...b, poSeq: n, poNumber: `PO${n}`, party: { name: `PARTY ${n % 120}`, phone: '', address: '', transport: '' }, revision, updatedAt: stamp(), rows }
    }
    const seed = sqlite.transaction(() => {
      for (let n = 1; n <= BILLS; n++) { const { bill, rows } = serializeBill(mk(n, 1)); billRepo.insertBill(bill); billRepo.replaceRows(bill.id, rows) }
    })
    seed()

    let clock = 0
    const svc = createItemsService({ repo: createItemsRepo(sqlite), rules: () => rulesRepo.list() }, { now: () => new Date(Date.UTC(2026, 9, 11, 12, 0, clock++)), yieldNow: async () => {}, chunk: 200 })
    const ms = async <T>(f: () => T | Promise<T>): Promise<[number, T]> => { const a = performance.now(); const r = await f(); return [performance.now() - a, r] }

    const [cold, ov] = await ms(() => svc.overview())
    expect(ov.bills).toBe(BILLS)
    expect(ov.lines).toBe(BILLS * LINES)
    const [warm] = await ms(() => svc.overview())
    const [rebuild] = await ms(() => svc.rebuild(() => {}))
    const [afterRebuild] = await ms(() => svc.overview())

    // one saved bill (a new spelling forces regrouping, the worst case); then a rate-only edit (no regroup)
    const save = async (b: Bill): Promise<void> => { const { bill, rows } = serializeBill(b); billRepo.updateBill(bill); billRepo.replaceRows(bill.id, rows) }
    await save(mk(1, 2, 'BRAND NEW SPELLING 77'))
    const [oneSaveNewSpelling] = await ms(() => svc.overview())
    await save(mk(2, 2))
    const [oneSaveRateOnly] = await ms(() => svc.overview())

    const top = [...svc.overview().groups].sort((a, b) => b.count - a.count)[0]!
    const [detail] = await ms(() => svc.group(top.id))
    const [sales, s] = await ms(() => svc.sales({ groupId: top.id }))
    console.log(`[items perf115] ${BILLS} bills / ${BILLS * LINES} lines, ${ov.groups.length} groups: cold open ${cold.toFixed(0)} ms, warm open ${warm.toFixed(1)} ms, rebuild ${rebuild.toFixed(0)} ms (+ open ${afterRebuild.toFixed(1)} ms), after ONE save: new spelling ${oneSaveNewSpelling.toFixed(0)} ms / rate-only ${oneSaveRateOnly.toFixed(1)} ms, group() ${detail.toFixed(1)} ms, sales() ${sales.toFixed(1)} ms (${s.nonGst.rows.length + s.gst.rows.length} rows)`)

    // loose ceilings (a real regression is seconds, not tens of ms)
    expect(cold).toBeLessThan(30_000)
    expect(rebuild).toBeLessThan(30_000)
    expect(warm).toBeLessThan(500)
    expect(oneSaveRateOnly).toBeLessThan(500)
    expect(oneSaveNewSpelling).toBeLessThan(5_000)
    expect(detail).toBeLessThan(500)
    expect(sales).toBeLessThan(1_000)
  }, 120_000)
})
