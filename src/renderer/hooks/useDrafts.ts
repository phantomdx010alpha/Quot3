import { useEffect } from 'react'
import type { DraftSummary } from '@shared/draft'
import type { Quot3Bridge } from '@shared/ipc'
import { startDraftAutosave } from '../stores/draftAutosave'
import { useDraftStore } from '../stores/draftStore'
import { useBehaviourStore } from '../stores/behaviourStore'

/** Phase 29 — starts the autosave subscription and listens for `drafts:recoverable`; also pulls the list once at start-up. Mounted in `AppShell`. */
export function useDrafts(): void {
  useEffect(() => startDraftAutosave(), [])
  useEffect(() => { void useBehaviourStore.getState().load() }, [])
  useEffect(() => {
    void useDraftStore.getState().load()
    const bridge = (window as unknown as { quot3?: Partial<Pick<Quot3Bridge, 'on'>> }).quot3
    if (!bridge?.on) return
    return bridge.on('drafts:recoverable', (payload) => {
      const list = (payload as { drafts?: DraftSummary[] } | null)?.drafts
      if (Array.isArray(list)) useDraftStore.getState().setDrafts(list)
    })
  }, [])
}
