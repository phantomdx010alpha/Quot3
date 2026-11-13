import { describe, expect, it } from 'vitest'
import { ALL_RIGHTS, NO_RIGHTS, PERM_FLAGS, PERM_LABELS, effectiveFlags, flagsToStore, missingFlags, normalizeFlags, notAllowedText, permRecordFromPayload, requiredFlags, rightsNotice, type PermRecord } from '../perms'

// Phase 242 (M23): the diff cases the SQL twin (`qt_price_required` in 19_price_perms.sql) must agree with. Invented names only.
const row = (over: Partial<PermRecord> = {}): PermRecord => ({ kind: 'price_row', rowKind: 'item', idx: 0, name: 'Acme tape', cells: { p1: '10', p2: '' }, ...over })
const tab = (over: Partial<PermRecord> = {}): PermRecord => ({ kind: 'price_tab', name: 'Small', position: 0, columnsKey: '[1]', parentId: '"c1"', ...over })

describe('requiredFlags (Phase 242 diff cases)', () => {
  it('a new row needs add only, a restored row too', () => {
    expect(requiredFlags(null, row())).toEqual(['add'])
    expect(requiredFlags(row({ deleted: true }), row())).toEqual(['add'])
  })
  it('a rename, a kind change or a move of a row is an edit', () => {
    expect(requiredFlags(row(), row({ name: 'Acme tape 2' }))).toEqual(['edit'])
    expect(requiredFlags(row(), row({ rowKind: 'section' }))).toEqual(['edit'])
    expect(requiredFlags(row(), row({ idx: 3 }))).toEqual(['edit'])
  })
  it('filling an EMPTY cell is an edit, changing or clearing a value is an overwrite, both together need both', () => {
    expect(requiredFlags(row(), row({ cells: { p1: '10', p2: '20' } }))).toEqual(['edit'])
    expect(requiredFlags(row(), row({ cells: { p1: '11', p2: '' } }))).toEqual(['overwrite'])
    expect(requiredFlags(row(), row({ cells: { p1: '', p2: '' } }))).toEqual(['overwrite'])
    expect(requiredFlags(row(), row({ cells: { p1: '11', p2: '20' } })).sort()).toEqual(['edit', 'overwrite'])
  })
  it('nothing changed needs nothing (a resend or a formatting-only change)', () => {
    expect(requiredFlags(row(), row())).toEqual([])
    expect(requiredFlags(row({ cells: { p1: '10' } }), row({ cells: { p1: '10', p2: '' } }))).toEqual([])
  })
  it('a delete needs delete; deleting what is already deleted needs nothing; a brand-new deleted record needs nothing', () => {
    expect(requiredFlags(row(), row({ deleted: true }))).toEqual(['delete'])
    expect(requiredFlags(row({ deleted: true }), row({ deleted: true }))).toEqual([])
    expect(requiredFlags(null, row({ deleted: true }))).toEqual([])
  })
  it('tabs, categories and tiers: create, restore, rename, reorder, columns, parent and a tier key change are all structure', () => {
    expect(requiredFlags(null, tab())).toEqual(['structure'])
    expect(requiredFlags(tab({ deleted: true }), tab())).toEqual(['structure'])
    for (const over of [{ name: 'Big' }, { position: 2 }, { columnsKey: '[2]' }, { parentId: '"c2"' }, { label: 'x' }, { key: 'k2' }]) expect(requiredFlags(tab(), tab(over)), JSON.stringify(over)).toEqual(['structure'])
    expect(requiredFlags(tab(), tab())).toEqual([])
    expect(requiredFlags(tab(), tab({ deleted: true }))).toEqual(['delete'])
    expect(requiredFlags({ kind: 'price_tier', key: 'a', label: 'Cash' }, { kind: 'price_tier', key: 'a', label: 'Cash' })).toEqual([])
  })
})

