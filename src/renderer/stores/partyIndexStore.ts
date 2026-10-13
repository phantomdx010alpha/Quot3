import { create } from 'zustand'
import { createPartyIndex, type PartyIndex } from '@shared/party/fuzzy'
import type { PartyLite } from '@shared/party/partyLite'

/**
 * Phase 26 — the saved parties and their in-memory fuzzy index. The list is fetched over the bridge ONCE (and again on
 * `refresh()`, e.g. after a save adds a party); every keystroke searches the index locally, never IPC.
 */
interface PartyIndexState {
  parties: PartyLite[]
  index: PartyIndex
  loaded: boolean
  /** Replace the list (also how tests inject parties). */
  setParties: (parties: PartyLite[]) => void
  /** Fetch from main. No bridge (tests / design preview) or a failed call leaves the current list untouched. */
  load: () => Promise<void>
}

const EMPTY: PartyIndex = createPartyIndex([])

export const usePartyIndexStore = create<PartyIndexState>((set) => ({
  parties: [],
  index: EMPTY,
  loaded: false,
  setParties: (parties) => set({ parties, index: createPartyIndex(parties), loaded: true }),
  load: async () => {
    try {
      const api = (window as unknown as { quot3?: { parties?: { list?: () => Promise<{ ok: boolean; data?: PartyLite[] }> } } }).quot3?.parties
      const r = await api?.list?.()
      if (r?.ok && r.data) set({ parties: r.data, index: createPartyIndex(r.data), loaded: true })
    } catch { /* no bridge: autocomplete simply has nothing to offer */ }
  }
}))
