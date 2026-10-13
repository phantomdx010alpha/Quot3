import { create } from 'zustand'
import type { Quot3Bridge, Result } from '@shared/ipc'
import type { AppSettingsState, BehaviourSettings } from '@shared/settings/appSettings'
import { ROUTES } from '@shared/routes'
import { useBehaviourStore } from './behaviourStore'

type Api = Quot3Bridge['appSettings']
const api = (): Api | undefined => (window as unknown as { quot3?: { appSettings?: Api } }).quot3?.appSettings

export type SettingsSection = 'company' | 'branch' | 'print' | 'behaviour' | 'themes' | 'appearance' | 'shortcuts' | 'dashboard' | 'backup' | 'fresh' | 'sync' | 'audit' | 'updates' | 'about'
export const SETTINGS_SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: 'company', label: 'Company' },
  { id: 'branch', label: 'Branch and PO prefix' },
  { id: 'print', label: 'Print defaults' },
  { id: 'behaviour', label: 'Behaviour' },
  { id: 'themes', label: 'Themes' },
  { id: 'appearance', label: 'Density and font size' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'dashboard', label: 'Dashboard tiles' },
  { id: 'backup', label: 'Backup and restore' },
  { id: 'fresh', label: 'Start fresh' },
  { id: 'sync', label: 'Sync and license' },
  { id: 'audit', label: 'Activity log' },
  { id: 'updates', label: 'Updates' },
  { id: 'about', label: 'About Quot3' }
]

export interface SettingsUiState {
  section: SettingsSection
  status: 'idle' | 'loading' | 'ready' | 'error'
  loadError: string
  data: AppSettingsState | null
  /** The message of the last refused save (shown under the form), '' = none. */
  error: string
  /** Which field the error belongs to, when known. */
  saving: boolean
  /** Last successful save, for a short "Saved" line. */
  savedAt: number
  printers: string[]
  setSection: (s: SettingsSection) => void
  load: () => Promise<void>
  loadPrinters: () => Promise<void>
  clearError: () => void
  saveCompany: (i: { name: string; phone: string; address: string }) => Promise<boolean>
  chooseLogo: () => Promise<void>
  removeLogo: () => Promise<void>
  savePrefix: (prefix: string) => Promise<boolean>
  savePrint: (i: { rupeeOnTotal: boolean; silent: boolean; printer: string }) => Promise<boolean>
  saveBehaviour: (i: BehaviourSettings) => Promise<boolean>
  saveImage: (scale: number) => Promise<boolean>
  saveNav: (smoothArrows: boolean) => Promise<boolean>
  saveCalc: (roundOff: boolean) => Promise<boolean>
  /** Phase 82: `calc.percentPresets` (comma text; blank = default). */
  savePercentPresets: (text: string) => Promise<boolean>
}

const NO_BRIDGE = 'Settings are not available (no connection to the app).'

export const useSettingsStore = create<SettingsUiState>((set, get) => {
  /** Runs a save call: shows the refusal message, or replaces the data and stamps "Saved". */
  async function run(call: (a: Api) => Promise<Result<AppSettingsState>>): Promise<boolean> {
    const a = api()
    if (!a) { set({ error: NO_BRIDGE }); return false }
    set({ saving: true, error: '' })
    try {
      const r = await call(a)
      if (!r.ok) { set({ saving: false, error: r.error.message }); return false }
      set({ data: r.data, saving: false, savedAt: Date.now() })
      useBehaviourStore.getState().apply(r.data.behaviour); useBehaviourStore.getState().applyNav(r.data.nav); useBehaviourStore.getState().applyCalc(r.data.calc)
      return true
    } catch {
      set({ saving: false, error: 'Could not save. Try again.' })
      return false
    }
  }
  return {
    section: 'company', status: 'idle', loadError: '', data: null, error: '', saving: false, savedAt: 0, printers: [],
    setSection: (section) => set({ section, error: '' }),
    clearError: () => set({ error: '' }),
    load: async () => {
      const a = api()
      if (!a) { set({ status: 'error', loadError: NO_BRIDGE }); return }
      set({ status: get().data ? 'ready' : 'loading', loadError: '' })
      try {
        const r = await a.get()
        if (!r.ok) { set({ status: 'error', loadError: r.error.message }); return }
        set({ status: 'ready', data: r.data })
        useBehaviourStore.getState().apply(r.data.behaviour); useBehaviourStore.getState().applyNav(r.data.nav); useBehaviourStore.getState().applyCalc(r.data.calc)
      } catch {
        set({ status: 'error', loadError: 'Could not read the settings.' })
      }
    },
    loadPrinters: async () => {
      const a = api()
      if (!a) return
      try {
        const r = await a.printers()
        if (r.ok) set({ printers: r.data.printers })
      } catch { /* the printer box stays free text */ }
    },
    saveCompany: (i) => run((a) => a.saveCompany(i)),
    chooseLogo: async () => {
      const a = api()
      if (!a) { set({ error: NO_BRIDGE }); return }
      set({ saving: true, error: '' })
      try {
        const r = await a.chooseLogo()
        if (!r.ok) { set({ saving: false, error: r.error.message }); return }
        set({ data: r.data.state, saving: false, ...(r.data.cancelled ? {} : { savedAt: Date.now() }) })
      } catch {
        set({ saving: false, error: 'Could not add the logo.' })
      }
    },
    removeLogo: async () => { await run((a) => a.removeLogo()) },
    savePrefix: (prefix) => run((a) => a.savePrefix(prefix)),
    savePrint: (i) => run((a) => a.savePrint(i)),
    saveBehaviour: (i) => run((a) => a.saveBehaviour(i)),
    saveImage: (scale) => run((a) => a.saveImage({ scale })),
    saveNav: (smoothArrows) => run((a) => a.saveNav({ smoothArrows })),
    saveCalc: (roundOff) => run((a) => a.saveCalc({ roundOff })),
    savePercentPresets: (text) => run((a) => a.saveCalc({ percentPresets: text }))
  }
})

/** Palette action: open Settings on one section. */
export function openSettingsSection(section: SettingsSection, navigate: (p: string) => void): void {
  useSettingsStore.getState().setSection(section)
  navigate(ROUTES.settings)
}
