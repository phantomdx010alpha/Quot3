import { describe, expect, it } from 'vitest'
import { analyseEdit, autoTypoFix, buildVocabulary, isBrandToken, isSafeAutoEdit, typoCandidates } from '../vocabulary'
import { groupItems, soldAtLeast, type ItemRuleInput, type ItemSpelling } from '../grouping'
import { normaliseItem } from '../normalise'

const sp = (name: string, count = 1, lastUsed?: string): ItemSpelling => ({ name, count, ...(lastUsed ? { lastUsed } : {}) })
const idOf = (name: string): string => normaliseItem(name).key
const rule = (r: Partial<ItemRuleInput> & Pick<ItemRuleInput, 'id' | 'kind' | 'keyA'>): ItemRuleInput => ({ updatedAt: '2026-10-11T10:00:00Z', ...r })

/** Invented vocabulary: common words with enough uses for the automatic rule (>= 30), as one-word product names. */
const COMMON = [['JUPITER', 40], ['GRIPPER', 50], ['BUTTON', 60], ['SHAKTI', 35], ['OVERLOCK', 45], ['SCISSOR', 33], ['CHALLENGE', 31], ['SEAM', 40], ['STICKER', 40], ['PERL', 40], ['JACK', 60], ['GERMAN', 40], ['SHAPES', 40]] as const
const base = (): ItemSpelling[] => COMMON.map(([n, c]) => sp(n, c))

describe('Phase 108 - edit analysis', () => {
  it('classifies single edits', () => {
    expect(analyseEdit('GRIPER', 'GRIPPER')?.kind).toBe('repeat')
    expect(analyseEdit('BUTTTON', 'BUTTON')?.kind).toBe('repeat')
    expect(analyseEdit('SHAKKTI', 'SHAKTI')?.kind).toBe('repeat')
    expect(analyseEdit('JUPITOR', 'JUPITER')?.kind).toBe('vowel-sub')
    expect(analyseEdit('BUTTOM', 'BUTTON')?.kind).toBe('consonant-sub')
    expect(analyseEdit('STRIKER', 'STICKER')?.kind).toBe('two-edits')
    expect(analyseEdit('BUTOTN', 'BUTTON')?.kind).toBe('transpose')
    expect(analyseEdit('OERLOCK', 'OVERLOCK')?.kind).toBe('insert-delete')
    expect(analyseEdit('SHAPE', 'SHAPES')?.atEnd).toBe(true)
    expect(analyseEdit('ABCDEFG', 'ABCDEFG')).toBeNull()
    expect(analyseEdit('ABCDEFG', 'XYZDEFG')).toBeNull()
  })
  it('the safe-edit whitelist has length floors and refuses edits at the end', () => {
    expect(isSafeAutoEdit(analyseEdit('STEAM', 'SEAM')!, 4)).toBe(false)
    expect(isSafeAutoEdit(analyseEdit('GRIPER', 'GRIPPER')!, 6)).toBe(true)
    expect(isSafeAutoEdit(analyseEdit('GERMANY', 'GERMAN')!, 6)).toBe(false)
  })
})

