import { create } from 'zustand'

/**
 * Phase 25 — UI state of the party/detail bar. The mounted `PartyBar` registers its ports here so the global actions
 * (palette / shortcuts) can reach it from anywhere, and clears them on unmount (same pattern as `gridUiStore`).
 */
interface PartyUiState {
  /** The address pull-down is open. */
  addressOpen: boolean
  focusParty: (() => void) | null
  focusDate: (() => void) | null
  openAddress: (() => void) | null
  closeAddress: (() => void) | null
  setAddressOpen: (open: boolean) => void
}

export const usePartyUiStore = create<PartyUiState>((set) => ({
  addressOpen: false,
  focusParty: null,
  focusDate: null,
  openAddress: null,
  closeAddress: null,
  setAddressOpen: (addressOpen) => set({ addressOpen })
}))
