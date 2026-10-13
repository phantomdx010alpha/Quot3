import type { Paper } from '../types'

/**
 * Phase 33 - the PaperDecision shape from PAPER_ENGINE_RULES.md section 5 / API_CONTRACTS `paper/paperRules.ts`.
 * Declared here so the print model (Phase 33) can consume it before `decidePaper()` exists (Phase 36 adds
 * `paperRules.ts` + `paperConstants.ts` and imports this type; it must not redeclare it). Pure: types only.
 */
export interface PaperDecision {
  size: Paper
  pages: number
  /** What the rules recommend, even when a forced size differs. */
  suggested: Paper
  reasons: string[]
  warnings: string[]
  requiresAck: boolean
}

/** A plain A5 / one page decision - the default, and what previews use until Phase 36 supplies the real one. */
export function simplePaperDecision(size: Paper, pages = 1): PaperDecision {
  return { size, pages: Math.max(1, Math.floor(pages)), suggested: size, reasons: [], warnings: [], requiresAck: false }
}
