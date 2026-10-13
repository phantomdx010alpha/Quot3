import { describe, it, expect } from 'vitest'
import {
  navReduce, createNavState, arriveAt, clickInText, syncCaret, isNumericCharAllowed, dataEdgeRow, lastUsedCell,
  prevWordStart, nextWordEnd, LEFT_UNLOCK_PRESSES, LEFT_EDGE_LEAVES_CELL, DEFAULT_NAV_OPTIONS, navOptionsFor,
  type NavState, type GridShape, type KeyInput, type NavEffect
} from '../cellNav'

/** cols: 0 = text (name), 1 = num (rate), 2 = num (qty). */
function shape(cells: string[][], kinds: ('text' | 'num')[] = ['text', 'num', 'num']): GridShape {
  return { rowCount: cells.length, colCount: kinds.length, cellText: (r, c) => cells[r]?.[c] ?? '', cellKind: (c) => kinds[c] ?? 'text' }
}
const K = (key: string, m: Partial<KeyInput> = {}): KeyInput => ({ key, ...m })
function run(st: NavState, sh: GridShape, ...keys: (string | KeyInput)[]) {
  let state = st
  let effects: NavEffect[] = []
  for (const k of keys) { const r = navReduce(state, typeof k === 'string' ? K(k) : k, sh); state = r.state; effects = r.effects }
  return { state, effects }
}
const has = (e: NavEffect[], type: NavEffect['type']) => e.some((x) => x.type === type)

const G = shape([
  ['Ruby', '10', '2'],
  ['Tomato red', '5', ''],
  ['', '', ''],
  ['', '', ''],
  ['', '', '']
])

describe('constants', () => {
  it('match the spec defaults', () => {
    expect(LEFT_UNLOCK_PRESSES).toBe(2)
    expect(LEFT_EDGE_LEAVES_CELL).toBe(false)
  })
})

describe('KB §9.1 arrival is Append at end', () => {
  for (const [name, from, key, to] of [
    ['Right', [0, 0], 'ArrowRight', [0, 1]], ['Left (empty)', [2, 1], 'ArrowLeft', [2, 0]],
    ['Up', [1, 1], 'ArrowUp', [0, 1]], ['Down', [0, 0], 'ArrowDown', [1, 0]],
    ['Tab', [0, 0], 'Tab', [0, 1]], ['Enter', [0, 0], 'Enter', [1, 0]]
  ] as const) {
    it(name, () => {
      const r = run(arriveAt(G, from[0], from[1]), G, key)
      expect([r.state.row, r.state.col]).toEqual(to)
      expect(r.state.mode).toBe('append')
      expect(r.state.caret).toBe(G.cellText(to[0], to[1]).length)
      expect(r.effects).toEqual([{ type: 'MOVE', row: to[0], col: to[1] }])
    })
  }
  it('Shift+Tab / Shift+Enter arrive Append at end', () => {
    expect(run(arriveAt(G, 1, 1), G, K('Tab', { shift: true })).state).toMatchObject({ row: 1, col: 0, mode: 'append', caret: 10 })
    expect(run(arriveAt(G, 1, 0), G, K('Enter', { shift: true })).state).toMatchObject({ row: 0, col: 0, mode: 'append', caret: 4 })
  })
  it('arriving from Free mode resets to Append', () => {
    const free = clickInText(G, 0, 0, 1)
    expect(run(free, G, 'Tab').state.mode).toBe('append')
  })
})

describe('KB §9.2 typing in Append appends', () => {
  it('emits INSERT_TEXT at end and never replaces', () => {
    const r = run(arriveAt(G, 0, 0), G, 'x')
    expect(r.effects).toEqual([{ type: 'INSERT_TEXT', text: 'x', at: 'end' }])
    expect(r.state.caret).toBe(5)
    expect(r.state.mode).toBe('append')
  })
  it('space and shifted letters are printable', () => {
    expect(run(arriveAt(G, 0, 0), G, ' ').effects[0]?.type).toBe('INSERT_TEXT')
    expect(run(arriveAt(G, 0, 0), G, K('A', { shift: true })).effects[0]).toMatchObject({ text: 'A' })
  })
  it('Backspace deletes last char natively', () => {
    const r = run(arriveAt(G, 0, 0), G, 'Backspace')
    expect(has(r.effects, 'NATIVE')).toBe(true)
    expect(r.state.caret).toBe(3)
  })
})

