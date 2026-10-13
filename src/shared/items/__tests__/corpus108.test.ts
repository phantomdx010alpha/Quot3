// Phase 108 - optional local run on the owner's private corpus. Skipped when the zip is absent. COUNTS ONLY: no spelling is printed.
import { describe, expect, it } from 'vitest'
import { parseLegacyFile } from '../../legacyImport/parse'
import { readCorpus } from '../../legacyImport/__tests__/corpus'
import { groupItems, soldAtLeast, type ItemSpelling } from '../grouping'
import { buildVocabulary, autoTypoFix } from '../vocabulary'

const files = readCorpus()

describe.runIf(files !== null)('Phase 108 - grouping on the private corpus (counts only)', () => {
  it('groups, tiers and the six named false matches', () => {
    const counts = new Map<string, number>()
    for (const f of files ?? []) {
      const r = parseLegacyFile(f.text, f.bytes)
      if (!r.ok) continue
      for (const it of r.bill.items) if (it.kind === 'item' && it.name.trim() !== '') counts.set(it.name.trim(), (counts.get(it.name.trim()) ?? 0) + 1)
    }
    const spellings: ItemSpelling[] = [...counts].map(([name, count]) => ({ name, count }))
    const t0 = Date.now()
    const r = groupItems(spellings)
    const ms = Date.now() - t0
    const again = groupItems([...spellings].reverse())
    const typoMerged = r.groups.reduce((n, g) => n + g.spellings.filter((s) => s.why.rule === 'typo-auto').length, 0)
    const sugg = new Set(r.groups.flatMap((g) => g.suggestions.map((s) => s.fromId + '|' + s.toId)))
    const vocab = buildVocabulary(spellings)
    const sixAuto = ['STEAM', 'STRIKER', 'PERAL', 'JACKO', 'GERMANY', 'SHAPE'].filter((w) => autoTypoFix(vocab, w)).length
    const named = ['JUPITOR', 'GRIPER', 'BUTTTON', 'SHAKKTI'].map((w) => (autoTypoFix(vocab, w) ? 1 : 0)).join('')
    // eslint-disable-next-line no-console
    console.log(`[items grouping] spellings=${spellings.length} groups=${r.groups.length} notItems=${r.notItems.length} soldAtLeast2=${soldAtLeast(r, 2).length} linesInThose=${soldAtLeast(r, 2).reduce((n, g) => n + g.count, 0)} typoSpellingsMerged=${typoMerged} suggestionPairs=${sugg.size} families=${r.families.length} sixFalseAuto=${sixAuto} namedTypoFixedFlags=${named} ms=${ms}`)
    expect(again).toEqual(r)
    expect(sixAuto).toBe(0)
  })
})
