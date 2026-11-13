/**
 * Phase 235 (M23) - Price List settings keys, defaults and tolerant read (pure). MILESTONE23_DESIGN 4.8 / API_CONTRACTS M23-1.
 * Values are stored as JSON in the generic `settings` table (settings:set takes any value); the zod schemas below validate on read
 * and in the Settings UI. Anything unexpected falls back to its default. All [A] defaults are listed in the phase log.
 */
import { z } from 'zod'
import { defaultColumnSet, sanitizeColumns } from './columns'
import { SEED_TIERS } from './tiers'
import { PRICELIST_LIMITS, type PriceColumn } from './types'
import type { Strictness } from './match'
import type { FillMode } from './autofill'

export const PRICELIST_KEYS = {
  enabled: 'pricelist.enabled',
  mode: 'pricelist.billing.mode',
  formatTier: 'pricelist.billing.formatTier',
  strictness: 'pricelist.billing.strictness',
  maxSuggestions: 'pricelist.billing.maxSuggestions',
  markAutoFilled: 'pricelist.billing.markAutoFilled',
  fillName: 'pricelist.billing.fillName',
  excludedTabs: 'pricelist.billing.excludedTabs',
  logVisible: 'pricelist.log.visible',
  logRetentionDays: 'pricelist.log.retentionDays',
  defaultColumns: 'pricelist.defaultColumns'
} as const

/** [A] GST bill -> cash+GST, Non-GST bill -> cash w/o. Keyed by registry format id; never a format name in code (rule 4.4). */
export const DEFAULT_FORMAT_TIER: Readonly<Record<string, string | null>> = { non_gst: 'cash_wo', gst: 'cash_gst' }
export const MAX_SUGGESTIONS_RANGE = { min: 1, max: 10 } as const
export const LOG_RETENTION_RANGE = { min: 30, max: 3650 } as const
export const MAX_EXCLUDED_TABS = 500

export const PRICELIST_DEFAULTS: Readonly<Record<string, unknown>> = {
  [PRICELIST_KEYS.enabled]: true,
  [PRICELIST_KEYS.mode]: 'auto',
  [PRICELIST_KEYS.formatTier]: { ...DEFAULT_FORMAT_TIER },
  [PRICELIST_KEYS.strictness]: 'normal',
  [PRICELIST_KEYS.maxSuggestions]: 5,
  [PRICELIST_KEYS.markAutoFilled]: true,
  [PRICELIST_KEYS.fillName]: false,
  [PRICELIST_KEYS.excludedTabs]: [],
  [PRICELIST_KEYS.logVisible]: false,
  [PRICELIST_KEYS.logRetentionDays]: 365,
  [PRICELIST_KEYS.defaultColumns]: defaultColumnSet(SEED_TIERS)
}

const idList = z.array(z.string().min(1).max(100)).max(MAX_EXCLUDED_TABS)
export const priceListSettingSchemas = {
  [PRICELIST_KEYS.enabled]: z.boolean(),
  [PRICELIST_KEYS.mode]: z.enum(['off', 'suggest', 'auto']),
  [PRICELIST_KEYS.formatTier]: z.record(z.string().min(1).max(60), z.string().min(1).max(PRICELIST_LIMITS.tierKeyMax).nullable()),
  [PRICELIST_KEYS.strictness]: z.enum(['strict', 'normal', 'loose']),
  [PRICELIST_KEYS.maxSuggestions]: z.number().int().min(MAX_SUGGESTIONS_RANGE.min).max(MAX_SUGGESTIONS_RANGE.max),
  [PRICELIST_KEYS.markAutoFilled]: z.boolean(),
  [PRICELIST_KEYS.fillName]: z.boolean(),
  [PRICELIST_KEYS.excludedTabs]: idList,
  [PRICELIST_KEYS.logVisible]: z.boolean(),
  [PRICELIST_KEYS.logRetentionDays]: z.number().int().min(LOG_RETENTION_RANGE.min).max(LOG_RETENTION_RANGE.max),
  [PRICELIST_KEYS.defaultColumns]: z.array(z.record(z.string(), z.unknown())).min(1).max(PRICELIST_LIMITS.maxColumns)
} as const

/** True when `value` is acceptable for a known Price List key (unknown keys: false). */
export function isPriceListSettingValue(key: string, value: unknown): boolean {
  const s = (priceListSettingSchemas as Record<string, z.ZodTypeAny>)[key]
  return !!s && s.safeParse(value).success
}

export interface PriceListSettings {
  enabled: boolean
  mode: FillMode
  formatTier: Record<string, string | null>
  strictness: Strictness
  maxSuggestions: number
  markAutoFilled: boolean
  fillName: boolean
  excludedTabs: string[]
  logVisible: boolean
  logRetentionDays: number
  defaultColumns: PriceColumn[]
}

function pick<T>(all: Record<string, unknown>, key: string, fallback: T): T {
  const s = (priceListSettingSchemas as Record<string, z.ZodTypeAny>)[key]!
  const r = s.safeParse(all[key])
  return r.success ? (r.data as T) : fallback
}

/** Tolerant read: each value that fails its schema falls back to the default; `formatTier` is merged over the defaults so new formats still work. */
export function readPriceListSettings(all: Record<string, unknown>): PriceListSettings {
  const d = PRICELIST_DEFAULTS
  const ft = pick<Record<string, string | null> | null>(all, PRICELIST_KEYS.formatTier, null)
  const cols = sanitizeColumns(all[PRICELIST_KEYS.defaultColumns])
  const hasCustomCols = priceListSettingSchemas[PRICELIST_KEYS.defaultColumns].safeParse(all[PRICELIST_KEYS.defaultColumns]).success
  return {
    enabled: all[PRICELIST_KEYS.enabled] !== false,
    mode: pick(all, PRICELIST_KEYS.mode, d[PRICELIST_KEYS.mode] as FillMode),
    formatTier: { ...DEFAULT_FORMAT_TIER, ...(ft ?? {}) },
    strictness: pick(all, PRICELIST_KEYS.strictness, d[PRICELIST_KEYS.strictness] as Strictness),
    maxSuggestions: pick(all, PRICELIST_KEYS.maxSuggestions, 5),
    markAutoFilled: all[PRICELIST_KEYS.markAutoFilled] !== false,
    fillName: all[PRICELIST_KEYS.fillName] === true,
    excludedTabs: pick(all, PRICELIST_KEYS.excludedTabs, []),
    logVisible: all[PRICELIST_KEYS.logVisible] === true,
    logRetentionDays: pick(all, PRICELIST_KEYS.logRetentionDays, 365),
    defaultColumns: hasCustomCols ? cols : defaultColumnSet(SEED_TIERS)
  }
}

/** Billing uses the Price List only when the master switch is on and the mode is not 'off'. */
export const billingActive = (s: Pick<PriceListSettings, 'enabled' | 'mode'>): boolean => s.enabled && s.mode !== 'off'
/** The tier for a registry format id (null = none): data lookup only. */
export const tierForFormat = (s: Pick<PriceListSettings, 'formatTier'>, formatId: string): string | null => s.formatTier[formatId] ?? null
