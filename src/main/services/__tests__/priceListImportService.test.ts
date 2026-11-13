import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createPriceListRepo } from '../../db/priceListRepo'
import { createPriceLogRepo } from '../../db/priceLogRepo'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { getLocalBranch } from '../../db/seed'
import { readLegacyInventory } from '../../db/legacyInventoryReader'
import { priceListHandlers } from '../../ipc/pricelist'
import { createPriceListImportService } from '../priceListImportService'
import { createPriceListService } from '../priceListService'
import { fromPlain } from '../../../shared/richtext/runs'

// Phase 237 (M23): the legacy inventory import against a SYNTHETIC old-style file (invented names). The real bills_data.db is never used here.
let t: TestDb | undefined
let dir = ''
afterEach(() => { t?.cleanup(); t = undefined; if (dir) rmSync(dir, { recursive: true, force: true }); dir = '' })

function fixture(extra: (db: Database.Database) => void = () => {}): string {
  dir = dir || mkdtempSync(join(tmpdir(), 'quot3-legacy-'))
  const file = join(dir, `legacy-${Math.random().toString(36).slice(2)}.db`)
  const db = new Database(file)
  db.exec(`
    CREATE TABLE bills (id INTEGER PRIMARY KEY, customer TEXT);
    INSERT INTO bills VALUES (1, 'SECRET CUSTOMER ZZZ');
    CREATE TABLE inv_last_state (id INTEGER PRIMARY KEY, blob TEXT);
    CREATE TABLE inv_categories (id INTEGER PRIMARY KEY, name TEXT UNIQUE, icon TEXT, position INTEGER);
    CREATE TABLE inv_tabs (id INTEGER PRIMARY KEY, category_id INTEGER, name TEXT, position INTEGER, UNIQUE(category_id, name));
    CREATE TABLE inv_items (id INTEGER PRIMARY KEY, tab_id INTEGER, row_index INTEGER, sl_no INTEGER, item_name TEXT, rate TEXT, rate_without_gst TEXT, unit_qty TEXT, qty TEXT, qty_with_gst TEXT);
    INSERT INTO inv_categories VALUES (1, 'Fruit', 'x', 0), (2, 'Spices', 'y', 0);
    INSERT INTO inv_tabs VALUES (11, 1, 'Apples', 1), (12, 1, 'Pears', 2), (21, 2, 'Whole', 1);
    INSERT INTO inv_items VALUES
      (1, 11, 0, 1, '  Green Apple' || char(10) || 'Small ', '110', '109', '108', '110', ''),
      (2, 11, 1, 2, 'Red Apple', '', '', '', '', ''),
      (3, 12, 0, 1, 'Conference Pear', '55', '', '', '', ''),
      (4, 21, 0, 1, 'Black Pepper', '900', '880', '', '', '');
  `)
  extra(db)
  db.close()
  return file
}
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex')

function make(opts: { writable?: boolean } = {}) {
  t = openTestDb()
  const sqlite = t.handle.sqlite
  const repo = createPriceListRepo(sqlite)
  const logRepo = createPriceLogRepo(sqlite)
  const branchId = () => getLocalBranch(sqlite).id
  const svc = createPriceListService({ repo, logRepo, branchId })
  const calls: string[] = []
  let k = 0
  const imp = createPriceListImportService(
    { repo, logRepo, branchId, tiers: () => svc.tree().tiers, readLegacy: readLegacyInventory, backup: { create: async (kind) => { calls.push(`backup:${kind}:rows=${(sqlite.prepare('SELECT COUNT(*) AS c FROM price_rows').get() as { c: number }).c}`); return { file: 'pre-import-test.db' } as never } } },
    { newId: () => `i${++k}`, ...opts }
  )
  return { sqlite, repo, logRepo, svc, imp, calls }
}
const count = (db: Database.Database, table: string): number => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c

