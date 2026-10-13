// Phase 107 - optional local run on the owner's private legacy corpus. Skipped when the zip is absent. Prints COUNTS ONLY, never a name
// (CLAUDE_MUST_READ 10c / 10e: the corpus contents are never logged or copied into code).
import { describe, expect, it } from 'vitest'
import { parseLegacyFile } from '../../legacyImport/parse'
import { readCorpus } from '../../legacyImport/__tests__/corpus'
import { normaliseItem } from '../normalise'

const files = readCorpus()

describe.runIf(files !== null)('Phase 107 - normaliser on the private corpus (counts only)', () => {
  it('distinct spellings -> cleaned -> key groups; non-product lines filtered', () => {
    const spellings = new Set<string>(), cleaned = new Set<string>(), keys = new Set<string>(), nonProducts = new Set<string>()
    let lines = 0, itemLines = 0, bills = 0
    for (const f of files ?? []) {
      const r = parseLegacyFile(f.text, f.bytes)
      if (!r.ok) continue
      bills++
      for (const it of r.bill.items) {
        if (it.kind !== 'item' || it.name.trim() === '') continue
        lines++
        const n = normaliseItem(it.name)
        if (n.empty) continue
        spellings.add(it.name.trim())
        if (n.nonProduct) { nonProducts.add(n.cleaned); continue }
        itemLines++
        cleaned.add(n.cleaned)
        keys.add(n.key)
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[items corpus] bills=${bills} namedLines=${lines} productLines=${itemLines} spellings=${spellings.size} cleaned=${cleaned.size} keyGroups=${keys.size} nonProductNames=${nonProducts.size}`)
    expect(bills).toBeGreaterThan(0)
    expect(keys.size).toBeLessThanOrEqual(cleaned.size)
    expect(cleaned.size).toBeLessThanOrEqual(spellings.size)
  })
})