describe('permRecordFromPayload (what the server reads from a synced payload)', () => {
  it('joins the name runs, reads cells as text and ignores key order', () => {
    const a = permRecordFromPayload('price_row', { row: { kind: 'item', idx: 4, nameRuns: [{ t: 'Acme ' }, { t: 'tape', b: true }], cells: { p1: '10', n: 5, z: null } } })
    expect(a).toMatchObject({ kind: 'price_row', rowKind: 'item', idx: 4, name: 'Acme tape', cells: { p1: '10', n: '5', z: '' } })
    const x = permRecordFromPayload('price_tab', { tab: { name: 'S', columns: [{ a: 1, b: 2 }] } })
    const y = permRecordFromPayload('price_tab', { tab: { name: 'S', columns: [{ b: 2, a: 1 }] } })
    expect(x.columnsKey).toBe(y.columnsKey)
  })
  it('bold or colour only (the same words) is no change; unreadable payloads never throw', () => {
    const plain = permRecordFromPayload('price_row', { row: { kind: 'item', idx: 0, nameRuns: [{ t: 'Acme tape' }], cells: {} } })
    const bold = permRecordFromPayload('price_row', { row: { kind: 'item', idx: 0, nameRuns: [{ t: 'Acme ', b: true }, { t: 'tape', c: 'red' }], cells: {} } })
    expect(requiredFlags(plain, bold)).toEqual([])
    for (const bad of [null, undefined, 5, 'x', [], { row: 7 }]) expect(() => permRecordFromPayload('price_row', bad)).not.toThrow()
    expect(permRecordFromPayload('price_tier', 'x')).toMatchObject({ kind: 'price_tier' })
  })
})

describe('flags (Phase 242)', () => {
  it('seat 1 and no-sync always have everything; another seat has what was granted; nothing cached = nothing', () => {
    expect(effectiveFlags(1, {}, true)).toEqual(ALL_RIGHTS)
    expect(effectiveFlags(3, {}, false)).toEqual(ALL_RIGHTS)
    expect(effectiveFlags(null, {}, false)).toEqual(ALL_RIGHTS)
    expect(effectiveFlags(3, { add: true, edit: 'yes' }, true)).toEqual({ ...NO_RIGHTS, add: true })
    expect(effectiveFlags(null, ALL_RIGHTS, true)).toEqual(NO_RIGHTS)
    expect(normalizeFlags(null)).toEqual(NO_RIGHTS)
  })
  it('seat 1 is stored as all-true whatever is sent', () => {
    expect(flagsToStore(1, NO_RIGHTS)).toEqual(ALL_RIGHTS)
    expect(flagsToStore(2, { delete: true })).toEqual({ ...NO_RIGHTS, delete: true })
  })
  it('the refusal names every missing flag in plain words and says who to ask', () => {
    const miss = missingFlags({ ...ALL_RIGHTS, overwrite: false, structure: false }, ['overwrite', 'structure', 'add'])
    expect(miss).toEqual(['overwrite', 'structure'])
    const t = notAllowedText(miss)
    expect(t).toContain(PERM_LABELS.overwrite)
    expect(t).toContain(PERM_LABELS.structure)
    expect(t).toContain('seat 1')
  })
})

describe('rightsNotice (the line on the Price List page)', () => {
  it('full rights and nothing refused = no notice', () => {
    expect(rightsNotice({ ...ALL_RIGHTS }, 0)).toEqual([])
  })
  it('no rights at all = one read-only line that says how to get them', () => {
    const n = rightsNotice({ ...NO_RIGHTS }, 0)
    expect(n).toHaveLength(1)
    expect(n[0]).toContain('Read only')
    expect(n[0]).toContain('Who can edit')
  })
  it('some rights missing = names exactly the missing ones', () => {
    const n = rightsNotice({ ...ALL_RIGHTS, delete: false, structure: false }, 0)
    expect(n).toHaveLength(1)
    expect(n[0]).toContain(PERM_LABELS.delete.toLowerCase())
    expect(n[0]).toContain(PERM_LABELS.structure.toLowerCase())
    for (const f of PERM_FLAGS.filter((x) => x !== 'delete' && x !== 'structure')) expect(n[0]).not.toContain(PERM_LABELS[f].toLowerCase())
  })
  it('refused changes add their own line (singular and plural)', () => {
    expect(rightsNotice({ ...ALL_RIGHTS }, 1)).toEqual(['1 change made on this PC was not accepted by the main branch and stays only on this PC.'])
    expect(rightsNotice({ ...ALL_RIGHTS }, 3)[0]).toContain('3 changes made on this PC were not accepted')
    expect(rightsNotice({ ...NO_RIGHTS }, 2)).toHaveLength(2)
  })
})