describe('Phase 108 - vocabulary and typo candidates', () => {
  const v = buildVocabulary([...base(), sp('ARIHANT GRIPPER WHITE', 10), sp('GRIPER', 1), sp('FANCY BUTTON 12', 3), sp('GST EXTRA 18%', 9)])
  it('counts lines per word, once per spelling, and skips non-items and protected tokens', () => {
    expect(v.get('GRIPPER')?.uses).toBe(60)
    expect(v.has('GST')).toBe(false)
    expect(v.has('12')).toBe(false)
    expect(v.get('ARIHANT')).toEqual({ uses: 10, first: 10 })
  })
  it.each([['JUPITOR', 'JUPITER'], ['GRIPER', 'GRIPPER'], ['BUTTTON', 'BUTTON'], ['SHAKKTI', 'SHAKTI'], ['OERLOCK', 'OVERLOCK'], ['SCISOOR', 'SCISSOR'], ['CHALLANGE', 'CHALLENGE']])('%s is fixed automatically to %s', (typo, target) => {
    const vv = buildVocabulary([...base(), sp(typo, 1)])
    expect(autoTypoFix(vv, typo)?.target).toBe(target)
  })
  it.each([['STEAM', 'SEAM'], ['STRIKER', 'STICKER'], ['PERAL', 'PERL'], ['JACKO', 'JACK'], ['GERMANY', 'GERMAN'], ['SHAPE', 'SHAPES']])('%s -> %s is NEVER automatic (but may be a suggestion)', (wrong, right) => {
    const vv = buildVocabulary([...base(), sp(wrong, 1)])
    expect(autoTypoFix(vv, wrong)).toBeNull()
    expect(typoCandidates(vv, wrong).some((c) => c.target === right && !c.auto)).toBe(true)
  })
  it('a word used more than twice, or a target under 30 uses, is not fixed automatically', () => {
    expect(autoTypoFix(buildVocabulary([...base(), sp('GRIPER', 3)]), 'GRIPER')).toBeNull()
    expect(autoTypoFix(buildVocabulary([sp('GRIPPER', 29), sp('GRIPER', 1)]), 'GRIPER')).toBeNull()
  })
  it('a habitual typo (up to 10 uses) is fixed only when the target is 30x as common', () => {
    expect(autoTypoFix(buildVocabulary([sp('GRIPPER', 150), sp('GRIPER', 5)]), 'GRIPER')?.target).toBe('GRIPPER')
    expect(autoTypoFix(buildVocabulary([sp('GRIPPER', 100), sp('GRIPER', 5)]), 'GRIPER')).toBeNull()
    expect(autoTypoFix(buildVocabulary([sp('GRIPPER', 900), sp('GRIPER', 11)]), 'GRIPER')).toBeNull()
  })
  it('needs a 10x ratio and an unambiguous target', () => {
    expect(typoCandidates(buildVocabulary([sp('GRIPPER', 5), sp('GRIPER', 1)]), 'GRIPER')).toEqual([])
    const amb = buildVocabulary([sp('GRIPPER', 40), sp('GRIPLER', 40), sp('GRIPER', 1)])
    expect(typoCandidates(amb, 'GRIPER').length).toBe(2)
    expect(autoTypoFix(amb, 'GRIPER')).toBeNull()
  })
  it('never touches protected tokens, short words or non-words', () => {
    const vv = buildVocabulary([sp('ZIP 505', 60), sp('ZIP 506', 1)])
    expect(typoCandidates(vv, '506')).toEqual([])
    expect(typoCandidates(vv, 'ZIP')).toEqual([])
  })
  it('brand = frequent and almost always the first word', () => {
    expect(isBrandToken(v, 'ARIHANT')).toBe(true)
    expect(isBrandToken(v, 'WHITE')).toBe(false)
    expect(isBrandToken(v, 'GRIPPER')).toBe(false) // frequent, but never the first word of a longer name
    expect(isBrandToken(v, 'BUTTON')).toBe(false)
  })
})

describe('Phase 108 - groups (Auto tier)', () => {
  it('same words in any order / case / spacing are one group, with a why per spelling', () => {
    const r = groupItems([sp('TALCO 2044', 5, '2026-01-02'), sp('2044 talco', 2, '2026-03-01'), sp('Talco  2044 (urgent)', 1)])
    expect(r.groups).toHaveLength(1)
    const g = r.groups[0]!
    expect(g.id).toBe(idOf('TALCO 2044'))
    expect(g.display).toBe('TALCO 2044')
    expect(g.count).toBe(8)
    expect(g.lastUsed).toBe('2026-03-01')
    expect(g.spellings.map((s) => s.why.rule)).toEqual(['most-used', 'same-key', 'same-key'])
    expect(g.spellings[2]!.note).toBe('URGENT')
  })
  it('the same typed name from many bills is counted once per name, summed', () => {
    const r = groupItems([sp('ZIP', 2), sp(' ZIP ', 3)])
    expect(r.groups[0]!.count).toBe(5)
    expect(r.groups[0]!.spellings).toHaveLength(1)
  })
  it('a rare typo is merged into its common word and says why', () => {
    const r = groupItems([...base(), sp('GRIPER', 1), sp('JUPITOR', 2)])
    const g = r.groups.find((x) => x.id === 'GRIPPER')!
    expect(g.count).toBe(51)
    const t = g.spellings.find((s) => s.name === 'GRIPER')!
    expect(t.why.rule).toBe('typo-auto')
    expect(t.why.text).toContain('GRIPER -> GRIPPER')
    expect(r.groups.find((x) => x.id === 'JUPITER')!.count).toBe(42)
  })
  it('the six false matches stay in separate groups', () => {
    const r = groupItems([...base(), sp('STEAM'), sp('STRIKER'), sp('PERAL'), sp('JACKO'), sp('GERMANY'), sp('SHAPE')])
    for (const w of ['STEAM', 'STRIKER', 'PERAL', 'JACKO', 'GERMANY', 'SHAPE']) {
      const g = r.groups.find((x) => x.id === w)!
      expect(g, w).toBeDefined()
      expect(g.spellings).toHaveLength(1)
    }
  })
  it('sizes and codes are never merged, never typo-fixed', () => {
    const r = groupItems([sp('ARIHANT 32X50', 30), sp('ARIHANT 25X50', 1), sp('MILTON 505', 30), sp('MILTON D7', 1), sp('arihant 32 x 50', 2)])
    expect(r.groups.map((g) => g.id).sort()).toEqual(['25X50 ARIHANT', '32X50 ARIHANT', '505 MILTON', 'D7 MILTON'])
    expect(r.groups.find((g) => g.id === '32X50 ARIHANT')!.count).toBe(32)
  })
  it('non-product lines are listed under notItems, not grouped', () => {
    const r = groupItems([sp('ZIP', 3), sp('GST EXTRA - 18%', 4), sp('LESS - PAYMENT', 2), sp('', 9), sp('(note only)', 1)])
    expect(r.groups).toHaveLength(1)
    expect(r.notItems.map((n) => n.name)).toEqual(['GST EXTRA - 18%', 'LESS - PAYMENT'])
    expect(r.notItems[0]!.byOwner).toBe(false)
  })
  it('soldAtLeast keeps groups with enough sales lines', () => {
    const r = groupItems([sp('A ZIP', 1), sp('B ZIP', 2), sp('C ZIP', 2)])
    expect(soldAtLeast(r, 2).map((g) => g.id)).toEqual(['B ZIP', 'C ZIP'])
  })
})