describe('KB §9.3 Left arms then unlocks', () => {
  it('Left, Left → Free at end-1', () => {
    const a = run(arriveAt(G, 0, 0), G, 'ArrowLeft')
    expect(a.state.leftArmed).toBe(true)
    expect(a.state.mode).toBe('append')
    expect(a.state.caret).toBe(4)
    expect(a.effects).toEqual([{ type: 'SET_ARMED', armed: true }])
    const b = run(a.state, G, 'ArrowLeft')
    expect(b.state).toMatchObject({ mode: 'free', caret: 3, leftArmed: false })
    expect(has(b.effects, 'SET_MODE')).toBe(true)
  })
  it('Left, X, Left → still Append (disarmed)', () => {
    const r = run(arriveAt(G, 0, 0), G, 'ArrowLeft', 'x', 'ArrowLeft')
    expect(r.state.mode).toBe('append')
    expect(r.state.leftArmed).toBe(true)
  })
  it('any other key disarms', () => {
    expect(run(arriveAt(G, 0, 0), G, 'ArrowLeft', 'F2').state.leftArmed).toBe(false)
  })
  it('leftUnlockPresses = 1 unlocks immediately', () => {
    const r = navReduce(arriveAt(G, 0, 0), K('ArrowLeft'), G, { ...DEFAULT_NAV_OPTIONS, leftUnlockPresses: 1 })
    expect(r.state).toMatchObject({ mode: 'free', caret: 3 })
  })
})

describe('KB §9.4 Free mode walks to the end edge then leaves', () => {
  it('Right until end, Right again → next cell, Append', () => {
    let st = clickInText(G, 0, 0, 2) // "Ru|by"
    st = run(st, G, 'ArrowRight').state
    st = run(st, G, 'ArrowRight').state
    expect(st).toMatchObject({ row: 0, col: 0, mode: 'free', caret: 4 })
    const r = run(st, G, 'ArrowRight')
    expect(r.state).toMatchObject({ row: 0, col: 1, mode: 'append', caret: 2 })
    expect(r.effects).toEqual([{ type: 'MOVE', row: 0, col: 1 }])
  })
  it('Free: Up/Down/Tab/Enter move and arrive Append', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'Enter']) {
      const r = run(clickInText(G, 1, 1, 0), G, key)
      expect(r.state.mode).toBe('append')
      expect(r.state.caret).toBe(G.cellText(r.state.row, r.state.col).length)
    }
  })
  it('D-K3: Left at start edge does nothing (default) — jumps when flag flipped', () => {
    const st = clickInText(G, 0, 1, 0)
    expect(run(st, G, 'ArrowLeft').effects).toEqual([{ type: 'IGNORE' }])
    const r = navReduce(st, K('ArrowLeft'), G, { ...DEFAULT_NAV_OPTIONS, leftEdgeLeavesCell: true })
    expect(r.state).toMatchObject({ row: 0, col: 0, mode: 'append' })
  })
  it('Free Left moves caret one char', () => {
    expect(run(clickInText(G, 0, 0, 3), G, 'ArrowLeft').state.caret).toBe(2)
  })
})

describe('KB §9.5 empty cells never trap', () => {
  const E = shape([['', '', ''], ['', '', ''], ['', '', '']])
  for (const [key, from, to] of [
    ['ArrowRight', [1, 1], [1, 2]], ['ArrowLeft', [1, 1], [1, 0]], ['ArrowUp', [1, 1], [0, 1]], ['ArrowDown', [1, 1], [2, 1]],
    ['Tab', [1, 1], [1, 2]], ['Enter', [1, 1], [2, 1]]
  ] as const) {
    it(`${key} leaves an empty cell at once`, () => {
      const r = run(arriveAt(E, from[0], from[1]), E, key)
      expect([r.state.row, r.state.col]).toEqual(to)
    })
  }
  it('Free-mode empty cell: Left also leaves', () => {
    expect(run(clickInText(E, 1, 1, 0), E, 'ArrowLeft').state).toMatchObject({ row: 1, col: 0 })
  })
  it('Left wraps to previous row end', () => {
    expect(run(arriveAt(E, 1, 0), E, 'ArrowLeft').state).toMatchObject({ row: 0, col: 2 })
  })
  it('Right wraps to next row start', () => {
    expect(run(arriveAt(E, 0, 2), E, 'ArrowRight').state).toMatchObject({ row: 1, col: 0 })
  })
})

describe('KB §9.6 F2 / Esc', () => {
  it('F2 → Free at end', () => {
    const r = run(arriveAt(G, 0, 0), G, 'F2')
    expect(r.state).toMatchObject({ mode: 'free', caret: 4 })
  })
  it('F2 in Free is a no-op', () => {
    expect(run(clickInText(G, 0, 0, 1), G, 'F2').effects).toEqual([{ type: 'IGNORE' }])
  })
  it('Esc in Free → Append, content kept (no CLEAR)', () => {
    const r = run(clickInText(G, 0, 0, 1), G, 'Escape')
    expect(r.state).toMatchObject({ mode: 'append', caret: 4 })
    expect(has(r.effects, 'CLEAR_CELL')).toBe(false)
    expect(has(r.effects, 'PAGE_ESCAPE')).toBe(false)
  })
  it('Esc in Append → PAGE_ESCAPE', () => {
    expect(run(arriveAt(G, 0, 0), G, 'Escape').effects).toEqual([{ type: 'PAGE_ESCAPE' }])
  })
  it('Esc Free then Esc Append = two steps', () => {
    const r = run(clickInText(G, 0, 0, 1), G, 'Escape', 'Escape')
    expect(r.effects).toEqual([{ type: 'PAGE_ESCAPE' }])
  })
})

