import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import type { BootstrapPreview, BootstrapResult } from '@shared/sync/bootstrap'

type Api = Quot3Bridge['bootstrap']
type BackupApi = Quot3Bridge['backup']
const bridge = (): { bootstrap?: Api; backup?: BackupApi } | undefined => (window as unknown as { quot3?: { bootstrap?: Api; backup?: BackupApi } }).quot3
const NO_BRIDGE = 'Importing is not available (no connection to the app).'

/** Phase 58 - the guided "join an existing branch" flow: 1 choose the backup, 2 review + PO prefix, 3 result. */
export interface BootstrapUiState {
  step: 'choose' | 'review' | 'done'
  busy: boolean
  error: string
  preview: BootstrapPreview | null
  result: BootstrapResult | null
  /** Pick a file with the native dialog (it joins the backups list as `imported-...`), then review it. */
  pickFile: () => Promise<boolean>
  /** Review a file that is already in the backups list. */
  review: (file: string) => Promise<boolean>
  apply: (prefix: string) => Promise<boolean>
  reset: () => void
}

export const useBootstrapStore = create<BootstrapUiState>((set, get) => ({
  step: 'choose', busy: false, error: '', preview: null, result: null,
  reset: () => set({ step: 'choose', busy: false, error: '', preview: null, result: null }),
  pickFile: async () => {
    const b = bridge()
    if (!b?.backup || !b.bootstrap) { set({ error: NO_BRIDGE }); return false }
    set({ busy: true, error: '' })
    try {
      const r = await b.backup.importFile()
      if (!r.ok) { set({ busy: false, error: r.error.message }); return false }
      if (r.data.cancelled || !r.data.backup) { set({ busy: false }); return false }
      set({ busy: false })
      return await get().review(r.data.backup.file)
    } catch {
      set({ busy: false, error: 'Something went wrong. Try again.' })
      return false
    }
  },
  review: async (file) => {
    const b = bridge()?.bootstrap
    if (!b) { set({ error: NO_BRIDGE }); return false }
    set({ busy: true, error: '' })
    try {
      const r = await b.preview(file)
      if (!r.ok) { set({ busy: false, error: r.error.message }); return false }
      set({ busy: false, step: 'review', preview: r.data })
      return true
    } catch {
      set({ busy: false, error: 'Something went wrong. Try again.' })
      return false
    }
  },
  apply: async (prefix) => {
    const b = bridge()?.bootstrap
    const p = get().preview
    if (!b || !p) { set({ error: NO_BRIDGE }); return false }
    set({ busy: true, error: '' })
    try {
      const r = await b.apply(p.file, prefix.trim() === '' ? undefined : prefix)
      if (!r.ok) { set({ busy: false, error: r.error.message }); return false }
      set({ busy: false, step: 'done', result: r.data })
      return true
    } catch {
      set({ busy: false, error: 'Something went wrong. Try again.' })
      return false
    }
  }
}))
