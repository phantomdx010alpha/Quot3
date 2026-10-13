import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import type { DuplicateSuggestion } from '@shared/customers/duplicates'
import { useCustomersStore } from './customersStore'
import { useSaveUiStore } from './saveUiStore'

type Api = Quot3Bridge['customers']
const api = (): Api | undefined => (window as unknown as { quot3?: { customers?: Api } }).quot3?.customers
const say = (tone: 'ok' | 'warn' | 'danger', m: string): void => useSaveUiStore.getState().announce(tone, m)

/**
 * Phase 137 - the "Possible duplicates" section of Customers. Similar names are only SUGGESTED here; the owner merges. State holds raw
 * values only (the list is replaced whole, never derived inside a selector).
 */
export interface DuplicatesState {
  open: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  items: DuplicateSuggestion[]
  /** Index of the highlighted suggestion. */
  index: number
  busy: boolean
  toggle: () => Promise<void>
  close: () => void
  load: () => Promise<void>
  move: (delta: number | 'first' | 'last') => void
  select: (index: number) => void
  merge: () => Promise<boolean>
  notSame: () => Promise<boolean>
  undoLast: () => Promise<boolean>
  unify: () => Promise<boolean>
}

const clamp = (i: number, n: number): number => (n === 0 ? 0 : Math.min(Math.max(i, 0), n - 1))
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export const useDuplicatesStore = create<DuplicatesState>((set, get) => {
  const refresh = async (): Promise<void> => {
    await get().load()
    await useCustomersStore.getState().load()
  }
  return {
    open: false, status: 'idle', error: '', items: [], index: 0, busy: false,

    async toggle() {
      if (get().open) { set({ open: false }); return }
      set({ open: true })
      await get().load()
    },
    close: () => set({ open: false }),

    async load() {
      const c = api()
      if (!c) { set({ status: 'error', error: 'Not connected to the app' }); return }
      set({ status: 'loading', error: '' })
      try {
        const r = await c.duplicates()
        if (!r.ok) { set({ status: 'error', error: r.error.message }); return }
        set({ status: 'ready', items: r.data, index: clamp(get().index, r.data.length) })
      } catch (e) {
        set({ status: 'error', error: e instanceof Error ? e.message : 'unknown error' })
      }
    },

    move(delta) {
      const n = get().items.length
      const cur = get().index
      set({ index: clamp(delta === 'first' ? 0 : delta === 'last' ? n - 1 : cur + delta, n) })
    },
    select: (index) => set({ index: clamp(index, get().items.length) }),

    async merge() {
      const c = api(); const s = get()
      const it = s.items[s.index]
      if (!c || !it || s.busy) return false
      set({ busy: true })
      try {
        const r = await c.merge({ survivorId: it.survivorId, mergedId: it.mergedId })
        if (!r.ok) { say('danger', r.error.message); return false }
        say('ok', `Merged ${it.merged.name} into ${it.survivor.name} (${plural(r.data.billsMoved, 'bill', 'bills')} moved). Undo last merge puts it back`)
        await refresh()
        return true
      } finally { set({ busy: false }) }
    },

    async notSame() {
      const c = api(); const s = get()
      const it = s.items[s.index]
      if (!c || !it || s.busy) return false
      set({ busy: true })
      try {
        const r = await c.notSame({ aId: it.survivorId, bId: it.mergedId })
        if (!r.ok) { say('danger', r.error.message); return false }
        say('ok', 'Marked as different customers')
        await get().load()
        return true
      } finally { set({ busy: false }) }
    },

    async undoLast() {
      const c = api()
      if (!c || get().busy) return false
      set({ busy: true })
      try {
        const r = await c.undoLastMerge()
        if (!r.ok) { say('danger', r.error.message); return false }
        if (r.data.undone === 0) { say('warn', 'There is no merge to undo'); return false }
        say('ok', `Undid ${plural(r.data.undone, 'merge', 'merges')}`)
        await refresh()
        return true
      } finally { set({ busy: false }) }
    },

    async unify() {
      const c = api()
      if (!c || get().busy) return false
      set({ busy: true })
      try {
        const r = await c.unify()
        if (!r.ok) { say('danger', r.error.message); return false }
        say('ok', r.data.merged === 0 ? 'Every customer name is already unique' : `Combined ${plural(r.data.merged, 'copy', 'copies')} of ${plural(r.data.groups, 'customer', 'customers')}`)
        await refresh()
        return true
      } finally { set({ busy: false }) }
    }
  }
})