describe('KB §9.7 Delete semantics', () => {
  it('Append: clears the whole cell', () => {
    const r = run(arriveAt(G, 0, 0), G, 'Delete')
    expect(r.effects).toEqual([{ type: 'CLEAR_CELL' }])
    expect(r.state).toMatchObject({ mode: 'append', caret: 0 })
  })
  it('Free: forward-delete is native', () => {
    expect(run(clickInText(G, 0, 0, 1), G, 'Delete').effects).toEqual([{ type: 'NATIVE' }])
  })
})

describe('KB §9.8 Tab wrapping and trailing row', () => {
  it('Tab at last column → next row first column', () => {
    expect(run(arriveAt(G, 0, 2), G, 'Tab').state).toMatchObject({ row: 1, col: 0 })
  })
  it('Shift+Tab at first column → previous row last column', () => {
    expect(run(arriveAt(G, 1, 0), G, K('Tab', { shift: true })).state).toMatchObject({ row: 0, col: 2 })
  })
  it('Shift+Tab at (0,0) is ignored', () => {
    expect(run(arriveAt(G, 0, 0), G, K('Tab', { shift: true })).effects).toEqual([{ type: 'IGNORE' }])
  })
  it('Tab past the last row → ENSURE_ROW then MOVE to column 0 of the new row', () => {
    const r = run(arriveAt(G, 4, 2), G, 'Tab')
    expect(r.effects).toEqual([{ type: 'ENSURE_ROW', index: 5 }, { type: 'MOVE', row: 5, col: 0 }])
    expect(r.state).toMatchObject({ row: 5, col: 0, caret: 0 })
  })
  it('Enter on the last row also opens a fresh row', () => {
    const r = run(arriveAt(G, 4, 1), G, 'Enter')
    expect(r.effects).toEqual([{ type: 'ENSURE_ROW', index: 5 }, { type: 'MOVE', row: 5, col: 1 }])
  })
  it('Down on the last row stops (no new row)', () => {
    expect(run(arriveAt(G, 4, 1), G, 'ArrowDown').effects).toEqual([{ type: 'IGNORE' }])
  })
})

describe('KB §9.9 Home / Ctrl+Left / Shift+Left in Append → Free', () => {
  it('Home → Free, caret start', () => {
    const r = run(arriveAt(G, 1, 0), G, 'Home')
    expect(r.state).toMatchObject({ mode: 'free', caret: 0 })
    expect(r.effects).toEqual([{ type: 'SET_MODE', mode: 'free' }, { type: 'SET_CARET', pos: 'start' }])
  })
  it('Ctrl+Left → Free, caret at previous word start', () => {
    const r = run(arriveAt(G, 1, 0), G, K('ArrowLeft', { ctrl: true }))
    expect(r.state).toMatchObject({ mode: 'free', caret: 7 }) // "Tomato |red"
    expect(has(r.effects, 'SET_CARET')).toBe(true)
  })
  it('Shift+Left → Free + native selection, caret end-1', () => {
    const r = run(arriveAt(G, 0, 0), G, K('ArrowLeft', { shift: true }))
    expect(r.state).toMatchObject({ mode: 'free', caret: 3 })
    expect(r.effects).toEqual([{ type: 'SET_MODE', mode: 'free' }, { type: 'NATIVE' }])
  })
  it('Shift+Home → Free + native selection to start', () => {
    const r = run(arriveAt(G, 0, 0), G, K('Home', { shift: true }))
    expect(r.state).toMatchObject({ mode: 'free', caret: 0 })
    expect(has(r.effects, 'NATIVE')).toBe(true)
  })
  it('Ctrl+Shift+Left → Free + native', () => {
    const r = run(arriveAt(G, 0, 0), G, K('ArrowLeft', { ctrl: true, shift: true }))
    expect(r.state.mode).toBe('free')
    expect(has(r.effects, 'NATIVE')).toBe(true)
  })
  it('End: no-op in Append, caret end in Free', () => {
    expect(run(arriveAt(G, 0, 0), G, 'End').effects).toEqual([{ type: 'IGNORE' }])
    expect(run(clickInText(G, 0, 0, 1), G, 'End').state.caret).toBe(4)
  })
  it('Free Home → start', () => { expect(run(clickInText(G, 0, 0, 3), G, 'Home').state.caret).toBe(0) })
})

