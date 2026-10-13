import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { effectiveTargets, rangeIds } from '@shared/history/historyList'
import { UNDO_DELETE_MS } from '@shared/constants'
import type { TrashItem } from '@shared/trash'

type TrashApi = Quot3Bridge['trash']
const api = (): TrashApi | undefined => (window as unknown as { quot3?: { trash?: TrashApi } }).quot3?.trash

/** The "Undo delete" offer shown for ~10 s after a delete on History (Ctrl+Z). */
export interface UndoOffer { ids: string[]; label: string; expiresAt: number }

export interface TrashState {
  /** The Recently deleted view replaces the bills panels while true. */
  open: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  items: TrashItem[]
  billId: string | null
  selection: string[]
  anchor: string | null
  /** Bills waiting for the "Delete forever" confirmation. */
  confirmPurge: TrashItem[] | null
  /** "Empty trash" dialog: open flag + what has been typed so far. */
  confirmEmpty: boolean
  emptyText: string
  undoOffer: UndoOffer | null
  focusList: (() => void) | null

  setOpen: (open: boolean) => Promise<void>
  load: () => Promise<void>
  selectItem: (id: string | null) => void
  extendSelection: (toId: string) => void
  toggleSelected: (id: string) => void
  selectAll: () => void
  targets: () => TrashItem[]
  /** Restore these ids (or the targets); resolves the ids that were restored. */
  restoreIds: (ids?: string[]) => Promise<string[]>
  askPurge: () => boolean
  cancelPurge: () => void
  purgeNow: () => Promise<string[]>
  askEmpty: () => boolean
  setEmptyText: (t: string) => void
  cancelEmpty: () => void
  emptyNow: () => Promise<number>
  offerUndo: (ids: string[], label: string) => void
  dismissUndo: () => void
  setFocusList: (f: (() => void) | null) => void
}

let undoTimer: ReturnType<typeof setTimeout> | null = null
let loadSeq = 0

export const useTrashStore = create<TrashState>((set, get) => ({
  open: false, status: 'idle', error: '', items: [], billId: null, selection: [], anchor: null,
  confirmPurge: null, confirmEmpty: false, emptyText: '', undoOffer: null, focusList: null,

  async setOpen(open) {
    set({ open, confirmPurge: null, confirmEmpty: false, emptyText: '', selection: [], anchor: null })
    if (open) await get().load()
  },

  async load() {
    const t = api()
    if (!t) { set({ status: 'error', error: 'Recently deleted is not available (no bridge).' }); return }
    const seq = ++loadSeq
    set({ status: 'loading', error: '' })
    try {
      const r = await t.list()
      if (seq !== loadSeq) return
      if (!r.ok) { set({ status: 'error', error: r.error.message }); return }
      const prev = get().billId
      set({
        items: r.data, status: 'ready', error: '',
        selection: get().selection.filter((id) => r.data.some((i) => i.id === id)),
        billId: r.data.some((i) => i.id === prev) ? prev : (r.data[0]?.id ?? null)
      })
    } catch (e) {
      if (seq === loadSeq) set({ status: 'error', error: e instanceof Error ? e.message : 'Could not load Recently deleted.' })
    }
  },

  selectItem: (billId) => set({ billId, selection: [], anchor: billId }),
  extendSelection(toId) {
    const { items, anchor, billId } = get()
    const from = anchor ?? billId
    set({ selection: rangeIds(items, from, toId), billId: toId, anchor: from })
  },
  toggleSelected(id) {
    const { selection, billId, items } = get()
    const base = selection.length > 0 ? selection : (billId && billId !== id ? [billId] : [])
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
    const order = new Map(items.map((b, i) => [b.id, i]))
    set({ selection: next.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)), billId: id, anchor: id })
  },
  selectAll: () => set({ selection: get().items.map((b) => b.id) }),
  targets() {
    const { items, selection, billId } = get()
    const ids = new Set(effectiveTargets(selection, billId))
    return items.filter((b) => ids.has(b.id))
  },

  async restoreIds(ids) {
    const t = api()
    const want = ids ?? get().targets().map((b) => b.id)
    if (!t || want.length === 0) return []
    const r = await t.restore({ ids: want })
    if (!r.ok) { set({ status: 'error', error: r.error.message }); return [] }
    // A restore of the offered ids closes the undo offer.
    if (get().undoOffer && r.data.restored.some((id) => get().undoOffer!.ids.includes(id))) get().dismissUndo()
    set({ selection: [], anchor: null })
    if (get().open) await get().load()
    return r.data.restored
  },

  askPurge() {
    const t = get().targets()
    if (t.length === 0) return false
    set({ confirmPurge: t })
    return true
  },
  cancelPurge: () => set({ confirmPurge: null }),
  async purgeNow() {
    const pending = get().confirmPurge
    const t = api()
    set({ confirmPurge: null })
    if (!pending || !t) return []
    const r = await t.purge({ ids: pending.map((b) => b.id) })
    if (!r.ok) { set({ status: 'error', error: r.error.message }); return [] }
    set({ selection: [], anchor: null })
    await get().load()
    return r.data.purged
  },

  askEmpty() {
    if (get().items.length === 0) return false
    set({ confirmEmpty: true, emptyText: '' })
    return true
  },
  setEmptyText: (emptyText) => set({ emptyText }),
  cancelEmpty: () => set({ confirmEmpty: false, emptyText: '' }),
  async emptyNow() {
    const t = api()
    set({ confirmEmpty: false, emptyText: '' })
    if (!t) return 0
    const r = await t.emptyTrash({ confirm: 'EMPTY' })
    if (!r.ok) { set({ status: 'error', error: r.error.message }); return 0 }
    set({ selection: [], anchor: null })
    await get().load()
    return r.data.purged
  },

  offerUndo(ids, label) {
    if (undoTimer) clearTimeout(undoTimer)
    set({ undoOffer: { ids, label, expiresAt: Date.now() + UNDO_DELETE_MS } })
    undoTimer = setTimeout(() => { undoTimer = null; set({ undoOffer: null }) }, UNDO_DELETE_MS)
  },
  dismissUndo() {
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null }
    set({ undoOffer: null })
  },
  setFocusList: (focusList) => set({ focusList })
}))
