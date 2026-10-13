import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createHistoryRepo } from '../../db/historyRepo'
import { createHistoryService } from '../historyService'
import { historyHandlers } from '../../ipc/history'
import { getLocalBranch } from '../../db/seed'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

interface Seed { id: string; date: string; at: string; party: string | null; total: string | null; deleted?: boolean; branch?: string }
function mk(seeds: Seed[] = []) {
  const t = openTestDb()
  open.push(t)
  const sqlite = t.handle.sqlite
  const branch = getLocalBranch(sqlite).id
  const ins = sqlite.prepare(
    `INSERT INTO bills (id, branch_id, po_seq, po_number, party_snapshot_json, format_id, bill_date, totals_json, item_row_count, revision, created_at, updated_at, deleted_at)
     VALUES (@id, @branch, @seq, @po, @party, 'non_gst', @date, @totals, 1, 1, @at, @at, @del)`
  )
  let seq = 0
  sqlite.transaction(() => {
    for (const s of seeds) {
      seq++
      ins.run({
        id: s.id, branch: s.branch ?? branch, seq, po: `Q3-${String(seq).padStart(4, '0')}`,
        party: JSON.stringify({ name: s.party ?? '', phone: '', address: '', transport: '' }),
        date: s.date, at: s.at, del: s.deleted ? s.at : null,
        totals: s.total === null ? '{}' : JSON.stringify({ itemsSubtotal: s.total, adjustmentsTotal: '0', grandTotal: s.total, gstTotal: '0' })
      })
    }
  })()
  const svc = createHistoryService(createHistoryRepo(sqlite))
  return { t, svc, branch }
}

const sample: Seed[] = [
  { id: 'a', date: '2026-10-05', at: '2026-10-05T09:00:00.000Z', party: 'Zakers Clothing', total: '9350' },
  { id: 'b', date: '2026-10-06', at: '2026-10-06T09:00:00.000Z', party: 'NEW PARTY', total: '10025' },
  { id: 'c', date: '2026-10-06', at: '2026-10-06T11:00:00.000Z', party: 'Ms Smart Bums', total: '7150' },
  { id: 'd', date: '2026-10-06', at: '2026-10-06T10:00:00.000Z', party: 'Gone', total: '1', deleted: true },
  { id: 'e', date: '2026-10-04', at: '2026-10-04T09:00:00.000Z', party: null, total: null }
]

