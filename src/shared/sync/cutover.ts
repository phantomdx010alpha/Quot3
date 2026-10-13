/**
 * Phase 140 - pure rules of the cutover from the v1 postbox to the shared notebook (MILESTONE12_DESIGN section 6).
 * No Electron, no Node, no DOM: the main service, the wizard and the tests all read the same words and the same step rule.
 *
 * The wizard has no stored "current step". The step is DERIVED from what is on disk (backup made, signed in, compare finished,
 * customers decided), so an interrupted wizard, a restart or a second window always resumes in the right place.
 */
export const CUTOVER_KEYS = {
  /** File name of the safety backup made at the start (set only after the backup really exists). */
  backupFile: 'cutover.backupFile',
  backupAt: 'cutover.backupAt',
  /** '1' while the old (v1) sync must stay stopped: its settings stay readable, its workers never start. */
  v1Inert: 'cutover.v1Inert',
  /** ISO time the owner finished the customer step: value is `done` or `skipped`. */
  unify: 'cutover.unify',
  /** ISO time the whole cutover finished (the v1 license is marked abandoned at the same moment). */
  doneAt: 'cutover.doneAt',
  v1Abandoned: 'cutover.v1Abandoned'
} as const

export type CutoverStep = 'backup' | 'signin' | 'compare' | 'unify' | 'done'
export const CUTOVER_STEPS: readonly CutoverStep[] = ['backup', 'signin', 'compare', 'unify', 'done']

export interface CutoverFacts {
  /** A v1 license is stored on this computer. */
  v1Active: boolean
  backupDone: boolean
  /** This computer is signed in to the shared notebook. */
  v2Active: boolean
  /** The first compare ran to the end. */
  compareDone: boolean
  /** The customer step was answered (unified or skipped). */
  unifyDone: boolean
  /** The whole cutover was finished. */
  finished: boolean
}

/** The wizard is offered only to a computer that has (or had, mid-way) a v1 activation and has not finished. A fresh install never sees it. */
export function cutoverNeeded(f: Pick<CutoverFacts, 'v1Active' | 'backupDone' | 'finished'>): boolean {
  return !f.finished && (f.v1Active || f.backupDone)
}

export function cutoverStep(f: CutoverFacts): CutoverStep {
  if (f.finished) return 'done'
  if (!f.backupDone) return 'backup'
  if (!f.v2Active) return 'signin'
  if (!f.compareDone) return 'compare'
  if (!f.unifyDone) return 'unify'
  return 'done'
}

export interface CutoverStatus {
  needed: boolean
  step: CutoverStep
  /** 1-based number of the step for "Step 2 of 4" (the done page counts as 4). */
  stepNo: number
  stepCount: number
  backupFile: string
  v1Inert: boolean
  /** Masked hint of the old license, for the "this one is abandoned" sentence. */
  v1LicenseHint: string
}
export const CUTOVER_STEP_COUNT = 4

export function stepNumber(step: CutoverStep): number {
  return step === 'done' ? CUTOVER_STEP_COUNT : CUTOVER_STEPS.indexOf(step) + 1
}

export interface CutoverWords { title: string; body: string; action: string }
export const CUTOVER_WORDS: Record<CutoverStep, CutoverWords> = {
  backup: {
    title: 'Back up and pause the old sync',
    body: 'Quot3 now keeps one shared notebook on Supabase instead of the old postbox. The Free plan of Supabase keeps no backups, so before anything changes Quot3 makes a fresh backup of this computer. The old sync is then paused here; its settings stay visible but it sends and fetches nothing.',
    action: 'Make backup and pause old sync'
  },
  signin: {
    title: 'Sign in to the shared notebook',
    body: 'Sign in with the new license, this computer\'s own e-mail and password, and choose a branch name that is different on every computer.',
    action: 'Sign in'
  },
  compare: {
    title: 'Compare with the notebook',
    body: 'Quot3 asks the notebook which bills and customers it holds and compares them with this computer. Bills that are the same on both sides are not sent again; bills only here are uploaded; bills only on the other computer are fetched. Nothing is deleted. You can stop and run it again: it carries on where it stopped.',
    action: 'Compare and sync'
  },
  unify: {
    title: 'Customers with the same name',
    body: 'Customers whose names are exactly the same (ignoring capitals and extra spaces) can be joined into one. Names that are only similar are never joined by themselves. Do this on ONE computer only, after both computers have finished the previous step. It can be undone from the Customers page.',
    action: 'Join same-name customers'
  },
  done: {
    title: 'Cutover finished',
    body: 'This computer now syncs through the shared notebook. The old license is abandoned and can be retired in Supabase. Your bills and the safety backup were not touched.',
    action: 'Close'
  }
}

/** What the compare step prints after a run (counts only: never a customer or bill name). */
export interface CutoverCompareNote { state: 'done' | 'paused'; upload: number; download: number; conflict: number; skip: number; /** The compare had already finished on this computer: nothing was run. */ already?: boolean }
export function cutoverCompareNote(r: CutoverCompareNote): string {
  if (r.already === true) return 'The comparison already finished on this computer. Nothing to do.'
  if (r.state === 'paused') return 'The comparison stopped part-way (connection or server). Press the button again; it carries on where it stopped.'
  const diff = r.upload + r.download + r.conflict
  if (diff === 0) return `Everything already matches the notebook (${r.skip} records the same).`
  return `Compared: ${r.skip} the same, ${r.upload} to send, ${r.download} to fetch${r.conflict > 0 ? `, ${r.conflict} different on both sides (the latest edit wins; the other version is kept)` : ''}.`
}

export function backupSentence(file: string): string {
  return file === '' ? 'No backup made yet.' : `Safety backup made: ${file}`
}

/** What the renderer may call (Phase 140 backs it with `cutover:*` channels). Every method answers an envelope; no secret ever travels back. */
export interface CutoverBridgeError { code: string; message: string }
export type CutoverResult<T> = { ok: true; data: T } | { ok: false; error: CutoverBridgeError }
export interface CutoverBridge {
  status(): Promise<CutoverResult<CutoverStatus>>
  /** Step 1: backup, then pause v1. Nothing changes if the backup fails. */
  begin(): Promise<CutoverResult<CutoverStatus>>
  /** Step 3 (needs step 2 done): the first compare; progress arrives on `sync:progress`. */
  compare(): Promise<CutoverResult<{ status: CutoverStatus; compare: CutoverCompareNote }>>
  /** Step 4: join exact-same-name customers, or skip. Answers counts only. */
  unify(input: { skip: boolean }): Promise<CutoverResult<{ status: CutoverStatus; merged: number; billsMoved: number }>>
}
