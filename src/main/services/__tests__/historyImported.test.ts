import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createHistoryRepo } from '../../db/historyRepo'
import { createHistoryService } from '../historyService'
import { historyHandlers } from '../../ipc/history'
import { getLocalBranch } from '../../db/seed'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

function mk() {
  const t = openTestDb()
  open.push(t)
  const sqlite = t.handle.sqlite
  const branch = getLocalBranch(sqlite).id
  const ins = sqlite.prepare(
    `INSERT INTO bills (id, branch_id, po_seq, po_number, party_snapshot_json, format_id, bill_date, totals_json, item_row_count, revision, created_at, updated_at, legacy_ref, import_batch_id)
     VALUES (@id, @branch, @seq, @po, @party, 'non_gst', @date, '{"grandTotal":"10"}', 1, 1, @at, @at, @ref, @batch)`
  )
  const rows = [
    { id: 'm1', date: '2026-10-06', ref: null, batch: null, party: 'Made Here' },
    { id: 'i1', date: '2026-10-06', ref: 'BR1_106', batch: 'B1', party: 'Old One' },
    { id: 'i2', date: '2026-10-05', ref: 'BR1_107', batch: 'B1', party: 'Old Two' },
    { id: 'i3', date: '2026-10-05', ref: 'BR1_201', batch: 'B2', party: 'Other Batch' }
  ]
  rows.forEach((r, i) => ins.run({ ...r, branch, seq: i + 1, po: `Q3-${String(i + 1).padStart(4, '0')}`, at: `${r.date}T0${i}:00:00.000Z`, party: JSON.stringify({ name: r.party, phone: '', address: '', transport: '' }) }))
  const svc = createHistoryService(createHistoryRepo(sqlite))
  return { svc, h: historyHandlers(svc) }
}

describe('History source filter and legacy search (Phase 86)', () => {
  it('lists the legacy tags only on imported bills', () => {
    const { svc } = mk()
    const items = svc.listBills({ date: '2026-10-06' }).items
    expect(items.find((i) => i.id === 'i1')).toMatchObject({ legacyRef: 'BR1_106', importBatchId: 'B1' })
    const mine = items.find((i) => i.id === 'm1')!
    expect('legacyRef' in mine).toBe(false)
    expect('importBatchId' in mine).toBe(false)
  })

  it('filters dates and bills by source and batch', () => {
    const { svc } = mk()
    expect(svc.listDates({ source: 'all' })).toEqual([{ date: '2026-10-06', count: 2 }, { date: '2026-10-05', count: 2 }])
    expect(svc.listDates({ source: 'created' })).toEqual([{ date: '2026-10-06', count: 1 }])
    expect(svc.listDates({ source: 'imported' })).toEqual([{ date: '2026-10-06', count: 1 }, { date: '2026-10-05', count: 2 }])
    expect(svc.listBills({ date: '2026-10-06', source: 'created' }).items.map((i) => i.id)).toEqual(['m1'])
    expect(svc.listBills({ date: '2026-10-05', source: 'imported', batch: 'B2' }).items.map((i) => i.id)).toEqual(['i3'])
    // a batch implies Imported even when the source says created / all
    expect(svc.listBills({ date: '2026-10-05', source: 'created', batch: 'B1' }).items.map((i) => i.id)).toEqual(['i2'])
  })

  it('search matches the legacy reference (BR1_106 and 106) and respects the filter', () => {
    const { svc } = mk()
    expect(svc.search({ query: 'BR1_106' }).items.map((i) => i.id)).toEqual(['i1'])
    expect(svc.search({ query: '107' }).items.map((i) => i.id)).toEqual(['i2'])
    expect(svc.search({ query: 'old', source: 'imported', batch: 'B2' }).items.map((i) => i.id)).toEqual([])
    expect(svc.search({ query: 'BR1', source: 'imported', batch: 'B2' }).items.map((i) => i.id)).toEqual(['i3'])
    expect(svc.search({ query: 'BR1', source: 'created' }).items).toEqual([])
    expect(svc.search({ query: 'BR1_106' }).items[0]).toMatchObject({ legacyRef: 'BR1_106', importBatchId: 'B1' })
  })

  it('the IPC schema accepts the new fields and refuses a bad source', async () => {
    const { h } = mk()
    const ok = (await h['history:listBills']!({ date: '2026-10-06', source: 'imported' })) as { ok: boolean; data: { items: unknown[] } }
    expect(ok.ok).toBe(true)
    expect(ok.data.items).toHaveLength(1)
    expect(((await h['history:listBills']!({ source: 'bogus' })) as { ok: boolean }).ok).toBe(false)
    expect(((await h['history:search']!({ query: 'x', batch: 'B1' })) as { ok: boolean }).ok).toBe(true)
  })
})
