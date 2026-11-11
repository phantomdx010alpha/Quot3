import { describe, expect, it } from 'vitest'
import { NAV_STACK_MAX, PREVIOUS_PAGE_RULE_DEFAULT, ROUTES, canGoBack, currentPath, initialNav, navBack, navPush } from '../routes'
import { searchActions, fuzzyScore } from '../commandSearch'
import { ACTIONS } from '../shortcuts'

describe('router stack', () => {
  it('starts at the dashboard; unknown initial path falls back', () => {
    expect(currentPath(initialNav())).toBe('/')
    expect(currentPath(initialNav('/nope'))).toBe('/')
    expect(currentPath(initialNav(ROUTES.designPreview))).toBe(ROUTES.designPreview)
  })
  it('Dashboard is the root: every page goes back to it in one step', () => {
    for (const p of [ROUTES.create, ROUTES.history, ROUTES.customers, ROUTES.items, ROUTES.settings, ROUTES.designPreview, ROUTES.devGrid]) {
      const s = navPush(initialNav(), p)
      expect(s.stack).toEqual(['/', p])
      expect(currentPath(navBack(s))).toBe('/')
    }
  })
  it('seeding a non-dashboard page still puts the Dashboard underneath', () => {
    expect(initialNav(ROUTES.settings).stack).toEqual(['/', '/settings'])
  })
  it('hopping between pages never builds a long stack', () => {
    let s = initialNav()
    s = navPush(s, ROUTES.create)
    s = navPush(s, ROUTES.history)
    s = navPush(s, ROUTES.settings)
    expect(s.stack).toEqual(['/', '/settings'])
    expect(currentPath(navBack(s))).toBe('/')
  })
  it('a bill opened from History, Customers or Items returns there, then to the Dashboard', () => {
    for (const from of [ROUTES.history, ROUTES.customers, ROUTES.items]) {
      let s = navPush(initialNav(), from)
      s = navPush(s, ROUTES.create, { returnToCurrent: true })
      expect(s.stack).toEqual(['/', from, '/create'])
      s = navBack(s)
      expect(currentPath(s)).toBe(from)
      s = navBack(s)
      expect(currentPath(s)).toBe('/')
    }
  })
  it('returnToCurrent is ignored from other pages (Create from the side rail, Dashboard)', () => {
    expect(navPush(initialNav(), ROUTES.create, { returnToCurrent: true }).stack).toEqual(['/', '/create'])
    expect(navPush(navPush(initialNav(), ROUTES.settings), ROUTES.create, { returnToCurrent: true }).stack).toEqual(['/', '/create'])
  })
  it('navigating to the Dashboard resets the stack', () => {
    const s = navPush(navPush(navPush(initialNav(), ROUTES.history), ROUTES.create, { returnToCurrent: true }), ROUTES.dashboard)
    expect(s.stack).toEqual(['/'])
    expect(canGoBack(s)).toBe(false)
  })
  it('Esc 20 times from any page ends at the Dashboard and stays', () => {
    const starts = Object.values(ROUTES)
    for (const p of starts) {
      let s = navPush(initialNav(), p)
      if (p === ROUTES.create) s = navPush(navPush(initialNav(), ROUTES.history), p, { returnToCurrent: true })
      for (let i = 0; i < 20; i++) s = navBack(s)
      expect(s.stack).toEqual(['/'])
    }
  })
  it('ignores unknown paths and same-page pushes', () => {
    const s = navPush(initialNav(), ROUTES.create)
    expect(navPush(s, '/nope')).toBe(s)
    expect(navPush(s, ROUTES.create)).toBe(s)
  })
  it('stays within the stack cap', () => {
    let s = initialNav()
    for (let i = 0; i < 40; i++) s = navPush(s, i % 2 ? ROUTES.create : ROUTES.history, { returnToCurrent: true })
    expect(s.stack.length).toBeLessThanOrEqual(NAV_STACK_MAX)
  })
})