describe('legacy inventory reader', () => {
  it('reads only the inv_* tables, never changes the file, and never touches bills', () => {
    const f = fixture()
    const before = sha(f)
    const inv = readLegacyInventory(f)
    expect(inv.categories).toHaveLength(2)
    expect(inv.tabs).toHaveLength(3)
    expect(inv.items).toHaveLength(4)
    expect(JSON.stringify(inv)).not.toContain('SECRET')
    expect(sha(f)).toBe(before)
  })

  it('refuses a file that is not an old inventory, and a missing file', () => {
    const f = fixture((db) => db.exec('DROP TABLE inv_items'))
    expect(() => readLegacyInventory(f)).toThrow(/no old inventory tables/)
    expect(() => readLegacyInventory(join(dir, 'nope.db'))).toThrow(/could not be opened/)
  })

  it('an older file without unit_qty / position still reads', () => {
    const f = fixture((db) => db.exec('ALTER TABLE inv_items DROP COLUMN unit_qty; ALTER TABLE inv_tabs DROP COLUMN position'))
    expect(readLegacyInventory(f).items[0]!.unitQty).toBe('')
  })
})

describe('price list import service', () => {
  it('preview writes nothing', () => {
    const { imp, sqlite } = make()
    const f = fixture()
    const pv = imp.preview(f)
    expect(pv.items).toMatchObject({ total: 4, withPrice: 3, nameOnly: 1, added: 4 })
    expect(count(sqlite, 'price_rows')).toBe(0)
    expect(count(sqlite, 'price_categories')).toBe(0)
    expect(count(sqlite, 'price_import_map')).toBe(0)
    expect(count(sqlite, 'price_log')).toBe(0)
  })

  it('import: pre-import backup first, one transaction, one log entry, rows + map written, names cleaned', async () => {
    const { imp, sqlite, svc, calls } = make()
    const f = fixture()
    const r = await imp.commit(f)
    expect(calls).toEqual(['backup:pre-import:rows=0'])
    expect(r).toMatchObject({ added: 4, updated: 0, backupFile: 'pre-import-test.db' })
    const tree = svc.tree()
    expect(tree.categories.map((c) => c.name)).toEqual(['Fruit', 'Spices'])
    expect(tree.tabs.map((x) => x.name)).toEqual(['Apples', 'Pears', 'Whole'])
    const rows = svc.rows(tree.tabs[0]!.id)
    expect(rows.map((x) => x.nameRuns.map((y) => y.t).join(''))).toEqual(['Green Apple Small', 'Red Apple'])
    expect(rows[0]!.cells).toEqual({ c1: '110', c2: '109', c3: '108', c4: '110' })
    expect(count(sqlite, 'price_import_map')).toBe(4)
    const log = svc.log().rows
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ op: 'import', entity: 'list' })
    expect(JSON.stringify(log)).not.toContain('Green Apple') // the log carries counts only, never names
  })

  it('run again: nothing to do, no backup, no log entry, no duplicates', async () => {
    const { imp, sqlite, calls, svc } = make()
    const f = fixture()
    await imp.commit(f)
    const again = await imp.commit(f)
    expect(again).toMatchObject({ added: 0, updated: 0, backupFile: null })
    expect(calls).toHaveLength(1)
    expect(count(sqlite, 'price_rows')).toBe(4)
    expect(svc.log().rows).toHaveLength(1)
  })

  it('run again after a source change: updates untouched rows, keeps an edited row, does not resurrect a deleted one, never deletes', async () => {
    const { imp, svc, sqlite } = make()
    const f1 = fixture()
    await imp.commit(f1)
    const tree = svc.tree()
    const apples = tree.tabs[0]!.id
    const pears = tree.tabs[1]!.id
    // the owner edits the Pear price and deletes Red Apple here
    const pearRow = svc.rows(pears)[0]!
    svc.saveRows({ tabId: pears, rows: [{ id: pearRow.id, kind: 'item', nameRuns: pearRow.nameRuns, cells: { c1: '77' } }] })
    const red = svc.rows(apples).find((x) => x.nameRuns[0]!.t === 'Red Apple')!
    svc.saveRows({ tabId: apples, rows: [], deleteIds: [red.id] })
    // the source changed: Green Apple, Pear and Red Apple prices, plus one new item
    const f2 = fixture((db) => db.exec(`UPDATE inv_items SET rate = '120' WHERE id = 1; UPDATE inv_items SET rate = '60' WHERE id = 3; UPDATE inv_items SET rate = '9' WHERE id = 2; INSERT INTO inv_items VALUES (5, 11, 2, 3, 'Fuji Apple', '5', '', '', '', '');`))
    const pv = imp.preview(f2)
    expect(pv.items).toMatchObject({ added: 1, changed: 1, editedHere: 1, removedHere: 1 })
    const r = await imp.commit(f2)
    expect(r).toMatchObject({ added: 1, updated: 1 })
    expect(svc.rows(apples).map((x) => [x.nameRuns[0]!.t, x.cells.c1])).toEqual([['Green Apple Small', '120'], ['Fuji Apple', '5']])
    expect(svc.rows(pears)[0]!.cells.c1).toBe('77') // edited here: kept
    expect(count(sqlite, 'price_rows')).toBe(5) // 4 + Fuji; the deleted Red Apple stays in the trash, nothing removed
    expect(svc.log().rows).toHaveLength(4) // 2 edits above + 2 imports
  })

  it('goes into existing structure by name and leaves other rows and columns alone', async () => {
    const { imp, svc, sqlite } = make()
    const c = svc.structure({ op: 'addCategory', name: ' fruit ' }).id!
    const tb = svc.structure({ op: 'addTab', categoryId: c, name: 'APPLES' }).id!
    svc.saveRows({ tabId: tb, rows: [{ kind: 'item', nameRuns: fromPlain('My Own Apple'), cells: { c1: '1' } }] })
    await imp.commit(fixture())
    expect(svc.tree().categories.filter((x) => x.name.toLowerCase().trim() === 'fruit')).toHaveLength(1)
    expect(svc.rows(tb).map((x) => x.nameRuns[0]!.t)).toEqual(['My Own Apple', 'Green Apple Small', 'Red Apple'])
    expect(count(sqlite, 'price_categories')).toBe(2)
  })

  it('a failure after the backup rolls the whole import back (one transaction)', async () => {
    const { imp, sqlite } = make()
    sqlite.exec(`CREATE TRIGGER boom BEFORE INSERT ON price_import_map WHEN NEW.legacy_key LIKE '%black pepper%' BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    await expect(imp.commit(fixture())).rejects.toThrow()
    expect(count(sqlite, 'price_rows')).toBe(0)
    expect(count(sqlite, 'price_categories')).toBe(0)
    expect(count(sqlite, 'price_log')).toBe(0)
  })

  it('a read-only database refuses the import; a bad file writes nothing and takes no backup', async () => {
    const ro = make({ writable: false })
    await expect(ro.imp.commit(fixture())).rejects.toThrow(/read-only/)
    t?.cleanup(); t = undefined
    const { imp, calls, sqlite } = make()
    await expect(imp.commit(join(dir, 'missing.db'))).rejects.toThrow(/could not be opened/)
    expect(calls).toEqual([])
    expect(count(sqlite, 'price_log')).toBe(0)
  })
})

describe('pricelist import IPC', () => {
  it('the renderer only holds an opaque id; a cancelled dialog returns null; an unknown id is NOT_FOUND', async () => {
    const m = make()
    const f = fixture()
    let pick: string | null = f
    const h = priceListHandlers(m.svc, { service: m.imp, pickFile: async () => pick })
    type R = { ok: boolean; data?: any; error?: { code: string } } // eslint-disable-line @typescript-eslint/no-explicit-any
    const p = (await h['pricelist:importPick']!({})) as R
    expect(p.data.label).toMatch(/^legacy-.*\.db$/)
    expect(JSON.stringify(p)).not.toContain(dir)
    const pv = (await h['pricelist:importPreview']!({ sourceId: p.data.sourceId })) as R
    expect(pv.data.items.added).toBe(4)
    const run = (await h['pricelist:importRun']!({ sourceId: p.data.sourceId })) as R
    expect(run.data.added).toBe(4)
    expect(((await h['pricelist:importPreview']!({ sourceId: 'nope' })) as R).error?.code).toBe('NOT_FOUND')
    expect(((await h['pricelist:importRun']!({ sourceId: p.data.sourceId, extra: 1 })) as R).ok).toBe(false)
    pick = null
    expect(((await h['pricelist:importPick']!({})) as R).data).toBeNull()
  })
})
