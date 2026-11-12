import { describe, expect, it, vi } from 'vitest'
import { SETTING_DEFAULTS } from '@shared/settings'
import { readAiSettings, aiFeatureOn } from '@shared/ai/aiSettings'
import { panelWanted } from '@shared/ai/aiPanel'
import { DEFAULT_MODEL } from '@shared/ai/modelConfig'
import { createAiService } from '../main/ai/aiService'
import { createIndexer } from '../main/ai/indexer'
import { createGroupSuggestService } from '../main/ai/groupSuggestService'
import { createFakeSpawner } from '../main/ai/__tests__/fakeWorker'

/** Phase 231 - "AI off = 0.1.49 behaviour", checked by test (fake worker, no model, no network). */
describe('AI off equals the old app', () => {
  it('every switch is off by default', () => {
    const s = readAiSettings(SETTING_DEFAULTS as Record<string, unknown>)
    expect(s).toEqual({ enabled: false, billingPanel: false, itemSuggestions: false, sentenceSearch: false })
    for (const f of ['billingPanel', 'itemSuggestions', 'sentenceSearch'] as const) expect(aiFeatureOn(s, f)).toBe(false)
  })

  it('no worker is spawned: off, or on with the model files missing', async () => {
    const sp = createFakeSpawner()
    const base = { model: DEFAULT_MODEL, modelRoot: '/x', spawn: sp.spawn, log: () => {} }
    const off = createAiService({ ...base, modelPresent: () => true, isEnabled: () => false })
    expect(await off.embed(['a'], 'query')).toEqual({ ok: false, reason: 'off' })
    const missing = createAiService({ ...base, modelPresent: () => false, isEnabled: () => true })
    expect(await missing.embed(['a'], 'passage')).toEqual({ ok: false, reason: 'notInstalled' })
    expect(sp.workers.length).toBe(0)
  })

  it('the indexer does nothing while off (no list of names read, no embed, state off)', () => {
    const embed = vi.fn(); const listNames = vi.fn(() => ['x'])
    const repo = { have: vi.fn(() => new Set<string>()), upsertMany: vi.fn(), deleteOtherModels: vi.fn(), deleteAll: vi.fn(() => 0) }
    const ix = createIndexer({ repo: repo as never, names: { listNames }, embed, modelKey: 'm@1', dim: 3, isEnabled: () => false, schedule: () => () => {} })
    ix.scan(); ix.notifyBills(['b1'])
    expect(ix.progress().state).toBe('off')
    expect(embed).not.toHaveBeenCalled(); expect(listNames).not.toHaveBeenCalled(); expect(repo.deleteOtherModels).not.toHaveBeenCalled()
  })

  it('no billing panel: it is wanted only with master AND panel switch AND a party AND a cell', () => {
    expect(panelWanted({ enabled: false, billingPanel: true, partyName: 'Invented Traders', cellActive: true })).toBe(false)
    expect(panelWanted({ enabled: true, billingPanel: false, partyName: 'Invented Traders', cellActive: true })).toBe(false)
  })

  it('no Items badges or chips: group suggestions answer empty without reading anything', () => {
    const aiGroups = vi.fn(() => ({ groups: [], ruleSuggested: [], splitKeyPairs: [] }))
    const svc = createGroupSuggestService({ items: { aiGroups }, vectors: { getMany: vi.fn(() => []) }, modelKey: 'm@1', threshold: 0.9, isOn: () => false })
    expect(svc.suggestGroups({ groupId: 'g1' })).toEqual({ suggestions: [], embeddingsUsed: false })
    expect(aiGroups).not.toHaveBeenCalled()
  })

})
