import { z } from 'zod'
import { incomingWins, type VersionStamp } from './pull'

/**
 * Phase 241 (M23, docs/MILESTONE23_DESIGN.md 7.2): the four Price List record kinds of the shared notebook. Pure.
 * One record per tier, category, tab and row (ids are the app's own uuids, so `rec_id` is the entity id). A tab record carries its column list.
 * Deletes are tombstones (`deleted: true`, `deletedAt` set). The version of a record is `updatedAt`, then the branch that made it
 * (revision is always 0, like item rules). Data only: nothing in a record is ever executed.
 */
export const PRICE_KINDS = ['price_tier', 'price_category', 'price_tab', 'price_row'] as const
export type PriceKind = (typeof PRICE_KINDS)[number]
export const isPriceKind = (k: unknown): k is PriceKind => typeof k === 'string' && (PRICE_KINDS as readonly string[]).includes(k)
/** Wire revision of every Price List record (outbox + stamp). */
export const PRICE_REVISION = 0
/** The key of the known top-level object inside each kind's payload. */
export const PRICE_DATA_KEY: Readonly<Record<PriceKind, string>> = { price_tier: 'tier', price_category: 'category', price_tab: 'tab', price_row: 'row' }

const nul = z.string().max(40).nullable()
const stamps = { createdAt: z.string().min(1).max(40), updatedAt: z.string().min(1).max(40), deletedAt: nul, branchId: z.string().min(1).max(100) }
const seat = z.number().int().min(1).max(99).nullable().optional()
const plain = (max: number) => z.string().max(max)

/** Loose = keys this build does not know are kept (an older app must not drop a newer field). */
export const priceTierData = z.object({
  tier: z.object({ id: z.string().min(1).max(100), key: z.string().min(1).max(30), label: plain(80), position: z.number().int().min(0).max(100000), ...stamps }).loose()
})
export const priceCategoryData = z.object({
  category: z.object({ id: z.string().min(1).max(100), name: plain(240), color: z.string().max(40).nullable(), position: z.number().int().min(0).max(100000), updatedBySeat: seat, ...stamps }).loose()
})
export const priceTabData = z.object({
  tab: z.object({
    id: z.string().min(1).max(100), categoryId: z.string().min(1).max(100), name: plain(240), position: z.number().int().min(0).max(100000),
    columns: z.array(z.object({}).loose()).max(40), updatedBySeat: seat, ...stamps
  }).loose()
})
export const priceRowData = z.object({
  row: z.object({
    id: z.string().min(1).max(100), tabId: z.string().min(1).max(100), idx: z.number().int().min(0).max(10_000_000), kind: z.enum(['item', 'section']),
    nameRuns: z.array(z.unknown()).max(500), cells: z.record(z.string().max(100), z.string().max(1000)), updatedBySeat: seat, ...stamps
  }).loose()
})

export interface PriceStamped { updatedAt: string; branchId: string; deletedAt: string | null }
export type PriceTierRec = z.infer<typeof priceTierData>['tier']
export type PriceCategoryRec = z.infer<typeof priceCategoryData>['category']
export type PriceTabRec = z.infer<typeof priceTabData>['tab']
export type PriceRowRec = z.infer<typeof priceRowData>['row']
export type PriceRec =
  | { kind: 'price_tier'; rec: PriceTierRec }
  | { kind: 'price_category'; rec: PriceCategoryRec }
  | { kind: 'price_tab'; rec: PriceTabRec }
  | { kind: 'price_row'; rec: PriceRowRec }

/** The ordering stamp of a Price List version: newer `updatedAt`, then branch id (revision is 0 on both sides). */
export const priceStamp = (r: Pick<PriceStamped, 'updatedAt' | 'branchId'>): VersionStamp => ({ updatedAt: r.updatedAt, revision: PRICE_REVISION, branchId: r.branchId })

/** True when the incoming version beats the local one. Equal = same version = not a win (applying twice changes nothing). */
export const priceIncomingWins = (local: Pick<PriceStamped, 'updatedAt' | 'branchId'> | null, incoming: Pick<PriceStamped, 'updatedAt' | 'branchId'>): boolean =>
  incomingWins(local ? priceStamp(local) : null, priceStamp(incoming))

/** What the version SAYS, ignoring who made it and when (same content on two PCs = same fingerprint, so the later arrival is dropped). */
export const priceFingerprint = (kind: PriceKind, rec: Record<string, unknown>): string => {
  const skip = ['updatedAt', 'createdAt', 'branchId', 'updatedBySeat', 'deletedAt']
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(rec).sort()) if (!skip.includes(k)) out[k] = rec[k]
  return JSON.stringify([kind, out, rec.deletedAt != null])
}
