/**
 * Phase 240 (M23) - billing integration, pure part (no DOM, no Electron, no Node, no AI). MILESTONE23_DESIGN 4.3.
 * Turns the Price List (tabs + rows) into a match index and answers "which tier value / all tiers for this matched row".
 * The format -> tier mapping is DATA (setting keyed by registry format id): nothing here knows a format name (rule 4.4).
 * Values are the stored decimal strings; nothing is parsed or computed (rule 4.3).
 */
import { buildIndex, match, type MatchEntry, type MatchIndexEntry, type MatchResult, type Strictness } from './match'
import type { PriceColumn, PriceRow, PriceTab, PriceTier } from './types'

/** A format has a Rate column when its registry columns say so (data, not a name). */
export const formatHasRate = (def: { columns: ReadonlyArray<{ key: string }> } | null | undefined): boolean => !!def && def.columns.some((c) => c.key === 'rate')

/** The column of `columns` that holds tier `tierKey` (first visible one, else any), or undefined. */
export function tierColumn(columns: readonly PriceColumn[], tierKey: string | null | undefined): PriceColumn | undefined {
  if (!tierKey) return undefined
  const all = columns.filter((c) => c.role === 'price' && c.tier === tierKey)
  return all.find((c) => !c.hidden) ?? all[0]
}

export interface BillingData {
  index: MatchIndexEntry[]
  rows: Map<string, { tabId: string; cells: Record<string, string> }>
  tabs: Map<string, { name: string; columns: PriceColumn[] }>
}
export const EMPTY_BILLING_DATA = (): BillingData => ({ index: [], rows: new Map(), tabs: new Map() })

/** Build once per Price List change (never per keystroke). Excluded ids may be tab ids or category ids; section rows are never matched. */
export function buildBillingData(tabs: readonly PriceTab[], rowsByTab: Readonly<Record<string, readonly PriceRow[]>>, excluded: readonly string[], plainOf: (r: PriceRow) => string): BillingData {
  const skip = new Set(excluded)
  const entries: MatchEntry[] = []
  const data = EMPTY_BILLING_DATA()
  for (const t of tabs) {
    if (skip.has(t.id) || skip.has(t.categoryId)) continue
    data.tabs.set(t.id, { name: t.name, columns: t.columns })
    for (const r of rowsByTab[t.id] ?? []) {
      if (r.kind !== 'item') continue
      const name = plainOf(r)
      if (name.trim() === '') continue
      entries.push({ rowId: r.id, tabId: t.id, categoryId: t.categoryId, name })
      data.rows.set(r.id, { tabId: t.id, cells: r.cells })
    }
  }
  data.index = buildIndex(entries)
  return data
}

/** The matched row's value for `tierKey` in ITS tab's columns ('' when the tab has no such column or the cell is empty). */
export function tierValue(data: BillingData, rowId: string, tierKey: string | null | undefined): string {
  const row = data.rows.get(rowId)
  if (!row) return ''
  const col = tierColumn(data.tabs.get(row.tabId)?.columns ?? [], tierKey)
  return col ? (row.cells[col.key] ?? '').trim() : ''
}

export interface TierShown { key: string; label: string; value: string }
/** ALL tiers of the matched row that have a value, in the tier order, for the strip. */
export function tiersOfRow(data: BillingData, rowId: string, tiers: readonly PriceTier[]): TierShown[] {
  const out: TierShown[] = []
  for (const t of [...tiers].sort((a, b) => a.position - b.position)) {
    const v = tierValue(data, rowId, t.key)
    if (v !== '') out.push({ key: t.key, label: t.label, value: v })
  }
  return out
}

export const matchForBilling = (data: BillingData, text: string, strictness: Strictness, maxSuggestions: number): MatchResult => match(text, data.index, strictness, maxSuggestions)

/** The toolbar switch / key cycles Auto -> Suggest -> Off -> Auto [A]. */
export const nextBillingMode = (m: 'off' | 'suggest' | 'auto'): 'off' | 'suggest' | 'auto' => (m === 'auto' ? 'suggest' : m === 'suggest' ? 'off' : 'auto')

/* ---- the strip's view model ---- */
export interface StripCandidateView { rowId: string; name: string; tabName: string; tiers: TierShown[]; best: boolean }
export type StripView =
  | { kind: 'hidden' }
  | { kind: 'notice'; text: string }
  | { kind: 'match'; tierKey: string | null; tierLabel: string; candidates: StripCandidateView[]; confident: boolean; filled: string | null }

export interface StripInput {
  enabled: boolean
  mode: 'off' | 'suggest' | 'auto'
  cellActive: boolean
  hasData: boolean
  typed: string
  match: MatchResult | null
  tierKey: string | null
  tiers: readonly PriceTier[]
  data: BillingData
  /** The value the last auto-fill wrote for the active row (shown in Auto mode), or null. */
  filled: string | null
}

/** Strip is shown only when the Price List is on, the mode is not off, an item-name cell is active and there is something to say. */
export function stripView(i: StripInput): StripView {
  if (!i.enabled || i.mode === 'off' || !i.cellActive || i.typed.trim() === '') return { kind: 'hidden' }
  if (!i.hasData) return { kind: 'notice', text: 'The Price List is empty.' }
  const m = i.match
  if (!m || m.candidates.length === 0) return { kind: 'hidden' }
  const label = i.tiers.find((t) => t.key === i.tierKey)?.label ?? ''
  const candidates = m.candidates.map((c) => ({
    rowId: c.rowId, name: c.name, tabName: i.data.tabs.get(c.tabId)?.name ?? '', tiers: tiersOfRow(i.data, c.rowId, i.tiers), best: m.best?.rowId === c.rowId
  }))
  return { kind: 'match', tierKey: i.tierKey, tierLabel: label, candidates, confident: m.confident, filled: i.mode === 'auto' ? i.filled : null }
}
