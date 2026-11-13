import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { resolveFormat } from '@shared/format/registry'
import { normaliseItem } from '@shared/items/normalise'
import { plain } from '@shared/richtext/runs'
import { PRICELIST_KEYS, readPriceListSettings, tierForFormat, type PriceListSettings } from '@shared/pricelist/settings'
import { decideFill, freshRowState, onRateTyped, type AutofillRowState } from '@shared/pricelist/autofill'
import { buildBillingData, EMPTY_BILLING_DATA, formatHasRate, matchForBilling, tierValue, type BillingData } from '@shared/pricelist/billing'
import type { MatchResult } from '@shared/pricelist/match'
import type { PriceRow, PriceTier } from '@shared/pricelist/types'
import { PANEL_DEBOUNCE_MS } from '@shared/ai/aiPanel'
import { runAsOneEntry } from './historyHooks'
import { useBillStore } from './billStore'
import type { TableSide } from './tableApi'

/**
 * Phase 240 (M23) - billing integration state (MILESTONE23_DESIGN 4.3). UI only: nothing here is part of the bill, undoable or saved,
 * except the one fill, which goes through the normal bill edit as ONE history entry. Like `aiPanelStore`: debounce + a `seq` stale-answer
 * guard, primitives for components, every bridge failure degrades silently (billing is then exactly as before).
 * Per-row state `{ rateTouched, autoFilledValue, autoFilledForNameKey }` lives here, keyed `side:rowId`, dropped on every bill switch.
 */
type Bridge = Pick<Quot3Bridge, 'settings' | 'pricelist'>
const bridge = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3

/** The Price List is re-read at most this often (on the next cell focus), so edits made on the Price List page reach billing. */
export const DATA_MAX_AGE_MS = 30_000
export const DEFAULT_SETTINGS: PriceListSettings = readPriceListSettings({})

export interface ActiveCell { side: TableSide; rowId: string }

