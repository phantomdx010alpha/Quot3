import { describe, expect, it } from 'vitest'
import { addExtraCol, extraColCount, extraColHasData, MAX_EXTRA_COLS, nextExtraColHeader, nextExtraColKey, removeExtraCol, renameExtraCol, sanitizeExtraHeader } from '../extraCols'
import { createEmptyRow } from '../billModel'
import { allActions, allShortcuts, findShortcutConflicts, matchShortcut } from '../shortcuts'
import type { BillRow, ExtraColDef } from '../types'

const col = (key: string, header: string): ExtraColDef => ({ key, header, kind: 'units' })
const rowWith = (i: number, extras: BillRow['extras']): BillRow => ({ ...createEmptyRow(i), extras })

describe('Phase 21 — pure extra-column management', () => {
  it('add appends with the next free key and default header', () => {
    const r = addExtraCol([], [])!
    expect(r.col).toEqual(col('c1', 'Col 1'))
    const r2 = addExtraCol(r.extraCols, [])!
    expect(r2.extraCols.map((c) => c.header)).toEqual(['Col 1', 'Col 2'])
    expect(extraColCount(r2.extraCols)).toBe(2)
  })
  it('default header skips names in use; key skips keys in use by columns AND orphan row data', () => {
    expect(nextExtraColHeader([col('c1', 'Col 1'), col('c3', 'col 2')])).toBe('Col 3')
    expect(nextExtraColHeader([col('a', 'ruby')])).toBe('Col 1')
    expect(nextExtraColKey([col('c1', 'x')], [rowWith(0, { c2: { text: 'orphan' } })])).toBe('c3')
  })
  it('add stops at the cap', () => {
    let cols: ExtraColDef[] = []
    for (let i = 0; i < MAX_EXTRA_COLS; i++) cols = addExtraCol(cols, [])!.extraCols
    expect(cols).toHaveLength(MAX_EXTRA_COLS)
    expect(addExtraCol(cols, [])).toBeNull()
  })
  it('remove drops the column and only its cells; untouched rows keep identity', () => {
    const a = rowWith(0, { c1: { text: '5-1' }, c2: { text: 'keep' } })
    const b = rowWith(1, { c2: { text: 'x' } })
    const r = removeExtraCol([col('c1', 'A'), col('c2', 'B')], [a, b], 'c1')!
    expect(r.extraCols.map((c) => c.key)).toEqual(['c2'])
    expect(r.rows[0]!.extras).toEqual({ c2: { text: 'keep' } })
    expect(r.rows[1]).toBe(b)
    expect(r.removed.header).toBe('A')
    expect(removeExtraCol([col('c1', 'A')], [a], 'nope')).toBeNull()
  })
  it('hasData: text or a mark counts, blanks do not', () => {
    expect(extraColHasData([rowWith(0, { c1: { text: '  ' } })], 'c1')).toBe(false)
    expect(extraColHasData([rowWith(0, { c1: { text: '' } })], 'c1')).toBe(false)
    expect(extraColHasData([rowWith(0, { c1: { text: '', marked: true } })], 'c1')).toBe(true)
    expect(extraColHasData([rowWith(0, { c1: { text: '5-1' } })], 'c1')).toBe(true)
  })
  it('rename sanitises to one capped line; empty / same / unknown = no change', () => {
    const cols = [col('c1', 'Col 1')]
    expect(renameExtraCol(cols, 'c1', '  ru\n  by ')![0]!.header).toBe('ru by')
    expect(renameExtraCol(cols, 'c1', '   ')).toBeNull()
    expect(renameExtraCol(cols, 'c1', 'Col 1')).toBeNull()
    expect(renameExtraCol(cols, 'zz', 'x')).toBeNull()
    expect(sanitizeExtraHeader('x'.repeat(100))).toHaveLength(40)
  })
  it('actions/shortcuts are registered: Ctrl+Alt+= / Ctrl+Alt+− / Ctrl+Alt+R, no conflicts', () => {
    const ids = allActions().map((a) => a.id)
    for (const id of ['cols.add', 'cols.remove', 'cols.rename']) expect(ids).toContain(id)
    const ev = (key: string) => ({ key, ctrlKey: true, altKey: true, shiftKey: false, metaKey: false })
    expect(matchShortcut(ev('='))?.action).toBe('cols.add')
    expect(matchShortcut(ev('-'))?.action).toBe('cols.remove')
    expect(matchShortcut(ev('r'))?.action).toBe('cols.rename')
    expect(findShortcutConflicts(allShortcuts())).toEqual([])
  })
})