describe('KB §9.10 Ctrl+Up/Down data-edge jumps; Ctrl+Home/End; pages', () => {
  const T = shape([['a'], ['b'], ['c'], [''], [''], ['d'], ['e'], [''], ['']], ['text'])
  it('filled run → end of run', () => { expect(run(arriveAt(T, 0, 0), T, K('ArrowDown', { ctrl: true })).state.row).toBe(2) })
  it('at end of run → next filled block start', () => { expect(run(arriveAt(T, 2, 0), T, K('ArrowDown', { ctrl: true })).state.row).toBe(5) })
  it('empty cell → next filled', () => { expect(run(arriveAt(T, 3, 0), T, K('ArrowDown', { ctrl: true })).state.row).toBe(5) })
  it('last block with nothing after → last row', () => { expect(run(arriveAt(T, 6, 0), T, K('ArrowDown', { ctrl: true })).state.row).toBe(8) })
  it('upward mirrors', () => {
    expect(run(arriveAt(T, 6, 0), T, K('ArrowUp', { ctrl: true })).state.row).toBe(5)
    expect(run(arriveAt(T, 5, 0), T, K('ArrowUp', { ctrl: true })).state.row).toBe(2)
    expect(run(arriveAt(T, 1, 0), T, K('ArrowUp', { ctrl: true })).state.row).toBe(0)
  })
  it('already at edge → ignore', () => {
    expect(run(arriveAt(T, 8, 0), T, K('ArrowDown', { ctrl: true })).effects).toEqual([{ type: 'IGNORE' }])
    expect(dataEdgeRow(T, 0, 0, -1)).toBe(0)
  })
  it('Ctrl+Home / Ctrl+End', () => {
    expect(run(arriveAt(G, 3, 2), G, K('Home', { ctrl: true })).state).toMatchObject({ row: 0, col: 0 })
    expect(run(arriveAt(G, 0, 0), G, K('End', { ctrl: true })).state).toMatchObject({ row: 1, col: 2 })
    expect(lastUsedCell(shape([['', '']], ['text', 'text']))).toEqual({ row: 0, col: 0 })
  })
  it('PageDown / PageUp clamp', () => {
    expect(run(arriveAt(G, 0, 0), G, K('PageDown', { pageRows: 3 })).state.row).toBe(3)
    expect(run(arriveAt(G, 3, 0), G, K('PageDown', { pageRows: 30 })).state.row).toBe(4)
    expect(run(arriveAt(G, 3, 0), G, K('PageUp', { pageRows: 2 })).state.row).toBe(1)
    expect(run(arriveAt(G, 0, 0), G, 'PageUp').effects).toEqual([{ type: 'IGNORE' }])
  })
})

describe('KB §9.11 numeric cells', () => {
  it('predicate: digits, one dot, leading minus only', () => {
    expect(isNumericCharAllowed('5', '12', 2)).toBe(true)
    expect(isNumericCharAllowed('a', '12', 2)).toBe(false)
    expect(isNumericCharAllowed(',', '12', 2)).toBe(false)
    expect(isNumericCharAllowed('.', '1.5', 3)).toBe(false)
    expect(isNumericCharAllowed('.', '15', 2)).toBe(true)
    expect(isNumericCharAllowed('-', '', 0)).toBe(true)
    expect(isNumericCharAllowed('-', '5', 1)).toBe(false)
    expect(isNumericCharAllowed('-', '5', 0)).toBe(true)
    expect(isNumericCharAllowed('-', '-5', 0)).toBe(false)
    expect(isNumericCharAllowed('-', '', 0, false)).toBe(false)
    expect(isNumericCharAllowed('5', '-3', 0)).toBe(false)
    expect(isNumericCharAllowed('12', '', 0)).toBe(false)
  })
  it('reducer ignores invalid chars silently in a num cell and appends valid ones', () => {
    const st = arriveAt(G, 0, 1)
    expect(run(st, G, 'a').effects).toEqual([{ type: 'IGNORE' }])
    expect(run(st, G, 'a').state.caret).toBe(2)
    expect(run(st, G, '5').effects[0]).toMatchObject({ type: 'INSERT_TEXT', text: '5' })
    expect(run(st, G, '-').effects).toEqual([{ type: 'IGNORE' }]) // not leading
  })
  it('leading minus allowed on an empty num cell unless column forbids', () => {
    expect(run(arriveAt(G, 2, 1), G, '-').effects[0]?.type).toBe('INSERT_TEXT')
    const noNeg: GridShape = { ...G, allowNegative: () => false }
    expect(run(arriveAt(noNeg, 2, 1), noNeg, '-').effects).toEqual([{ type: 'IGNORE' }])
  })
  it('Free num cell: valid char native, invalid ignored, dot twice rejected', () => {
    const st = clickInText(G, 0, 1, 1) // "1|0"
    expect(run(st, G, '5').effects).toEqual([{ type: 'NATIVE' }])
    expect(run(st, G, 'x').effects).toEqual([{ type: 'IGNORE' }])
    const D = shape([['x', '1.5', '']])
    expect(run(clickInText(D, 0, 1, 1), D, '.').effects).toEqual([{ type: 'IGNORE' }])
  })
  it('Free num cell at end edge: Right moves on', () => {
    expect(run(clickInText(G, 0, 1, 2), G, 'ArrowRight').state).toMatchObject({ row: 0, col: 2, mode: 'append' })
  })
})

