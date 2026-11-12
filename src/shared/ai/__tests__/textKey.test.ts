import { describe, expect, it } from 'vitest'
import { distinctTextKeys, hashText, textKey } from '../textKey'

describe('textKey', () => {
  it('spelling noise (case, separators, notes) gives one key', () => {
    const a = textKey('Talco 2044 (red)')
    const b = textKey('TALCO-2044')
    expect(a).not.toBeNull()
    expect(a!.hash).toBe(b!.hash)
    expect(a!.text).toBe('talco 2044')
  })
  it('different protected tokens give different keys', () => {
    expect(textKey('Hinge 505')!.hash).not.toBe(textKey('Hinge D7')!.hash)
  })
  it('empty, note-only and non-goods lines have no key', () => {
    expect(textKey('')).toBeNull()
    expect(textKey('(note only)')).toBeNull()
    expect(textKey('Coolie')).toBeNull()
    expect(textKey('GST 18%')).toBeNull()
  })
  it('hash is stable and distinct names do not collide in a sample', () => {
    expect(hashText('abc')).toBe(hashText('abc'))
    const set = new Set<string>()
    for (let i = 0; i < 5000; i++) set.add(hashText(`item ${i} size ${i * 7}`))
    expect(set.size).toBe(5000)
  })
  it('distinctTextKeys dedupes by hash, keeps first-seen order', () => {
    const k = distinctTextKeys(['Bolt 10', 'BOLT-10', 'Nut 5', '', 'Coolie'])
    expect(k.map((x) => x.text)).toEqual(['bolt 10', 'nut 5'])
  })
})
