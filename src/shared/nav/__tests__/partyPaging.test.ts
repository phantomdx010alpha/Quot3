import { describe, expect, it } from 'vitest'
import { nextParty } from '../partyPaging'

const P = ['p1', 'p2', 'p3']

describe('nextParty', () => {
  it('moves one party in the order on screen', () => {
    expect(nextParty(P, 'p2', 'next')).toEqual({ id: 'p3', atEnd: false })
    expect(nextParty(P, 'p2', 'prev')).toEqual({ id: 'p1', atEnd: false })
  })
  it('first and last: no wrap, end marker', () => {
    expect(nextParty(P, 'p1', 'prev')).toEqual({ id: 'p1', atEnd: true })
    expect(nextParty(P, 'p3', 'next')).toEqual({ id: 'p3', atEnd: true })
  })
  it('one party and empty list', () => {
    expect(nextParty(['p1'], 'p1', 'next')).toEqual({ id: 'p1', atEnd: true })
    expect(nextParty([], 'p1', 'prev')).toEqual({ id: null, atEnd: true })
    expect(nextParty([], null, 'next')).toEqual({ id: null, atEnd: true })
  })
  it('current party missing from the list: nearest, no throw', () => {
    expect(nextParty(P, 'gone', 'next')).toEqual({ id: 'p1', atEnd: false })
    expect(nextParty(P, null, 'prev')).toEqual({ id: 'p3', atEnd: false })
    expect(nextParty(P, 'p2', 'next', { missing: new Set(['p2']) })).toEqual({ id: 'p3', atEnd: false })
  })
  it('filtered list: only the shown parties are visited', () => {
    expect(nextParty(['p1', 'p3'], 'p1', 'next')).toEqual({ id: 'p3', atEnd: false })
  })
})