describe('KB §9.12 range selection', () => {
  it('Shift+Down begins, Shift+Down extends, Shift+Up shrinks, back to anchor ends it', () => {
    let r = run(arriveAt(G, 0, 0), G, K('ArrowDown', { shift: true }))
    expect(r.state.range).toEqual({ anchor: { row: 0, col: 0 }, focus: { row: 1, col: 0 } })
    expect(r.effects).toEqual([{ type: 'EXTEND_RANGE', to: { row: 1, col: 0 } }])
    r = run(r.state, G, K('ArrowDown', { shift: true }))
    expect(r.state.range?.focus).toEqual({ row: 2, col: 0 })
    r = run(r.state, G, K('ArrowUp', { shift: true }))
    expect(r.state.range?.focus).toEqual({ row: 1, col: 0 })
    r = run(r.state, G, K('ArrowUp', { shift: true }))
    expect(r.state.range).toBeNull()
    expect(r.effects).toEqual([{ type: 'COLLAPSE_RANGE' }])
    expect(r.state).toMatchObject({ row: 0, col: 0, mode: 'append' })
  })
  it('Shift+Right at end edge in Append begins a horizontal range', () => {
    const r = run(arriveAt(G, 0, 0), G, K('ArrowRight', { shift: true }))
    expect(r.state.range?.focus).toEqual({ row: 0, col: 1 })
  })
  it('Shift+Left at start edge in Free begins a range left; mid-text it is native selection', () => {
    expect(run(clickInText(G, 0, 1, 0), G, K('ArrowLeft', { shift: true })).state.range?.focus).toEqual({ row: 0, col: 0 })
    expect(run(clickInText(G, 0, 0, 3), G, K('ArrowLeft', { shift: true })).effects).toEqual([{ type: 'NATIVE' }])
  })
  it('Shift+Left on an empty cell begins a range (no trap)', () => {
    expect(run(arriveAt(G, 2, 1), G, K('ArrowLeft', { shift: true })).state.range?.focus).toEqual({ row: 2, col: 0 })
  })
  it('range is clamped at grid edges', () => {
    expect(run(arriveAt(G, 0, 0), G, K('ArrowUp', { shift: true })).effects).toEqual([{ type: 'IGNORE' }])
  })
  it('Delete / Backspace on a range clear it in one effect; arrival is Append', () => {
    let st = run(arriveAt(G, 0, 0), G, K('ArrowDown', { shift: true }), K('ArrowRight', { shift: true })).state
    const r = run(st, G, 'Delete')
    expect(r.effects[0]).toEqual({ type: 'CLEAR_RANGE', from: { row: 0, col: 0 }, to: { row: 1, col: 1 } })
    expect(r.state).toMatchObject({ range: null, mode: 'append', caret: 0, row: 0, col: 0 })
    st = run(arriveAt(G, 1, 0), G, K('ArrowUp', { shift: true })).state
    expect(run(st, G, 'Backspace').effects[0]).toEqual({ type: 'CLEAR_RANGE', from: { row: 0, col: 0 }, to: { row: 1, col: 0 } })
  })
  it('plain arrow collapses the range and moves from the active cell', () => {
    const st = run(arriveAt(G, 0, 0), G, K('ArrowDown', { shift: true })).state
    const r = run(st, G, 'ArrowDown')
    expect(r.state).toMatchObject({ row: 1, col: 0, range: null })
    expect(r.effects[0]).toEqual({ type: 'COLLAPSE_RANGE' })
  })
  it('Esc with a range collapses it (not PAGE_ESCAPE)', () => {
    const st = run(arriveAt(G, 0, 0), G, K('ArrowDown', { shift: true })).state
    const r = run(st, G, 'Escape')
    expect(r.state.range).toBeNull()
    expect(has(r.effects, 'PAGE_ESCAPE')).toBe(false)
  })
  it('copy/cut/paste keep the range and are native', () => {
    const st = run(arriveAt(G, 0, 0), G, K('ArrowDown', { shift: true })).state
    for (const c of ['c', 'x', 'v', 'z']) {
      const r = run(st, G, K(c, { ctrl: true }))
      expect(r.state.range).not.toBeNull()
      expect(r.effects).toEqual([{ type: 'NATIVE' }])
    }
  })
  it('typing with a range collapses it and appends to the active cell', () => {
    const st = run(arriveAt(G, 0, 0), G, K('ArrowDown', { shift: true })).state
    const r = run(st, G, 'q')
    expect(r.state.range).toBeNull()
    expect(r.effects.map((e) => e.type)).toEqual(['COLLAPSE_RANGE', 'INSERT_TEXT'])
  })
})

