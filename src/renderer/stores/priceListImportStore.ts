import { create } from 'zustand'
import type { Quot3Bridge, Result } from '@shared/ipc'
import type { ImportPreview } from '@shared/pricelist/legacyImport'
import type { PriceImportRunResult } from '@shared/pricelist/api'

type Bridge = Pick<Quot3Bridge, 'pricelist'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3
const fail = (r: Result<unknown>): string => (r.ok ? '' : r.error.message)

/** Phase 237 (M23) - Settings > Price List: the legacy inventory import. The preview writes nothing; Import runs only after a preview. Selectors must return raw values (Phase 92 rule). */
export interface PriceListImportState {
  sourceId: string
  fileLabel: string
  preview: ImportPreview | null
  result: PriceImportRunResult | null
  error: string
  busy: boolean
  pick: () => Promise<void>
  refresh: () => Promise<void>
  run: () => Promise<void>
  reset: () => void
}

export const usePriceListImportStore = create<PriceListImportState>()((set, get) => {
  const call = async <T,>(fn: (b: NonNullable<Bridge['pricelist']>) => Promise<Result<T>>, ok: (d: T) => void): Promise<void> => {
    const b = api()?.pricelist
    if (!b) { set({ error: 'The app could not be reached. Restart Quot3.' }); return }
    set({ busy: true, error: '' })
    try {
      const r = await fn(b)
      if (!r.ok) { set({ error: fail(r) }); return }
      ok(r.data)
    } catch { set({ error: 'Something went wrong. Try again.' }) } finally { set({ busy: false }) }
  }
  return {
    sourceId: '', fileLabel: '', preview: null, result: null, error: '', busy: false,
    pick: () => call((b) => b.importPick(), (d) => {
      if (!d) return
      set({ sourceId: d.sourceId, fileLabel: d.label, preview: null, result: null })
      void get().refresh()
    }),
    refresh: async () => {
      const id = get().sourceId
      if (id === '') return
      await call((b) => b.importPreview(id), (d) => set({ preview: d }))
    },
    run: async () => {
      const id = get().sourceId
      if (id === '' || !get().preview) return
      await call((b) => b.importRun(id), (d) => set({ result: d, preview: d.preview }))
    },
    reset: () => set({ sourceId: '', fileLabel: '', preview: null, result: null, error: '', busy: false })
  }
})
