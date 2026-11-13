import { afterEach, describe, expect, it } from 'vitest'
import { createSim, SIM_BASE, type Sim, type SimBranchV2 } from './sharedSim'
import { decodeRecord, encodeRecord, RECORD_KINDS, READER_VER } from '../../../shared/sync/codecV2'
import { PRICE_KINDS, priceIncomingWins, type PriceRec } from '../../../shared/sync/priceListRecords'
import { encodeLocalRecord } from '../billRecordV2'
import { fromPlain } from '../../../shared/richtext/runs'
import { rowPlain } from '../../../shared/pricelist/rows'

// Phase 241 (M23): the four Price List kinds over the in-memory shared server (no real Supabase). Invented names only.
const open: Sim[] = []
afterEach(() => { open.splice(0).forEach((s) => s.close()) })
const mk = async (o: Parameters<typeof createSim>[0] = {}): Promise<Sim> => { const s = await createSim(o); open.push(s); return s }
const item = (name: string, cells: Record<string, string> = {}) => ({ kind: 'item' as const, nameRuns: fromPlain(name), cells })

/** Everything a person sees: live categories / tabs / rows by NAME (ids and timestamps are not compared). */
function view(b: SimBranchV2): string {
  const t = b.price.tree()
  return JSON.stringify(t.categories.map((c) => ({
    c: c.name,
    tabs: t.tabs.filter((x) => x.categoryId === c.id).map((x) => ({ t: x.name, cols: x.columns.map((k) => k.label), rows: b.price.rows(x.id).map((r) => ({ n: rowPlain(r), cells: r.cells })) }))
  })))
}
const firstTab = (b: SimBranchV2, cat: string) => { const t = b.price.tree(); const c = t.categories.find((x) => x.name === cat)!; return t.tabs.find((x) => x.categoryId === c.id)! }

describe('Phase 241 - codec', () => {
  it('knows the four price kinds and an old reader sets them aside as an unknown kind', () => {
    for (const k of PRICE_KINDS) expect(RECORD_KINDS).toContain(k)
    const raw = { kind: 'price_row', recId: 'x', version: 1, payload: {}, schemaVer: 1, minReaderVer: 1 }
    // a reader that does not list the kind (older app) = the generic unknown-kind path; simulated with a kind this build does not know
    const r = decodeRecord({ ...raw, kind: 'price_future' })
    expect(r).toMatchObject({ outcome: 'aside', reason: 'unknown_kind' })
    expect(READER_VER).toBe(1)
  })

  it('a row survives encode -> decode, unknown fields are kept, and the hash ignores who / when', () => {
    const rec = { id: 'r1', tabId: 't1', idx: 0, kind: 'item', nameRuns: [{ text: 'Brass tap' }], cells: { cash_wo: '110' }, createdAt: 'a', updatedAt: '2026-11-12T10:00:00.000Z', deletedAt: null, branchId: 'b1', updatedBySeat: 2 }
    const e = encodeRecord({ kind: 'price_row', recId: 'r1', data: { row: rec }, deleted: false, editedAt: rec.updatedAt, appVer: '1', unknownJson: JSON.stringify({ future: 1 }) })
    const d = decodeRecord({ kind: 'price_row', recId: 'r1', version: 1, payload: e.payload, schemaVer: 1, minReaderVer: e.minReaderVer, editedAt: e.editedAt })
    expect(d.outcome).toBe('apply')
    if (d.outcome !== 'apply') return
    expect(d.record.unknownJson).toContain('future')
    const e2 = encodeRecord({ kind: 'price_row', recId: 'r1', data: { row: { ...rec, updatedAt: '2027-01-01T00:00:00.000Z', branchId: 'b2', updatedBySeat: 3 } }, deleted: false, editedAt: 'x', appVer: '1', unknownJson: JSON.stringify({ future: 1 }) })
    expect(e2.payloadHash).toBe(e.payloadHash)
    const e3 = encodeRecord({ kind: 'price_row', recId: 'r1', data: { row: { ...rec, cells: { cash_wo: '111' } } }, deleted: false, editedAt: 'x', appVer: '1', unknownJson: JSON.stringify({ future: 1 }) })
    expect(e3.payloadHash).not.toBe(e.payloadHash)
  })

  it('a hostile record is refused by the schema (bad kind of row, oversized cell)', () => {
    const base = { id: 'r1', tabId: 't1', idx: 0, nameRuns: [], cells: {}, createdAt: 'a', updatedAt: 'b', deletedAt: null, branchId: 'x' }
    expect(() => encodeRecord({ kind: 'price_row', recId: 'r1', data: { row: { ...base, kind: 'script' } }, deleted: false, editedAt: 'x', appVer: '1' })).toThrow()
    expect(() => encodeRecord({ kind: 'price_row', recId: 'r1', data: { row: { ...base, kind: 'item', cells: { a: 'x'.repeat(1001) } } }, deleted: false, editedAt: 'x', appVer: '1' })).toThrow()
  })

  it('newer updatedAt wins, then the greater branch id; equal is not a win', () => {
    expect(priceIncomingWins({ updatedAt: '2026-01-01T00:00:00.000Z', branchId: 'a' }, { updatedAt: '2026-01-02T00:00:00.000Z', branchId: 'a' })).toBe(true)
    expect(priceIncomingWins({ updatedAt: '2026-01-02T00:00:00.000Z', branchId: 'a' }, { updatedAt: '2026-01-01T00:00:00.000Z', branchId: 'z' })).toBe(false)
    expect(priceIncomingWins({ updatedAt: '2026-01-01T00:00:00.000Z', branchId: 'a' }, { updatedAt: '2026-01-01T00:00:00.000Z', branchId: 'b' })).toBe(true)
    expect(priceIncomingWins({ updatedAt: '2026-01-01T00:00:00.000Z', branchId: 'a' }, { updatedAt: '2026-01-01T00:00:00.000Z', branchId: 'a' })).toBe(false)
  })
})

