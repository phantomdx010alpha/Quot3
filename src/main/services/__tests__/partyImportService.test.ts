import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createPartyRepo } from '../../db/partyRepo'
import { createPartyImportRepo } from '../../db/partyImportRepo'
import { createExcelSheetReader } from '../../import/excelSheetReader'
import { createPartyImportService } from '../partyImportService'
import { createCustomerService } from '../customerService'
import { createCustomerRepo } from '../../db/customerRepo'
import { partyImportHandlers } from '../../ipc/partyImport'

const open: TestDb[] = []
const dirs: string[] = []
afterEach(() => { open.splice(0).forEach((t) => t.cleanup()); dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })) })

let n = 0
function mk(opts: { writable?: boolean } = {}) {
  const t = openTestDb()
  open.push(t)
  const sqlite = t.handle.sqlite
  const parties = createPartyRepo(sqlite)
  const svc = createPartyImportService({ parties, imports: createPartyImportRepo(sqlite), reader: createExcelSheetReader() }, { ...opts, newId: () => `id-${++n}` })
  const customers = createCustomerService({ parties, customers: createCustomerRepo(sqlite) }, { newId: () => `c-${++n}` })
  return { t, sqlite, parties, svc, customers }
}
const tmp = (): string => { const d = mkdtempSync(join(tmpdir(), 'quot3-imp-')); dirs.push(d); return d }

async function xlsx(sheets: Record<string, (string | number | null)[][]>): Promise<string> {
  const wb = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) { const ws = wb.addWorksheet(name); rows.forEach((r) => ws.addRow(r)) }
  const file = join(tmp(), 'parties.xlsx')
  await wb.xlsx.writeFile(file)
  return file
}
const live = (sqlite: TestDb['handle']['sqlite']) => sqlite.prepare("SELECT name, phone, address, transport, source, import_id AS importId FROM parties WHERE deleted_at IS NULL ORDER BY name_norm").all() as { name: string; phone: string | null; address: string | null; transport: string | null; source: string; importId: string | null }[]

describe('partyImportService - preview', () => {
  it('reads an xlsx, finds the header row under a title, auto-maps odd spellings, numeric phones as text, blank rows ignored', async () => {
    const { svc } = mk()
    const file = await xlsx({ Parties: [['Sharma Traders list'], [], ['Sl', 'CUSTOMER NAME', 'Mobile No.', 'Full Address', 'Transporter'], [1, 'Ruby Traders', 9845011001, '1 Main Rd', 'VRL'], [null, null, null, null, null], [2, 'Zed & Co', null, null, null]] })
    const p = await svc.preview({ filePath: file })
    expect(p.headerRow).toBe(3)
    expect(p.mapping).toEqual({ name: 1, phone: 2, address: 3, transport: 4 })
    expect(p.totalRows).toBe(3)
    expect(p.summary).toMatchObject({ new: 2, blank: 1 })
    expect(p.rows[0]).toMatchObject({ name: 'Ruby Traders', phone: '9845011001', row: 4 })
    expect(p.rows.some((r) => r.status === 'blank')).toBe(false)
  })
  it('caps the sample at 20 rows and honours a chosen sheet', async () => {
    const { svc } = mk()
    const many = [['Name'], ...Array.from({ length: 45 }, (_, i) => [`Party ${i}`])]
    const file = await xlsx({ First: [['x']], Second: many })
    const p = await svc.preview({ filePath: file, sheet: 'Second' })
    expect(p.sheets).toEqual(['First', 'Second']); expect(p.sheet).toBe('Second')
    expect(p.totalRows).toBe(45); expect(p.sample).toHaveLength(20); expect(p.rows).toHaveLength(20); expect(p.summary.new).toBe(45)
  })
  it('reads a csv; refuses .xls, other types, missing files and bad mappings with clear messages', async () => {
    const { svc } = mk()
    const csv = join(tmp(), 'p.csv'); writeFileSync(csv, 'Party,Phone\nA One,98450 11001\nB Two,\n')
    const p = await svc.preview({ filePath: csv })
    expect(p.mapping).toMatchObject({ name: 0, phone: 1 }); expect(p.summary.new).toBe(2)
    await expect(svc.preview({ filePath: join(tmp(), 'old.xls') })).rejects.toThrow(/\.xls/)
    await expect(svc.preview({ filePath: join(tmp(), 'a.txt') })).rejects.toThrow(/Excel/)
    await expect(svc.preview({ filePath: join(tmp(), 'missing.xlsx') })).rejects.toThrow(/could not be opened/)
    const bad = join(tmp(), 'bad.xlsx'); writeFileSync(bad, 'not a zip')
    await expect(svc.preview({ filePath: bad })).rejects.toThrow(/could not be read/)
    await expect(svc.preview({ filePath: csv, mapping: { name: null, phone: 1, address: null, transport: null } })).rejects.toThrow(/party name/)
    await expect(svc.preview({ filePath: csv, mapping: { name: 0, phone: 0, address: null, transport: null } })).rejects.toThrow(/one field/)
    await expect(svc.preview({ filePath: csv, mapping: { name: 9, phone: null, address: null, transport: null } })).rejects.toThrow(/does not exist/)
  })
})

