import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import type { BackupInfo, BackupStatus } from '@shared/backup/backupRules'

type Api = Quot3Bridge['backup']
const api = (): Api | undefined => (window as unknown as { quot3?: { backup?: Api } }).quot3?.backup
const NO_BRIDGE = 'Backups are not available (no connection to the app).'

/** Phase 50 - Settings > Backup state. Every call shows the service's own message when it refuses. */
export interface BackupUiState {
  list: BackupInfo[]
  status: BackupStatus | null
  busy: boolean
  error: string
  /** One-line result of the last action ("Backup saved: ..."), '' = none. */
  notice: string
  /** Set after Restore / Reset was accepted: the app is restarting. */
  restarting: boolean
  load: () => Promise<void>
  create: () => Promise<boolean>
  restore: (file: string, confirm: string) => Promise<boolean>
  remove: (file: string) => Promise<boolean>
  importFile: () => Promise<boolean>
  reset: (confirm: string) => Promise<boolean>
  clearMessages: () => void
}

export const useBackupStore = create<BackupUiState>((set, get) => {
  /** Runs one bridge call with busy / error handling. */
  async function run<T>(call: (a: Api) => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>, done: (d: T) => Partial<BackupUiState>): Promise<boolean> {
    const a = api()
    if (!a) { set({ error: NO_BRIDGE }); return false }
    set({ busy: true, error: '', notice: '' })
    try {
      const r = await call(a)
      if (!r.ok) { set({ busy: false, error: r.error.message }); return false }
      set({ busy: false, ...done(r.data) })
      return true
    } catch {
      set({ busy: false, error: 'Something went wrong. Try again.' })
      return false
    }
  }
  return {
    list: [], status: null, busy: false, error: '', notice: '', restarting: false,
    clearMessages: () => set({ error: '', notice: '' }),
    load: async () => {
      const a = api()
      if (!a) { set({ error: NO_BRIDGE }); return }
      try {
        const [l, s] = await Promise.all([a.list(), a.status()])
        set({ ...(l.ok ? { list: l.data } : { error: l.error.message }), ...(s.ok ? { status: s.data } : {}) })
      } catch { set({ error: 'Could not read the backups.' }) }
    },
    create: async () => {
      const ok = await run((a) => a.create(), (b) => ({ notice: `Backup saved: ${b.file}` }))
      if (ok) await get().load()
      return ok
    },
    restore: (file, confirm) => run((a) => a.restore(file, confirm), (d) => ({ restarting: true, notice: `Restoring. The app is restarting. Your current data was saved first as ${d.preRestore}.` })),
    remove: async (file) => {
      const ok = await run((a) => a.delete(file), () => ({ notice: `Deleted ${file}` }))
      if (ok) await get().load()
      return ok
    },
    importFile: async () => {
      let added = false
      const ok = await run((a) => a.importFile(), (d) => { added = !d.cancelled; return d.cancelled ? {} : { notice: `Imported as ${d.backup?.file ?? 'a backup'}. Choose Restore to use it.` } })
      if (ok && added) await get().load()
      return ok
    },
    reset: (confirm) => run((a) => a.resetLocalData(confirm), (d) => ({ restarting: true, notice: `Resetting. The app is restarting. Your old data was saved first as ${d.preRestore}.` }))
  }
})

/** Ctrl+Alt+B: a manual backup from any page, then the Backup section shows the result. */
export async function createBackupNow(): Promise<boolean> {
  return useBackupStore.getState().create()
}
