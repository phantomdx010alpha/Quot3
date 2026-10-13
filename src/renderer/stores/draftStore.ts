import { create } from 'zustand'
import { createEmptyBill } from '@shared/billModel'
import type { DraftSummary } from '@shared/draft'
import type { Quot3Bridge } from '@shared/ipc'
import { ROUTES } from '@shared/routes'
import type { Bill } from '@shared/types'
import { useRouter } from '../router/routerStore'
import { draftAutosaveIdle, markDraftKnown } from './draftAutosave'
import { useBillStore } from './billStore'
import { createSession } from './createSession'
import { requestLeave } from './guardStore'

/**
 * Phase 29 — the recoverable drafts the Dashboard offers. `load()` pulls `drafts:list`; the main process also pushes
 * `drafts:recoverable { drafts }` once the page has loaded (both feed `setDrafts`). Recovering opens the draft on the Create
 * page with a FRESH undo history; it stays dirty until saved or discarded.
 */
type DraftApi = Pick<Quot3Bridge, 'drafts' | 'bills'>
const api = (): Partial<DraftApi> | undefined => (window as unknown as { quot3?: Partial<DraftApi> }).quot3

interface DraftState {
  drafts: DraftSummary[]
  loaded: boolean
  /** Shown on the Dashboard after "Recover unsaved bill" found nothing / a recovery failed. */
  message: string
  /** The Dashboard should move focus to the banner once (set by the palette action, consumed by `DraftRecovery`). */
  wantFocus: boolean
  setDrafts: (drafts: DraftSummary[]) => void
  load: () => Promise<void>
  /** Opens the draft on Create (through the unsaved-changes guard). Resolves true when the bill was opened. */
  recover: (id: string) => Promise<boolean>
  /** Deletes a draft the owner no longer wants. */
  remove: (id: string) => Promise<void>
  /** Palette action: show the Dashboard banner with focus (or say there is nothing to recover). */
  showBanner: () => Promise<void>
  consumeFocus: () => void
}

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: [],
  loaded: false,
  message: '',
  wantFocus: false,
  setDrafts: (drafts) => set({ drafts, loaded: true }),
  load: async () => {
    try {
      await draftAutosaveIdle() // a delete queued by Save / Discard must reach main before we ask what is left
      const r = await api()?.drafts?.list()
      if (r?.ok) set({ drafts: r.data, loaded: true })
    } catch { /* no bridge / transient: keep what we have */ }
  },
  recover: (id) => new Promise<boolean>((resolve) => {
    const open = (): void => {
      void (async () => {
        const a = api()
        try {
          const r = await a?.drafts?.get(id)
          if (!r || !r.ok) {
            set({ message: r && !r.ok ? r.error.message : 'Recovery is not available (no connection to the app)' })
            await get().load()
            resolve(false)
            return
          }
          const d = r.data
          let baseline: Bill | null = null
          if (d.billId !== null) {
            const saved = await a?.bills?.getForEdit(d.billId)
            if (saved?.ok) baseline = saved.data
          }
          // Never saved (or the saved bill is gone): "saved" = an empty bill, so the recovered bill is dirty.
          baseline ??= { ...createEmptyBill({ branchId: d.bill.branchId, rowCount: 0 }), billDate: d.bill.billDate }
          useBillStore.getState().loadDraft(d.bill, baseline)
          createSession.set(d.bill.id)
          markDraftKnown(d.bill.id)
          set((s) => ({ drafts: s.drafts.filter((x) => x.id !== id), message: '' }))
          useRouter.getState().navigate(ROUTES.create)
          resolve(true)
        } catch {
          set({ message: 'That unsaved bill could not be opened' })
          resolve(false)
        }
      })()
    }
    if (!requestLeave(open)) resolve(false) // the guard dialog took over; the pending action runs `open` if the owner proceeds
  }),
  remove: async (id) => {
    try { await api()?.drafts?.delete(id) } catch { /* the list is reloaded below either way */ }
    await get().load()
  },
  showBanner: async () => {
    await get().load()
    set({ wantFocus: true, message: get().drafts.length === 0 ? 'There are no unsaved bills to recover.' : '' })
    useRouter.getState().navigate(ROUTES.dashboard)
  },
  consumeFocus: () => set({ wantFocus: false })
}))
