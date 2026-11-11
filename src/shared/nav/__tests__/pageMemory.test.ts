import { describe, expect, it } from 'vitest'
import { ROUTES } from '../../routes'
import {
  MAX_PARTY_RECORDS, canRemember, emptyMemory, emptyMemoryMap, getMemory, memoryKey, restoreSelection, sanitize, saveMemory
} from '../pageMemory'

const hist = () => ({ ...emptyMemory(ROUTES.history, undefined, 5), scroll: { dates: 120, bills: 900 }, selection: { kind: 'bill' as const, id: 'b7', orderHint: 3 }, filters: { search: 'abc', source: 'all', trash: false }, panels: { revisions: true } })

describe('save / get', () => {
  it('stores one record per route path and returns a new map', () => {
    const m0 = emptyMemoryMap()
    const m1 = saveMemory(m0, hist(), 10)
    expect(m0.records).toEqual({})
    expect(getMemory(m1, ROUTES.history)?.scroll).toEqual({ dates: 120, bills: 900 })
    expect(getMemory(m1, ROUTES.history)?.savedAt).toBe(10)
    const m2 = saveMemory(m1, { ...hist(), scroll: { dates: 1, bills: 2 } }, 11)
    expect(Object.keys(m2.records)).toEqual([ROUTES.history])
    expect(getMemory(m2, ROUTES.history)?.scroll.bills).toBe(2)
  })
  it('Create and the Dashboard store nothing', () => {
    const m = emptyMemoryMap()
    expect(saveMemory(m, { ...hist(), path: ROUTES.create })).toBe(m)
    expect(saveMemory(m, { ...hist(), path: ROUTES.dashboard })).toBe(m)
    expect(canRemember(ROUTES.create)).toBe(false)
    expect(getMemory(saveMemory(m, hist()), ROUTES.create)).toBeUndefined()
  })
  it('keeps one record per party on paging pages, keyed by page + party ID', () => {
    let m = emptyMemoryMap()
    m = saveMemory(m, emptyMemory(ROUTES.history, 'p1'), 1)
    m = saveMemory(m, emptyMemory(ROUTES.history, 'p2'), 2)
    m = saveMemory(m, emptyMemory(ROUTES.history), 3)
    expect(Object.keys(m.records).sort()).toEqual([memoryKey(ROUTES.history), memoryKey(ROUTES.history, 'p1'), memoryKey(ROUTES.history, 'p2')].sort())
    expect(getMemory(m, ROUTES.history, 'p2')?.partyId).toBe('p2')
  })
  it('caps party records and drops the oldest', () => {
    let m = emptyMemoryMap()
    for (let i = 0; i < MAX_PARTY_RECORDS + 5; i++) m = saveMemory(m, emptyMemory(ROUTES.customers, `p${i}`), i)
    expect(Object.keys(m.records).length).toBe(MAX_PARTY_RECORDS)
    expect(getMemory(m, ROUTES.customers, 'p0')).toBeUndefined()
    expect(getMemory(m, ROUTES.customers, `p${MAX_PARTY_RECORDS + 4}`)).toBeDefined()
  })
})

describe('sanitize', () => {
  it('drops unknown fields and bad values', () => {
    const m = sanitize({ path: ROUTES.items, savedAt: 3, billContent: { total: 99 }, scroll: { a: 5, b: -1, c: 'x', d: NaN }, filters: { q: 'x', bad: {}, n: 2 }, panels: { open: true, bad: 3 }, selection: { kind: 'bill', id: 'b1', extra: 1 }, junk: 1 })
    expect(m).toEqual({ path: ROUTES.items, savedAt: 3, scroll: { a: 5 }, filters: { q: 'x', n: 2 }, panels: { open: true }, selection: { kind: 'bill', id: 'b1' } })
    expect(m).not.toHaveProperty('billContent')
  })
  it('rejects unusable input, Create and a bad selection kind', () => {
    expect(sanitize(null)).toBeNull()
    expect(sanitize({ path: 5 })).toBeNull()
    expect(sanitize({ path: ROUTES.create })).toBeNull()
    expect(sanitize({ path: ROUTES.history, selection: { kind: 'row', id: '3' } })?.selection).toBeUndefined()
  })
  it('limits long filter text', () => {
    expect((sanitize({ path: ROUTES.history, filters: { q: 'x'.repeat(5000) } })!.filters.q as string).length).toBe(200)
  })
})

describe('restoreSelection', () => {
  const ids = ['a', 'b', 'c', 'd']
  it('finds the remembered ID, wherever it is now (IDs not indexes)', () => {
    expect(restoreSelection(['d', 'c', 'b', 'a'], { kind: 'bill', id: 'b', orderHint: 1 })).toEqual({ id: 'b', found: true })
  })
  it('remembered item deleted: nearest neighbour by the order hint, clamped', () => {
    expect(restoreSelection(['a', 'c', 'd'], { kind: 'bill', id: 'b', orderHint: 1 })).toEqual({ id: 'c', found: false })
    expect(restoreSelection(['a', 'c'], { kind: 'bill', id: 'z', orderHint: 9 })).toEqual({ id: 'c', found: false })
  })
  it('no hint or no memory: first item; empty list: null, never throws', () => {
    expect(restoreSelection(ids, { kind: 'bill', id: 'zz' })).toEqual({ id: 'a', found: false })
    expect(restoreSelection(ids, undefined)).toEqual({ id: 'a', found: false })
    expect(restoreSelection([], { kind: 'bill', id: 'a' })).toEqual({ id: null, found: false })
  })
})
