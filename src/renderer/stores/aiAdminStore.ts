import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { AI_KEYS, readAiSettings, type AiSettings } from '@shared/ai/aiSettings'
import type { AiAdminState } from '@shared/ai/aiAdmin'
import { useAiPanelStore } from './aiPanelStore'

/**
 * Phase 230 (M22) - Settings > AI. Reads the four switches through the generic `settings` bridge and the status / progress through
 * `ai.admin`. Turning `ai.enabled` off tells the other AI stores to re-read at once (the main process stops the worker and indexing).
 * Plain-words errors; nothing here touches a bill or money.
 */
type Bridge = Pick<Quot3Bridge, 'settings' | 'ai'>
const bridge = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3

export type AiSwitch = keyof AiSettings
const KEY: Record<AiSwitch, string> = { enabled: AI_KEYS.enabled, billingPanel: AI_KEYS.billingPanel, itemSuggestions: AI_KEYS.itemSuggestions, sentenceSearch: AI_KEYS.sentenceSearch }

export interface AiAdminUi {
  settings: AiSettings
  admin: AiAdminState | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  note: string
  busy: boolean
  load: () => Promise<void>
  refresh: () => Promise<void>
  setSwitch: (which: AiSwitch, on: boolean) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  rebuild: () => Promise<void>
  deleteData: () => Promise<void>
}

const OFF: AiSettings = { enabled: false, billingPanel: false, itemSuggestions: false, sentenceSearch: false }
const NO_AI = 'AI is not available in this window.'

export const useAiAdminStore = create<AiAdminUi>((set, get) => {
  async function readAdmin(): Promise<void> {
    const ai = bridge()?.ai
    if (!ai?.admin) { set({ status: 'error', error: NO_AI }); return }
    const r = await ai.admin()
    if (r.ok) set({ admin: r.data, status: 'ready', error: '' })
    else set({ status: 'error', error: r.error.message })
  }
  /** Runs one control; the answer (or the refusal) is shown, never thrown. */
  async function control(call: (ai: Quot3Bridge['ai']) => Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string } }>, note: string): Promise<void> {
    const ai = bridge()?.ai
    if (!ai) { set({ error: NO_AI }); return }
    set({ busy: true, error: '', note: '' })
    try {
      const r = await call(ai)
      if (!r.ok) set({ error: r.error.message })
      else { set({ note }); await readAdmin() }
    } catch { set({ error: 'Something went wrong. Try again.' }) }
    set({ busy: false })
  }
  return {
    settings: OFF, admin: null, status: 'idle', error: '', note: '', busy: false,
    load: async () => {
      set({ status: 'loading', error: '', note: '' })
      try {
        const s = await bridge()?.settings?.getAll()
        if (s?.ok) set({ settings: readAiSettings(s.data) })
        await readAdmin()
      } catch { set({ status: 'error', error: 'Could not read the AI state.' }) }
    },
    refresh: async () => { try { await readAdmin() } catch { /* the last good state stays */ } },
    setSwitch: async (which, on) => {
      const prev = get().settings
      set({ settings: { ...prev, [which]: on }, error: '', note: '' })
      try {
        const r = await bridge()?.settings?.set(KEY[which], on)
        if (!r || !r.ok) { set({ settings: prev, error: r && !r.ok ? r.error.message : NO_AI }); return }
        // Other AI surfaces re-read the switches now, so turning the master off hides them all at once.
        await useAiPanelStore.getState().load()
        await readAdmin()
      } catch { set({ settings: prev, error: 'Could not save the switch.' }) }
    },
    pause: () => control((ai) => ai.pause(), 'Indexing paused.'),
    resume: () => control((ai) => ai.resume(), 'Indexing resumed.'),
    rebuild: () => control((ai) => ai.rebuild(), 'Rebuilding the index.'),
    deleteData: () => control((ai) => ai.deleteData(), 'AI data deleted.')
  }
})