describe('Phase 241 - repo hook and read', () => {
  it('every local change reaches the outbox (a cascade delete sends the tab AND each of its rows), and a remote apply sends nothing', async () => {
    const s = await mk()
    const [a, b] = s.bs as [SimBranchV2, SimBranchV2]
    const c = a.price.structure({ op: 'addCategory', name: 'Taps' }).id!
    const tb = a.price.structure({ op: 'addTab', categoryId: c, name: 'Brass' }).id!
    a.price.saveRows({ tabId: tb, rows: [item('Tap A', { cash_wo: '10' }), item('Tap B')] })
    const before = a.pendingCount()
    expect(before).toBeGreaterThanOrEqual(4 + 1 + 2) // 4 seed tiers + category + tab + 2 rows (coalesced per id)
    await a.push.runOnce(); expect(a.pendingCount()).toBe(0)
    a.price.structure({ op: 'deleteTab', id: tb })
    expect(a.pendingCount()).toBe(3) // the tab + its 2 rows (tombstones)
    await a.push.runOnce()
    await b.pull.runOnce()
    expect(b.pendingCount()).toBe(0) // what B received never goes back out
  })

  it('getSyncRecord finds any kind by id, in any state, and nothing for a purged id', async () => {
    const s = await mk()
    const a = s.bs[0] as SimBranchV2
    const c = a.price.structure({ op: 'addCategory', name: 'Pipes' }).id!
    expect(a.priceRepo.getSyncRecord(c)?.kind).toBe('price_category')
    a.price.structure({ op: 'deleteCategory', id: c })
    const rec = a.priceRepo.getSyncRecord(c) as Extract<PriceRec, { kind: 'price_category' }>
    expect(rec.rec.deletedAt).not.toBeNull()
    a.price.purge({ kind: 'category', id: c })
    expect(a.priceRepo.getSyncRecord(c)).toBeUndefined()
    expect(encodeLocalRecord({ bills: { getRecord: () => undefined, getRows: () => [] }, priceList: a.priceRepo }, c, { offsetMs: null, appVer: '1' })).toBeNull()
  })
})