export interface PriceStripState {
  settings: PriceListSettings
  tiers: PriceTier[]
  data: BillingData
  loadedAt: number
  cellActive: boolean
  cell: ActiveCell | null
  typed: string
  match: MatchResult | null
  /** Value the last auto-fill wrote for the active row (shown in Auto mode). */
  filled: string | null
  /** Rows whose Rate holds an auto-filled value (`side:rowId`) - for the subtle marker. */
  marked: readonly string[]
  seq: number
  load: (force?: boolean) => Promise<void>
  setCell: (cell: ActiveCell | null, typed: string) => void
  setTyped: (typed: string) => void
  rateTyped: (side: TableSide, rowId: string) => void
  /** The cursor LEFT an item-name cell whose text was edited in that cell session. Decides and (Auto mode) writes the fill. */
  leaveName: (side: TableSide, rowId: string) => void
  setMode: (mode: PriceListSettings['mode']) => void
  /** Settings > Price List > Billing: update one or more billing settings and save each under its own key. */
  saveSettings: (patch: Partial<Pick<PriceListSettings, 'enabled' | 'strictness' | 'maxSuggestions' | 'markAutoFilled' | 'formatTier'>>) => void
  reset: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null
const clearTimer = (): void => { if (timer !== null) { clearTimeout(timer); timer = null } }
const rowStates = new Map<string, AutofillRowState>()
const keyOf = (c: ActiveCell): string => `${c.side}:${c.rowId}`
const stateOf = (k: string): AutofillRowState => rowStates.get(k) ?? freshRowState()

export function persistMode(mode: PriceListSettings['mode']): void {
  try { void bridge()?.settings?.set(PRICELIST_KEYS.mode, mode).catch(() => undefined) } catch { /* a switch that fails to save is not worth a message */ }
}

export const billingOn = (s: Pick<PriceListSettings, 'enabled' | 'mode'>): boolean => s.enabled && s.mode !== 'off'

export const usePriceStripStore = create<PriceStripState>((set, get) => {
  const drop = (): void => { clearTimer(); set({ match: null, seq: get().seq + 1 }) }

  const runMatch = (): void => {
    const s = get()
    if (!billingOn(s.settings) || !s.cellActive || s.typed.trim() === '') { set({ match: null }); return }
    const mySeq = s.seq + 1
    set({ seq: mySeq })
    const m = matchForBilling(s.data, s.typed, s.settings.strictness, s.settings.maxSuggestions)
    if (get().seq !== mySeq) return // a newer question or a bill switch happened meanwhile
    set({ match: m })
  }
  const plan = (keep = false): void => {
    if (keep) clearTimer(); else drop()
    if (!billingOn(get().settings) || !get().cellActive) return
    timer = setTimeout(() => { timer = null; runMatch() }, PANEL_DEBOUNCE_MS)
  }

  /** The side's table facts read from the bill store: format id, the row's committed name and rate text. */
  const sideRow = (side: TableSide, rowId: string): { formatId: string; name: string; rate: string } | null => {
    const b = useBillStore.getState()
    const rows = side === 'primary' ? b.rows : b.second?.rows
    const formatId = side === 'primary' ? b.formatId : b.second?.formatId
    const r = rows?.find((x) => x.id === rowId)
    if (!r || !formatId) return null
    return { formatId, name: plain(r.nameRuns), rate: r.rate ?? '' }
  }

  function decideAndFill(side: TableSide, rowId: string): void {
    const s = get()
    if (s.settings.mode !== 'auto' || !billingOn(s.settings)) return
    const row = sideRow(side, rowId)
    if (!row) return
    const def = resolveFormat(row.formatId)
    const nameKey = normaliseItem(row.name).key
    const m = matchForBilling(s.data, row.name, s.settings.strictness, s.settings.maxSuggestions)
    const tierKey = tierForFormat(s.settings, row.formatId)
    const k = `${side}:${rowId}`
    const d = decideFill(stateOf(k), {
      mode: s.settings.mode, loading: false, formatHasRate: formatHasRate(def), tierKey, rateText: row.rate, nameKey, match: m,
      tierValue: m.best ? tierValue(s.data, m.best.rowId, tierKey) : undefined
    })
    rowStates.set(k, d.state)
    set({ match: m })
    if (d.action !== 'fill') return
    // ONE undo step of its own (Ctrl+Z removes only the rate); written through the normal bill edit like a typed value.
    const ok = runAsOneEntry('Rate filled from Price List', () => {
      const st = useBillStore.getState()
      return side === 'primary' ? st.setCellTexts([{ rowId, colKey: 'rate', text: d.value }]) : st.setSecondCellTexts([{ rowId, colKey: 'rate', text: d.value }])
    })
    if (!ok) { rowStates.set(k, stateOf(k)); return }
    const cur = get()
    set({ filled: cur.cell && keyOf(cur.cell) === k ? d.value : cur.filled, marked: cur.marked.includes(k) ? cur.marked : [...cur.marked, k] })
  }

  return {
    settings: DEFAULT_SETTINGS,
    tiers: [],
    data: EMPTY_BILLING_DATA(),
    loadedAt: 0,
    cellActive: false,
    cell: null,
    typed: '',
    match: null,
    filled: null,
    marked: [],
    seq: 0,
    load: async (force = false) => {
      try {
        const api = bridge()
        const all = await api?.settings?.getAll()
        if (!api || !all || !all.ok) return
        const settings = readPriceListSettings(all.data)
        if (!billingOn(settings)) { set({ settings, data: EMPTY_BILLING_DATA(), tiers: [], loadedAt: 0, match: null }); return }
        if (!force && get().loadedAt !== 0 && Date.now() - get().loadedAt < DATA_MAX_AGE_MS) { set({ settings }); return }
        const tree = await api.pricelist?.tree()
        if (!tree || !tree.ok) { set({ settings }); return }
        const tabs = tree.data.tabs.filter((t) => !settings.excludedTabs.includes(t.id) && !settings.excludedTabs.includes(t.categoryId))
        const rowsByTab: Record<string, PriceRow[]> = {}
        await Promise.all(tabs.map(async (t) => {
          const r = await api.pricelist?.rows(t.id)
          if (r && r.ok) rowsByTab[t.id] = r.data
        }))
        set({ settings, tiers: tree.data.tiers, data: buildBillingData(tabs, rowsByTab, settings.excludedTabs, (r) => plain(r.nameRuns)), loadedAt: Date.now() })
      } catch { /* settings / data stay as they are: billing works as before */ }
    },
    setCell: (cell, typed) => {
      const s = get()
      const same = s.cell && cell && keyOf(s.cell) === keyOf(cell)
      const active = cell !== null
      if (s.cellActive === active && same && s.typed === typed) return
      const st = cell ? rowStates.get(keyOf(cell)) : undefined
      set({ cellActive: active, cell, typed, filled: cell && st?.autoFilledValue ? st.autoFilledValue : null })
      plan(!!(s.cellActive && active && same))
    },
    setTyped: (typed) => { if (get().typed !== typed) { set({ typed }); plan(true) } },
    rateTyped: (side, rowId) => { const k = `${side}:${rowId}`; rowStates.set(k, onRateTyped(stateOf(k))) },
    leaveName: (side, rowId) => {
      // Runs after the grid has committed the cell (one macrotask later) so the bill store holds the final name.
      setTimeout(() => decideAndFill(side, rowId), 0)
    },
    setMode: (mode) => {
      set({ settings: { ...get().settings, mode } })
      persistMode(mode)
      if (billingOn(get().settings)) void get().load(true)
      plan()
    },
    saveSettings: (patch) => {
      set({ settings: { ...get().settings, ...patch } })
      const keyOf2: Record<string, string> = { enabled: PRICELIST_KEYS.enabled, strictness: PRICELIST_KEYS.strictness, maxSuggestions: PRICELIST_KEYS.maxSuggestions, markAutoFilled: PRICELIST_KEYS.markAutoFilled, formatTier: PRICELIST_KEYS.formatTier }
      for (const [k, v] of Object.entries(patch)) { try { void bridge()?.settings?.set(keyOf2[k]!, v).catch(() => undefined) } catch { /* not saved: the value still holds until restart */ } }
      if (billingOn(get().settings)) void get().load(true)
    },
    reset: () => {
      rowStates.clear()
      set({ cellActive: false, cell: null, typed: '', filled: null, marked: [] })
      drop()
    }
  }
})

/** Test hook: the per-row state the auto-fill keeps (UI state only, never stored in the bill). */
export const __rowStateOf = (side: TableSide, rowId: string): AutofillRowState => stateOf(`${side}:${rowId}`)
