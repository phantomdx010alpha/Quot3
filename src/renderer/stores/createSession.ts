import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { ROUTES, currentPath } from '@shared/routes'
import { useBillStore } from './billStore'
import { useRouter } from '../router/routerStore'
import { useBehaviourStore } from './behaviourStore'

/**
 * Phase 28 — which bill the Create page is working on. Phase 118: the id lives only while Create is the current page (see below);
 * `nonce` makes an already-mounted Create page start over (New bill while on Create).
 */
let currentId: string | null = null
export const createSession = {
  get: (): string | null => currentId,
  set: (id: string | null): void => { currentId = id }
}
export const useCreateSession = create<{ nonce: number }>(() => ({ nonce: 0 }))

/**
 * Phase 70 — a successful Save ends the Create session: the next time Create opens (from the rail, Dashboard, Ctrl+N …) it is a
 * blank bill, not the one just saved. The bill already on screen is left alone (no navigation, no reload), so saving with Ctrl+S
 * and carrying on typing still works and the next save sends `expectedRevision` as before.
 */
export function endSessionAfterSave(): void {
  createSession.set(null)
}

// Phase 118 (HARD RULE, supersedes the Phase 70 "unsaved bill stays resumable" subscription): Create ALWAYS opens a clean bill.
// The session is only valid while Create stays the current page. The moment the router leaves Create (rail, Ctrl+N, Esc, back,
// after Save, after Discard - the unsaved-changes guard has already had its say) the session ends, so no later change to the bill
// store (a late `dirty` flip, a debounced write) can make the next entry resume it. Edit routes are unaffected: `openBillForEdit`,
// draft recovery and revision restore set the session right BEFORE navigating to Create from another page.
useRouter.subscribe((s, prev) => {
  if (currentPath(prev.nav) === ROUTES.create && currentPath(s.nav) !== ROUTES.create) currentId = null
})

/** Forget the open bill; the Create page opens an empty one (on next mount, or right now if mounted). Callers go through the guard first. */
export function startFreshBill(): void {
  createSession.set(null)
  useBillStore.setState({ billId: null })
  useCreateSession.setState((s) => ({ nonce: s.nonce + 1 }))
  useRouter.getState().navigate(ROUTES.create)
}

/** Load a saved bill into the Create page. Resolves false (nothing changed) when it cannot be read. Callers go through the guard first. */
export async function openBillForEdit(id: string): Promise<boolean> {
  const api = (window as unknown as { quot3?: Pick<Quot3Bridge, 'bills'> }).quot3?.bills
  if (!api) return false
  try {
    const r = await api.getForEdit(id)
    if (!r.ok) return false
    // Phase 120: Save stamps the round-off flag from the setting (never from the bill), so the editing session shows the totals the save
    // will produce. Without this an old / imported bill (flag 0) showed an unrounded grand total although re-saving rounds it. The flag is
    // set BEFORE loadBill, so the baseline already carries it and merely opening the bill is not "unsaved work".
    const flag = useBehaviourStore.getState().roundOff ? (1 as const) : (0 as const)
    useBillStore.getState().loadBill({ ...r.data, roundOff: flag })
    createSession.set(r.data.id)
    useRouter.getState().navigate(ROUTES.create, { returnToCurrent: true })
    return true
  } catch {
    return false
  }
}