describe('previous-page rule (Phase 218, M21-2 [A]; option `keepPrevious`, default OFF)', () => {
  const K = { keepPrevious: true }
  it('is off by default, so every Phase 94 expectation above still holds unchanged', () => {
    expect(PREVIOUS_PAGE_RULE_DEFAULT).toBe(false)
  })
  it('History then Customers gives [dashboard, history, customers]; Esc goes to History, then the Dashboard', () => {
    let s = navPush(initialNav(), ROUTES.history, K)
    s = navPush(s, ROUTES.customers, K)
    expect(s.stack).toEqual(['/', '/history', '/customers'])
    s = navBack(s)
    expect(currentPath(s)).toBe(ROUTES.history)
    s = navBack(s)
    expect(s.stack).toEqual(['/'])
  })
  it('replaces the Phase 94 expectation "history, create, settings -> [/, /settings]": only ONE previous page is kept', () => {
    let s = initialNav()
    s = navPush(s, ROUTES.history, K)
    s = navPush(s, ROUTES.settings, K)
    s = navPush(s, ROUTES.items, K)
    expect(s.stack).toEqual(['/', '/settings', '/items'])
  })
  it('navigating to the previous page pops back to it (no [dashboard, a, b, a] growth)', () => {
    let s = navPush(navPush(initialNav(), ROUTES.history, K), ROUTES.customers, K)
    s = navPush(s, ROUTES.history, K)
    expect(s.stack).toEqual(['/', '/history'])
  })
  it('the Dashboard resets the stack; Esc on the Dashboard does nothing', () => {
    const s = navPush(navPush(navPush(initialNav(), ROUTES.history, K), ROUTES.customers, K), ROUTES.dashboard, K)
    expect(s.stack).toEqual(['/'])
    expect(navBack(s)).toBe(s)
  })
  it('Create is never kept as a previous page and never gets memory underneath it', () => {
    expect(navPush(navPush(initialNav(), ROUTES.create, K), ROUTES.history, K).stack).toEqual(['/', '/history'])
    expect(navPush(navPush(initialNav(), ROUTES.history, K), ROUTES.create, K).stack).toEqual(['/', '/history', '/create'])
  })
  it('the drill-down keeps working: bill from History returns to History, then the Dashboard', () => {
    let s = navPush(navPush(initialNav(), ROUTES.history, K), ROUTES.create, { ...K, returnToCurrent: true })
    expect(s.stack).toEqual(['/', '/history', '/create'])
    s = navBack(s)
    expect(currentPath(s)).toBe(ROUTES.history)
    s = navBack(s)
    expect(s.stack).toEqual(['/'])
  })
  it('from a drill-down bill, going to another page keeps the list underneath; going back to that list pops', () => {
    const bill = navPush(navPush(initialNav(), ROUTES.history, K), ROUTES.create, { ...K, returnToCurrent: true })
    expect(navPush(bill, ROUTES.customers, K).stack).toEqual(['/', '/history', '/customers'])
    expect(navPush(bill, ROUTES.history, K).stack).toEqual(['/', '/history'])
  })
  it('/dev pages are never kept; unknown paths and same-page pushes are no-ops; the cap holds; Esc x20 ends at the Dashboard', () => {
    expect(navPush(navPush(initialNav(), ROUTES.devGrid, K), ROUTES.history, K).stack).toEqual(['/', '/history'])
    const s = navPush(initialNav(), ROUTES.history, K)
    expect(navPush(s, '/nope', K)).toBe(s)
    expect(navPush(s, ROUTES.history, K)).toBe(s)
    let t = initialNav()
    const pages = Object.values(ROUTES)
    for (let i = 0; i < 60; i++) t = navPush(t, pages[(i * 7) % pages.length]!, { keepPrevious: true, returnToCurrent: i % 3 === 0 })
    expect(t.stack.length).toBeLessThanOrEqual(NAV_STACK_MAX)
    expect(t.stack[0]).toBe('/')
    for (let i = 0; i < 20; i++) t = navBack(t)
    expect(t.stack).toEqual(['/'])
  })
})

describe('command search', () => {
  it('finds "Go to History" from partial and fuzzy input', () => {
    expect(searchActions('history', ACTIONS)[0]?.id).toBe('nav.history')
    expect(searchActions('go hist', ACTIONS)[0]?.id).toBe('nav.history')
    expect(searchActions('gthist', ACTIONS)[0]?.id).toBe('nav.history')
  })
  it('empty query returns everything in registry order; nonsense returns nothing', () => {
    expect(searchActions('', ACTIONS).map((a) => a.id)).toEqual(ACTIONS.map((a) => a.id))
    expect(searchActions('zzzzqq', ACTIONS)).toEqual([])
  })
  it('scores prefix above scattered matches', () => {
    expect(fuzzyScore('new', 'New bill')).toBeGreaterThan(fuzzyScore('new', 'Open design preview'))
    expect(fuzzyScore('xyz', 'New bill')).toBe(-1)
  })
})
