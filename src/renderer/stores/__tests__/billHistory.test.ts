import { beforeEach, describe, expect, it } from 'vitest'
import { useBillStore } from '../billStore'
import { historyHooks, runAsOneEntry } from '../historyHooks'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'
import { docsEqualPersisted, type BillDoc } from '@shared/history/billDoc'
import { fromPlain } from '@shared/richtext/runs'
import { applyFormat } from '@shared/richtext/format'
import { UNDO_MAX_DEPTH } from '@shared/history/undoStack'

const S = () => useBillStore.getState()
const doc = (): BillDoc => ({ formatId: S().formatId, extraCols: S().extraCols, rows: S().rows, party: S().party, billDate: S().billDate })
let clock = 0
const tick = (ms: number): void => { clock += ms }
const snapshot = () => ({ doc: doc(), footer: JSON.stringify(S().view.footer), body: JSON.stringify(S().view.body) })

beforeEach(() => {
  clock = 1_000_000
  historyHooks.now = () => clock
  historyHooks.selection = null
  S().loadBill(legacyGridBill())
  // other test files replace wrap; the store installs it at creation — re-install through a fresh load is not enough
})

describe('Phase 17 — store history', () => {
  it('a freshly opened bill has no history and is clean', () => {
    expect([S().canUndo, S().canRedo, S().dirty, S().historyList().length]).toEqual([false, false, false, 0])
  })

  it('one edit = one entry with a human label; undo restores, redo reapplies', () => {
    const id = S().rows[0]!.id
    const oldRate = S().rows[0]!.rate
    S().setCellText(id, 'rate', '99')
    expect(S().undoLabel).toBe('Typed in Rate (row 1)')
    expect(S().canUndo).toBe(true)
    expect(S().undo()).toBe(true)
    expect(S().rows[0]!.rate).toBe(oldRate)
    expect(S().redoLabel).toBe('Typed in Rate (row 1)')
    expect(S().redo()).toBe(true)
    expect(S().rows[0]!.rate).toBe('99')
  })

  it('UR 7.1 — typing 5 chars quickly is one undo; pause > 1 s makes two', () => {
    const id = S().rows[0]!.id
    const name = (): string => S().rows[0]!.nameRuns.map((r) => r.t).join('')
    S().setCellText(id, 'name', 'Q'); tick(5000) // start from a short name so every step below is growth
    for (const t of ['Qa', 'Qab', 'Qabc', 'Qabcd', 'Qabcde']) { S().setCellText(id, 'name', t); tick(100) }
    expect(S().historyList()).toHaveLength(2)
    S().undo()
    expect(name()).toBe('Q')

    S().loadBill(legacyGridBill())
    const id2 = S().rows[0]!.id
    S().setCellText(id2, 'name', 'Q'); tick(5000)
    S().setCellText(id2, 'name', 'X'.repeat(2)); tick(1500); S().setCellText(id2, 'name', 'X'.repeat(3))
    expect(S().historyList()).toHaveLength(3)
    S().undo()
    expect(name()).toBe('XX')
    S().undo()
    expect(name()).toBe('Q')
  })

  it('typing and deleting in one cell are separate entries; another cell is another entry', () => {
    const id = S().rows[0]!.id
    S().setCellText(id, 'name', 'An extremely long item name for the typing run'); tick(50)
    S().setCellText(id, 'name', 'An extremely long'); tick(50)
    expect(S().historyList().map((e) => e.label)).toEqual(['Typed in Item Name (row 1)', 'Deleted in Item Name (row 1)'])
    S().setCellText(S().rows[1]!.id, 'name', 'Z')
    expect(S().historyList()).toHaveLength(3)
  })

  it('UR 7.2 — a range operation (paste 3x3) is ONE entry; one undo restores values and row count', () => {
    const before = snapshot()
    const rowsBefore = S().rows.length
    const cells = [] as { rowId: string; colKey: string; text: string }[]
    for (let r = 0; r < 3; r++) for (const c of ['name', 'rate', 'qty']) cells.push({ rowId: S().rows[r + 17]!.id, colKey: c, text: c === 'name' ? `N${r}` : String(r + 1) })
    runAsOneEntry('Paste', () => { S().ensureBodyRows(S().view.bodyIds.length + 5); S().setCellTexts(cells) })
    expect(S().historyList()).toHaveLength(1)
    expect(S().undoLabel).toBe('Paste')
    expect(S().rows.length).toBeGreaterThanOrEqual(rowsBefore)
    S().undo()
    expect(docsEqualPersisted(before.doc, doc())).toBe(true)
    expect(JSON.stringify(S().view.footer)).toBe(before.footer)
    S().redo()
    expect(S().rows[17]!.nameRuns[0]!.t).toBe('N0')
  })

  it('UR 7.4 — format switch is its own entry; undo restores the id and leaves row data untouched', () => {
    const rowsRef = S().rows
    const from = S().formatId
    S().setFormatId(from === 'gst' ? 'non_gst' : 'gst')
    expect(S().undoLabel).toMatch(/^Switched to /)
    S().undo()
    expect(S().formatId).toBe(from)
    expect(S().rows).toEqual(rowsRef)
  })

  it('UR 7.5 — a new edit after undo clears redo', () => {
    const id = S().rows[0]!.id
    S().setCellText(id, 'rate', '5'); tick(5000); S().setCellText(id, 'rate', '6'); S().undo()
    expect(S().canRedo).toBe(true)
    tick(5000); S().setCellText(id, 'qty', '3')
    expect(S().canRedo).toBe(false)
    expect(S().redo()).toBe(false)
  })

  it('UR 7.6 — undo back to the saved snapshot clears dirty; edit sets it; you can undo past a save (D-U2)', () => {
    const id = S().rows[0]!.id
    S().setCellText(id, 'rate', '777')
    expect(S().dirty).toBe(true)
    S().undo()
    expect(S().dirty).toBe(false)
    S().redo(); S().markSaved()
    expect(S().dirty).toBe(false)
    expect(S().canUndo).toBe(true) // history survives Save
    S().undo()
    expect(S().dirty).toBe(true)
    S().redo()
    expect(S().dirty).toBe(false)
  })

  it('dirty ignores trailing blank padding rows', () => {
    S().ensureBodyRows(S().view.bodyIds.length + 4)
    S().markSaved()
    S().ensureBodyRows(S().view.bodyIds.length + 4)
    S().breakCoalesce()
    expect(S().dirty).toBe(false)
  })

  it('save breaks coalescing: typing after a save is a new entry', () => {
    const id = S().rows[0]!.id
    S().setCellText(id, 'rate', '1'); S().markSaved(); tick(10); S().setCellText(id, 'rate', '12')
    expect(S().historyList()).toHaveLength(2)
  })

  it('UR 7.7 — depth limit through the store: the oldest entry drops, nothing crashes', () => {
    const id = S().rows[0]!.id
    for (let i = 0; i < UNDO_MAX_DEPTH + 1; i++) { tick(2000); S().setCellText(id, 'rate', String(i + 10)) }
    expect(S().historyList()).toHaveLength(UNDO_MAX_DEPTH)
    let n = 0; while (S().undo()) n++
    expect(n).toBe(UNDO_MAX_DEPTH)
  })

  it('formatting and total reset are undoable with labels', () => {
    const r0 = S().rows[0]!
    S().setNameRuns(r0.id, applyFormat(fromPlain('Ruby'), 'redBold', 0, 4))
    expect(S().undoLabel).toBe('Formatted Item Name (row 1)')
    S().undo()
    expect(S().rows[0]!.nameRuns).toEqual(r0.nameRuns)
    tick(5000)
    S().setCellText(r0.id, 'total', '12345')
    expect(S().rows[0]!.totalOverride).toBe('12345')
    tick(5000)
    S().resetTotal(r0.id)
    expect(S().undoLabel).toBe('Reset total (row 1)')
    S().undo()
    expect(S().rows[0]!.totalOverride).toBe('12345')
  })

  it('no-op edits record nothing', () => {
    const id = S().rows[0]!.id
    S().setCellText(id, 'rate', S().rows[0]!.rate ?? '')
    expect(S().canUndo).toBe(false)
  })

  it('jumpTo moves to any state and keeps the rest redoable', () => {
    const id = S().rows[0]!.id
    for (const v of ['1', '2', '3']) { tick(5000); S().setCellText(id, 'rate', v) }
    S().jumpTo(0)
    expect(S().rows[0]!.rate).toBe('1')
    expect(S().historyCursor()).toBe(1)
    S().jumpTo(2)
    expect(S().rows[0]!.rate).toBe('3')
    S().jumpTo(-1)
    expect(S().dirty).toBe(false)
  })

  it('loading another bill clears history (D-U2)', () => {
    S().setCellText(S().rows[0]!.id, 'rate', '1')
    S().loadBill(legacyGridBill())
    expect([S().canUndo, S().canRedo, S().historyList().length]).toEqual([false, false, 0])
  })
})

