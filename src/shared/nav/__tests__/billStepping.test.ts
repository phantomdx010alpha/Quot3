import { describe, expect, it } from 'vitest'
import { makeBillContext, stepBill, withCurrentBill } from '../billStepping'

const L = ['b1', 'b2', 'b3', 'b4', 'b5']

describe('stepBill', () => {
  it('steps by ID in the given order', () => {
    expect(stepBill(L, 'b2', 'next')).toEqual({ id: 'b3', atEnd: false })
    expect(stepBill(L, 'b2', 'prev')).toEqual({ id: 'b1', atEnd: false })
  })
  it('does not wrap: first and last are ends', () => {
    expect(stepBill(L, 'b1', 'prev')).toEqual({ id: 'b1', atEnd: true })
    expect(stepBill(L, 'b5', 'next')).toEqual({ id: 'b5', atEnd: true })
  })
  it('empty list and one-item list are safe', () => {
    expect(stepBill([], 'b1', 'next')).toEqual({ id: null, atEnd: true })
    expect(stepBill(['b1'], 'b1', 'next')).toEqual({ id: 'b1', atEnd: true })
    expect(stepBill(['b1'], 'b1', 'prev')).toEqual({ id: 'b1', atEnd: true })
  })
  it('skips missing (deleted / trashed) IDs', () => {
    const missing = new Set(['b3'])
    expect(stepBill(L, 'b2', 'next', { missing })).toEqual({ id: 'b4', atEnd: false })
    expect(stepBill(L, 'b4', 'prev', { missing })).toEqual({ id: 'b2', atEnd: false })
    expect(stepBill(L, 'b4', 'next', { missing: new Set(['b5']) })).toEqual({ id: 'b4', atEnd: true })
  })
  it('current gone: steps from its old position, nearest otherwise', () => {
    const missing = new Set(['b3'])
    expect(stepBill(L, 'b3', 'next', { missing })).toEqual({ id: 'b4', atEnd: false })
    expect(stepBill(L, 'b3', 'prev', { missing })).toEqual({ id: 'b2', atEnd: false })
    expect(stepBill(L, 'b5', 'next', { missing: new Set(['b5']) })).toEqual({ id: 'b4', atEnd: true })
    expect(stepBill(L, 'zz', 'next')).toEqual({ id: 'b1', atEnd: false })
    expect(stepBill(L, 'zz', 'prev')).toEqual({ id: 'b5', atEnd: false })
  })
  it('every ID missing gives null', () => {
    expect(stepBill(['a', 'b'], 'a', 'next', { missing: new Set(['a', 'b']) })).toEqual({ id: null, atEnd: true })
  })
  it('a filtered list steps only through that list; duplicates keep first position', () => {
    expect(stepBill(['b2', 'b4'], 'b2', 'next')).toEqual({ id: 'b4', atEnd: false })
    expect(stepBill(['b1', 'b2', 'b1', 'b3'], 'b2', 'next')).toEqual({ id: 'b3', atEnd: false })
  })
  it('a walk of PageDown x4 then PageUp x4 returns to the start (IDs, not indexes)', () => {
    let id = 'b1'
    for (let i = 0; i < 4; i++) id = stepBill(L, id, 'next').id!
    expect(id).toBe('b5')
    for (let i = 0; i < 4; i++) id = stepBill(L, id, 'prev').id!
    expect(id).toBe('b1')
  })
})

describe('BillContext', () => {
  it('holds IDs only and can move the current bill', () => {
    const c = makeBillContext('/history', ['b1', '', 'b2'], 'b1')
    expect(c).toEqual({ sourcePath: '/history', orderedBillIds: ['b1', 'b2'], currentId: 'b1' })
    expect(withCurrentBill(c, 'b2').currentId).toBe('b2')
    expect(withCurrentBill(c, 'b1')).toBe(c)
  })
})
