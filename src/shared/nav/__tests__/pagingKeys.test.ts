import { describe, expect, it } from 'vitest'
import { ROUTES } from '../../routes'
import { distinctInOrder, firstRowOfParty, historyPartyFocus, pagingBlocked, pagingDir, pagingMode, partyNameKey } from '../pagingKeys'

const base = { path: '/', billStepping: false, historyPartyInFocus: false, itemsSalesWindow: false }
const tgt = (o: Partial<Parameters<typeof pagingBlocked>[0]> = {}) => ({ tag: 'DIV', editable: false, inGrid: false, inOverlay: false, ...o })
const key = (k: string, m: Record<string, boolean> = {}) => ({ key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...m })

describe('Phase 220 pagingMode', () => {
  it('Create: bill mode only with a BillContext; a new bill keeps grid paging', () => {
    expect(pagingMode({ ...base, path: ROUTES.create, billStepping: true })).toBe('bill')
    expect(pagingMode({ ...base, path: ROUTES.create, billStepping: false })).toBeNull()
  })
  it('Customers always pages parties; History only with a party in focus; Items only in the Sales window', () => {
    expect(pagingMode({ ...base, path: ROUTES.customers })).toBe('parties')
    expect(pagingMode({ ...base, path: ROUTES.history })).toBeNull()
    expect(pagingMode({ ...base, path: ROUTES.history, historyPartyInFocus: true })).toBe('parties')
    expect(pagingMode({ ...base, path: ROUTES.items })).toBeNull()
    expect(pagingMode({ ...base, path: ROUTES.items, itemsSalesWindow: true })).toBe('parties')
  })
  it('other screens keep normal paging', () => {
    expect(pagingMode({ ...base, path: ROUTES.dashboard })).toBeNull()
    expect(pagingMode({ ...base, path: ROUTES.settings, billStepping: true, historyPartyInFocus: true, itemsSalesWindow: true })).toBeNull()
  })
})

describe('Phase 220 pagingBlocked / pagingDir', () => {
  it('blocks inputs, selects, textareas, editable non-grid, and any overlay', () => {
    for (const tag of ['INPUT', 'textarea', 'Select']) expect(pagingBlocked(tgt({ tag }))).toBe(true)
    expect(pagingBlocked(tgt({ editable: true }))).toBe(true)
    expect(pagingBlocked(tgt({ inOverlay: true }))).toBe(true)
    expect(pagingBlocked(tgt({ inGrid: true, inOverlay: true, tag: 'INPUT' }))).toBe(true)
  })
  it('does not block the page body, a list, or the grid', () => {
    expect(pagingBlocked(tgt())).toBe(false)
    expect(pagingBlocked(tgt({ tag: 'LI' }))).toBe(false)
    expect(pagingBlocked(tgt({ inGrid: true, editable: true, tag: 'INPUT' }))).toBe(false)
  })
  it('only the plain keys step', () => {
    expect(pagingDir(key('PageUp'))).toBe('prev')
    expect(pagingDir(key('PageDown'))).toBe('next')
    expect(pagingDir(key('PageDown', { ctrlKey: true }))).toBeNull()
    expect(pagingDir(key('PageUp', { shiftKey: true }))).toBeNull()
    expect(pagingDir(key('PageUp', { altKey: true }))).toBeNull()
    expect(pagingDir(key('a'))).toBeNull()
  })
})

describe('Phase 220 historyPartyFocus / helpers', () => {
  const cs = [{ id: 'c1', name: 'Sharma Traders' }, { id: 'c2', name: 'Verma' }, { id: 'c3', name: 'verma ' }]
  it('exact normalised name gives the customer id', () => {
    expect(historyPartyFocus('  sharma   traders ', cs)).toBe('c1')
  })
  it('empty, partial, unknown and duplicate names give null', () => {
    expect(historyPartyFocus('', cs)).toBeNull()
    expect(historyPartyFocus('   ', cs)).toBeNull()
    expect(historyPartyFocus('Sharma', cs)).toBeNull()
    expect(historyPartyFocus('Nobody', cs)).toBeNull()
    expect(historyPartyFocus('Verma', cs)).toBeNull() // two customers share the normalised name
  })
  it('partyNameKey, distinctInOrder, firstRowOfParty', () => {
    expect(partyNameKey('  A   B ')).toBe('a b')
    expect(distinctInOrder(['a', 'b', 'a', null, undefined, '', 'c', 'b'])).toEqual(['a', 'b', 'c'])
    expect(firstRowOfParty(['a', 'a', 'b', 'a'], 'b')).toBe(2)
    expect(firstRowOfParty(['a'], 'z')).toBe(-1)
  })
})
