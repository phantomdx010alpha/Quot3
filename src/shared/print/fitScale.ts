/**
 * Phase 148 - print "spatial awareness" (fit-to-page). PURE: no DOM, no Electron.
 *
 * AFTER the paper is chosen (the 40/30/80/70 thresholds in `paper/paperConstants.ts` are untouched and never read here),
 * a bill that fits ONE page at the normal size may be scaled UP by one factor (font size and row padding together) so it
 * uses the page better. Rules: never below 1.0 (today's look is the floor); never above the cap (so a 5-row bill stays
 * compact, it does not fill the sheet); always MEASURED (the caller renders at a candidate factor and reports the real
 * content bottom, so wrapped names, header, totals, adjustments and extra columns are all counted); never overflows.
 * Top-aligned stays true: only sizes change, never vertical positioning (Phase 144 / 73).
 */
import type { Paper } from '../types'
import { PAGE_MARGIN_MM, PAPER_MM } from './printConstants'

/** Printable height of one page in CSS px (the same number as `printFlow.contentHeightPx`; kept here so this file does not import printFlow, which imports it; a test pins that they agree). */
export const pageHeightPx = (paper: Paper): number => Math.round((PAPER_MM[paper].h - 2 * PAGE_MARGIN_MM[paper]) * (96 / 25.4))

/** Share of the printable height the scaled bill may use (a little air at the bottom, and slack for rounding). */
export const FIT_FILL = 0.96
/** Candidate factors move in steps of this. */
export const FIT_STEP = 0.05
/** Most real measurements the search makes after the first (unscaled) one; then it gives up and keeps 1. */
export const FIT_MAX_TRIES = 5

/** Default maximum enlargement per paper [A: owner-confirmable]. */
export const FIT_DEFAULT_CAP: Readonly<Record<Paper, number>> = { A5: 1.35, A4: 1.25 }
/** The Settings range for the cap (1 = no enlargement at all). */
export const FIT_CAP_RANGE = { min: 1, max: 2 } as const

/** A usable cap: a finite number clamped to the range and rounded to 2 decimals; anything else -> the paper's default. */
export function normalizeFitCap(v: unknown, paper: Paper): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return FIT_DEFAULT_CAP[paper]
  return Math.round(Math.min(FIT_CAP_RANGE.max, Math.max(FIT_CAP_RANGE.min, v)) * 100) / 100
}

/** The settings as the print service uses them. */
export interface FitSettings { enabled: boolean; capA5: number; capA4: number }
export const DEFAULT_FIT_SETTINGS: FitSettings = Object.freeze({ enabled: true, capA5: FIT_DEFAULT_CAP.A5, capA4: FIT_DEFAULT_CAP.A4 })
export const fitCapFor = (s: FitSettings, paper: Paper): number => (paper === 'A5' ? s.capA5 : s.capA4)

const r2 = (n: number): number => Math.round(n * 100) / 100

/**
 * First guess from the unscaled measurement: height grows roughly with the factor, so `available / bottom1`, floored to a
 * step, then limited to [1, cap]. `bottom1` is the measured sheet bottom (CSS px) at factor 1. Not a promise: wrapping makes
 * real height grow faster than linearly, which is why `fitScaleSearch` verifies.
 */
export function fitEstimate(bottom1: number, paper: Paper, cap: number): number {
  if (!Number.isFinite(bottom1) || bottom1 <= 0) return 1
  const c = normalizeFitCap(cap, paper)
  const raw = (pageHeightPx(paper) * FIT_FILL) / bottom1
  const stepped = Math.floor(raw / FIT_STEP + 1e-9) * FIT_STEP
  return r2(Math.min(c, Math.max(1, stepped)))
}

/** True when a measured bottom (CSS px) fits the fill budget of one `paper` page. */
export const fitsBudget = (paper: Paper, bottomPx: number): boolean => Number.isFinite(bottomPx) && bottomPx <= pageHeightPx(paper) * FIT_FILL

export interface FitResult { scale: number; /** Measurements made (including the unscaled one). */ measures: number }

/**
 * The factor to render at. `measure(scale)` renders the bill at `scale` and returns the sheet bottom in CSS px (the caller
 * owns the hidden window). Steps: measure at 1; if that already overflows one page, or the budget leaves no room, keep 1;
 * otherwise try the estimate and step DOWN by `FIT_STEP` until a measurement fits (at most `FIT_MAX_TRIES`), else 1.
 * A throwing `measure` propagates (the caller keeps 1).
 */
export async function fitScaleSearch(measure: (scale: number) => Promise<number>, paper: Paper, cap: number): Promise<FitResult> {
  const c = normalizeFitCap(cap, paper)
  if (c <= 1) return { scale: 1, measures: 0 }
  const bottom1 = await measure(1)
  let measures = 1
  if (!Number.isFinite(bottom1) || bottom1 <= 0 || bottom1 > pageHeightPx(paper) + 1) return { scale: 1, measures }
  let s = fitEstimate(bottom1, paper, c)
  for (let i = 0; i < FIT_MAX_TRIES && s > 1; i++) {
    const b = await measure(s)
    measures++
    if (fitsBudget(paper, b)) return { scale: s, measures }
    s = r2(s - FIT_STEP)
  }
  return { scale: 1, measures }
}
