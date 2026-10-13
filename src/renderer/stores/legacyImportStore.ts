import { create } from 'zustand'
import type { LegacyBatchInfo, LegacyCommitSummary, LegacyPreviewResult, LegacyUndoSummary, Quot3Bridge } from '@shared/ipc'
import type { ClashChoice } from '@shared/legacyImport/plan'
import type { LegacyPickResult, ReportFormat } from '@shared/legacyImport/uiModel'
import { useHistoryStore } from './historyStore'
import { useCustomersStore } from './customersStore'

type Bridge = Pick<Quot3Bridge, 'legacyImport' | 'on'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3

/** Pick -> Reading -> Preview -> Importing -> Report (LEGACY_IMPORT_SPEC section 7). */
export type LegacyStep = 'closed' | 'pick' | 'reading' | 'preview' | 'importing' | 'done'

export interface LegacyImportState {
  step: LegacyStep
  source: LegacyPickResult | null
  progress: { done: number; total: number } | null
  preview: LegacyPreviewResult | null
  /** Owner's per-file clash choices (files not listed use the planner's default). */
  choices: Record<string, ClashChoice>
  /** Phase 88: queue the imported bills for the other branches (default on). */
  send: boolean
  setSend: (v: boolean) => void
  result: LegacyCommitSummary | null
  batches: LegacyBatchInfo[]
  /** Result line of the last undo (also shown on the pick step). */
  undoMessage: string
  notice: string
  error: string
  busy: boolean
  /** Bumped after an import / undo changed bills, so History and Customers can reload. */
  changeTick: number

  open: () => Promise<void>
  close: () => void
  pick: (kind: 'folder' | 'files') => Promise<void>
  setChoice: (file: string, choice: ClashChoice) => Promise<void>
  backToPick: () => Promise<void>
  cancelReading: () => Promise<void>
  commit: () => Promise<void>
  undo: (batchId: string) => Promise<void>
  saveReport: (format: ReportFormat) => Promise<void>
  loadBatches: () => Promise<void>
}

const FRESH = { send: true, source: null, progress: null, preview: null, choices: {}, result: null, undoMessage: '', notice: '', error: '', busy: false }
let unsub: (() => void) | null = null
let token = 0

export const describeUndo = (u: LegacyUndoSummary): string => {
  const parts = [`${u.deleted} ${u.deleted === 1 ? 'bill' : 'bills'} moved to Recently deleted`]
  if (u.keptEdited.length > 0) parts.push(`${u.keptEdited.length} kept because they were edited since (${u.keptEdited.slice(0, 5).map((k) => k.poNumber).join(', ')}${u.keptEdited.length > 5 ? ', ...' : ''})`)
  if (u.partiesRemoved > 0) parts.push(`${u.partiesRemoved} ${u.partiesRemoved === 1 ? 'customer' : 'customers'} removed`)
  return `Import undone: ${parts.join(', ')}`
}

export const useLegacyImportStore = create<LegacyImportState>((set, get) => {
  const changed = (): void => {
    set({ changeTick: get().changeTick + 1 })
    // Reload only what has been opened before (a page that never loaded loads itself on first visit).
    if (useHistoryStore.getState().status !== 'idle') void useHistoryStore.getState().refresh()
    if (useCustomersStore.getState().status !== 'idle') void useCustomersStore.getState().load()
  }

  const follow = (): void => {
    unsub?.()
    unsub = api()?.on?.('legacyImport:progress', (p: unknown) => {
      const x = p as { sourceId?: string; done?: number; total?: number } | null
      if (!x || x.sourceId !== get().source?.sourceId || typeof x.done !== 'number' || typeof x.total !== 'number') return
      set({ progress: { done: x.done, total: x.total } })
    }) ?? null
  }

  async function runPreview(): Promise<void> {
    const a = api()?.legacyImport
    const s = get()
    if (!a || !s.source) return
    const my = ++token
    set({ step: 'reading', progress: null, error: '', busy: true })
    const res = await a.preview({ sourceId: s.source.sourceId, ...(Object.keys(s.choices).length > 0 ? { choices: s.choices } : {}) })
    if (my !== token) return
    if (!res.ok) { set({ busy: false, step: s.preview ? 'preview' : 'pick', error: res.error.message }); return }
    set({ busy: false, step: 'preview', preview: res.data, progress: null })
  }

  return {
    step: 'closed', ...FRESH, batches: [], changeTick: 0,

    async open() {
      follow()
      set({ ...FRESH, step: 'pick' })
      await get().loadBatches()
    },

    close() {
      if (get().step === 'importing') return // the write cannot be interrupted; the dialog stays until it finishes
      token++
      const a = api()?.legacyImport
      const src = get().source
      if (get().step === 'reading') void a?.cancel()
      if (a && src) void a.release(src.sourceId)
      unsub?.(); unsub = null
      set({ step: 'closed', ...FRESH })
    },

    async pick(kind) {
      const a = api()?.legacyImport
      if (!a || get().busy) return
      set({ error: '', busy: true })
      const res = await a.pick(kind)
      if (!res.ok) { set({ busy: false, error: res.error.message }); return }
      if (res.data === null) { set({ busy: false }); return }
      const old = get().source
      if (old) void a.release(old.sourceId)
      set({ source: res.data, choices: {}, preview: null, busy: false, undoMessage: '' })
      await runPreview()
    },

    async setChoice(file, choice) {
      if (get().busy) return
      set({ choices: { ...get().choices, [file]: choice } })
      await runPreview()
    },

    async backToPick() {
      token++
      const a = api()?.legacyImport
      const src = get().source
      if (a && src) void a.release(src.sourceId)
      set({ step: 'pick', source: null, preview: null, choices: {}, progress: null, error: '', busy: false })
      await get().loadBatches()
    },

    setSend: (v) => set({ send: v }),

    async cancelReading() {
      token++
      await api()?.legacyImport?.cancel()
      set({ step: get().preview ? 'preview' : 'pick', busy: false, progress: null, notice: 'Cancelled. Nothing was changed.' })
    },

    async commit() {
      const a = api()?.legacyImport
      const s = get()
      if (!a || !s.source || !s.preview || !s.preview.canImport || s.busy) return
      set({ busy: true, step: 'importing', error: '', notice: '' })
      const res = await a.commit({ sourceId: s.source.sourceId, ...(s.send ? {} : { send: false }), ...(Object.keys(s.choices).length > 0 ? { choices: s.choices } : {}) })
      if (!res.ok) { set({ busy: false, step: 'preview', error: res.error.message }); return }
      set({ busy: false, step: 'done', result: res.data })
      if (res.data.batchId !== null) changed()
    },

    async undo(batchId) {
      const a = api()?.legacyImport
      if (!a || get().busy) return
      set({ busy: true, error: '' })
      const res = await a.undo(batchId)
      if (!res.ok) { set({ busy: false, error: res.error.message }); return }
      set({ busy: false, undoMessage: describeUndo(res.data), result: get().result?.batchId === batchId ? null : get().result, step: get().step === 'done' ? 'pick' : get().step })
      await get().loadBatches()
      changed()
    },

    async saveReport(format) {
      const a = api()?.legacyImport
      const src = get().source
      if (!a || !src) return
      const res = await a.saveReport({ sourceId: src.sourceId, format })
      if (!res.ok) { set({ error: res.error.message }); return }
      set({ error: '', notice: res.data ? 'Report saved.' : '' })
    },

    async loadBatches() {
      const res = await api()?.legacyImport?.list()
      if (res && res.ok) set({ batches: res.data })
    }
  }
})