describe('historyService', () => {
  it('lists dates newest first with counts, excluding the trash', () => {
    const { svc } = mk(sample)
    expect(svc.listDates({})).toEqual([
      { date: '2026-10-06', count: 2 }, { date: '2026-10-05', count: 1 }, { date: '2026-10-04', count: 1 }
    ])
    expect(svc.listDates({ branch: 'all' })).toEqual(svc.listDates({}))
  })

  it('lists a date newest first (by creation time) with party, PO, date and total', () => {
    const { svc } = mk(sample)
    const r = svc.listBills({ date: '2026-10-06' })
    expect(r.next).toBeUndefined()
    expect(r.items.map((i) => i.id)).toEqual(['c', 'b'])
    expect(r.items[0]).toEqual({ id: 'c', poNumber: 'Q3-0003', poSeq: 3, billDate: '2026-10-06', partyName: 'Ms Smart Bums', grandTotal: '7150', branchId: expect.any(String), revision: 1, syncState: 'local_only' })
  })

  it('a bill with an empty party and an unreadable totals cache still lists (blank party, empty total)', () => {
    const { svc } = mk(sample)
    expect(svc.listBills({ date: '2026-10-04' }).items).toEqual([expect.objectContaining({ id: 'e', partyName: '', grandTotal: '' })])
  })

  it('no date = every bill newest first; an unknown date or branch is an empty list', () => {
    const { svc } = mk(sample)
    expect(svc.listBills({}).items.map((i) => i.id)).toEqual(['c', 'b', 'a', 'e'])
    expect(svc.listBills({ date: '2020-01-01' }).items).toEqual([])
    expect(svc.listBills({ branch: 'nope' }).items).toEqual([])
    expect(svc.listDates({ branch: 'nope' })).toEqual([])
  })

  it('pages with a keyset cursor: no gaps, no duplicates, last page has no next', () => {
    const seeds: Seed[] = Array.from({ length: 23 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, date: '2026-10-01', at: `2026-10-01T10:${String(i % 60).padStart(2, '0')}:00.000Z`, party: `P${i}`, total: '1' }))
    const { svc } = mk(seeds)
    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    for (;;) {
      const r = svc.listBills({ date: '2026-10-01', limit: 10, ...(cursor ? { cursor } : {}) })
      seen.push(...r.items.map((i) => i.id))
      pages++
      if (!r.next) break
      cursor = r.next
    }
    expect(pages).toBe(3)
    expect(seen).toHaveLength(23)
    expect(new Set(seen).size).toBe(23)
    expect(seen).toEqual(svc.listBills({ date: '2026-10-01', limit: 100 }).items.map((i) => i.id))
  })

  it('ties on creation time are broken by id so paging stays stable', () => {
    const seeds: Seed[] = ['x1', 'x2', 'x3', 'x4', 'x5'].map((id) => ({ id, date: '2026-10-01', at: '2026-10-01T10:00:00.000Z', party: id, total: '1' }))
    const { svc } = mk(seeds)
    const a = svc.listBills({ limit: 2 })
    const b = svc.listBills({ limit: 2, cursor: a.next! })
    const c = svc.listBills({ limit: 2, cursor: b.next! })
    expect([...a.items, ...b.items, ...c.items].map((i) => i.id)).toEqual(['x5', 'x4', 'x3', 'x2', 'x1'])
    expect(c.next).toBeUndefined()
  })

  it('a malformed cursor is a VALIDATION error', () => {
    const { svc } = mk(sample)
    expect(() => svc.listBills({ cursor: '%%%' })).toThrowError(/cursor/i)
  })

  it('filters by branch and lists the local branch first', () => {
    const { t, svc, branch } = mk([])
    t.handle.sqlite.prepare(`INSERT INTO branches (id, name, po_prefix, is_local, created_at) VALUES ('br2', 'Annex', 'AN-', 0, '2026-10-01T00:00:00Z')`).run()
    const { svc: svc2 } = (() => {
      const ins = t.handle.sqlite.prepare(
        `INSERT INTO bills (id, branch_id, po_seq, po_number, party_snapshot_json, format_id, bill_date, totals_json, item_row_count, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, '{"name":"X"}', 'non_gst', '2026-10-02', '{}', 1, 1, '2026-10-02T00:00:00Z', '2026-10-02T00:00:00Z')`
      )
      ins.run('l1', branch, 1, 'Q3-0001'); ins.run('r1', 'br2', 1, 'AN-0001')
      return { svc }
    })()
    expect(svc2.listBills({ branch }).items.map((i) => i.id)).toEqual(['l1'])
    expect(svc2.listBills({ branch: 'br2' }).items.map((i) => i.id)).toEqual(['r1'])
    expect(svc2.listBills({ branch: 'all' }).items).toHaveLength(2)
    expect(svc2.listDates({ branch: 'br2' })).toEqual([{ date: '2026-10-02', count: 1 }])
    const bs = svc2.branches()
    expect(bs[0]).toEqual({ id: branch, name: expect.any(String), isLocal: true })
    expect(bs.map((b) => b.id)).toEqual([branch, 'br2'])
  })

  it('performance: 500 bills over 70 dates — dates, one day and the first page each answer in < 50 ms', () => {
    const seeds: Seed[] = Array.from({ length: 500 }, (_, i) => {
      const day = 1 + (i % 70)
      const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10)
      return { id: `b${String(i).padStart(3, '0')}`, date, at: `${date}T${String(8 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`, party: `Party ${i % 40}`, total: String(100 + i) }
    })
    const { svc } = mk(seeds)
    const time = (fn: () => unknown): number => { const t0 = performance.now(); fn(); return performance.now() - t0 }
    svc.listDates({}) // warm the statements
    const dates = svc.listDates({})
    expect(dates).toHaveLength(70)
    expect(dates.reduce((n, d) => n + d.count, 0)).toBe(500)
    expect(dates[0]!.date > dates[69]!.date).toBe(true)
    expect(time(() => svc.listDates({}))).toBeLessThan(50)
    expect(time(() => svc.listBills({ date: dates[0]!.date }))).toBeLessThan(50)
    const first = svc.listBills({})
    expect(first.items).toHaveLength(200)
    expect(first.next).toBeDefined()
    expect(time(() => svc.listBills({}))).toBeLessThan(50)
    expect(time(() => svc.listBills({ cursor: first.next! }))).toBeLessThan(50)
  })
})

