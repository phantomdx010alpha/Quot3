import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { DEFAULT_BEHAVIOUR, type BehaviourSettings } from '@shared/settings/appSettings'
import { DEFAULT_PERCENT_PRESETS, validatePercentPresets } from '@shared/calc/percentPresets'

/**
 * Phase 48 - the Settings > Behaviour numbers the grid and draft autosave read at the moment they need them.
 * Defaults apply until `load()` succeeds (and when there is no bridge), so a failing read never changes behaviour.
 */
export interface BehaviourState extends BehaviourSettings {
  /** Phase 75: `nav.smoothArrows` (default ON); the grid reads it on every key. */
  smoothArrows: boolean
  /** Phase 77: `calc.roundOff` (default ON): a NEW bill starts with the round-off flag set from this. */
  roundOff: boolean
  /** Phase 83: the % calculator's preset chips (`calc.percentPresets`, validated; default 18, 5, 3). */
  percentPresets: string[]
  load: () => Promise<void>
  applyNav: (n: { smoothArrows: boolean }) => void
  applyCalc: (c: { roundOff: boolean; percentPresets?: string }) => void
  apply: (b: BehaviourSettings) => void
}

type Api = Pick<Quot3Bridge, 'appSettings'>['appSettings']
const api = (): Api | undefined => (window as unknown as { quot3?: { appSettings?: Api } }).quot3?.appSettings

export const useBehaviourStore = create<BehaviourState>((set) => ({
  ...DEFAULT_BEHAVIOUR,
  smoothArrows: true,
  roundOff: true,
  percentPresets: [...DEFAULT_PERCENT_PRESETS],
  applyNav: (n) => set({ smoothArrows: n.smoothArrows }),
  applyCalc: (c) => {
    const v = c.percentPresets === undefined ? null : validatePercentPresets(c.percentPresets)
    set({ roundOff: c.roundOff, ...(v && v.ok ? { percentPresets: v.presets } : {}) })
  },
  apply: (b) => set({ trashRetentionDays: b.trashRetentionDays, leftUnlockPresses: b.leftUnlockPresses, autosaveSeconds: b.autosaveSeconds }),
  load: async () => {
    const a = api()
    if (!a) return
    try {
      const r = await a.get()
      if (r.ok) { useBehaviourStore.getState().apply(r.data.behaviour); useBehaviourStore.getState().applyNav(r.data.nav); useBehaviourStore.getState().applyCalc(r.data.calc) }
    } catch { /* keep the defaults */ }
  }
}))

export const autosaveMs = (): number => useBehaviourStore.getState().autosaveSeconds * 1000