describe('Ctrl+A', () => {
  it('Append: selects all cells', () => {
    const r = run(arriveAt(G, 0, 0), G, K('a', { ctrl: true }))
    expect(r.state.range).toEqual({ anchor: { row: 0, col: 0 }, focus: { row: 4, col: 2 } })
    expect(r.effects[0]).toMatchObject({ type: 'EXTEND_RANGE', to: { row: 4, col: 2 } })
  })
  it('Free: first selects the text natively, second selects all cells', () => {
    const a = run(clickInText(G, 0, 0, 1), G, K('a', { ctrl: true }))
    expect(a.effects).toEqual([{ type: 'NATIVE' }])
    expect(a.state.textAllSelected).toBe(true)
    expect(run(a.state, G, K('a', { ctrl: true })).state.range).not.toBeNull()
  })
  it('another key between resets the text-select-all step', () => {
    const a = run(clickInText(G, 0, 0, 1), G, K('a', { ctrl: true }), 'ArrowLeft', K('a', { ctrl: true }))
    expect(a.effects).toEqual([{ type: 'NATIVE' }])
  })
})

describe('extras', () => {
  it('unhandled combos are NATIVE (undo, bold, clipboard)', () => {
    for (const c of ['z', 'y', 'b', 'c', 'v']) expect(run(arriveAt(G, 0, 0), G, K(c, { ctrl: true })).effects).toEqual([{ type: 'NATIVE' }])
    expect(run(arriveAt(G, 0, 0), G, K('ArrowDown', { alt: true })).effects).toEqual([{ type: 'NATIVE' }])
    expect(run(arriveAt(G, 0, 0), G, 'F5').effects).toEqual([{ type: 'NATIVE' }])
  })
  it('does not mutate its input state', () => {
    const st = arriveAt(G, 0, 0)
    const copy = JSON.parse(JSON.stringify(st))
    navReduce(st, K('ArrowLeft'), G)
    navReduce(st, K('Tab'), G)
    expect(st).toEqual(copy)
  })
  it('clamps a stale state (rows removed) and an empty grid never throws', () => {
    expect(() => navReduce(createNavState(99, 99), K('Tab'), G)).not.toThrow()
    expect(navReduce(createNavState(), K('a'), { rowCount: 0, colCount: 0, cellText: () => '', cellKind: () => 'text' }).effects).toEqual([{ type: 'IGNORE' }])
  })
  it('syncCaret reconciles the DOM caret so edge detection stays true', () => {
    let st = clickInText(G, 0, 0, 1)
    st = syncCaret(st, 4)
    expect(run(st, G, 'ArrowRight').state).toMatchObject({ row: 0, col: 1 })
  })
  it('word helpers', () => {
    expect(prevWordStart('Tomato red', 10)).toBe(7)
    expect(prevWordStart('Tomato red', 7)).toBe(0)
    expect(nextWordEnd('Tomato red', 0)).toBe(6)
    expect(nextWordEnd('Tomato red', 6)).toBe(10)
  })
  it('Free Ctrl+Right moves by word, then leaves at end', () => {
    let st = clickInText(G, 1, 0, 0)
    st = run(st, G, K('ArrowRight', { ctrl: true })).state
    expect(st.caret).toBe(6)
    st = run(st, G, K('ArrowRight', { ctrl: true })).state
    expect(st.caret).toBe(10)
    expect(run(st, G, K('ArrowRight', { ctrl: true })).state).toMatchObject({ row: 1, col: 1 })
  })
  it('Right in Append on filled cell moves to the next cell', () => {
    expect(run(arriveAt(G, 0, 0), G, 'ArrowRight').state).toMatchObject({ row: 0, col: 1, mode: 'append' })
  })
  it('Right at the very last cell opens a trailing row', () => {
    expect(run(arriveAt(G, 4, 2), G, 'ArrowRight').effects[0]).toEqual({ type: 'ENSURE_ROW', index: 5 })
  })
  it('astral characters count as one printable key', () => {
    expect(run(arriveAt(G, 0, 0), G, '😀').effects[0]?.type).toBe('INSERT_TEXT')
  })
})

