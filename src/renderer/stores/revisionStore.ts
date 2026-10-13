import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { diffBills, type BillDiff } from '@shared/diff/billDiff'
import { previousRevision, type RevisionSummary } from '@shared/revisions'

type Bridge = Pick<Quot3Bridge, 'revisions' | 'bills'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3

/** `previous` = what that save changed; `current` = what changed since that revision (i.e. what restoring it would undo). */
export type CompareMode = 'previous' | 'current'

export interface RevisionDiffState {
  /** `first` = the oldest stored revision (nothing to compare with); `same` = the revision IS the current bill. */
  kind: 'diff' | 'first' | 'same'
  diff: BillDiff | null
}

export interface RevisionState {
  open: boolean
  billId: string | null
  poNumber: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  items: RevisionSummary[]
  selected: number | null
  mode: CompareMode
  detail: RevisionDiffState | null
  detailStatus: 'idle' | 'loading' | 'ready' | 'error'
  detailError: string
  openFor: (billId: string, poNumber: string) => Promise<void>
  close: () => void
  select: (revision: number) => Promise<void>
  moveSelection: (delta: number) => Promise<void>
  setMode: (mode: CompareMode) => Promise<void>
  toggleMode: () => Promise<void>
}

let loadToken = 0

export const useRevisionStore = create<RevisionState>((set, get) => {
  const loadDetail = async (): Promise<void> => {
    const { billId, selected, mode, items } = get()
    const a = api()
    if (!billId || selected === null || !a?.revisions) { set({ detail: null, detailStatus: 'idle' }); return }
    const token = ++loadToken
    set({ detailStatus: 'loading', detailError: '' })
    try {
      const sel = items.find((r) => r.revision === selected)
      if (mode === 'current' && sel?.isCurrent) { if (token === loadToken) set({ detail: { kind: 'same', diff: null }, detailStatus: 'ready' }); return }
      if (mode === 'previous') {
        const prev = previousRevision(items, selected)
        if (prev === null) { if (token === loadToken) set({ detail: { kind: 'first', diff: null }, detailStatus: 'ready' }); return }
        const [o, n] = await Promise.all([a.revisions.get({ billId, revision: prev }), a.revisions.get({ billId, revision: selected })])
        if (token !== loadToken) return
        if (!o.ok || !n.ok) { set({ detailStatus: 'error', detailError: (!o.ok ? o : (n as { ok: false; error: { message: string } })).error.message }); return }
        set({ detail: { kind: 'diff', diff: diffBills(o.data.bill, n.data.bill) }, detailStatus: 'ready' })
        return
      }
      if (!a.bills) { set({ detailStatus: 'error', detailError: 'Not connected to the app' }); return }
      const [o, n] = await Promise.all([a.revisions.get({ billId, revision: selected }), a.bills.getForEdit(billId)])
      if (token !== loadToken) return
      if (!o.ok) { set({ detailStatus: 'error', detailError: o.error.message }); return }
      if (!n.ok) { set({ detailStatus: 'error', detailError: n.error.message }); return }
      set({ detail: { kind: 'diff', diff: diffBills(o.data.bill, n.data) }, detailStatus: 'ready' })
    } catch (e) {
      if (token === loadToken) set({ detailStatus: 'error', detailError: e instanceof Error ? e.message : 'Could not read the revision' })
    }
  }

  return {
    open: false, billId: null, poNumber: '', status: 'idle', error: '', items: [], selected: null, mode: 'previous',
    detail: null, detailStatus: 'idle', detailError: '',

    async openFor(billId, poNumber) {
      const a = api()?.revisions
      loadToken++
      set({ open: true, billId, poNumber, status: 'loading', error: '', items: [], selected: null, mode: 'previous', detail: null, detailStatus: 'idle', detailError: '' })
      if (!a) { set({ status: 'error', error: 'Revision history is not available (no connection to the app)' }); return }
      try {
        const r = await a.list({ billId })
        if (get().billId !== billId || !get().open) return
        if (!r.ok) { set({ status: 'error', error: r.error.message }); return }
        set({ status: 'ready', items: r.data, selected: r.data[0]?.revision ?? null })
        await loadDetail()
      } catch (e) {
        set({ status: 'error', error: e instanceof Error ? e.message : 'Could not read the revisions' })
      }
    },

    close() {
      loadToken++
      set({ open: false, billId: null, items: [], selected: null, detail: null, detailStatus: 'idle', status: 'idle', error: '' })
    },

    async select(revision) {
      if (get().selected === revision) return
      set({ selected: revision })
      await loadDetail()
    },

    async moveSelection(delta) {
      const { items, selected } = get()
      if (items.length === 0) return
      const i = Math.max(0, Math.min(items.length - 1, (items.findIndex((r) => r.revision === selected) < 0 ? 0 : items.findIndex((r) => r.revision === selected)) + delta))
      await get().select(items[i]!.revision)
    },

    async setMode(mode) {
      if (get().mode === mode) return
      set({ mode })
      await loadDetail()
    },

    async toggleMode() { await get().setMode(get().mode === 'previous' ? 'current' : 'previous') },
  }
})
