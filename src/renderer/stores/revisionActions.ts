import type { Quot3Bridge } from '@shared/ipc'
import { currentPath, ROUTES } from '@shared/routes'
import { useRouter } from '../router/routerStore'
import { useBillStore } from './billStore'
import { createSession } from './createSession'
import { requestLeave } from './guardStore'
import { useHistoryStore } from './historyStore'
import { useRevisionStore } from './revisionStore'
import { useSaveUiStore } from './saveUiStore'

/** Phase 44 - Revision history actions (undo layer L4). Messages go through the same status line as the other bill actions. */
const say = (tone: 'ok' | 'warn' | 'danger', msg: string): void => useSaveUiStore.getState().announce(tone, msg)
const api = (): Pick<Quot3Bridge, 'revisions'> | undefined => (window as unknown as { quot3?: Pick<Quot3Bridge, 'revisions'> }).quot3

/**
 * Ctrl+Shift+V (also the palette and the History button): open the revision panel for the bill in front of the owner -
 * the open bill on Create, the highlighted bill on History. From any other page it opens History (it needs a bill to look at).
 * Pressing it again closes the panel.
 */
export function toggleRevisions(): boolean {
  const rs = useRevisionStore.getState()
  if (rs.open) { rs.close(); return true }
  const path = currentPath(useRouter.getState().nav)
  if (path === ROUTES.create) {
    const b = useBillStore.getState()
    if (b.billId === null || b.poNumber === '') { say('warn', 'This bill has not been saved yet - it has no revisions. Save it first (Ctrl+S)'); return false }
    void rs.openFor(b.billId, b.poNumber)
    return true
  }
  if (path === ROUTES.history) {
    const t = useHistoryStore.getState().targets()
    if (t.length === 0) { say('warn', 'Nothing to show revisions for - select a bill first'); return false }
    if (t.length > 1) { say('warn', `${t.length} bills selected - select one bill to see its revisions`); return false }
    void rs.openFor(t[0]!.id, t[0]!.poNumber)
    return true
  }
  useRouter.getState().navigate(ROUTES.history)
  return false
}

/**
 * "Restore this revision": the revision's content opens in Create as an UNSAVED change (the open bill's saved copy is the baseline),
 * so Save / Discard and undo apply and nothing is overwritten. If the bill open on Create has unsaved changes the normal
 * Save / Discard / Cancel prompt comes first.
 */
export function restoreSelectedRevision(): boolean {
  const rs = useRevisionStore.getState()
  const bridge = api()?.revisions
  if (!rs.open || rs.billId === null || rs.selected === null || !bridge) return false
  const items = rs.items
  const sel = items.find((r) => r.revision === rs.selected)
  if (sel?.isCurrent) { say('warn', 'That is already the current version of the bill'); return false }
  const billId = rs.billId
  const revision = rs.selected
  requestLeave(() => {
    void (async () => {
      try {
        const r = await bridge.restoreToDraft({ billId, revision })
        if (!r.ok) { say('danger', r.error.message); return }
        useBillStore.getState().loadDraft(r.data.draft, r.data.baseline)
        createSession.set(r.data.draft.id)
        useRevisionStore.getState().close()
        useRouter.getState().navigate(ROUTES.create)
        say('ok', `Revision ${r.data.fromRevision} loaded as an unsaved change - Save to keep it, or Discard`)
      } catch (e) {
        say('danger', `Could not restore: ${e instanceof Error ? e.message : 'unknown error'}`)
      }
    })()
  })
  return true
}
