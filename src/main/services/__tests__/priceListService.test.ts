import { afterEach, describe, expect, it } from 'vitest'
import { getLocalBranch } from '../../db/seed'
import { createPriceListRepo } from '../../db/priceListRepo'
import { createPriceLogRepo } from '../../db/priceLogRepo'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createPriceListService, type PriceListOpts } from '../priceListService'
import { fromPlain } from '../../../shared/richtext/runs'
import { applyPendingWipeData, writeWipeOptions } from '../../db/wipeApply'

// Phase 236 (M23): Price List storage + service. Invented names only; no private data.
let t: TestDb | undefined
afterEach(() => { t?.cleanup(); t = undefined })

let clock = Date.parse('2026-11-12T10:00:00.000Z')
function make(opts: PriceListOpts = {}) {
  t = openTestDb()
  const sqlite = t.handle.sqlite
  const repo = createPriceListRepo(sqlite)
  const logRepo = createPriceLogRepo(sqlite)
  let n = 0
  const svc = createPriceListService({ repo, logRepo, branchId: () => getLocalBranch(sqlite).id }, { now: () => new Date((clock += 1000)), newId: () => `id${++n}`, ...opts })
  return { svc, sqlite, repo, logRepo }
}
const item = (name: string, cells: Record<string, string> = {}) => ({ kind: 'item' as const, nameRuns: fromPlain(name), cells })
const catWithTab = (svc: ReturnType<typeof make>['svc'], cat = 'Fruit', tab = 'Apples') => {
  const c = svc.structure({ op: 'addCategory', name: cat }).id!
  const tb = svc.structure({ op: 'addTab', categoryId: c, name: tab }).id!
  return { c, tb }
}

