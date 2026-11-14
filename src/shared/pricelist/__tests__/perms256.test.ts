import { describe, expect, it } from 'vitest'
import { ALL_RIGHTS, NO_RIGHTS, PERM_FLAGS, PERM_NEEDS, needsWords, notAllowedText, refusedNeeds, requiredFlags, rightsNotice } from '../perms'
import { refusedLine } from '../../../pwa/sync/priceSyncWords'

// Phase 256 (M24): a refusal names the flag it needs, on the desktop and on the phone. Invented values only.
describe('Phase 256 - refusal text names the flag', () => {
  it('the five words are exactly "needs Add / Edit / Overwrite / Delete / Structure"', () => {
    expect(PERM_FLAGS.map((f) => PERM_NEEDS[f])).toEqual(['needs Add', 'needs Edit', 'needs Overwrite', 'needs Delete', 'needs Structure'])
    expect(needsWords(['overwrite', 'edit'])).toBe('needs Overwrite, needs Edit')
  })
  it('the local refusal names the flag and keeps the label and the seat-1 hint', () => {
    const t = notAllowedText(['overwrite'])
    expect(t).toContain('needs Overwrite')
    expect(t).toContain('Change existing prices')
    expect(t).toMatch(/not allowed.*seat 1/s)
    expect(notAllowedText(['add', 'structure'])).toMatch(/needs Add.*needs Structure/s)
  })
  it('a price change with only Edit granted is refused as "needs Overwrite" (the 255 finding)', () => {
    const need = requiredFlags({ kind: 'price_row', cells: { c1: '10' }, name: 'A' }, { kind: 'price_row', cells: { c1: '12' }, name: 'A' })
    expect(need).toEqual(['overwrite'])
    expect(notAllowedText(need)).toContain('needs Overwrite')
  })
  it('refusedNeeds collects the flags of a kept-list once, in settings order, dropping unknown names', () => {
    expect(refusedNeeds([{ missing: ['delete', 'overwrite'] }, { missing: ['overwrite', 'bogus'] }, {}])).toEqual(['overwrite', 'delete'])
    expect(refusedNeeds([])).toEqual([])
  })
  it('the "not accepted by the main branch" lines add the flags only when known (desktop rightsNotice, phone refusedLine)', () => {
    expect(rightsNotice({ ...ALL_RIGHTS }, 1)).toEqual(['1 change made on this PC was not accepted by the main branch and stays only on this PC.'])
    expect(rightsNotice({ ...ALL_RIGHTS }, 2, ['overwrite'])[0]).toContain('not accepted by the main branch (needs Overwrite) and stay')
    expect(rightsNotice({ ...NO_RIGHTS }, 1, ['add'])).toHaveLength(2)
    expect(refusedLine(1)).toMatch(/not accepted by the main branch\. It stays/)
    expect(refusedLine(2, ['edit', 'delete'])).toContain('not accepted by the main branch (needs Edit, needs Delete). They stay')
  })
})
