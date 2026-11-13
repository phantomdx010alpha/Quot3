import { describe, expect, it } from 'vitest'
import { activityToCsv, deriveServerChange, type ActivityRow } from '../logEntry'
import type { PermRecord } from '../perms'

// Phase 243 (M23): the pure rules for the shared activity log. The SQL `qt_price_log_change` in supabase/sql/20_price_log.sql is the twin of these cases.
const row = (name: string, cells: Record<string, string> = {}, over: Partial<PermRecord> = {}): PermRecord => ({ kind: 'price_row', rowKind: 'item', idx: 0, name, cells, ...over })
const ctx = { categoryName: 'Panna', tabName: 'Small', colLabel: (k: string) => (k === 'cash_wo' ? 'Cash w/o' : k) }

describe('deriveServerChange - rows', () => {
  it('a new row is an add, with the whole path', () => {
    expect(deriveServerChange(null, row('Assam'), ctx)).toEqual({ entity: 'row', op: 'add', path: ['Panna', 'Small', 'Assam'], changes: [] })
  })
  it('back from the trash is a restore; a tombstone of a live row is a delete; a tombstone of nothing is nothing', () => {
    expect(deriveServerChange(row('A', {}, { deleted: true }), row('A'), ctx)?.op).toBe('restore')
    expect(deriveServerChange(row('A'), row('A', {}, { deleted: true }), ctx)?.op).toBe('delete')
    expect(deriveServerChange(null, row('A', {}, { deleted: true }), ctx)).toBeNull()
    expect(deriveServerChange(row('A', {}, { deleted: true }), row('A', {}, { deleted: true }), ctx)).toBeNull()
  })
  it('filling an empty cell is an edit, changing a value is an overwrite, with labelled old -> new values', () => {
    expect(deriveServerChange(row('A', { cash_wo: '' }), row('A', { cash_wo: '110' }), ctx)).toMatchObject({ op: 'edit', changes: [{ column: 'Cash w/o', before: '', after: '110' }] })
    expect(deriveServerChange(row('A', { cash_wo: '110' }), row('A', { cash_wo: '120' }), ctx)).toMatchObject({ op: 'overwrite', changes: [{ column: 'Cash w/o', before: '110', after: '120' }] })
    expect(deriveServerChange(row('A', { cash_wo: '110' }), row('A', {}), ctx)?.op).toBe('overwrite')
  })
  it('a rename is an edit named Name; a bare reorder or an identical resave logs nothing', () => {
    expect(deriveServerChange(row('A'), row('B'), ctx)).toMatchObject({ op: 'edit', changes: [{ column: 'Name', before: 'A', after: 'B' }] })
    expect(deriveServerChange(row('A', {}, { idx: 1 }), row('A', {}, { idx: 5 }), ctx)).toBeNull()
    expect(deriveServerChange(row('A', { x: '1' }), row('A', { x: '1' }), ctx)).toBeNull()
  })
  it('changes come out in a fixed (sorted) order', () => {
    const r = deriveServerChange(row('A', { b: '1', a: '1' }), row('A', { b: '2', a: '2' }), ctx)
    expect(r?.changes.map((c) => c.column)).toEqual(['a', 'b'])
  })
})

describe('deriveServerChange - tabs, categories, tiers', () => {
  const tab = (name: string, over: Partial<PermRecord> = {}): PermRecord => ({ kind: 'price_tab', name, position: 0, columnsKey: '[]', parentId: 'c1', ...over })
  it('a new tab is an add; a changed tab is structure; an unchanged one logs nothing', () => {
    expect(deriveServerChange(null, tab('Small'), { categoryName: 'Panna' })).toMatchObject({ entity: 'tab', op: 'add', path: ['Panna', 'Small'] })
    expect(deriveServerChange(tab('Small'), tab('Small', { columnsKey: '[1]' }), { categoryName: 'Panna' })?.op).toBe('structure')
    expect(deriveServerChange(tab('Small'), tab('Small'), { categoryName: 'Panna' })).toBeNull()
  })
  it('a new or renamed category / tier is structure with its own name as the path', () => {
    expect(deriveServerChange(null, { kind: 'price_category', name: 'Panna', position: 0 })).toMatchObject({ entity: 'category', op: 'structure', path: ['Panna'] })
    expect(deriveServerChange({ kind: 'price_tier', label: 'Cash', key: 'cash', position: 0 }, { kind: 'price_tier', label: 'Cash+GST', key: 'cash', position: 0 })).toMatchObject({ entity: 'tier', op: 'structure', path: ['Cash+GST'] })
  })
  it('a deleted record keeps its old name when the tombstone has none', () => {
    expect(deriveServerChange({ kind: 'price_category', name: 'Old', position: 0 }, { kind: 'price_category', deleted: true })).toMatchObject({ op: 'delete', path: ['Old'] })
  })
})

describe('activityToCsv', () => {
  const base = { at: '2026-11-13T10:00:00.000Z', seatNo: 2, branchId: 'b', deviceKind: 'pc' as const, entity: 'row' as const, entityId: 'r', op: 'overwrite' as const, path: 'Panna \u203A Small \u203A Assam', count: 1 }
  const rows: ActivityRow[] = [
    { ...base, id: 2, branchName: 'Branch A', changes: [{ column: 'Cash w/o', before: '110', after: '120' }] },
    { ...base, id: 1, op: 'add', changes: null, branchName: 'Branch, "B"' }
  ]
  it('writes a header, one line per changed value and one for an entry without values, with the Excel mark when asked', () => {
    const csv = activityToCsv(rows, { bom: true })
    const lines = csv.replace('\uFEFF', '').trimEnd().split('\r\n')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(lines[0]).toBe('When,Seat,Branch,Device,Action,Where,Column,Before,After,Records')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain(',Branch A,pc,overwrite,')
    expect(lines[1]).toContain(',Cash w/o,110,120,1')
    expect(lines[2]).toContain('"Branch, ""B"""')
  })
  it('neutralises text a spreadsheet could run as a formula', () => {
    const csv = activityToCsv([{ ...base, id: 3, path: '=HYPERLINK("x")', changes: [{ column: 'Name', before: '@a', after: '+b' }] }])
    expect(csv).toContain("'@a")
    expect(csv).toContain("'+b")
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
  })
})