describe('price list service', () => {
  it('seeds the four tiers once, and a removed tier never comes back', () => {
    const { svc } = make()
    const a = svc.tree()
    expect(a.tiers.map((x) => x.key)).toEqual(['cash_wo', 'wholesale_wo', 'cash_gst', 'credit_gst'])
    expect(svc.tree().tiers).toHaveLength(4)
    svc.structure({ op: 'removeTier', key: 'credit_gst' })
    expect(svc.tree().tiers.map((x) => x.key)).toEqual(['cash_wo', 'wholesale_wo', 'cash_gst'])
    const added = svc.structure({ op: 'addTier', label: 'Credit GST' })
    expect(added.tree.tiers.map((x) => x.key)).toContain('credit_gst_2') // the removed key is never reused
  })

  it('creates categories and tabs with the default columns, and refuses duplicate names (case / spaces)', () => {
    const { svc } = make()
    const { c, tb } = catWithTab(svc)
    const tab = svc.tree().tabs.find((x) => x.id === tb)!
    expect(tab.columns.map((x) => x.role)).toEqual(['name', 'price', 'price', 'price', 'price'])
    expect(() => svc.structure({ op: 'addCategory', name: '  fruit ' })).toThrow(/already used/)
    expect(() => svc.structure({ op: 'addTab', categoryId: c, name: 'APPLES' })).toThrow(/already used/)
    expect(() => svc.structure({ op: 'addTab', categoryId: c, name: '   ' })).toThrow(/empty/)
  })

  it('saves rows in one batch: canonical money, bad cells dropped, name_norm stored, edits logged with before / after', () => {
    const { svc, sqlite, logRepo } = make()
    const { tb } = catWithTab(svc)
    const cols = svc.tree().tabs[0]!.columns
    const k1 = cols[1]!.key, k2 = cols[2]!.key
    const r = svc.saveRows({ tabId: tb, rows: [item('Green Apple Small', { [k1]: '110.00', [k2]: 'abc' }), { kind: 'section', nameRuns: fromPlain('BIG'), cells: { [k1]: '5' } }] })
    expect(r.rows[0]!.cells).toEqual({ [k1]: '110' })
    expect(r.rows[1]!.cells).toEqual({}) // a section row carries no prices
    const stored = sqlite.prepare('SELECT name_plain AS p, name_norm AS n FROM price_rows WHERE id = ?').get(r.rows[0]!.id) as { p: string; n: string }
    expect(stored.p).toBe('Green Apple Small')
    expect(stored.n).not.toBe('')
    svc.saveRows({ tabId: tb, rows: [{ ...item('Green Apple Small', { [k1]: '120' }), id: r.rows[0]!.id }] })
    const edit = logRepo.list({ limit: 10 }).find((e) => e.op === 'edit')!
    expect(edit.changes).toEqual([{ column: cols[1]!.label, before: '110', after: '120' }])
    expect(edit.path).toContain('Fruit')
    expect(svc.rows(tb)).toHaveLength(2)
  })

  it('writes ONE log entry per batch, not one per row', () => {
    const { svc, logRepo } = make()
    const { tb } = catWithTab(svc)
    const before = logRepo.total()
    svc.saveRows({ tabId: tb, rows: [item('A'), item('B'), item('C')] })
    expect(logRepo.total() - before).toBe(1)
  })

  it('deleting a category sends its tabs and rows to the trash together; restore brings the same ones back', () => {
    const { svc } = make()
    const { c, tb } = catWithTab(svc)
    const other = svc.structure({ op: 'addTab', categoryId: c, name: 'Pears' }).id!
    svc.saveRows({ tabId: tb, rows: [item('A'), item('B')] })
    svc.saveRows({ tabId: other, rows: [item('P')] })
    svc.saveRows({ tabId: tb, rows: [], deleteIds: [svc.rows(tb)[0]!.id] }) // deleted EARLIER: must stay deleted after the category returns
    svc.structure({ op: 'deleteCategory', id: c })
    const trash = svc.trash()
    expect(trash.filter((x) => x.kind === 'category')).toHaveLength(1)
    expect(trash.filter((x) => x.kind !== 'category')).toHaveLength(0) // children are listed under the category
    expect(svc.tree().tabs).toHaveLength(0)
    svc.restore({ kind: 'category', id: c })
    expect(svc.tree().tabs.map((x) => x.name).sort()).toEqual(['Apples', 'Pears'])
    expect(svc.rows(tb)).toHaveLength(1)
    expect(svc.rows(other)).toHaveLength(1)
    expect(svc.trash().filter((x) => x.kind === 'row')).toHaveLength(1)
  })

  it('a restored name that is taken meanwhile gets " (2)"; a child cannot be restored under a deleted parent', () => {
    const { svc } = make()
    const { c, tb } = catWithTab(svc)
    svc.saveRows({ tabId: tb, rows: [item('A')] })
    const rowId = svc.rows(tb)[0]!.id
    svc.structure({ op: 'deleteTab', id: tb })
    svc.structure({ op: 'addTab', categoryId: c, name: 'Apples' })
    svc.restore({ kind: 'tab', id: tb })
    expect(svc.tree().tabs.map((x) => x.name).sort()).toEqual(['Apples', 'Apples (2)'])
    svc.saveRows({ tabId: tb, rows: [], deleteIds: [rowId] })
    svc.structure({ op: 'deleteTab', id: tb })
    expect(() => svc.restore({ kind: 'row', id: rowId })).toThrow(/Restore its tab first/)
    svc.structure({ op: 'deleteCategory', id: c })
    expect(() => svc.restore({ kind: 'tab', id: tb })).toThrow(/Restore its category first/)
  })

  it('duplicates a tab with its rows and keeps column keys; moves a tab to another category', () => {
    const { svc } = make()
    const { tb } = catWithTab(svc)
    svc.saveRows({ tabId: tb, rows: [item('A', { c1: '10' })] })
    const dup = svc.structure({ op: 'duplicateTab', id: tb })
    expect(dup.tree.tabs.map((x) => x.name)).toContain('Apples (2)')
    expect(svc.rows(dup.id!)[0]!.cells).toEqual({ c1: '10' })
    const c2 = svc.structure({ op: 'addCategory', name: 'Veg' }).id!
    const moved = svc.structure({ op: 'moveTab', id: dup.id!, categoryId: c2 })
    expect(moved.tree.tabs.find((x) => x.id === dup.id)!.categoryId).toBe(c2)
  })

  it('columns: add / rename / remove, the name column is protected, a removed key is not reused while rows still hold it', () => {
    const { svc } = make()
    const { tb } = catWithTab(svc)
    const add = svc.columns({ tabId: tb, action: 'add', label: 'Note', role: 'note' })
    expect(add.key).toBe('c5')
    svc.saveRows({ tabId: tb, rows: [item('A', { c5: 'fresh' })] })
    svc.columns({ tabId: tb, action: 'remove', key: 'c5' })
    expect(svc.columns({ tabId: tb, action: 'add', label: 'Other' }).key).toBe('c6')
    expect(() => svc.columns({ tabId: tb, action: 'remove', key: 'name' })).toThrow(/name column/)
    expect(svc.columns({ tabId: tb, action: 'rename', key: 'c1', label: 'Cash' }).columns[1]!.label).toBe('Cash')
  })

  it('"Clear Price List" needs the typed words, takes the backup first, empties everything but tiers, and logs it', async () => {
    let backups = 0
    const { svc, logRepo, sqlite } = make({ backupBefore: async () => { backups++ } })
    const { tb } = catWithTab(svc)
    svc.saveRows({ tabId: tb, rows: [item('A')] })
    await expect(svc.clearAll('clear')).rejects.toThrow(/CLEAR PRICE LIST/)
    expect(backups).toBe(0)
    const r = await svc.clearAll('  clear   price list ')
    expect(backups).toBe(1)
    expect(r).toEqual({ categories: 1, tabs: 1, rows: 1 })
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM price_rows').get()).toEqual({ n: 0 })
    expect(svc.tree().tiers).toHaveLength(4)
    expect(logRepo.list({ limit: 1 })[0]!.entity).toBe('list')
  })

  it('log pages newest first and trimLog removes entries older than the retention', () => {
    const { svc, logRepo } = make({ logRetentionDays: () => 30 })
    for (let i = 0; i < 5; i++) svc.structure({ op: 'addCategory', name: `C${i}` })
    const p1 = svc.log({ limit: 2 })
    expect(p1.rows).toHaveLength(2)
    expect(p1.next).toBe(p1.rows[1]!.id)
    expect(svc.log({ limit: 2, beforeId: p1.next }).rows[0]!.id).toBeLessThan(p1.rows[1]!.id)
    logRepo.insert({ at: '2020-01-01T00:00:00.000Z', seatNo: null, branchId: 'x', deviceKind: 'pc', entity: 'row', entityId: 'z', op: 'add', path: 'old', changes: null, count: 1 })
    expect(svc.trimLog()).toBe(1)
  })

  it('a read-only database refuses every write but still reads', () => {
    const { svc } = make({ writable: false })
    expect(svc.tree().tiers).toEqual([]) // no seeding on a read-only database
    expect(() => svc.structure({ op: 'addCategory', name: 'X' })).toThrow(/read-only/)
    expect(() => svc.saveRows({ tabId: 'a', rows: [] })).toThrow(/read-only/)
    expect(svc.trimLog()).toBe(0)
  })

  it('unknown tab / row ids are NOT_FOUND, never a crash', () => {
    const { svc } = make()
    expect(() => svc.rows('nope')).toThrow(/no longer exists/)
    const { tb } = catWithTab(svc)
    expect(() => svc.saveRows({ tabId: tb, rows: [{ ...item('A'), id: 'ghost' }] })).toThrow(/no longer exists/)
  })

  it('"Start fresh" Level 1 clears bills but leaves the Price List and its log alone', () => {
    const { svc, sqlite } = make()
    const { tb } = catWithTab(svc)
    svc.saveRows({ tabId: tb, rows: [item('A')] })
    writeWipeOptions(t!.dir, { level: 1, poStart: 1, removeBackups: false, removeThemes: false, removeLogs: false, removeAssets: false })
    const r = applyPendingWipeData(sqlite, t!.dir)
    expect(r.error).toBeNull()
    expect(r.applied?.level).toBe(1)
    expect(svc.rows(tb)).toHaveLength(1)
    expect(svc.tree().categories).toHaveLength(1)
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM price_log').get() as { n: number }).n).toBeGreaterThan(0)
  })
})