describe('Phase 108 - suggestions (Suggested tier)', () => {
  it('a non-automatic typo is a suggestion between two groups, not a merge', () => {
    const r = groupItems([...base(), sp('SHAPE', 1)])
    const g = r.groups.find((x) => x.id === 'SHAPE')!
    expect(g.suggestions).toHaveLength(1)
    expect(g.suggestions[0]).toMatchObject({ fromId: 'SHAPE', toId: 'SHAPES', kind: 'plural' })
    expect(r.groups.find((x) => x.id === 'SHAPES')!.suggestions).toEqual(g.suggestions)
  })
  it('typo suggestion for a word used more than twice', () => {
    const r = groupItems([...base(), sp('GRIPER', 5)])
    expect(r.groups.find((x) => x.id === 'GRIPER')!.suggestions[0]).toMatchObject({ kind: 'typo', toId: 'GRIPPER' })
  })
  it('singular / plural suggested', () => {
    const r = groupItems([sp('BUTTON', 20), sp('BUTTONS', 15)])
    expect(r.groups[0]!.suggestions).toHaveLength(1)
    expect(r.groups[0]!.suggestions[0]!.kind).toBe('plural')
  })
  it('one differing word is suggested only when one side is rare; colours and sizes never', () => {
    const rare = groupItems([sp('SPADE ZIP', 30), sp('SPADE ZIPPY', 1), sp('SPADE HOOK', 30)])
    expect(rare.groups.find((g) => g.id === 'SPADE ZIPPY')!.suggestions.some((s) => s.kind === 'one-word' && s.toId === 'SPADE ZIP')).toBe(true)
    expect(rare.groups.find((g) => g.id === 'HOOK SPADE')!.suggestions.some((x) => x.fromId === 'SPADE ZIP' || x.toId === 'SPADE ZIP')).toBe(false)
    const colours = groupItems([sp('ZIP RED', 1), sp('ZIP BLUE', 1), sp('ZIP BIG', 1), sp('ZIP SMALL', 1)])
    const pairs = new Set(colours.groups.flatMap((g) => g.suggestions).filter((x) => x.kind === 'one-word').map((x) => [x.fromId, x.toId].sort().join(' / ')))
    expect([...pairs].sort()).toEqual(['BIG ZIP / RED ZIP', 'BIG ZIP / BLUE ZIP', 'RED ZIP / SMALL ZIP', 'BLUE ZIP / SMALL ZIP'].sort())
  })
  it('protected tokens never differ inside a suggestion', () => {
    const r = groupItems([sp('MILTON 505', 30), sp('MILTON 506', 1), sp('MILTON D7', 1)])
    expect(r.groups.flatMap((g) => g.suggestions)).toEqual([])
  })
})

describe('Phase 108 - families (brand display grouping)', () => {
  const sps = [sp('ARIHANT GRIPPER WHITE', 8), sp('ARIHANT 32X50', 6), sp('ARIHANT ZIP', 3), sp('WHITE BUTTON', 4)]
  it('groups sharing a leading brand word sit under one family; nothing is merged', () => {
    const r = groupItems(sps)
    const f = r.families.find((x) => x.id === 'ARIHANT')!
    expect(f.groupIds).toHaveLength(3)
    expect(f.count).toBe(17)
    expect(r.groups).toHaveLength(4)
    expect(r.groups.find((g) => g.id === 'BUTTON WHITE')!.familyId).toBeNull()
  })
})

