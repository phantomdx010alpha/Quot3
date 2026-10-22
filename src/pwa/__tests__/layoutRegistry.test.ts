import { describe, expect, it } from 'vitest'
import { SETTING_DEFAULTS } from '../data/settingsRepo'
import { builtLayoutIds, DEFAULT_LAYOUT, isLayoutId, LAYOUT_BLURBS, LAYOUT_IDS, LAYOUT_LABELS, LAYOUTS, layoutHasRoute, planLayoutChange, resolveLayout } from '../ui/layouts/layoutRegistry'

// Phase 189 - the layout registry is pure; the chooser lists exactly the built ones (classic, plus tidy since Phase 192).
describe('layout registry', () => {
  it('has the four ids, classic is the default and the setting default', () => {
    expect([...LAYOUT_IDS]).toEqual(['classic', 'tidy', 'guided', 'inbox'])
    expect(DEFAULT_LAYOUT).toBe('classic')
    expect(SETTING_DEFAULTS['ui.layout']).toBe('classic')
    for (const id of LAYOUT_IDS) { expect(LAYOUT_LABELS[id]).toBeTruthy(); expect(LAYOUT_BLURBS[id]).toBeTruthy() }
    expect(LAYOUT_BLURBS.classic).toMatch(/today/i)
  })
  it('isLayoutId accepts only the four ids', () => {
    for (const id of LAYOUT_IDS) expect(isLayoutId(id)).toBe(true)
    for (const bad of ['', 'Classic', 'wide', null, undefined, 3, {}]) expect(isLayoutId(bad)).toBe(false)
  })
  it('all four layouts are built, so the chooser offers them all', () => {
    expect(builtLayoutIds()).toEqual(['classic', 'tidy', 'guided', 'inbox'])
    expect(LAYOUTS.inbox?.id).toBe('inbox')
    expect(LAYOUTS.guided?.id).toBe('guided')
    expect(LAYOUTS.tidy?.id).toBe('tidy')
    expect(LAYOUTS.classic).toEqual({ id: 'classic' })
  })
  it('an unknown or not-yet-built stored value is classic', () => {
    for (const v of ['nope', undefined, null, 7, 'wide']) expect(resolveLayout(v)).toBe('classic')
    expect(resolveLayout('classic')).toBe('classic')
    expect(resolveLayout('tidy')).toBe('tidy')
    expect(resolveLayout('guided')).toBe('guided')
  })
  it('classic has every page; planLayoutChange decides none / hold / apply and never touches data', () => {
    expect(layoutHasRoute('classic', 'billview')).toBe(true)
    expect(layoutHasRoute('tidy', 'billview')).toBe(true)
    expect(layoutHasRoute('tidy', 'settings')).toBe(true) // the classic page inside the tidy shell
    expect(layoutHasRoute('guided', 'billview')).toBe(true)
    expect(layoutHasRoute('inbox', 'billview')).toBe(true)
    expect(layoutHasRoute('inbox', 'history')).toBe(true) // the same bills list
    expect(planLayoutChange({ current: 'classic', next: 'classic', hasUnsaved: false, route: 'home' }).action).toBe('none')
    expect(planLayoutChange({ current: 'classic', next: 'unknown', hasUnsaved: true, route: 'home' }).action).toBe('none')
  })
})
