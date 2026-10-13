import { describe, expect, it } from 'vitest'
import { createHistory, UNDO_COALESCE_MS, UNDO_MAX_DEPTH, type HistoryEntry } from '../undoStack'

const e = (label: string, at: number, key?: string): HistoryEntry => ({
  label, at, patches: [{ op: 'add', path: ['p'], value: label }], inverse: [{ op: 'add', path: ['i'], value: label }],
  selBefore: null, selAfter: null, coalesceKey: key
})

describe('Phase 17 — createHistory', () => {
  it('constants match UR §2', () => { expect(UNDO_MAX_DEPTH).toBe(500); expect(UNDO_COALESCE_MS).toBe(1000) })

  it('undo / redo move entries between stacks; a new push clears redo (UR §7.5)', () => {
    const h = createHistory()
    h.push(e('a', 0)); h.push(e('b', 5000))
    expect(h.undo()?.label).toBe('b')
    expect(h.canRedo()).toBe(true)
    h.push(e('c', 9000))
    expect(h.canRedo()).toBe(false)
    expect(h.list().map((x) => x.label)).toEqual(['a', 'c'])
    expect(h.undo()?.label).toBe('c'); expect(h.undo()?.label).toBe('a'); expect(h.undo()).toBeNull()
    expect(h.redo()?.label).toBe('a')
  })

  it('same key within the idle window merges; patches in order, inverse reversed (UR §7.1)', () => {
    const h = createHistory()
    h.push(e('t1', 0, 'type:r1:name')); h.push(e('t2', 400, 'type:r1:name')); h.push(e('t3', 1300, 'type:r1:name')) // 900 ms after t2: still idle < 1000
    expect(h.list()).toHaveLength(1)
    const top = h.peekUndo()!
    expect(top.patches.map((p) => p.value)).toEqual(['t1', 't2', 't3'])
    expect(top.inverse.map((p) => p.value)).toEqual(['t3', 't2', 't1'])
  })

  it('a pause longer than 1000 ms, another key, or no key = separate entries', () => {
    const h = createHistory()
    h.push(e('a', 0, 'k')); h.push(e('b', 1001, 'k'))
    expect(h.list()).toHaveLength(2)
    h.push(e('c', 1100, 'other')); h.push(e('d', 1200)); h.push(e('f', 1300))
    expect(h.list()).toHaveLength(5)
  })

  it('never merges across an undo/redo or after breakCoalesce', () => {
    const h = createHistory()
    h.push(e('a', 0, 'k')); h.undo(); h.redo(); h.push(e('b', 10, 'k'))
    expect(h.list()).toHaveLength(2)
    h.breakCoalesce(); h.push(e('c', 20, 'k'))
    expect(h.list()).toHaveLength(3)
  })

  it('depth limit: the 501st entry drops the oldest, no crash (UR §7.7)', () => {
    const h = createHistory()
    for (let i = 0; i < UNDO_MAX_DEPTH + 1; i++) h.push(e(`e${i}`, i * 5000))
    expect(h.list()).toHaveLength(UNDO_MAX_DEPTH)
    expect(h.list()[0]!.label).toBe('e1')
    let n = 0; while (h.undo()) n++
    expect(n).toBe(UNDO_MAX_DEPTH)
  })

  it('jumpTo moves the cursor both ways and keeps the rest redoable', () => {
    const h = createHistory()
    for (const l of ['a', 'b', 'c', 'd']) h.push(e(l, l.charCodeAt(0) * 5000))
    let r = h.jumpTo(1)
    expect(r.direction).toBe('undo'); expect(r.entries.map((x) => x.label)).toEqual(['d', 'c'])
    expect(h.cursor()).toBe(2); expect(h.peekRedo()!.label).toBe('c')
    r = h.jumpTo(3)
    expect(r.direction).toBe('redo'); expect(r.entries.map((x) => x.label)).toEqual(['c', 'd'])
    r = h.jumpTo(-1)
    expect(r.entries).toHaveLength(4); expect(h.cursor()).toBe(0)
    expect(h.jumpTo(-1).direction).toBe('none')
    expect(h.jumpTo(99).entries).toHaveLength(4) // clamped
    expect(h.list().map((x) => x.label)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('clear empties everything', () => {
    const h = createHistory(); h.push(e('a', 0)); h.undo(); h.clear()
    expect([h.canUndo(), h.canRedo(), h.list().length]).toEqual([false, false, 0])
  })
})