describe('Phase 74 - smooth arrows (KB §11)', () => {
  const ON = navOptionsFor(true)
  const OFF = navOptionsFor(false)
  const go = (st: NavState, key: KeyInput, o = ON) => navReduce(st, key, G, o)

  it('OFF is exactly DEFAULT_NAV_OPTIONS and gives identical results to calling with no options', () => {
    expect(OFF).toBe(DEFAULT_NAV_OPTIONS)
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'F2', 'Escape', 'Home', 'End', 'Tab', 'Enter']
    const states = [arriveAt(G, 1, 1), arriveAt(G, 0, 0), clickInText(G, 1, 0, 3), clickInText(G, 1, 0, 0), arriveAt(G, 2, 2)]
    for (const st of states) for (const k of keys) expect(go(st, K(k), OFF)).toEqual(navReduce(st, K(k), G))
  })
  it('ON, not editing: Left jumps to the previous cell at once, Append, caret at end, no arming', () => {
    const r = go(arriveAt(G, 0, 1), K('ArrowLeft'))
    expect(r.state).toMatchObject({ row: 0, col: 0, mode: 'append', caret: 4, leftArmed: false })
    expect(r.effects).toEqual([{ type: 'MOVE', row: 0, col: 0 }])
  })
  it('ON: Left from column 0 goes to the last column of the row above; at the very first cell it does nothing', () => {
    const r = go(arriveAt(G, 1, 0), K('ArrowLeft'))
    expect(r.state).toMatchObject({ row: 0, col: 2, mode: 'append', caret: 1 })
    expect(go(arriveAt(G, 0, 0), K('ArrowLeft')).effects).toEqual([{ type: 'IGNORE' }])
  })
  it('ON, not editing: Right jumps to the next cell with caret at end (same as OFF)', () => {
    const r = go(arriveAt(G, 0, 0), K('ArrowRight'))
    expect(r.state).toMatchObject({ row: 0, col: 1, mode: 'append', caret: 2 })
    expect(r).toEqual(go(arriveAt(G, 0, 0), K('ArrowRight'), OFF))
  })
  it('ON, F2 edit mode: Left / Right move letter by letter', () => {
    const f = go(arriveAt(G, 1, 0), K('F2')).state
    expect(f).toMatchObject({ mode: 'free', caret: 10 })
    const l = go(f, K('ArrowLeft'))
    expect(l.state).toMatchObject({ row: 1, col: 0, mode: 'free', caret: 9 })
    expect(go(l.state, K('ArrowRight')).state).toMatchObject({ row: 1, col: 0, mode: 'free', caret: 10 })
  })
  it('ON, edit mode: Left at the very start jumps to the previous cell (Append, caret at end)', () => {
    const r = go(clickInText(G, 0, 1, 0), K('ArrowLeft'))
    expect(r.state).toMatchObject({ row: 0, col: 0, mode: 'append', caret: 4 })
    expect(r.effects).toEqual([{ type: 'MOVE', row: 0, col: 0 }])
  })
  it('ON, edit mode: Right at the very end jumps to the next cell; mid-text it only moves the caret', () => {
    expect(go(clickInText(G, 0, 0, 4), K('ArrowRight')).state).toMatchObject({ row: 0, col: 1, mode: 'append' })
    expect(go(clickInText(G, 0, 0, 2), K('ArrowRight')).state).toMatchObject({ row: 0, col: 0, mode: 'free', caret: 3 })
  })
  it('OFF, edit mode: Left at the very start does nothing (D-K3) and Append Left only arms (D-K1)', () => {
    expect(go(clickInText(G, 0, 1, 0), K('ArrowLeft'), OFF).effects).toEqual([{ type: 'IGNORE' }])
    expect(go(arriveAt(G, 0, 1), K('ArrowLeft'), OFF).effects).toEqual([{ type: 'SET_ARMED', armed: true }])
  })
  it('ON: Esc / Enter / Tab still leave edit mode (Esc keeps content, Append at end; Enter / Tab move)', () => {
    const f = clickInText(G, 1, 0, 3)
    expect(go(f, K('Escape')).state).toMatchObject({ row: 1, col: 0, mode: 'append', caret: 10 })
    expect(go(f, K('Enter')).state).toMatchObject({ row: 2, col: 0, mode: 'append' })
    expect(go(f, K('Tab')).state).toMatchObject({ row: 1, col: 1, mode: 'append' })
  })
  it('ON: Up / Down, Shift+Left ranges and Ctrl+Left are unchanged from OFF', () => {
    for (const st of [arriveAt(G, 1, 1), clickInText(G, 1, 0, 3)]) {
      for (const k of [K('ArrowUp'), K('ArrowDown'), K('ArrowLeft', { shift: true }), K('ArrowRight', { shift: true }), K('ArrowLeft', { ctrl: true }), K('Home'), K('End')]) {
        expect(go(st, k, ON)).toEqual(go(st, k, OFF))
      }
    }
  })
})

