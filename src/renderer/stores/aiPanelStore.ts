import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import type { AiState } from '@shared/ai/aiStatus'
import type { PartySuggestion } from '@shared/ai/partyHistory'
import { AI_KEYS, readAiSettings } from '@shared/ai/aiSettings'
import { PANEL_DEBOUNCE_MS, panelWanted } from '@shared/ai/aiPanel'

/**
 * Phase 226 (M22) - state of the billing-screen purchase-history panel. UI only: nothing here is part of the bill, undoable, or saved
 * except the two switches (`ai.enabled`, `ai.billingPanel`), which go through the generic `settings` bridge like the calculator drawer.
 * Phase 92 rule: components select primitives (`enabled`, `typed`, ...) and the row array only by reference; nothing derives a new array in a selector.
 * Everything degrades silently: any bridge failure leaves the panel hidden and billing untouched.
 */
type Bridge = Pick<Quot3Bridge, 'settings' | 'ai'>
const bridge = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3

export interface AiPanelState {
  enabled: boolean
  billingPanel: boolean
  status: AiState | null
  partyId: string | null
  partyName: string
  cellActive: boolean
  /** Text of the active item cell (what the owner is typing). */
  typed: string
  rows: readonly PartySuggestion[]
  /** Guards against stale answers: bumped by every new question and by every input change that must drop old rows. */
  seq: number
  load: () => Promise<void>
  toggle: () => void
  setBillingPanel: (on: boolean) => void
  setParty: (partyId: string | null, partyName: string) => void
  setCell: (active: boolean, typed: string) => void
  /** Drops everything tied to the open bill (bill switch). */
  reset: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null
const clearTimer = (): void => { if (timer !== null) { clearTimeout(timer); timer = null } }

function persist(key: string, value: boolean): void {
  try { void bridge()?.settings?.set(key, value).catch(() => undefined) } catch { /* a switch that fails to save is not worth a message */ }
}

export const useAiPanelStore = create<AiPanelState>((set, get) => {
  /** Hide and forget old rows at once; any answer still in flight is ignored. */
  const drop = (): void => { clearTimer(); set({ rows: [], seq: get().seq + 1 }) }

  const wanted = (): boolean => { const s = get(); return panelWanted({ enabled: s.enabled, billingPanel: s.billingPanel, partyName: s.partyName, cellActive: s.cellActive }) }

  async function ask(): Promise<void> {
    const s0 = get()
    if (!wanted()) return
    const mySeq = s0.seq + 1
    set({ seq: mySeq })
    const input = { partyId: s0.partyId, partyName: s0.partyName, text: s0.typed }
    try {
      const ai = bridge()?.ai
      if (!ai) { set({ rows: [] }); return }
      // Status is only for the quiet "loading / not installed" line; a failure there is not an error.
      void ai.status().then((r) => { if (r.ok && get().seq === mySeq) set({ status: r.data.state }) }).catch(() => undefined)
      const r = await ai.suggestForParty(input)
      if (get().seq !== mySeq) return // a newer question, a party change or a bill switch happened meanwhile
      set({ rows: r.ok ? r.data.suggestions : [] })
    } catch {
      if (get().seq === mySeq) set({ rows: [] })
    }
  }

  /**
   * Re-plan after an input change. Party / bill / switch changes drop the old rows at once (no stale rows). While the owner only keeps typing
   * in the same cell (`keepRows`) the last rows stay until the debounced answer replaces them, so the panel does not flicker on every key.
   */
  function plan(keepRows = false): void {
    if (keepRows) clearTimer(); else drop()
    if (!wanted()) { if (keepRows) drop(); return }
    timer = setTimeout(() => { timer = null; void ask() }, PANEL_DEBOUNCE_MS)
  }

  return {
    enabled: false,
    billingPanel: false,
    status: null,
    partyId: null,
    partyName: '',
    cellActive: false,
    typed: '',
    rows: [],
    seq: 0,
    load: async () => {
      try {
        const r = await bridge()?.settings?.getAll()
        if (!r || !r.ok) return
        const a = readAiSettings(r.data)
        if (a.enabled !== get().enabled || a.billingPanel !== get().billingPanel) { set({ enabled: a.enabled, billingPanel: a.billingPanel }); plan() }
      } catch { /* both switches stay as they are */ }
    },
    toggle: () => get().setBillingPanel(!get().billingPanel),
    setBillingPanel: (on) => {
      // [A] Turning the panel ON while the master switch is off turns the master on too: the owner's explicit click on an AI control is the consent,
      // and Settings > AI (Phase 230) does not exist yet. Turning it OFF never touches the master.
      const turnMasterOn = on && !get().enabled
      set({ billingPanel: on, ...(turnMasterOn ? { enabled: true } : {}) })
      persist(AI_KEYS.billingPanel, on)
      if (turnMasterOn) persist(AI_KEYS.enabled, true)
      plan()
    },
    setParty: (partyId, partyName) => {
      const s = get()
      if (s.partyId === partyId && s.partyName === partyName) return
      set({ partyId, partyName })
      plan()
    },
    setCell: (cellActive, typed) => {
      const s = get()
      if (s.cellActive === cellActive && s.typed === typed) return
      const keep = s.cellActive && cellActive
      set({ cellActive, typed })
      plan(keep)
    },
    reset: () => {
      set({ cellActive: false, typed: '', partyId: null, partyName: '' })
      drop()
    }
  }
})
