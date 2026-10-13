import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { emptyMapping, type ColumnMapping, type ImportField, type ImportMode, type PartyImportPreview, type PartyImportReport, type PartyImportSummary } from '@shared/partyImport/partyImport'

type Bridge = Pick<Quot3Bridge, 'partyImport'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3

export type ImportStep = 'closed' | 'choosing' | 'mapping' | 'importing' | 'done'

export interface PartyImportState {
  step: ImportStep
  filePath: string
  sheet: string
  headerRow: number | null
  mapping: ColumnMapping
  mode: ImportMode
  preview: PartyImportPreview | null
  report: PartyImportReport | null
  undoMessage: string
  error: string
  busy: boolean
  /** Called after an import or an undo changed the saved parties (the Customers page reloads). */
  onChanged: (() => void) | null
  start: () => Promise<void>
  close: () => void
  setMapping: (field: ImportField, column: number | null) => Promise<void>
  setMode: (mode: ImportMode) => Promise<void>
  setSheet: (sheet: string) => Promise<void>
  setHeaderRow: (row: number) => Promise<void>
  commit: () => Promise<void>
  undo: () => Promise<void>
  recent: () => Promise<PartyImportSummary[]>
}

let token = 0
const FRESH = { filePath: '', sheet: '', headerRow: null, mapping: emptyMapping(), mode: 'skip' as ImportMode, preview: null, report: null, undoMessage: '', error: '', busy: false }

export const usePartyImportStore = create<PartyImportState>((set, get) => {
  /** (Re)build the preview with the current choices; a slower, older answer is dropped. */
  async function refresh(keep: { sheet: boolean; header: boolean; mapping: boolean }): Promise<void> {
    const a = api()?.partyImport
    const s = get()
    if (!a) { set({ step: 'mapping', error: 'The app bridge is not available' }); return }
    const my = ++token
    set({ busy: true, error: '' })
    const res = await a.preview({
      filePath: s.filePath,
      ...(s.sheet && keep.sheet ? { sheet: s.sheet } : {}),
      ...(s.headerRow !== null && keep.header ? { headerRow: s.headerRow } : {}),
      ...(keep.mapping ? { mapping: s.mapping } : {}),
      mode: s.mode
    })
    if (my !== token) return
    if (!res.ok) { set({ busy: false, error: res.error.message, step: s.preview ? 'mapping' : 'closed' }); return }
    const p = res.data
    set({ busy: false, step: 'mapping', preview: p, sheet: p.sheet, headerRow: p.headerRow, mapping: p.mapping, error: '' })
  }

  return {
    step: 'closed', ...FRESH, onChanged: null,

    async start() {
      const a = api()?.partyImport
      if (!a) return
      set({ ...FRESH, step: 'choosing' })
      const res = await a.pickFile()
      if (!res.ok) { set({ step: 'closed', error: res.error.message }); return }
      if (res.data === null) { set({ step: 'closed' }); return }
      set({ filePath: res.data.filePath })
      await refresh({ sheet: false, header: false, mapping: false })
    },

    close() { token++; set({ step: 'closed', busy: false }) },

    async setMapping(field, column) {
      set({ mapping: { ...get().mapping, [field]: column } })
      await refresh({ sheet: true, header: true, mapping: true })
    },
    async setMode(mode) { set({ mode }); await refresh({ sheet: true, header: true, mapping: true }) },
    async setSheet(sheet) { set({ sheet, headerRow: null, mapping: emptyMapping() }); await refresh({ sheet: true, header: false, mapping: false }) },
    async setHeaderRow(row) { set({ headerRow: Math.max(1, Math.floor(row) || 1), mapping: emptyMapping() }); await refresh({ sheet: true, header: true, mapping: false }) },

    async commit() {
      const a = api()?.partyImport
      const s = get()
      if (!a || s.busy || s.mapping.name === null) return
      set({ busy: true, step: 'importing', error: '' })
      const res = await a.commit({ filePath: s.filePath, sheet: s.sheet, ...(s.headerRow !== null ? { headerRow: s.headerRow } : {}), mapping: s.mapping, mode: s.mode })
      if (!res.ok) { set({ busy: false, step: 'mapping', error: res.error.message }); return }
      set({ busy: false, step: 'done', report: res.data, undoMessage: '' })
      get().onChanged?.()
    },

    async undo() {
      const a = api()?.partyImport
      const r = get().report
      if (!a || !r || get().busy) return
      set({ busy: true, error: '' })
      const res = await a.undo(r.importId)
      if (!res.ok) { set({ busy: false, error: res.error.message }); return }
      const u = res.data
      set({ busy: false, report: null, undoMessage: `Import undone: ${u.removed} removed, ${u.restored} restored${u.kept > 0 ? `, ${u.kept} kept because they were edited since` : ''}` })
      get().onChanged?.()
    },

    async recent() {
      const res = await api()?.partyImport?.list()
      return res && res.ok ? res.data : []
    }
  }
})
