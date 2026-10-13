/**
 * Phase 33 - print layout constants (pure). Print geometry lives here and nowhere else; none of it depends on the UI
 * theme. Paper thresholds (A5/A4 row limits) are NOT here - they belong to paper/paperConstants.ts (Phase 36).
 */
import type { Paper } from '../types'

/** Page geometry in millimetres (portrait). */
export const PAPER_MM: Readonly<Record<Paper, { w: number; h: number }>> = {
  A5: { w: 148, h: 210 },
  A4: { w: 210, h: 297 }
}

/** Small fixed `@page` margins, mm. */
export const PAGE_MARGIN_MM: Readonly<Record<Paper, number>> = { A5: 6, A4: 10 }

/** Base text size in points per paper. A5 is dense so 40 rough rows plus the footer fit one A5 sheet (owner rule); 80 rows on one A4 sheet need a denser tier - Phase 35/36. */
export const PRINT_FONT_PT: Readonly<Record<Paper, { base: number; head: number; party: number }>> = {
  A5: { base: 7.5, head: 7, party: 11 },
  A4: { base: 9, head: 8.5, party: 14 }
}

/**
 * Phase 40 - A4 density tiers. The owner's rule "up to 80 rough / 70 professional rows on ONE A4 page" does not fit at the
 * normal 9 pt (about 4.3 mm per row), so a bill the engine says is one A4 page is fitted by trying tiers 0..n until the measured
 * content fits. Tier 0 is the normal style. Font sizes in pt, cell padding (top/bottom) in mm.
 */
export interface DensityTier { base: number; head: number; padY: number }
export const A4_DENSITY_TIERS: readonly DensityTier[] = [
  { base: 9, head: 8.5, padY: 0.3 },
  { base: 8, head: 7.5, padY: 0.25 },
  { base: 7, head: 6.5, padY: 0.2 },
  { base: 6.2, head: 6, padY: 0.15 },
  { base: 5.5, head: 5.2, padY: 0.1 }
]

/** Column width budget, in hundredths of a percent (integers, so the widths sum to exactly 10000). */
export const PRINT_WIDTH_TOTAL = 10000
/** Each extra (units) column's share of the table width: 11%. */
export const EXTRA_COL_PRINT_SHARE = 1100
/** The item-name column never shrinks below this while extras are added (20%). */
export const NAME_COL_MIN_SHARE = 2000

/**
 * Phase 35 - column floors (hundredths of a percent). No column is squeezed below its floor while another has room, so
 * "Sl.No", "Quantity" and amounts like 11804.00 are never broken mid-word or mid-number. Extras and the name column
 * give way first.
 */
export const PRINT_MIN_SHARE = { index: 800, numeric: 1100, extra: 800, name: NAME_COL_MIN_SHARE } as const

/** Bundled print fonts (resources/fonts). Latin + Latin-ext subsets: the latin-ext file holds the rupee sign (U+20B9). */
export const PRINT_FONT_FAMILY = 'Quot3 Noto Sans'
export interface PrintFontFile { file: string; weight: 400 | 700; unicodeRange: string }
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
export const PRINT_FONT_FILES: readonly PrintFontFile[] = [
  { file: 'noto-sans-latin-400-normal.woff2', weight: 400, unicodeRange: LATIN },
  { file: 'noto-sans-latin-ext-400-normal.woff2', weight: 400, unicodeRange: LATIN_EXT },
  { file: 'noto-sans-latin-700-normal.woff2', weight: 700, unicodeRange: LATIN },
  { file: 'noto-sans-latin-ext-700-normal.woff2', weight: 700, unicodeRange: LATIN_EXT }
]

/** Logo box: height cap per paper (mm) and width cap (share of the sheet). Aspect is always preserved (object-fit: contain). */
export const LOGO_MAX_HEIGHT_MM: Readonly<Record<Paper, number>> = { A5: 14, A4: 20 }
export const LOGO_MAX_WIDTH_PCT = 28

export const RUPEE = '₹'
