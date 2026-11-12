import { describe, expect, it } from 'vitest'
import { AI_DEFAULTS, AI_KEYS, aiFeatureOn, isAiSettingValue, readAiSettings } from '../aiSettings'
import { SETTING_DEFAULTS, SETTING_KEY_RE } from '../../settings'
import { DEFAULT_MODEL, E5_SMALL, MODEL_CANDIDATES, findModel, isFullyPinned, isPermissiveLicence, modelDir, withPrefix } from '../modelConfig'

describe('ai settings (Phase 222)', () => {
  it('the four keys are valid setting keys, OFF in SETTING_DEFAULTS and in AI_DEFAULTS', () => {
    expect(Object.values(AI_KEYS)).toEqual(['ai.enabled', 'ai.billingPanel', 'ai.itemSuggestions', 'ai.sentenceSearch'])
    for (const k of Object.values(AI_KEYS)) { expect(SETTING_KEY_RE.test(k)).toBe(true); expect(SETTING_DEFAULTS[k]).toBe(false); expect(AI_DEFAULTS[k]).toBe(false) }
    expect(readAiSettings(SETTING_DEFAULTS as Record<string, unknown>)).toEqual({ enabled: false, billingPanel: false, itemSuggestions: false, sentenceSearch: false })
  })
  it('only a real true turns a switch on; a feature needs the master switch too', () => {
    expect(readAiSettings({ 'ai.enabled': 'yes', 'ai.billingPanel': 1 })).toEqual({ enabled: false, billingPanel: false, itemSuggestions: false, sentenceSearch: false })
    const s = readAiSettings({ 'ai.billingPanel': true })
    expect(aiFeatureOn(s, 'billingPanel')).toBe(false)
    expect(aiFeatureOn(readAiSettings({ 'ai.enabled': true, 'ai.billingPanel': true }), 'billingPanel')).toBe(true)
    expect(aiFeatureOn(readAiSettings({ 'ai.enabled': true }), 'sentenceSearch')).toBe(false)
  })
  it('setting values are booleans only', () => {
    expect(isAiSettingValue(true)).toBe(true)
    expect(isAiSettingValue('true')).toBe(false)
    expect(isAiSettingValue(null)).toBe(false)
  })
})

describe('modelConfig (Phase 222)', () => {
  it('default is multilingual-e5-small with the e5 prefix policy, 384 dims, mean pooling, normalised', () => {
    expect(DEFAULT_MODEL).toBe(E5_SMALL)
    expect(E5_SMALL.dim).toBe(384)
    expect(withPrefix(E5_SMALL, 'red tomato', 'query')).toBe('query: red tomato')
    expect(withPrefix(E5_SMALL, 'red tomato', 'passage')).toBe('passage: red tomato')
    expect(E5_SMALL.pooling).toBe('mean')
    expect(E5_SMALL.normalize).toBe(true)
  })
  it('candidates have unique ids, relative file paths, thresholds in (0,1] and no prefix on MiniLM', () => {
    const ids = MODEL_CANDIDATES.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of MODEL_CANDIDATES) {
      expect(findModel(m.id)).toBe(m)
      expect(modelDir(m)).toBe(`ai-models/${m.id}`)
      for (const f of m.files) expect(f.path.startsWith('/') || f.path.includes('..')).toBe(false)
      for (const t of Object.values(m.thresholds)) { expect(t).toBeGreaterThan(0); expect(t).toBeLessThanOrEqual(1) }
    }
    expect(withPrefix(findModel('all-MiniLM-L6-v2')!, 'x', 'query')).toBe('x')
    expect(findModel('nope')).toBeUndefined()
  })
  it('only the default model is pinned and licence-confirmed (owner fetch 2026-11-12); the bake-off candidates are not; permissive list is explicit', () => {
    expect(isFullyPinned(E5_SMALL)).toBe(true); expect(E5_SMALL.licenceConfirmed).toBe(true)
    expect(E5_SMALL.revision).toBe('761b726dd34fb83930e26aab4e9ac3899aa1fa78')
    for (const m of MODEL_CANDIDATES.filter((c) => c !== E5_SMALL)) { expect(isFullyPinned(m)).toBe(false); expect(m.licenceConfirmed).toBe(false) }
    expect(isFullyPinned({ ...E5_SMALL, revision: 'a'.repeat(40), files: E5_SMALL.files.map((f) => ({ ...f, sha256: 'b'.repeat(64) })) })).toBe(true)
    expect(isPermissiveLicence('MIT')).toBe(true)
    expect(isPermissiveLicence('CC-BY-NC-4.0')).toBe(false)
  })
})