// ---------- UR 7.8: property test ----------
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

describe('Phase 17 — property: undo all = initial, redo all = final (UR 7.8)', () => {
  for (const coalesce of [false, true]) {
    for (let seed = 1; seed <= 12; seed++) {
      it(`seed ${seed}${coalesce ? ' (coalescing)' : ''}`, () => {
        const rnd = prng(seed * (coalesce ? 7919 : 104729))
        const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T
        const initial = snapshot()
        const steps = 40
        for (let i = 0; i < steps; i++) {
          tick(coalesce ? 100 : 2000)
          const rows = S().rows
          const row = pick(rows)
          const op = pick(['name', 'rate', 'qty', 'total', 'extra', 'format', 'fmtname', 'reset', 'range', 'pad'] as const)
          if (op === 'name') S().setCellText(row.id, 'name', pick(['Ruby', 'Tomato', 'Pearl', '', 'Opal 22']))
          else if (op === 'rate') S().setCellText(row.id, 'rate', pick(['', '10', '99.5', '1250']))
          else if (op === 'qty') S().setCellText(row.id, 'qty', pick(['', '1', '2.5', '40']))
          else if (op === 'total') S().setCellText(row.id, 'total', pick(['', '500', '-20', '1']))
          else if (op === 'extra') S().setCellText(row.id, 'ruby', pick(['', '12-1', 'x']))
          else if (op === 'format') S().setFormatId(S().formatId === 'gst' ? 'non_gst' : 'gst')
          else if (op === 'fmtname') S().setNameRuns(row.id, applyFormat(row.nameRuns.length ? row.nameRuns : fromPlain('Z'), pick(['bold', 'redBold', 'highlight', 'clear'] as const), 0, 2))
          else if (op === 'reset') S().resetTotal(row.id)
          else if (op === 'pad') S().ensureBodyRows(S().view.bodyIds.length + 2)
          else runAsOneEntry('Range', () => { for (let k = 0; k < 4; k++) S().setCellText(pick(S().rows).id, pick(['rate', 'qty', 'name'] as const), pick(['', '3', 'Q'])) })
        }
        const final = snapshot()
        let guard = 0
        while (S().undo()) { if (++guard > 1000) throw new Error('runaway') }
        expect(docsEqualPersisted(initial.doc, doc())).toBe(true)
        expect(JSON.stringify(S().view.footer)).toBe(initial.footer) // derived totals recomputed after undo
        guard = 0
        while (S().redo()) { if (++guard > 1000) throw new Error('runaway') }
        expect(docsEqualPersisted(final.doc, doc())).toBe(true)
        expect(JSON.stringify(S().view.footer)).toBe(final.footer)
      })
    }
  }
})
