import { describe, expect, it } from 'vitest'
import { ACTIONS } from '../shortcuts'
import { TOOLBAR_NAMES, TOOLBAR_NAME_MAX, TOOLBAR_NAMES_MIN_WIDTH, toolbarName } from '../toolbarNames'

describe('Phase 147 - toolbar names', () => {
  it('every named button is a real registry action (one source of truth)', () => {
    const ids = new Set(ACTIONS.map((a) => a.id as string))
    for (const id of Object.keys(TOOLBAR_NAMES)) expect(ids.has(id), id).toBe(true)
  })
  it('names are short, non-empty and unique (so the bars cannot wrap or grow)', () => {
    const names = Object.values(TOOLBAR_NAMES)
    for (const n of names) { expect(n.length).toBeGreaterThan(0); expect(n.length).toBeLessThanOrEqual(TOOLBAR_NAME_MAX) }
    expect(new Set(names).size).toBe(names.length)
    expect(toolbarName('bill.save')).toBe('Save')
  })
  it('the breakpoint is a sane desktop width below the 1366 density target', () => {
    expect(TOOLBAR_NAMES_MIN_WIDTH).toBeLessThan(1366)
    expect(TOOLBAR_NAMES_MIN_WIDTH).toBeGreaterThan(900)
  })
})
