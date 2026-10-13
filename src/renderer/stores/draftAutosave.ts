import { buildDraftPayload, shouldKeepDraft } from '@shared/draft'
import type { Quot3Bridge } from '@shared/ipc'
import { useBillStore } from './billStore'
import { autosaveMs } from './behaviourStore'

/**
 * Phase 29 — debounced draft autosave (UNDO_REDO_RULES §3). While the open bill differs from its saved / opened state, it is
 * written to ONE draft row (id = the bill-session id) `DRAFT_AUTOSAVE_MS` after the last change; when it is clean again (undone
 * to the saved state) or saved / discarded, the row goes. The write is a timer callback + an async bridge call — it never runs
 * inside a keystroke. Cell text still being typed is committed to the store on leaving the cell (Phase 11), so a crash loses at
 * most the cell in progress. Failures are swallowed (the next change retries); a draft must never interrupt typing.
 */
type DraftBridge = Pick<Quot3Bridge, 'drafts'>
const bridge = (): DraftBridge['drafts'] | undefined => (window as unknown as { quot3?: Partial<DraftBridge> }).quot3?.drafts

let timer: ReturnType<typeof setTimeout> | null = null
/** Serialises bridge calls so a delete can never overtake the write before it. */
let queue: Promise<void> = Promise.resolve()
/** Draft rows this app session knows exist (written here or recovered), so a clean bill does not fire needless deletes. */
const known = new Set<string>()

const chain = (fn: () => Promise<void>): Promise<void> => {
  queue = queue.then(fn).catch(() => undefined)
  return queue
}

async function deleteRow(id: string): Promise<void> {
  const api = bridge()
  if (!api) return
  try { await api.delete(id) } catch { /* retried implicitly: a leftover row is cleaned by the stale sweep */ }
}

/** Runs when the timer fires (reads the store NOW, so it always writes the latest state). */
function write(): Promise<void> {
  return chain(async () => {
    const api = bridge()
    const s = useBillStore.getState()
    if (!api || s.billId === null) return
    if (!shouldKeepDraft({ billId: s.billId, dirty: s.dirty })) {
      if (known.delete(s.billId)) await deleteRow(s.billId)
      return
    }
    const bill = s.toBill()
    try {
      const r = await api.save({
        draftId: bill.id,
        ...(bill.poNumber !== '' ? { billId: bill.id } : {}),
        payload: JSON.stringify(buildDraftPayload(bill))
      })
      if (r.ok) known.add(bill.id)
    } catch { /* next change retries */ }
  })
}

function schedule(ms: number): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void write() }, ms)
}

/** Subscribes to the bill store; returns the unsubscribe. Call once (the app shell does). */
/** `ms` fixes the delay (tests); without it the Settings > Behaviour autosave seconds apply, read at each change. */
export function startDraftAutosave(ms?: number): () => void {
  const off = useBillStore.subscribe((s, p) => {
    if (s.billId === p.billId && s.rows === p.rows && s.party === p.party && s.billDate === p.billDate && s.formatId === p.formatId && s.extraCols === p.extraCols && s.dirty === p.dirty) return
    schedule(ms ?? autosaveMs())
  })
  return () => {
    off()
    if (timer !== null) { clearTimeout(timer); timer = null }
  }
}

/** The draft of this bill session is no longer wanted (saved, or the owner chose Discard): cancel the pending write and delete the row. */
export function forgetDraft(id: string | null): Promise<void> {
  if (timer !== null) { clearTimeout(timer); timer = null }
  if (id === null) return queue
  known.delete(id)
  return chain(() => deleteRow(id))
}

/** A recovered draft stays in the database (another crash must still be recoverable); remember it so a clean state removes it. */
export function markDraftKnown(id: string): void { known.add(id) }

/** Resolves when every queued draft write / delete has finished (tests and orderly shutdown). */
export function draftAutosaveIdle(): Promise<void> { return queue }

/** Test helper: forget everything this module remembers. */
export function resetDraftAutosave(): void {
  if (timer !== null) { clearTimeout(timer); timer = null }
  known.clear()
  queue = Promise.resolve()
}
