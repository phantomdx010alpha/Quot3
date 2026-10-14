import { create } from 'zustand'
import { billForSide, needsSidePick, type OutputPurpose } from '@shared/hybrid/hybridOutput'
import type { Bill, HybridSide } from '@shared/types'
import { useGridUiStore } from './gridUiStore'
import { useHistoryStore } from './historyStore'

/**
 * Phase 152 - the "GST side or non-GST side?" question that comes first for every output of a Hybrid bill (Print, Save PDF,
 * image copy, text copy; Create and History alike). The bill is a snapshot taken when the question opened. Choosing a side hands
 * the output path a NORMAL bill for that side (`billForSide`, so nothing of the other table can reach the output); Esc cancels
 * and nothing is output. Store selectors are primitives only (Phase 92 rule).
 */
export interface SidePickState {
  open: boolean
  purpose: OutputPurpose
  bill: Bill | null
  run: ((bill: Bill, side: HybridSide) => void) | null
  set: (patch: Partial<Omit<SidePickState, 'set'>>) => void
}

export const useSidePickStore = create<SidePickState>((set) => ({
  open: false, purpose: 'print', bill: null, run: null,
  set: (patch) => set(patch)
}))

const st = (): SidePickState => useSidePickStore.getState()

/**
 * Run an output for `bill`. A bill that is not in the Hybrid view runs at once, unchanged, and the result of `run` is returned.
 * A Hybrid bill opens the side question instead and returns `whilePicking` (the output has not started yet).
 */
export function withOutputSide<T>(bill: Bill, purpose: OutputPurpose, run: (bill: Bill, side: HybridSide | null) => T, whilePicking: T): T {
  if (!needsSidePick(bill)) return run(bill, null)
  if (st().open) return whilePicking
  st().set({ open: true, purpose, bill, run: (b, side) => { void run(b, side) } })
  return whilePicking
}

function close(): void {
  st().set({ open: false, bill: null, run: null })
}

/** G / N / the buttons: close the question and start the output for the chosen side. */
export function chooseSide(side: HybridSide): boolean {
  const s = st()
  if (!s.open || !s.bill || !s.run) return false
  const run = s.run
  const bill = billForSide(s.bill, side)
  close()
  run(bill, side)
  return true
}

/** Esc / Cancel: nothing is output; focus goes back to where it was. */
export function cancelSidePick(): void {
  if (!st().open) return
  close()
  useGridUiStore.getState().refocus?.()
  useHistoryStore.getState().focusBills?.()
}
