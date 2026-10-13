import { clearFormat, length, setRedBold, toggleBold, toggleHighlight, toggleRed } from './runs'
import type { Runs } from '../types'

/**
 * Phase 15 — the formatting commands the grid UI exposes, as one pure function (so keyboard, toolbar, palette and
 * tests all share it). Built on the Phase 14 runs engine; never touches the DOM.
 *  - `bold`      Ctrl+B            toggle bold on the selection (whole cell when there is no selection)
 *  - `redBold`   Ctrl+Shift+R      one press: red + bold on the selection (whole cell when none)
 *  - `red`       palette           toggle plain red (no bold)
 *  - `highlight` Ctrl+H            toggle highlight on the WHOLE cell (legacy "highlight cell" shortcut)
 *  - `clear`     Ctrl+Shift+C      remove all formatting from the selection (whole cell when none)
 */
export type FormatKind = 'bold' | 'redBold' | 'red' | 'highlight' | 'clear'

export const FORMAT_KINDS: readonly FormatKind[] = ['redBold', 'bold', 'red', 'highlight', 'clear']

export const FORMAT_LABELS: Readonly<Record<FormatKind, string>> = {
  redBold: 'Red + Bold',
  bold: 'Bold',
  red: 'Red',
  highlight: 'Highlight cell',
  clear: 'Clear formatting'
}

export function applyFormat(runs: Runs, kind: FormatKind, start: number, end: number = start): Runs {
  switch (kind) {
    case 'bold': return toggleBold(runs, start, end)
    case 'redBold': return setRedBold(runs, start, end)
    case 'red': return toggleRed(runs, start, end)
    case 'highlight': return toggleHighlight(runs, 0, length(runs))
    case 'clear': return clearFormat(runs, start, end)
  }
}

/** True when any run carries a style flag (lets the renderer keep the plain single-text-node path for unstyled names). */
export function hasStyle(runs: Runs): boolean {
  for (const r of runs) if (r.b || r.r || r.hl) return true
  return false
}
