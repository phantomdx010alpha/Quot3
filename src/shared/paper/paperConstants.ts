import type { PrintMode } from '../types'

/**
 * Phase 36 - the ONLY place the paper thresholds live (PAPER_ENGINE_RULES §2, owner-specified). A lint-style test
 * (`paperConstants.test.ts`) fails if these numbers show up as literals in any other source file; everything else
 * imports from here. The per-format A5 extra-column limit is NOT here - it is `FormatDef.a5ExtraColLimit`.
 */

/** Most item + adjustment rows that still print on one A5 sheet. */
export const A5_MAX_ROWS: Readonly<Record<PrintMode, number>> = Object.freeze({ rough: 40, professional: 30 })

/** Most rows on one A4 sheet; beyond this the bill runs onto more A4 pages (assumption A3). */
export const A4_MAX_ROWS: Readonly<Record<PrintMode, number>> = Object.freeze({ rough: 80, professional: 70 })
