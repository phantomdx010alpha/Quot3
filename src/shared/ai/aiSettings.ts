/**
 * Phase 222 (M22) - the four AI switches (pure; no Electron / Node / DOM). MILESTONE22_DESIGN 2 rule 6.
 * Every switch is OFF by default. With `ai.enabled` off (or the model missing / crashed) the app behaves exactly as 0.1.49.
 */
export const AI_KEYS = { enabled: 'ai.enabled', billingPanel: 'ai.billingPanel', itemSuggestions: 'ai.itemSuggestions', sentenceSearch: 'ai.sentenceSearch' } as const
export const AI_DEFAULTS: Readonly<Record<string, unknown>> = { [AI_KEYS.enabled]: false, [AI_KEYS.billingPanel]: false, [AI_KEYS.itemSuggestions]: false, [AI_KEYS.sentenceSearch]: false }

export interface AiSettings { enabled: boolean; billingPanel: boolean; itemSuggestions: boolean; sentenceSearch: boolean }

/** Tolerant read of the stored values: anything but a real `true` is off. */
export function readAiSettings(all: Record<string, unknown>): AiSettings {
  return {
    enabled: all[AI_KEYS.enabled] === true,
    billingPanel: all[AI_KEYS.billingPanel] === true,
    itemSuggestions: all[AI_KEYS.itemSuggestions] === true,
    sentenceSearch: all[AI_KEYS.sentenceSearch] === true
  }
}

/** A feature is live only when the master switch AND its own switch are on (the model state is checked separately by the service). */
export function aiFeatureOn(s: AiSettings, feature: 'billingPanel' | 'itemSuggestions' | 'sentenceSearch'): boolean {
  return s.enabled && s[feature]
}

/** Zod-free value check used by the settings IPC schema: these keys only ever hold booleans. */
export const isAiSettingValue = (v: unknown): v is boolean => typeof v === 'boolean'