describe('Phase 241 - two virtual PCs converge', () => {
  it('categories, tabs, columns and rows made on A appear on B; edits and deletes follow', async () => {
    const s = await mk()
    const [a, b] = s.bs as [SimBranchV2, SimBranchV2]
    const c = a.price.structure({ op: 'addCategory', name: 'Taps' }).id!
    const tb = a.price.structure({ op: 'addTab', categoryId: c, name: 'Brass' }).id!
    a.price.columns({ tabId: tb, action: 'add', label: 'Pack' })
    a.price.saveRows({ tabId: tb, rows: [item('Tap A', { cash_wo: '10' }), item('Tap B', { cash_wo: '20' })] })
    await s.settle()
    expect(view(b)).toBe(view(a))
    expect(b.price.rows(firstTab(b, 'Taps').id)).toHaveLength(2)
    s.tick(5000)
    const rowA = a.price.rows(tb)[0]!
    a.price.saveRows({ tabId: tb, rows: [{ id: rowA.id, kind: 'item', nameRuns: rowA.nameRuns, cells: { cash_wo: '12' } }], deleteIds: [a.price.rows(tb)[1]!.id] })
    await s.settle()
    expect(view(b)).toBe(view(a))
    expect(b.price.rows(firstTab(b, 'Taps').id).map((r) => r.cells.cash_wo)).toEqual(['12'])
  })

  it('both PCs seed the same four tiers with different ids and still end with four tiers', async () => {
    const s = await mk()
    const [a, b] = s.bs as [SimBranchV2, SimBranchV2]
    a.price.tree(); b.price.tree() // first use seeds on each PC
    await s.settle()
    expect(a.price.tree().tiers.map((t) => t.key)).toEqual(['cash_wo', 'wholesale_wo', 'cash_gst', 'credit_gst'])
    expect(b.price.tree().tiers.map((t) => t.key)).toEqual(['cash_wo', 'wholesale_wo', 'cash_gst', 'credit_gst'])
    expect(a.price.tree().tiers.map((t) => t.id)).toEqual(b.price.tree().tiers.map((t) => t.id)) // the smaller id kept each key on both
  })

  it('the later edit of the same price wins on both; the older one is not lost on the server', async () => {
    const s = await mk()
    const [a, b] = s.bs as [SimBranchV2, SimBranchV2]
    const c = a.price.structure({ op: 'addCategory', name: 'Taps' }).id!
    const tb = a.price.structure({ op: 'addTab', categoryId: c, name: 'Brass' }).id!
    a.price.saveRows({ tabId: tb, rows: [item('Tap A', { cash_wo: '10' })] })
    await s.settle()
    const rowId = a.price.rows(tb)[0]!.id
    const bt = firstTab(b, 'Taps').id
    s.tick(1000); a.price.saveRows({ tabId: tb, rows: [{ id: rowId, kind: 'item', nameRuns: fromPlain('Tap A'), cells: { cash_wo: '11' } }] })
    s.tick(1000); b.price.saveRows({ tabId: bt, rows: [{ id: rowId, kind: 'item', nameRuns: fromPlain('Tap A'), cells: { cash_wo: '12' } }] })
    await s.settle()
    expect(a.price.rows(tb)[0]!.cells.cash_wo).toBe('12')
    expect(b.price.rows(bt)[0]!.cells.cash_wo).toBe('12')
    expect(s.server.historyOf(s.orgId, 'price_row', rowId).length).toBeGreaterThan(0)
  })

  it('a category deleted on A (with its tabs and rows) is deleted on B, and a restore brings it all back', async () => {
    const s = await mk()
    const [a, b] = s.bs as [SimBranchV2, SimBranchV2]
    const c = a.price.structure({ op: 'addCategory', name: 'Taps' }).id!
    const tb = a.price.structure({ op: 'addTab', categoryId: c, name: 'Brass' }).id!
    a.price.saveRows({ tabId: tb, rows: [item('Tap A', { cash_wo: '10' })] })
    await s.settle()
    s.tick(1000); a.price.structure({ op: 'deleteCategory', id: c })
    await s.settle()
    expect(b.price.tree().categories).toHaveLength(0)
    expect(b.price.trash().some((t) => t.kind === 'category')).toBe(true)
    s.tick(1000); a.price.restore({ kind: 'category', id: c })
    await s.settle()
    expect(view(b)).toBe(view(a))
    expect(b.price.tree().categories).toHaveLength(1)
  })

  it('two PCs that each made a category with the same name keep both, the incoming one gets "(2)", and nothing throws', async () => {
    const s = await mk()
    const [a, b] = s.bs as [SimBranchV2, SimBranchV2]
    a.price.structure({ op: 'addCategory', name: 'Taps' })
    s.tick(1000); b.price.structure({ op: 'addCategory', name: 'Taps' })
    await s.settle()
    expect(a.price.tree().categories.map((x) => x.name).sort()).toEqual(['Taps', 'Taps (2)'])
    expect(b.price.tree().categories.map((x) => x.name).sort()).toEqual(['Taps', 'Taps (2)'])
  })

  it('a PC that joins later gets the whole list from the first-sync compare (existing data uploads, nothing is lost)', async () => {
    const s = await mk()
    const [a, b] = s.bs as [SimBranchV2, SimBranchV2]
    const c = a.price.structure({ op: 'addCategory', name: 'Taps' }).id!
    const tb = a.price.structure({ op: 'addTab', categoryId: c, name: 'Brass' }).id!
    a.price.saveRows({ tabId: tb, rows: [item('Tap A', { cash_wo: '10' })] })
    // drop the captured outbox rows as if the list existed before sync was switched on, then let the compare find it
    a.sqlite.prepare('DELETE FROM sync_outbox').run()
    await a.compare.run()
    expect(a.pendingCount()).toBeGreaterThan(0)
    await s.settle()
    expect(view(b)).toBe(view(a))
    void SIM_BASE
  })
})
