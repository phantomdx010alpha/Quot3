import type { ActionId } from './shortcuts'

/**
 * Phase 30 - the bottom-bar output actions. Each one is a STUB until the phase that implements it lands; the table is the
 * single place that says which phase, so the button tooltip ("available in Phase 37"), the shortcut notice and the tests
 * agree. When a phase implements an action it sets `phase` to null (and the button/handler start doing the real work).
 * Pure: no DOM, no Electron.
 */
export type OutputActionId = Extract<ActionId, `output.${string}`>

export interface OutputActionDef {
  id: OutputActionId
  label: string
  /** Phase that implements it; null = implemented. */
  phase: number | null
}

export const OUTPUT_ACTIONS: readonly OutputActionDef[] = [
  { id: 'output.printRough', label: 'Print Rough', phase: null },
  { id: 'output.printPro', label: 'Print Professional', phase: null },
  { id: 'output.imageRough', label: 'Copy image Rough', phase: null },
  { id: 'output.imagePro', label: 'Copy image Professional', phase: null },
  { id: 'output.tsv', label: 'Copy bill as TSV', phase: null }
]

export function outputActionDef(id: OutputActionId): OutputActionDef {
  const d = OUTPUT_ACTIONS.find((a) => a.id === id)
  if (!d) throw new Error(`Unknown output action ${id}`)
  return d
}

/** Why the action cannot run yet, or null when it can. Used for the disabled tooltip and the shortcut notice. */
export function outputDisabledReason(id: OutputActionId): string | null {
  const d = outputActionDef(id)
  return d.phase === null ? null : `${d.label} is not built yet (arrives in Phase ${d.phase})`
}

/** Tooltip text: the label, or the label plus the reason while it is a stub. */
export function outputTooltip(id: OutputActionId): string {
  const d = outputActionDef(id)
  return d.phase === null ? d.label : `${d.label} - available in Phase ${d.phase}`
}
