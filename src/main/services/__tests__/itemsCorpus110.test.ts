// Phase 110 - optional local run on the owner's private corpus (docs/reference/legacy_import/Bills_JSON.zip). Skipped when absent.
// COUNTS AND RATES OF ONE NAMED ITEM ONLY: no party name, bill number or other spelling is printed or stored.
import { afterEach, describe, expect, it } from 'vitest'
import { createBillRepo } from '../../db/billRepo'
import { createItemRulesRepo } from '../../db/itemRulesRepo'
import { createItemsRepo } from '../../db/itemsRepo'
import { getLocalBranch } from '../../db/seed'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createItemsService } from '../itemsService'
import { serializeBill } from '../../../shared/billModel'
import { convertLegacyBill } from '../../../shared/legacyImport/convert'
import { parseLegacyFile } from '../../../shared/legacyImport/parse'
import { readCorpus } from '../../../shared/legacyImport/__tests__/corpus'
import { normaliseItem } from '../../../shared/items/normalise'

const files = readCorpus()
const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

describe.runIf(files !== null)('Phase 110 - items service on the private corpus (counts only)', () => {
  it('AMETO SMALL: non-GST median 82, GST kept apart; incremental = rebuild; timings', async () => {
    const t = openTestDb(); open.push(t)
    const sqlite = t.handle.sqlite
    const branchId = getLocalBranch(sqlite).id
    const repo = createBillRepo(sqlite)
    let n = 0
    sqlite.transaction(() => {
      for (const f of files ?? []) {
        const p = parseLegacyFile(f.text, f.bytes)
        if (!p.ok) continue
        n++
        const c = convertLegacyBill(p.bill, `corpus-${n}`, branchId, '2026-10-11T00:00:00.000Z')
        const { bill, rows } = serializeBill({ ...c.bill, poSeq: n, poNumber: `X${n}` })
        repo.insertBill(bill); repo.replaceRows(bill.id, rows)
      }
    })()
    const svc = createItemsService({ repo: createItemsRepo(sqlite), rules: () => createItemRulesRepo(sqlite).list() }, { yieldNow: async () => {} })
    const t0 = Date.now()
    const o = svc.overview()
    const coldMs = Date.now() - t0
    const id = normaliseItem('AMETO SMALL').key
    const sales = svc.sales({ groupId: id })
    const incremental = JSON.stringify(sales)
    const t1 = Date.now()
    const summary = await svc.rebuild()
    const rebuildMs = Date.now() - t1
    // eslint-disable-next-line no-console
    console.log(`[items corpus] bills=${o.bills} lines=${o.lines} groups=${o.groups.length} coldRead=${coldMs}ms rebuild=${rebuildMs}ms | AMETO SMALL non-GST: n=${sales.nonGst.stats.count} parties=${sales.nonGst.stats.parties} min=${sales.nonGst.stats.minRate} median=${sales.nonGst.stats.medianRate} max=${sales.nonGst.stats.maxRate} | GST: n=${sales.gst.stats.count}`)
    expect(summary.bills).toBe(o.bills)
    expect(JSON.stringify(svc.sales({ groupId: id }))).toBe(incremental)
    expect(sales.nonGst.stats.medianRate).toBe('82')
    expect(sales.gst.stats.count).toBeGreaterThanOrEqual(1)
    expect(sales.nonGst.rows.length + sales.gst.rows.length).toBe(sales.nonGst.stats.count + sales.gst.stats.count)
  }, 120_000)
})
