import { allActions, allShortcuts, type ActionGroup, type ShortcutScope } from './shortcuts'

/**
 * Phase 49 - the read-only shortcut viewer's rows (pure): every registered action with every key bound to it, searchable.
 * Built from the one shortcut registry, so it can never disagree with the palette or the tooltips.
 */
export interface ShortcutRow {
  action: string
  label: string
  group: ActionGroup
  bindings: { keys: string; scope: ShortcutScope }[]
}

const SCOPE_ORDER: Record<ShortcutScope, number> = { global: 0, create: 1, grid: 2, history: 3, customers: 4, items: 5 }

export function shortcutRows(): ShortcutRow[] {
  const shortcuts = allShortcuts()
  return allActions().map((a) => ({
    action: a.id,
    label: a.label,
    group: a.group,
    bindings: shortcuts
      .filter((s) => s.action === a.id)
      .map((s) => ({ keys: s.keys, scope: s.scope }))
      .sort((x, y) => SCOPE_ORDER[x.scope] - SCOPE_ORDER[y.scope])
  }))
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Every word of the query must appear in the label, the group, a key combination or a scope (case-insensitive). */
export function searchShortcutRows(rows: readonly ShortcutRow[], query: string): ShortcutRow[] {
  const words = norm(query).split(' ').filter(Boolean)
  if (words.length === 0) return [...rows]
  return rows.filter((r) => {
    const hay = norm([r.label, r.group, ...r.bindings.flatMap((b) => [b.keys, b.scope])].join(' '))
    return words.every((w) => hay.includes(w))
  })
}

/**
 * Phase 67 - keys that work INSIDE a control (the grid, a list, a dialog) and so are not registry actions. Shown on the F1 sheet so
 * it tells the whole keyboard story. Source of truth for the grid ones: docs/reference/KEYBOARD_CELL_RULES.md. Pure data.
 */
export interface ContextKeyHint { where: string; keys: string[]; does: string }
export const CONTEXT_KEY_HINTS: readonly ContextKeyHint[] = [
  { where: 'Grid', keys: ['Tab', 'Shift+Tab'], does: 'Next / previous cell (Tab past the last cell opens a fresh row)' },
  { where: 'Grid', keys: ['Enter', 'Shift+Enter'], does: 'Cell below / above' },
  { where: 'Grid', keys: ['ArrowUp', 'ArrowDown', 'ArrowRight'], does: 'Move between cells (Right moves on from the end of a cell)' },
  { where: 'Grid', keys: ['ArrowLeft'], does: 'Previous cell (smooth arrows ON, the default). With it OFF in Settings > Behaviour: press twice to edit in the middle of a cell' },
  { where: 'Grid', keys: ['F2'], does: 'Edit inside the cell: Left / Right then move letter by letter, and Left at the very start / Right at the very end moves to the neighbouring cell (smooth arrows ON)' },
  { where: 'Grid', keys: ['Escape'], does: 'While editing in the middle: back to the end of the cell; otherwise leave the bill (asks to save)' },
  { where: 'Grid', keys: ['Delete'], does: 'Clear the cell (or the selected range)' },
  { where: 'Grid', keys: ['Ctrl+Home', 'Ctrl+End'], does: 'First cell / last used cell' },
  { where: 'Grid', keys: ['Ctrl+ArrowUp', 'Ctrl+ArrowDown'], does: 'First / last row of the column' },
  { where: 'Grid', keys: ['PageUp', 'PageDown'], does: 'Up / down one page' },
  { where: 'Grid', keys: ['Shift+ArrowUp', 'Shift+ArrowDown'], does: 'Select a range of cells' },
  { where: 'Grid', keys: ['Ctrl+A'], does: 'Select all cells' },
  { where: 'Lists', keys: ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'], does: 'Move through the dates, bills and customers lists (the dashboard lists take the first four)' },
  { where: 'Items', keys: ['ArrowRight', 'ArrowLeft'], does: 'Groups: Right opens its Spellings; Spellings: Left goes back to Groups, Right to Sales' },
  { where: 'Items', keys: ['Delete'], does: 'Groups: not an item. Spellings: dismiss the highlighted suggestion (same as X)' },
  { where: 'Items', keys: ['ArrowUp', 'ArrowDown', 'Enter'], does: 'Sales: move over the sales; Enter (or double-click) opens that bill, Esc comes back to the same item' },
  { where: 'Items', keys: ['Escape'], does: 'Cancel a marked merge / move; in Sales clear the party filter; otherwise back to the Dashboard' },
  { where: 'Items', keys: ['Tab', 'Shift+Tab'], does: 'Move between the three windows: Groups, Spellings, Sales (Esc goes back to the Dashboard)' },
  { where: 'Lists', keys: ['Enter'], does: 'Open the highlighted item' },
  { where: 'Dialogs', keys: ['Tab', 'Shift+Tab'], does: 'Move between the dialog\'s controls (focus never leaves the dialog)' },
  { where: 'Dialogs', keys: ['Escape'], does: 'Close or cancel' },
  { where: 'Unsaved changes', keys: ['S', 'D', 'Escape'], does: 'Save / Discard / Cancel' },
  { where: 'Party name', keys: ['ArrowDown', 'ArrowUp', 'Enter'], does: 'Choose a matching party from the list; Esc closes the list only' },
  { where: 'Settings > Sync', keys: ['Enter'], does: 'Sign in (in the sign-in form) or Rename (in the rename box). Ctrl+K then "sync" finds Sync now, Compare and sync and Rename this branch' },
  { where: 'Command palette', keys: ['ArrowUp', 'ArrowDown', 'Enter', 'Escape'], does: 'Choose, run, close' }
]
