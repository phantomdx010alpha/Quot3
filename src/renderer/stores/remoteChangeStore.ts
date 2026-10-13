import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import type { HeldChange } from '@shared/sync/pull'
import { useBillStore } from './billStore'
import { openBillForEdit } from './createSession'

type Api = Quot3Bridge['sync']
type Win = { quot3?: { sync?: Api; on?: Quot3Bridge['on'] } }
const bridge = (): Win['quot3'] => (window as unknown as Win).quot3

/**
 * Phase 56 - changes that arrived from another branch for the bill that is open in the editor. Main never applies them under
 * the editor; they wait here until the owner picks Keep mine / Load theirs (or leaves the bill, which applies them by the normal ordering).
 */
export interface RemoteChangeState {
  held: HeldChange[]
  load: () => Promise<void>
}
export const useRemoteChangeStore = create<RemoteChangeState>((set) => ({
  held: [],
  load: async () => {
    const api = bridge()?.sync
    if (!api) return
    try {
      const r = await api.held()
      if (r.ok) set({ held: r.data })
    } catch { /* the banner just stays as it was */ }
  }
}))

/** The held change for the bill that is open right now, if any. */
export function heldForOpenBill(held: readonly HeldChange[], billId: string | null): HeldChange | undefined {
  return billId === null ? undefined : held.find((h) => h.billId === billId)
}

/** Keep mine: forget the other branch's version of the open bill. Returns whether there was one. */
export async function keepMine(): Promise<boolean> {
  const id = useBillStore.getState().billId
  const h = heldForOpenBill(useRemoteChangeStore.getState().held, id)
  const api = bridge()?.sync
  if (!h || !api) return false
  try { await api.resolveHeld({ billId: h.billId, choice: 'keep' }) } catch { return false }
  await useRemoteChangeStore.getState().load()
  return true
}

/** Load theirs: apply the other branch's version and reload the editor from it (unsaved edits on screen are replaced). */
export async function loadTheirs(): Promise<boolean> {
  const id = useBillStore.getState().billId
  const h = heldForOpenBill(useRemoteChangeStore.getState().held, id)
  const api = bridge()?.sync
  if (!h || !api) return false
  try {
    const r = await api.resolveHeld({ billId: h.billId, choice: 'load' })
    if (!r.ok || !r.data.done) return false
  } catch { return false }
  await useRemoteChangeStore.getState().load()
  return openBillForEdit(h.billId)
}

/**
 * Starts the two-way link with main: reports which bill the editor has open (so main never applies a change under it) and
 * refreshes the held list whenever `bills:remoteChanged` arrives. Returns the stop function.
 */
export function startRemoteSync(): () => void {
  const b = bridge()
  const api = b?.sync
  if (!api) return () => undefined
  let last: string | null | undefined
  const report = (): void => {
    const id = useBillStore.getState().billId
    if (id === last) return
    last = id
    void api.setEditor(id).then(() => useRemoteChangeStore.getState().load()).catch(() => undefined)
  }
  report()
  const unStore = useBillStore.subscribe(report)
  const unEvent = b?.on?.('bills:remoteChanged', () => { void useRemoteChangeStore.getState().load() })
  void useRemoteChangeStore.getState().load()
  return () => { unStore(); unEvent?.() }
}