describe('history IPC validation', () => {
  it('accepts valid input and rejects unknown keys, bad dates, oversized limits and non-objects', async () => {
    const { svc } = mk(sample)
    const h = historyHandlers(svc)
    const ok = (await h['history:listBills']!({ date: '2026-10-06' })) as { ok: boolean; data: { items: unknown[] } }
    expect(ok.ok).toBe(true)
    expect(ok.data.items).toHaveLength(2)
    expect(((await h['history:listDates']!({})) as { ok: boolean }).ok).toBe(true)
    expect(((await h['history:branches']!({})) as { ok: boolean }).ok).toBe(true)
    for (const bad of [{ date: '06-10-26' }, { limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { extra: 1 }, { cursor: '' }, 'x', null]) {
      expect(((await h['history:listBills']!(bad)) as { ok: boolean }).ok).toBe(false)
    }
    expect(((await h['history:listDates']!({ branch: '' })) as { ok: boolean }).ok).toBe(false)
    expect(((await h['history:listDates']!({ nope: 1 })) as { ok: boolean }).ok).toBe(false)
    const badCursor = (await h['history:listBills']!({ cursor: '%%%' })) as { ok: boolean; error: { code: string } }
    expect(badCursor.ok).toBe(false)
    expect(badCursor.error.code).toBe('VALIDATION')
  })
})

describe('historyService - date range (Phase 42)', () => {
  it('From/To limit dates, bills and search (inclusive); From after To is VALIDATION', () => {
    const { svc } = mk(sample)
    expect(svc.listDates({ from: '2026-10-05', to: '2026-10-05' })).toEqual([{ date: '2026-10-05', count: 1 }])
    expect(svc.listDates({ from: '2026-10-05' }).map((d) => d.date)).toEqual(['2026-10-06', '2026-10-05'])
    expect(svc.listBills({ to: '2026-10-05' }).items.map((i) => i.id)).toEqual(['a', 'e'])
    expect(svc.search({ query: 'party', from: '2026-10-07' }).items).toEqual([])
    expect(() => svc.listDates({ from: '2026-10-06', to: '2026-10-05' })).toThrow(/From date/)
    expect(() => svc.listBills({ from: '2026-10-06', to: '2026-10-05' })).toThrow(/From date/)
    expect(() => svc.search({ query: 'x', from: '2026-10-06', to: '2026-10-05' })).toThrow(/From date/)
  })
})

describe('historyService.search (Phase 42)', () => {
  function withItems() {
    const m = mk(sample)
    const ins = m.t.handle.sqlite.prepare(
      `INSERT INTO bill_rows (id, bill_id, idx, name_runs_json, name_plain, qty, rate, extras_json) VALUES (@id, @bill, @idx, '[]', @name, '1', '1', '{}')`
    )
    ins.run({ id: 'r1', bill: 'a', idx: 0, name: 'Denim jeans' })
    ins.run({ id: 'r2', bill: 'a', idx: 1, name: 'Cotton shirt' })
    ins.run({ id: 'r3', bill: 'c', idx: 0, name: 'Silk saree' })
    ins.run({ id: 'r4', bill: 'd', idx: 0, name: 'Denim in the trash' })
    return m
  }

  it('finds by item text (name_plain across all rows), party, PO number and amount; the trash never matches', () => {
    const { svc } = withItems()
    expect(svc.search({ query: 'denim' }).items.map((i) => i.id)).toEqual(['a'])
    expect(svc.search({ query: 'shirt' }).items.map((i) => i.id)).toEqual(['a'])
    expect(svc.search({ query: 'smart' }).items.map((i) => i.id)).toEqual(['c'])
    expect(svc.search({ query: 'Q3-0002' }).items.map((i) => i.id)).toEqual(['b'])
    expect(svc.search({ query: '9350' }).items.map((i) => i.id)).toEqual(['a'])
    expect(svc.search({ query: 'gone' }).items).toEqual([])
  })

  it('ranks (PO exact before a party word), keeps the matched fields, strips the item text', () => {
    const { svc } = withItems()
    const r = svc.search({ query: 'silk smart' })
    expect(r.items.map((i) => i.id)).toEqual(['c'])
    expect(r.items[0]!.matchedOn.sort()).toEqual(['item', 'party'])
    expect('itemText' in r.items[0]!).toBe(false)
    expect(r.truncated).toBe(false)
  })

  it('blank query -> nothing; branch filter applies; fuzzy party typo', () => {
    const { svc } = withItems()
    expect(svc.search({ query: '  ' }).items).toEqual([])
    expect(svc.search({ query: 'smart', branch: 'nope' }).items).toEqual([])
    expect(svc.search({ query: 'zakerz' }).items.map((i) => i.id)).toEqual(['a'])
  })

  it('IPC: strict schema (unknown keys, bad dates, oversize query, bad limit) is rejected; a good call returns ok', async () => {
    const { svc } = withItems()
    const h = historyHandlers(svc)['history:search']!
    expect(await h({ query: 'denim' })).toMatchObject({ ok: true, data: { items: [expect.objectContaining({ id: 'a' })], truncated: false } })
    for (const bad of [{ query: 'x', extra: 1 }, { query: 'x', from: '10-05-2026' }, { query: 'x'.repeat(201) }, { query: 'x', limit: 0 }, { query: 'x', limit: 1001 }, {}, 'x']) {
      expect(await h(bad)).toMatchObject({ ok: false })
    }
  })

  it('performance: a 500-bill DB searches in < 150 ms', () => {
    const seeds: Seed[] = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, date: `2026-0${1 + (i % 9)}-10`, at: `2026-01-01T10:00:${String(i % 60).padStart(2, '0')}.000Z`, party: `Party ${i % 40} Traders`, total: String(100 + i) }))
    const { svc } = mk(seeds)
    const t0 = performance.now()
    const r = svc.search({ query: 'party 7 traders' })
    expect(performance.now() - t0).toBeLessThan(150)
    expect(r.items.length).toBeGreaterThan(0)
  })
})
