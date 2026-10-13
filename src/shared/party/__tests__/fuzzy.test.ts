import { describe, expect, it } from 'vitest'
import { createPartyIndex } from '../fuzzy'
import { findPartyByName, isNewParty, normalizePartyName, partyToSnapshot, type PartyLite } from '../partyLite'
import { SAMPLE_PARTIES } from '../sampleParties'

const parties: PartyLite[] = SAMPLE_PARTIES.map((p, i) => ({ id: `p${String(i).padStart(2, '0')}`, ...p }))
const idx = createPartyIndex(parties)
const names = (q: string, limit?: number): string[] => idx.search(q, limit).map((p) => p.name)

describe('normalizePartyName / isNewParty', () => {
  it('trims, collapses whitespace, lower-cases, NFC-normalises', () => {
    expect(normalizePartyName('  Ruby   TRADERS \n')).toBe('ruby traders')
    expect(normalizePartyName('Cafe\u0301')).toBe(normalizePartyName('Caf\u00e9'))
    expect(normalizePartyName('   ')).toBe('')
  })
  it('a typed name that matches no saved party is new (case / spacing do not matter)', () => {
    expect(isNewParty('Brand New Traders', parties)).toBe(true)
    expect(isNewParty('  brand   new traders ', parties)).toBe(true)
    expect(isNewParty('ruby traders', parties)).toBe(false)
    expect(isNewParty('  RUBY   Traders  ', parties)).toBe(false)
  })
  it('blank names are never a new party; a near-miss ("Ruby Trader") IS new', () => {
    expect(isNewParty('', parties)).toBe(false)
    expect(isNewParty('   ', parties)).toBe(false)
    expect(isNewParty('Ruby Trader', parties)).toBe(true)
    expect(isNewParty('Anyone', [])).toBe(true)
  })
  it('findPartyByName returns the saved party; snapshot copies the four fields', () => {
    const p = findPartyByName(parties, 'ruby TRADERS')
    expect(p?.id).toBe(parties.find((x) => x.name === 'Ruby Traders')?.id)
    expect(findPartyByName(parties, '')).toBeUndefined()
    expect(partyToSnapshot(p!)).toEqual({ name: p!.name, phone: p!.phone, address: p!.address, transport: p!.transport })
  })
})

describe('createPartyIndex.search', () => {
  it('seed data has 30 distinct parties', () => {
    expect(parties).toHaveLength(30)
    expect(new Set(parties.map((p) => normalizePartyName(p.name))).size).toBe(30)
  })
  it('empty / whitespace query → nothing; limit respected', () => {
    expect(names('')).toEqual([])
    expect(names('   ')).toEqual([])
    expect(names('a', 3).length).toBeLessThanOrEqual(3)
    expect(names('a', 0)).toEqual([])
  })
  it('exact name first, whatever the case', () => {
    expect(names('ruby traders')[0]).toBe('Ruby Traders')
    expect(names('RUBY')[0]).toBe('Ruby Traders')
  })
  it('prefix and partial words', () => {
    expect(names('gan')).toEqual(expect.arrayContaining(['Ganesh Fabrics', 'Sri Ganesha Sarees']))
    expect(names('gan')[0]).toBe('Ganesh Fabrics') // name-prefix beats word-prefix
    expect(names('tomat')[0]).toBe('Tomato Garments')
    expect(names('textile')).toEqual(expect.arrayContaining(['Balaji Textile Mart', 'Sri Lakshmi Textiles']))
  })
  it('typos still find the party', () => {
    expect(names('Rubi Traders')[0]).toBe('Ruby Traders')
    expect(names('tomatoo garments')[0]).toBe('Tomato Garments')
    expect(names('Ganesh Fabrcs')[0]).toBe('Ganesh Fabrics')
    expect(names('venkateshwra')).toContain('Venkateshwara Silks')
  })
  it('"Lakshmi Cloth" variants are all offered, exact-ish ones first', () => {
    const r = names('Lakshmi Cloth')
    expect(r.slice(0, 2)).toEqual(['Lakshmi Cloth Stores', 'Lakshmi Clothing Co'])
    expect(r).toEqual(expect.arrayContaining(['Laxmi Cloth House']))
    expect(names('Laxmi Cloth')).toEqual(expect.arrayContaining(['Lakshmi Cloth Stores', 'Laxmi Cloth House']))
    expect(names('Laxmi Cloth')[0]).toBe('Laxmi Cloth House')
  })
  it('phone digits (with spaces, dashes, +) match by substring; prefix first', () => {
    expect(names('98450 11002')).toEqual(['Laxmi Cloth House'])
    expect(names('9845011003')).toEqual(['Sri Lakshmi Textiles'])
    expect(names('984-501')).toHaveLength(4)
    expect(names('77004')).toEqual(['Hindustan Uniforms'])
    expect(names('+98450')).toHaveLength(4)
    expect(names('98450')[0]).toBe('Lakshmi Cloth Stores') // all four share the prefix → name A–Z tiebreak
  })
  it('two digits are NOT a phone search (too short) and do not match every number', () => {
    expect(names('98')).toEqual([])
  })
  it('gibberish finds nothing; results are deterministic across calls and index rebuilds', () => {
    expect(names('zzqxj')).toEqual([])
    expect(names('lakshmi')).toEqual(createPartyIndex(parties).search('lakshmi').map((p) => p.name))
  })
  it('blank phone never matches a phone query; duplicates in names order by name then id', () => {
    const idx2 = createPartyIndex([
      { id: 'b', name: 'Same Name', phone: '', address: '', transport: '' },
      { id: 'a', name: 'Same Name', phone: '', address: '', transport: '' }
    ])
    expect(idx2.search('same').map((p) => p.id)).toEqual(['a', 'b'])
    expect(idx2.search('12345')).toEqual([])
  })
  it('empty index is safe', () => {
    expect(createPartyIndex([]).search('x')).toEqual([])
  })
})
