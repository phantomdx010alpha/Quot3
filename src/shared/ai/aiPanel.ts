/**
 * Phase 226 (M22) - pure view logic of the billing-screen purchase-history panel (no Electron / Node / DOM).
 * The panel is shown only when `ai.enabled` AND `ai.billingPanel` are on, a party is set and an item-name cell is active (MILESTONE22_DESIGN 7).
 * It never writes anything: rates and quantities are shown as the stored text, never parsed or computed (CLAUDE_MUST_READ 10q).
 */
import type { PartySuggestion } from './partyHistory'
import type { AiState } from './aiStatus'

/** Delay between the last keystroke in the item cell and the question to main (design 7: about 150 ms). */
export const PANEL_DEBOUNCE_MS = 150
/** Rows shown (the engine already caps at 5; this is the display cap). */
export const PANEL_MAX_ROWS = 5

export interface PanelGate {
  /** `ai.enabled` (master). */
  enabled: boolean
  /** `ai.billingPanel`. */
  billingPanel: boolean
  partyName: string
  /** An item-name cell of the grid is the active cell. */
  cellActive: boolean
}

/** All four conditions of Phase 226 scope (1). */
export function panelWanted(g: PanelGate): boolean {
  return g.enabled && g.billingPanel && g.partyName.trim() !== '' && g.cellActive
}

export interface PanelRow {
  key: string
  name: string
  format: string
  /** True when the line was billed with GST (drives the pill colour only, never a format name). */
  gst: boolean
  rate: string
  qty: string
  date: string
  times: string
  reason: string
}

export type PanelView =
  | { kind: 'hidden' }
  | { kind: 'notice'; text: string }
  | { kind: 'rows'; rows: PanelRow[] }

const EM = '-'

/** yyyy-mm-dd (or a longer ISO stamp) -> dd/mm/yyyy (day first, like the rest of the app [A]); anything else is shown as stored. */
export function dateText(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw
}

export function timesText(n: number): string {
  return n === 1 ? 'bought once' : `bought ${n} times`
}

/** The reason chip text. Tier 2 and 3 both read "looks similar" (contract M22-4). */
export function reasonText(s: Pick<PartySuggestion, 'why'>): string {
  return s.why
}

export function rowOf(s: PartySuggestion, index: number): PanelRow {
  const qty = s.lastQty === null || s.lastQty === '' ? EM : s.lastUnit ? `${s.lastQty} ${s.lastUnit}` : s.lastQty
  return {
    key: `${index}:${s.nameUsed}:${s.formatLabel}`,
    name: s.nameUsed,
    format: s.formatLabel,
    gst: s.gst,
    rate: s.lastRate === null || s.lastRate === '' ? EM : s.lastRate,
    qty,
    date: dateText(s.lastDate),
    times: timesText(s.timesBought),
    reason: reasonText(s)
  }
}

export function noticeText(state: AiState | null): string | null {
  if (state === 'loading') return 'AI is loading'
  if (state === 'notInstalled') return 'AI model is not installed'
  if (state === 'error') return 'AI is not available'
  return null
}

/**
 * What to draw. Hidden unless wanted. Matches win over any notice (tier 1 and 2 work without the model). With nothing to show, a quiet
 * notice appears only while the model is loading / missing / failed (the owner turned the panel on, so silence would look broken);
 * a ready model with no match hides the panel.
 */
export function panelView(g: PanelGate, status: AiState | null, suggestions: readonly PartySuggestion[]): PanelView {
  if (!panelWanted(g)) return { kind: 'hidden' }
  if (suggestions.length > 0) return { kind: 'rows', rows: suggestions.slice(0, PANEL_MAX_ROWS).map(rowOf) }
  const n = noticeText(status)
  return n ? { kind: 'notice', text: n } : { kind: 'hidden' }
}

/** Optional accept key (A2, NOT built): the only thing it may ever copy into the item cell is this value. Extension point for a later phase. */
export function acceptableName(row: Pick<PanelRow, 'name'>): string { return row.name }