describe('partyImportService - commit and undo', () => {
  const sheet = [['Name', 'Phone', 'Address', 'Transport'], ['Ruby Traders', '98450 11001', '1 Main Rd', 'VRL'], ['New One', '99999 88888', null, null], ['ruby  traders', null, null, null], [null, '12345 67890', null, null], ['Existing Co', '70000 00000', '9 New St', null]]

  it('imports new parties tagged source=import + import id, skips duplicates / repeats, reports problems; one audit row', async () => {
    const { svc, sqlite, customers } = mk()
    customers.create({ name: 'Existing Co', phone: '60000 00000', address: '1 Old Rd' })
    const file = await xlsx({ S: sheet })
    const pv = await svc.preview({ filePath: file })
    const r = await svc.commit({ filePath: file, mapping: pv.mapping, mode: 'skip' })
    expect(r).toMatchObject({ created: 2, updated: 0, skipped: 2, invalid: 1 })
    const rows = live(sqlite)
    expect(rows.map((x) => x.name)).toEqual(['Existing Co', 'New One', 'Ruby Traders'])
    expect(rows.find((x) => x.name === 'Existing Co')).toMatchObject({ phone: '60000 00000', source: 'manual', importId: null })
    expect(rows.find((x) => x.name === 'Ruby Traders')).toMatchObject({ source: 'import', importId: r.importId, phone: '98450 11001' })
    expect(sqlite.prepare("SELECT count(*) AS c FROM audit_log WHERE entity = 'party_import'").get()).toEqual({ c: 1 })
    expect(svc.list()[0]).toMatchObject({ id: r.importId, created: 2, skipped: 2, invalid: 1, undone: false, fileName: 'parties.xlsx' })
  })

  it('importing the same file twice adds nothing the second time', async () => {
    const { svc, sqlite } = mk()
    const file = await xlsx({ S: sheet })
    const map = (await svc.preview({ filePath: file })).mapping
    await svc.commit({ filePath: file, mapping: map, mode: 'skip' })
    const again = await svc.commit({ filePath: file, mapping: map, mode: 'skip' })
    expect(again.created).toBe(0)
    expect(live(sqlite)).toHaveLength(3)
  })

  it('update mode fills changed fields only (blank never clears) and undo puts the old values back', async () => {
    const { svc, sqlite, customers } = mk()
    customers.create({ name: 'Existing Co', phone: '60000 00000', address: '1 Old Rd', transport: 'SRS' })
    const file = await xlsx({ S: sheet })
    const map = (await svc.preview({ filePath: file })).mapping
    const r = await svc.commit({ filePath: file, mapping: map, mode: 'update' })
    expect(r).toMatchObject({ created: 2, updated: 1 })
    expect(live(sqlite).find((x) => x.name === 'Existing Co')).toMatchObject({ phone: '70000 00000', address: '9 New St', transport: 'SRS' })
    const u = svc.undo(r.importId)
    expect(u).toEqual({ removed: 2, restored: 1, kept: 0 })
    const after = live(sqlite)
    expect(after.map((x) => x.name)).toEqual(['Existing Co'])
    expect(after[0]).toMatchObject({ phone: '60000 00000', address: '1 Old Rd', transport: 'SRS' })
    expect(svc.list()[0]!.undone).toBe(true)
    expect(() => svc.undo(r.importId)).toThrow(/already undone/)
    // the names are free again
    expect(() => customers.create({ name: 'New One' })).not.toThrow()
  })

  it('undo keeps parties the owner edited after the import', async () => {
    const { svc, sqlite, customers, parties } = mk()
    const file = await xlsx({ S: sheet })
    const map = (await svc.preview({ filePath: file })).mapping
    const r = await svc.commit({ filePath: file, mapping: map, mode: 'skip' })
    const id = parties.findByNorm('new one')!.id
    customers.update(id, { name: 'New One', phone: 'edited' })
    // make the edit time differ from the batch time deterministically
    sqlite.prepare("UPDATE parties SET updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(id)
    expect(svc.undo(r.importId)).toEqual({ removed: 2, restored: 0, kept: 1 })
    expect(live(sqlite).map((x) => x.name)).toEqual(['New One'])
  })

  it('refuses on a read-only database and validates the mapping before writing', async () => {
    const ro = mk({ writable: false })
    const file = await xlsx({ S: sheet })
    await expect(ro.svc.commit({ filePath: file, mapping: { name: 0, phone: null, address: null, transport: null }, mode: 'skip' })).rejects.toThrow(/read-only/)
    const { svc, sqlite } = mk()
    await expect(svc.commit({ filePath: file, mapping: { name: null, phone: null, address: null, transport: null }, mode: 'skip' })).rejects.toThrow(/party name/)
    expect(live(sqlite)).toHaveLength(0)
  })

  it('a bigger sheet (3000 rows) imports in one go quickly', async () => {
    const { svc, sqlite } = mk()
    const file = await xlsx({ S: [['Party', 'Phone'], ...Array.from({ length: 3000 }, (_, i) => [`Party ${i}`, 9000000000 + i])] })
    const t0 = Date.now()
    const r = await svc.commit({ filePath: file, mapping: { name: 0, phone: 1, address: null, transport: null }, mode: 'skip' })
    expect(r.created).toBe(3000); expect(live(sqlite)).toHaveLength(3000)
    expect(Date.now() - t0).toBeLessThan(8000)
  })
})

describe('partyImport IPC', () => {
  it('strict validation and the picker', async () => {
    const { svc } = mk()
    const h = partyImportHandlers(svc, { pick: async () => '/x/a.xlsx' })
    expect(await h['partyImport:pickFile']!({})).toEqual({ ok: true, data: { filePath: '/x/a.xlsx' } })
    const cancelled = partyImportHandlers(svc, { pick: async () => null })
    expect(await cancelled['partyImport:pickFile']!({})).toEqual({ ok: true, data: null })
    for (const [ch, bad] of [
      ['partyImport:pickFile', { x: 1 }], ['partyImport:preview', {}], ['partyImport:preview', { filePath: 'a', extra: 1 }],
      ['partyImport:commit', { filePath: 'a', mapping: { name: 0, phone: null, address: null, transport: null }, mode: 'merge' }],
      ['partyImport:commit', { filePath: 'a', mapping: { name: -1, phone: null, address: null, transport: null }, mode: 'skip' }],
      ['partyImport:undo', { importId: '' }], ['partyImport:list', { a: 1 }]
    ] as const) {
      const res = (await h[ch]!(bad)) as { ok: boolean; error?: { code: string } }
      expect(res.ok).toBe(false); expect(res.error?.code).toBe('VALIDATION')
    }
    const missing = (await h['partyImport:undo']!({ importId: 'nope' })) as { ok: boolean; error?: { code: string } }
    expect(missing.error?.code).toBe('NOT_FOUND')
  })
})
