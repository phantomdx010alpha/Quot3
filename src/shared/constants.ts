// Shared constants (pure). Paper thresholds do NOT belong here — see paper/paperConstants.ts (Phase 36).
export const APP_NAME = 'Quot3'

// Phase 24 — the "240 FPS" input-to-paint budget (CLAUDE_MUST_READ §5.6). One definition; the harness, tests and docs read it from here.
export const PERF_KEY_HZ = 240
/** One 240 Hz frame is ~4.17 ms; the gate target for p95 input→paint on an 80-row bill. */
export const PERF_P95_BUDGET_MS = 4.2

// Phase 29 — draft autosave. One definition; the autosave store, the service cleanup and the tests read it from here.
/** An unsaved bill is written to its draft row this long after the last change (never on the keystroke path). */
export const DRAFT_AUTOSAVE_MS = 2000
/** Drafts untouched for longer than this are removed at launch (with an audit row). */
export const DRAFT_STALE_DAYS = 14

// Phase 43 — Recently deleted (trash). One definition; the service, the launch purge, the UI and the tests read it from here.
/** A bill stays in Recently deleted this many days before the launch sweep purges it (setting `trash.retentionDays` overrides). */
export const TRASH_RETENTION_DAYS = 30
/** How long the "Undo delete" offer (Ctrl+Z on History) stays alive after a delete. */
export const UNDO_DELETE_MS = 10_000

// Phase 44 - Revision history. One definition; the prune, the service, the UI and the tests read it from here.
/** Newest revisions kept per bill (`bill_revisions`); older ones are pruned on every save. */
export const REVISION_MAX_PER_BILL = 50