describe('Phase 104 - extra-column Down extends the rows (D-K10)', () => {
  // cols: 0 = name, 1 = rate, 2 = extra column; 3 rows (last row = the bottom-most editable row).
  const X = (rows: number): GridShape => ({ ...shape(Array.from({ length: rows }, () => ['a', '1', 'x'])), isExtraCol: (c) => c === 2 })
  const ON = navOptionsFor(true), OFF = navOptionsFor(false)
  const down = (st: NavState, sh: GridShape, o = ON, m: Partial<KeyInput> = {}) => navReduce(st, K('ArrowDown', m), sh, o)

  for (const [name, o] of [['smooth ON', ON], ['smooth OFF', OFF]] as const) {
    it(`${name}: Down on the last row of an extra column adds a row and moves into it`, () => {
      const sh = X(3)
      const r = down(arriveAt(sh, 2, 2), sh, o)
      expect(r.effects).toEqual([{ type: 'ENSURE_ROW', index: 3 }, { type: 'MOVE', row: 3, col: 2 }])
      expect(r.state).toMatchObject({ row: 3, col: 2, mode: 'append' })
    })
    it(`${name}: Down on a non-extra column at the last row still does nothing`, () => {
      const sh = X(3)
      for (const c of [0, 1]) {
        const r = down(arriveAt(sh, 2, c), sh, o)
        expect(r.effects.some((e) => e.type === 'ENSURE_ROW')).toBe(false)
        expect(r.state).toMatchObject({ row: 2, col: c })
      }
    })
    it(`${name}: Down in the middle of an extra column just moves down`, () => {
      const sh = X(3)
      const r = down(arriveAt(sh, 0, 2), sh, o)
      expect(r.effects.some((e) => e.type === 'ENSURE_ROW')).toBe(false)
      expect(r.state).toMatchObject({ row: 1, col: 2 })
    })
  }
  it('works from Free mode (caret mid-text) too', () => {
    const sh = X(3)
    const st = clickInText(sh, 2, 2, 0)
    expect(down(st, sh).effects[0]).toEqual({ type: 'ENSURE_ROW', index: 3 })
  })
  it('a shape without isExtraCol (no extra columns) never grows', () => {
    const sh = shape([['a', '1', 'x'], ['a', '1', 'x']])
    expect(down(arriveAt(sh, 1, 2), sh).effects.some((e) => e.type === 'ENSURE_ROW')).toBe(false)
  })
  it('Shift+Down, Ctrl+Down and Alt+Down are unchanged at the last row of an extra column', () => {
    const sh = X(3)
    expect(down(arriveAt(sh, 2, 2), sh, ON, { shift: true }).effects.some((e) => e.type === 'ENSURE_ROW')).toBe(false)
    expect(down(arriveAt(sh, 2, 2), sh, ON, { ctrl: true }).effects.some((e) => e.type === 'ENSURE_ROW')).toBe(false)
    expect(down(arriveAt(sh, 2, 2), sh, ON, { alt: true }).effects).toEqual([{ type: 'NATIVE' }])
  })
  it('Up at the first row is still a no-op in an extra column', () => {
    const sh = X(3)
    expect(navReduce(arriveAt(sh, 0, 2), K('ArrowUp'), sh, ON).state).toMatchObject({ row: 0, col: 2 })
  })
})

describe('Phase 119 (D-K12) - a modifier key alone is inert', () => {
  const rangeState = (): NavState => run(arriveAt(G, 0, 1), G, K('ArrowDown', { shift: true }), K('ArrowDown', { shift: true })).state
  for (const mod of ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock']) {
    it(`bare ${mod} changes nothing and keeps the range`, () => {
      const before = rangeState()
      expect(before.range).not.toBeNull()
      const flags = mod === 'Control' ? { ctrl: true } : mod === 'Shift' ? { shift: true } : mod === 'Alt' ? { alt: true } : mod === 'Meta' ? { meta: true } : {}
      const r = navReduce(before, K(mod, flags), G)
      expect(r.state).toEqual(before)
      expect(r.effects).toEqual([{ type: 'IGNORE' }])
    })
  }
  it('Ctrl, then C, then V keep the range alive (copy and paste can use it)', () => {
    let st = rangeState()
    for (const k of [K('Control', { ctrl: true }), K('c', { ctrl: true }), K('v', { ctrl: true })]) {
      const r = navReduce(st, k, G)
      expect(has(r.effects, 'COLLAPSE_RANGE')).toBe(false)
      st = r.state
    }
    expect(st.range).not.toBeNull()
  })
  it('bare modifiers do not change mode or caret in Free mode', () => {
    const free = run(arriveAt(G, 0, 0), G, 'F2').state
    const r = navReduce(free, K('Control', { ctrl: true }), G)
    expect(r.state).toEqual(free)
  })
})
