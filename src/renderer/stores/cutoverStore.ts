import { create } from 'zustand'
import { cutoverCompareNote, type CutoverBridge, type CutoverBridgeError, type CutoverStatus } from '@shared/sync/cutover'

/** The cutover bridge is added to `window.quot3` when the app is wired (see PHASE_STATUS, Phase 140); until then it is absent and no wizard shows. */
type Win = { quot3?: { cutover?: CutoverBridge } }
export const cutoverBridge = (): CutoverBridge | undefined => (window as unknown as Win).quot3?.cutover
const NO_BRIDGE = 'The cutover is not available (no connection to the app).'
const SOMETHING = 'Something went wrong. Try again.'

/** Phase 140 - mirrors the cutover state kept by main. Selectors read raw fields only (Phase 92 rule). */
export interface CutoverState {
  status: CutoverStatus | null
  busy: boolean
  error: string
  /** Counts-only result of the last compare / unify. */
  note: string
  load: () => Promise<void>
  begin: () => Promise<boolean>
  compare: () => Promise<boolean>
  unify: (skip: boolean) => Promise<boolean>
}

export const useCutoverStore = create<CutoverState>((set) => {
  const bad = (e: CutoverBridgeError | undefined): false => { set({ busy: false, error: e?.message ?? SOMETHING }); return false }
  return {
    status: null, busy: false, error: '', note: '',
    async load() {
      const b = cutoverBridge()
      if (!b) { set({ status: null }); return }
      try {
        const r = await b.status()
        if (r.ok) set({ status: r.data }); else set({ error: r.error.message })
      } catch { set({ error: SOMETHING }) }
    },
    async begin() {
      const b = cutoverBridge()
      if (!b) { set({ error: NO_BRIDGE }); return false }
      set({ busy: true, error: '', note: '' })
      try {
        const r = await b.begin()
        if (!r.ok) return bad(r.error)
        set({ busy: false, status: r.data })
        return true
      } catch { return bad(undefined) }
    },
    async compare() {
      const b = cutoverBridge()
      if (!b) { set({ error: NO_BRIDGE }); return false }
      set({ busy: true, error: '', note: '' })
      try {
        const r = await b.compare()
        if (!r.ok) return bad(r.error)
        set({ busy: false, status: r.data.status, note: cutoverCompareNote(r.data.compare) })
        return r.data.compare.state === 'done'
      } catch { return bad(undefined) }
    },
    async unify(skip) {
      const b = cutoverBridge()
      if (!b) { set({ error: NO_BRIDGE }); return false }
      set({ busy: true, error: '', note: '' })
      try {
        const r = await b.unify({ skip })
        if (!r.ok) return bad(r.error)
        set({ busy: false, status: r.data.status, note: skip ? 'Customers left as they are.' : `Joined ${r.data.merged} same-name customers (${r.data.billsMoved} bills moved).` })
        return true
      } catch { return bad(undefined) }
    }
  }
})
