import { describe, expect, it } from 'vitest'
import { buildHistoryRows, formatClock, jumpNotice, ORIGINAL_STATE_LABEL, redoTooltip, undoNotice, undoTooltip } from '../historyView'
import type { HistoryEntry } from '../undoStack'

const e = (label: string, at: number): HistoryEntry => ({ label, at, patches: [], inverse: [], selBefore: null, selAfter: null })
const list = [e('A', 1000), e('B', 2000), e('C', 3000)]

describe('Phase 18 — history panel model', () => {
  it('newest first, original state last, exactly one current row', () => {
    const rows = buildHistoryRows(list, 3)
    expect(rows.map((r) => r.label)).toEqual(['C', 'B', 'A', ORIGINAL_STATE_LABEL])
    expect(rows.map((r) => r.index)).toEqual([2, 1, 0, -1])
    expect(rows.map((r) => r.state)).toEqual(['current', 'applied', 'applied', 'applied'])
    expect(rows.filter((r) => r.state === 'current')).toHaveLength(1)
  })
  it('redo entries are marked undone; current follows the cursor', () => {
    const rows = buildHistoryRows(list, 1)
    expect(rows.map((r) => r.state)).toEqual(['undone', 'undone', 'current', 'applied'])
  })
  it('cursor 0 = original state is current; empty history has just that row', () => {
    expect(buildHistoryRows(list, 0).map((r) => r.state)).toEqual(['undone', 'undone', 'undone', 'current'])
    const only = buildHistoryRows([], 0)
    expect(only).toHaveLength(1)
    expect(only[0]).toMatchObject({ index: -1, state: 'current', at: null })
  })
  it('clamps an out-of-range cursor', () => {
    expect(buildHistoryRows(list, 99).filter((r) => r.state === 'current')[0]?.index).toBe(2)
    expect(buildHistoryRows(list, -4).filter((r) => r.state === 'current')[0]?.index).toBe(-1)
  })
  it('tooltips name the NEXT action', () => {
    expect(undoTooltip('Paste')).toBe('Undo: Paste')
    expect(undoTooltip(null)).toBe('Nothing to undo')
    expect(redoTooltip('Switched to GST')).toBe('Redo: Switched to GST')
    expect(redoTooltip(null)).toBe('Nothing to redo')
  })
  it('status notices', () => {
    expect(undoNotice('undo', true, 'Delete cell')).toBe('Undone: Delete cell')
    expect(undoNotice('redo', true, 'Paste')).toBe('Redone: Paste')
    expect(undoNotice('undo', false, null)).toBe('Nothing to undo')
    expect(undoNotice('redo', false, null)).toBe('Nothing to redo')
    expect(jumpNotice(true, { index: 1, label: 'B' })).toBe('Jumped to: B')
    expect(jumpNotice(true, { index: -1, label: ORIGINAL_STATE_LABEL })).toBe('Jumped to the original state')
    expect(jumpNotice(false, null)).toBe('Already at that state')
  })
  it('formatClock is zero-padded HH:MM:SS', () => {
    const d = new Date(2026, 9, 8, 3, 4, 5).getTime()
    expect(formatClock(d)).toBe('03:04:05')
  })
})
