import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import type { ActivateInput, LicenseStatus } from '@shared/sync/license'

type Api = Quot3Bridge['license']
const api = (): Api | undefined => (window as unknown as { quot3?: { license?: Api } }).quot3?.license
const NO_BRIDGE = 'Sync is not available (no connection to the app).'

/** Phase 52 - Settings > Sync and license. Secrets typed here go to main once and are never kept in this store. */
export interface LicenseUiState {
  status: LicenseStatus | null
  busy: boolean
  error: string
  notice: string
  load: (check?: boolean) => Promise<void>
  activate: (input: ActivateInput) => Promise<boolean>
  deactivate: (confirm: string) => Promise<boolean>
  clearMessages: () => void
}

export const useLicenseStore = create<LicenseUiState>((set) => {
  async function run(call: (a: Api) => ReturnType<Api['status']>, notice: string): Promise<boolean> {
    const a = api()
    if (!a) { set({ error: NO_BRIDGE }); return false }
    set({ busy: true, error: '', notice: '' })
    try {
      const r = await call(a)
      if (!r.ok) { set({ busy: false, error: r.error.message }); return false }
      set({ busy: false, status: r.data, notice })
      return true
    } catch {
      set({ busy: false, error: 'Something went wrong. Try again.' })
      return false
    }
  }
  return {
    status: null, busy: false, error: '', notice: '',
    clearMessages: () => set({ error: '', notice: '' }),
    load: async (check) => {
      const a = api()
      if (!a) { set({ error: NO_BRIDGE }); return }
      if (check === true) set({ busy: true, error: '', notice: '' })
      try {
        const r = await a.status(check)
        set(r.ok ? { status: r.data, busy: false } : { error: r.error.message, busy: false })
      } catch { set({ error: 'Could not read the license status.', busy: false }) }
    },
    activate: (input) => run((a) => a.activate(input), 'Activated. This branch is registered with the license.'),
    deactivate: (confirm) => run((a) => a.deactivate(confirm), 'Deactivated on this computer.')
  }
})
