import { describe, expect, it, vi } from 'vitest'
import { SETTING_DEFAULTS } from '@shared/settings'
import { parseTyped } from '../sentenceSearch'

/** Phase 231 - AI off: a typed sentence is not taken over (no chips beyond the plain search). */
describe('AI off equals the old search', () => {
  it('with the master switch off a sentence and a plain word both keep the old search', async () => {
    const getAll = vi.fn(async () => ({ ok: true as const, data: { ...SETTING_DEFAULTS } }))
    vi.stubGlobal('window', { quot3: { settings: { getAll } } })
    expect(await parseTyped('ruby tomato to Invented Traders last month')).toBeNull()
    expect(await parseTyped('tomato')).toBeNull()
    vi.unstubAllGlobals()
  })
})