describe('Phase 108 - owner rules (applied last, newest wins)', () => {
  const two = [sp('SHAKTI TAPE', 5), sp('SAKTHI TAPE', 4)]
  it('merge puts two groups together and says why', () => {
    const r = groupItems(two, [rule({ id: 'r1', kind: 'merge', keyA: idOf('SHAKTI TAPE'), keyB: idOf('SAKTHI TAPE'), canonical: 'SHAKTI TAPE' })])
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]!.display).toBe('SHAKTI TAPE')
    expect(r.groups[0]!.spellings.find((s) => s.name === 'SAKTHI TAPE')!.why.rule).toBe('owner-merge')
    expect(r.groups[0]!.suggestions).toEqual([])
  })
  it('split keeps two keys apart even when a typo rule would join them, and silences suggestions', () => {
    const sps = [...base(), sp('GRIPER', 1)]
    const split = groupItems(sps, [rule({ id: 's1', kind: 'split', keyA: 'GRIPPER', keyB: 'GRIPER' })])
    expect(split.groups.find((g) => g.id === 'GRIPER')!.spellings).toHaveLength(1)
    expect(split.groups.find((g) => g.id === 'GRIPPER')!.count).toBe(50)
    expect(split.groups.flatMap((g) => g.suggestions)).toEqual([])
  })
  it('the newest decision on a pair wins (merge then split, split then merge)', () => {
    const A = idOf('SHAKTI TAPE'), B = idOf('SAKTHI TAPE')
    const m = rule({ id: 'a', kind: 'merge', keyA: A, keyB: B, updatedAt: '2026-10-11T10:00:00Z' })
    const s = rule({ id: 'b', kind: 'split', keyA: A, keyB: B, updatedAt: '2026-10-11T11:00:00Z' })
    expect(groupItems(two, [m, s]).groups).toHaveLength(2)
    expect(groupItems(two, [m, { ...s, updatedAt: '2026-10-11T09:00:00Z' }]).groups).toHaveLength(1)
  })
  it('a deleted rule restores the automatic result', () => {
    const m = rule({ id: 'a', kind: 'merge', keyA: idOf('SHAKTI TAPE'), keyB: idOf('SAKTHI TAPE') })
    expect(groupItems(two, [{ ...m, deleted: true }])).toEqual(groupItems(two))
  })
  it('ignore moves a line to notItems (by owner)', () => {
    const r = groupItems([sp('ZIP', 2), sp('SAMPLE PIECE', 1)], [rule({ id: 'i', kind: 'ignore', keyA: idOf('SAMPLE PIECE') })])
    expect(r.groups.map((g) => g.id)).toEqual(['ZIP'])
    expect(r.notItems).toEqual([{ name: 'SAMPLE PIECE', count: 1, reason: 'Marked not an item by you', byOwner: true }])
  })
  it('a family rule overrides the automatic family', () => {
    const r = groupItems([sp('ZIP LONG', 3)], [rule({ id: 'f', kind: 'family', keyA: idOf('ZIP LONG'), canonical: 'spade' })])
    expect(r.groups[0]!.familyId).toBe('SPADE')
    expect(r.families[0]).toMatchObject({ id: 'SPADE', count: 3 })
  })
  it('rules about keys that do not exist are ignored', () => {
    expect(groupItems(two, [rule({ id: 'x', kind: 'merge', keyA: 'NOPE', keyB: 'NADA' })])).toEqual(groupItems(two))
  })
})

describe('Phase 108 - determinism and size', () => {
  const data = [...base(), sp('GRIPER', 1), sp('SHAPE', 1), sp('ARIHANT ZIP', 6), sp('ZIP ARIHANT', 2), sp('BUTTONS', 3), sp('GST EXTRA', 2)]
  it('input order does not change the output', () => {
    const a = groupItems(data)
    const b = groupItems([...data].reverse())
    expect(b).toEqual(a)
    expect(groupItems(data)).toEqual(a)
  })
  it('handles several thousand spellings quickly', () => {
    const words = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA']
    const many: ItemSpelling[] = []
    for (let i = 0; i < 6000; i++) many.push(sp(`${words[i % 12]} ${words[(i * 7 + 3) % 12]} ${words[(i * 5 + 1) % 12]} ${1 + (i % 200)}X${1 + (i % 97)} ${i}`, 1 + (i % 3)))
    const t0 = Date.now()
    const r = groupItems(many)
    expect(r.groups.length).toBeGreaterThan(100)
    expect(Date.now() - t0).toBeLessThan(15000)
  })
})
