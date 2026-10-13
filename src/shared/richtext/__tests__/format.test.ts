import { describe, expect, it } from 'vitest'
import { applyFormat, hasStyle, FORMAT_KINDS } from '../format'
import { applyTextChange, fromPlain, plain, runsEqual } from '../runs'
import type { Runs } from '../../types'

const base = (): Runs => fromPlain('red tomato box')

describe('applyFormat', () => {
  it('Red+Bold on a selected word styles only that word', () => {
    const out = applyFormat(base(), 'redBold', 4, 10)
    expect(out).toEqual([{ t: 'red ' }, { t: 'tomato', b: 1, r: 1 }, { t: ' box' }])
    expect(plain(out)).toBe('red tomato box')
  })
  it('collapsed caret formats the whole cell', () => {
    expect(applyFormat(base(), 'bold', 3, 3)).toEqual([{ t: 'red tomato box', b: 1 }])
    expect(applyFormat(base(), 'redBold', 0, 0)).toEqual([{ t: 'red tomato box', b: 1, r: 1 }])
  })
  it('pressing Red+Bold twice returns to plain', () => {
    const once = applyFormat(base(), 'redBold', 4, 10)
    expect(runsEqual(applyFormat(once, 'redBold', 4, 10), base())).toBe(true)
  })
  it('plain red does not add bold', () => {
    expect(applyFormat(base(), 'red', 0, 3)).toEqual([{ t: 'red', r: 1 }, { t: ' tomato box' }])
  })
  it('highlight always covers the whole cell, whatever the selection', () => {
    expect(applyFormat(base(), 'highlight', 4, 6)).toEqual([{ t: 'red tomato box', hl: 1 }])
    expect(applyFormat(applyFormat(base(), 'highlight', 4, 6), 'highlight', 0, 0)).toEqual(base())
  })
  it('highlight on an empty cell is a no-op', () => { expect(applyFormat([], 'highlight', 0, 0)).toEqual([]) })
  it('clear removes every flag in the range', () => {
    const rich = applyFormat(applyFormat(base(), 'redBold', 0, 14), 'highlight', 0, 0)
    expect(applyFormat(rich, 'clear', 0, 14)).toEqual(base())
    expect(applyFormat(rich, 'clear', 0, 3)).toEqual([{ t: 'red' }, { t: ' tomato box', b: 1, r: 1, hl: 1 }])
  })
  it('formatting survives later edits (typed text, diffed in)', () => {
    const styled = applyFormat(base(), 'redBold', 4, 10) // red [tomato] box
    const edited = applyTextChange(styled, 'red tomato sauce box')
    expect(plain(edited)).toBe('red tomato sauce box')
    expect(edited[0]).toEqual({ t: 'red ' })
    expect(edited[1]).toMatchObject({ b: 1, r: 1 })
  })
  it('hasStyle and the kind list', () => {
    expect(hasStyle(base())).toBe(false)
    expect(hasStyle(applyFormat(base(), 'bold', 0, 1))).toBe(true)
    expect(FORMAT_KINDS).toHaveLength(5)
  })
  it('never mutates its input', () => {
    const r = base(); const snap = JSON.stringify(r)
    for (const k of FORMAT_KINDS) applyFormat(r, k, 1, 5)
    expect(JSON.stringify(r)).toBe(snap)
  })
})
