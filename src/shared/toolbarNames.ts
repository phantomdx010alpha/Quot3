import type { ActionId } from './shortcuts'

/**
 * Phase 147 - the SHORT visible names shown next to the icons of the Create page's toolbars (top toolbars and bottom
 * action bar). Keyed by the shortcut-registry action id, so a button's name, tooltip (full registry-style label) and
 * shortcut all hang off the same id. Kept short on purpose (<= `TOOLBAR_NAME_MAX` characters) so the bars never wrap
 * or grow taller. Pure: no DOM, no Electron.
 */
export const TOOLBAR_NAME_MAX = 14

export const TOOLBAR_NAMES = {
  'grid.redBold': 'Red + Bold',
  'grid.bold': 'Bold',
  'grid.clearFormat': 'Clear',
  'grid.highlight': 'Highlight',
  'grid.formatPalette': 'Palette',
  'cols.add': 'Add col',
  'cols.remove': 'Remove col',
  'cols.rename': 'Rename col',
  'units.mark': 'Mark',
  'units.summary': 'Units',
  'units.marked': 'Marked calc',
  'edit.undo': 'Undo',
  'edit.redo': 'Redo',
  'edit.historyPanel': 'History',
  'edit.revert': 'Revert',
  'output.printRough': 'Print Rough',
  'output.printPro': 'Print Pro',
  'output.imageRough': 'Image Rough',
  'output.imagePro': 'Image Pro',
  'output.tsv': 'Copy TSV',
  'bill.new': 'New',
  'bill.save': 'Save'
} as const satisfies Partial<Record<ActionId, string>>

export type ToolbarNameId = keyof typeof TOOLBAR_NAMES

export function toolbarName(id: ToolbarNameId): string {
  return TOOLBAR_NAMES[id]
}

/** Viewport width (px) below which the names are hidden and only the icons stay [A, Phase 147]. CSS mirrors it in `ui.css`. */
export const TOOLBAR_NAMES_MIN_WIDTH = 1180
