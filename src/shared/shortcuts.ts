import { listFormats } from './format/registry'

/**
 * THE shortcut registry (Phase 4). The palette, tooltips and cheat-sheet are all generated from this file.
 * Later phases append entries here; they never keep private key tables. Pure: no DOM, no Electron.
 */

/** Phase 20: one palette action per registered format, `format.set.<formatId>` (dynamic — see `formatActionDefs`). */
export type FormatActionId = `format.set.${string}`

export type ActionId =
  | FormatActionId
  | 'nav.dashboard'
  | 'nav.create'
  | 'nav.history'
  | 'nav.customers'
  | 'nav.items'
  | 'nav.games'
  | 'nav.settings'
  | 'nav.back'
  | 'bill.new'
  | 'palette.open'
  | 'help.shortcuts'
  | 'dev.designPreview'
  | 'dev.grid'
  | 'dev.perf'
  | 'dev.printPreview'
  | 'create.focusParty'
  | 'history.focusDates'
  | 'history.focusBills'
  | 'history.refresh'
  | 'history.search'
  | 'history.dateRange'
  | 'history.clearFilters'
  | 'history.open'
  | 'history.openPdf'
  | 'history.delete'
  | 'history.selectAll'
  | 'history.trash'
  | 'history.undoDelete'
  | 'revisions.open'
  | 'partyImport.open'
  | 'legacyImport.open'
  | 'settings.company'
  | 'settings.branch'
  | 'settings.print'
  | 'settings.behaviour'
  | 'settings.themes'
  | 'effects.toggle'
  | 'settings.appearance'
  | 'settings.shortcuts'
  | 'settings.backup'
  | 'settings.fresh'
  | 'settings.sync'
  | 'settings.joinBranch'
  | 'settings.audit'
  | 'settings.updates'
  | 'settings.about'
  | 'updates.check'
  | 'diagnostics.copy'
  | 'backup.create'
  | 'sync.keepMine'
  | 'sync.loadTheirs'
  | 'sync.toggle'
  | 'sync.now'
  | 'sync.compare'
  | 'sync.renameBranch'
  | 'customers.search'
  | 'customers.add'
  | 'customers.edit'
  | 'customers.bills'
  | 'customers.delete'
  | 'customers.duplicates'
  | 'customers.merge'
  | 'customers.notSame'
  | 'customers.undoMerge'
  | 'customers.unify'
  | 'items.search'
  | 'items.rebuild'
  | 'items.window1'
  | 'items.window2'
  | 'items.window3'
  | 'items.undo'
  | 'items.merge'
  | 'items.split'
  | 'items.move'
  | 'items.ignore'
  | 'items.confirm'
  | 'items.reject'
  | 'items.salesTab'
  | 'items.salesParty'
  | 'items.salesCopy'
  | 'history.emptyTrash'
  | 'history.restore'
  | 'history.purge'
  | 'create.focusDate'
  | 'create.address'
  | 'create.addressClose'
  | 'grid.resetTotal'
  | 'grid.bold'
  | 'grid.redBold'
  | 'grid.red'
  | 'grid.highlight'
  | 'grid.clearFormat'
  | 'grid.formatPalette'
  | 'grid.copy'
  | 'grid.cut'
  | 'grid.paste'
  | 'grid.selectRow'
  | 'grid.deleteRows'
  | 'grid.moveRowUp'
  | 'grid.moveRowDown'
  | 'grid.moveRowTop'
  | 'grid.moveRowBottom'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.historyPanel'
  | 'edit.revert'
  | 'bill.save'
  | 'draft.recover'
  | 'cols.add'
  | 'cols.remove'
  | 'cols.rename'
  | 'grid.colWiden'
  | 'grid.colNarrow'
  | 'grid.colWidthsReset'
  | 'units.mark'
  | 'units.summary'
  | 'units.marked'
  | 'calc.toggle'
  | 'calc.mode'
  | 'hybrid.toggle'
  | 'hybrid.focusFirst'
  | 'hybrid.focusSecond'
  | 'hybrid.recopy'
  | 'output.printRough'
  | 'output.printPro'
  | 'output.imageRough'
  | 'output.imagePro'
  | 'output.tsv'
  | 'output.pdfRough'
  | 'output.pdfPro'
  | 'output.openPdf'

export type ActionGroup = 'Navigate' | 'Bill' | 'Help' | 'Developer'

export interface ActionDef {
  id: ActionId
  label: string
  group: ActionGroup
}

export type ShortcutScope = 'global' | 'create' | 'history' | 'customers' | 'items' | 'grid'

export interface ShortcutDef {
  id: string
  /** e.g. "Ctrl+Shift+K". Modifier order is free; matching normalises it. */
  keys: string
  label: string
  scope: ShortcutScope
  action: ActionId
}

export interface KeyInput {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** Every command the palette can run — with or without a key binding. Registry order = default palette order. */
export const ACTIONS: readonly ActionDef[] = [
  { id: 'nav.dashboard', label: 'Go to Dashboard', group: 'Navigate' },
  { id: 'nav.create', label: 'Go to Create', group: 'Navigate' },
  { id: 'nav.history', label: 'Go to History', group: 'Navigate' },
  { id: 'nav.customers', label: 'Go to Customers', group: 'Navigate' },
  { id: 'nav.items', label: 'Go to Items', group: 'Navigate' },
  { id: 'nav.games', label: 'Go to Games', group: 'Navigate' },
  { id: 'nav.settings', label: 'Go to Settings', group: 'Navigate' },
  { id: 'nav.back', label: 'Back', group: 'Navigate' },
  { id: 'bill.new', label: 'New bill', group: 'Bill' },
  { id: 'palette.open', label: 'Command palette', group: 'Help' },
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', group: 'Help' },
  { id: 'dev.designPreview', label: 'Open design preview', group: 'Developer' },
  { id: 'dev.grid', label: 'Open grid (dev)', group: 'Developer' },
  { id: 'dev.perf', label: 'Open perf harness (dev)', group: 'Developer' },
  { id: 'dev.printPreview', label: 'Open print preview (dev)', group: 'Developer' },
  { id: 'create.focusParty', label: 'Focus party name', group: 'Bill' },
  { id: 'history.focusDates', label: 'Focus the dates list', group: 'Navigate' },
  { id: 'history.focusBills', label: 'Focus the bills list', group: 'Navigate' },
  { id: 'history.refresh', label: 'Refresh the bills list', group: 'Navigate' },
  { id: 'history.search', label: 'Search bills (party, bill no, item, amount)', group: 'Navigate' },
  { id: 'history.dateRange', label: 'Filter bills by date range', group: 'Navigate' },
  { id: 'history.clearFilters', label: 'Clear search and date filter', group: 'Navigate' },
  { id: 'history.open', label: 'Open the selected bill to edit', group: 'Bill' },
  { id: 'history.openPdf', label: 'Open the selected bill as PDF', group: 'Bill' },
  { id: 'history.delete', label: 'Delete the selected bill(s)', group: 'Bill' },
  { id: 'history.selectAll', label: 'Select all listed bills', group: 'Navigate' },
  { id: 'history.trash', label: 'Show / hide Recently deleted bills', group: 'Bill' },
  { id: 'history.undoDelete', label: 'Undo the last delete', group: 'Bill' },
  { id: 'revisions.open', label: 'Show earlier versions (revisions) of the bill', group: 'Bill' },
  { id: 'partyImport.open', label: 'Import parties from Excel', group: 'Navigate' },
  { id: 'legacyImport.open', label: 'Import legacy bills (old app folder)', group: 'Navigate' },
  { id: 'settings.company', label: 'Settings: Company details and logo', group: 'Navigate' },
  { id: 'settings.branch', label: 'Settings: Branch and PO prefix', group: 'Navigate' },
  { id: 'settings.print', label: 'Settings: Print defaults', group: 'Navigate' },
  { id: 'settings.behaviour', label: 'Settings: Behaviour', group: 'Navigate' },
  { id: 'settings.themes', label: 'Settings: Themes', group: 'Navigate' },
  { id: 'effects.toggle', label: 'Turn visual effects on / off', group: 'Help' },
  { id: 'settings.appearance', label: 'Settings: Density and font size', group: 'Navigate' },
  { id: 'settings.shortcuts', label: 'Settings: Keyboard shortcuts list', group: 'Navigate' },
  { id: 'settings.backup', label: 'Settings: Backup and restore', group: 'Navigate' },
  { id: 'settings.fresh', label: 'Settings: Start fresh (clear bills and customers, or factory reset)', group: 'Navigate' },
  { id: 'settings.sync', label: 'Settings: Sync and license', group: 'Navigate' },
  { id: 'settings.joinBranch', label: 'Settings: Join an existing branch (import history)', group: 'Navigate' },
  { id: 'settings.audit', label: 'Settings: Activity log (who did what, when)', group: 'Navigate' },
  { id: 'settings.updates', label: 'Settings: Updates', group: 'Navigate' },
  { id: 'settings.about', label: 'About Quot3 (version, publisher)', group: 'Help' },
  { id: 'updates.check', label: 'Check for updates now', group: 'Help' },
  { id: 'diagnostics.copy', label: 'Copy diagnostics (for support)', group: 'Help' },
  { id: 'backup.create', label: 'Create a backup now', group: 'Help' },
  { id: 'sync.keepMine', label: 'Another branch changed this bill: keep mine', group: 'Bill' },
  { id: 'sync.loadTheirs', label: 'Another branch changed this bill: load theirs', group: 'Bill' },
  { id: 'sync.toggle', label: 'Sync: switch on / off', group: 'Help' },
  { id: 'sync.now', label: 'Sync: send and fetch now', group: 'Help' },
  { id: 'sync.compare', label: 'Sync: compare with the shared notebook and sync', group: 'Help' },
  { id: 'sync.renameBranch', label: 'Sync: rename this branch', group: 'Help' },
  { id: 'history.restore', label: 'Restore the selected deleted bill(s)', group: 'Bill' },
  { id: 'history.purge', label: 'Delete the selected bill(s) forever', group: 'Bill' },
  { id: 'history.emptyTrash', label: 'Empty Recently deleted', group: 'Bill' },
  { id: 'create.focusDate', label: 'Focus bill date', group: 'Bill' },
  { id: 'create.address', label: 'Show / edit party address', group: 'Bill' },
  { id: 'create.addressClose', label: 'Hide party address', group: 'Bill' },
  { id: 'grid.resetTotal', label: 'Reset total to auto', group: 'Bill' },
  { id: 'grid.redBold', label: 'Red + Bold (selection or cell)', group: 'Bill' },
  { id: 'grid.bold', label: 'Bold (selection or cell)', group: 'Bill' },
  { id: 'grid.red', label: 'Red (selection or cell)', group: 'Bill' },
  { id: 'grid.highlight', label: 'Highlight cell', group: 'Bill' },
  { id: 'grid.clearFormat', label: 'Clear formatting', group: 'Bill' },
  { id: 'grid.formatPalette', label: 'Format palette', group: 'Bill' },
  { id: 'grid.copy', label: 'Copy cell / range', group: 'Bill' },
  { id: 'grid.cut', label: 'Cut cell / range', group: 'Bill' },
  { id: 'grid.paste', label: 'Paste (Excel / Quot3)', group: 'Bill' },
  { id: 'grid.selectRow', label: 'Select row (Ctrl+Space, Shift+Space in a number cell, or click the Sl.No)', group: 'Bill' },
  { id: 'grid.deleteRows', label: 'Delete selected rows (Delete; extra columns stay)', group: 'Bill' },
  { id: 'grid.moveRowUp', label: 'Move row up (Alt+Shift+Up; extra columns stay)', group: 'Bill' },
  { id: 'grid.moveRowDown', label: 'Move row down (Alt+Shift+Down; extra columns stay)', group: 'Bill' },
  { id: 'grid.moveRowTop', label: 'Move row to the top (extra columns stay)', group: 'Bill' },
  { id: 'grid.moveRowBottom', label: 'Move row to the bottom of the items (extra columns stay)', group: 'Bill' },
  { id: 'edit.undo', label: 'Undo', group: 'Bill' },
  { id: 'edit.redo', label: 'Redo', group: 'Bill' },
  { id: 'edit.historyPanel', label: 'Undo history panel', group: 'Bill' },
  { id: 'edit.revert', label: 'Revert to last saved', group: 'Bill' },
  { id: 'bill.save', label: 'Save bill', group: 'Bill' },
  { id: 'draft.recover', label: 'Recover unsaved bill', group: 'Bill' },
  { id: 'cols.add', label: 'Add extra column', group: 'Bill' },
  { id: 'cols.remove', label: 'Remove extra column', group: 'Bill' },
  { id: 'cols.rename', label: 'Rename extra column', group: 'Bill' },
  { id: 'grid.colWiden', label: 'Widen column', group: 'Bill' },
  { id: 'grid.colNarrow', label: 'Narrow column', group: 'Bill' },
  { id: 'grid.colWidthsReset', label: 'Reset column widths', group: 'Bill' },
  { id: 'units.mark', label: 'Mark / unmark cell (new segment header)', group: 'Bill' },
  { id: 'units.summary', label: 'Units summary', group: 'Bill' },
  { id: 'units.marked', label: 'Marked calculations', group: 'Bill' },
  { id: 'calc.toggle', label: 'Calculator (show / hide)', group: 'Bill' },
  { id: 'calc.mode', label: 'Calculator: switch between calculator and % calculator', group: 'Bill' },
  // Phase 151: Hybrid format (GST + Non-GST side by side). Alt+3 is the owner's key (MILESTONE14_DESIGN 1.6); the table-switch keys are [A] (Ctrl+Left / Right are taken by the cell editor).
  { id: 'hybrid.toggle', label: 'Switch to Hybrid (GST + Non-GST side by side)', group: 'Bill' },
  { id: 'hybrid.focusFirst', label: 'Hybrid: go to the first table (left)', group: 'Bill' },
  { id: 'hybrid.focusSecond', label: 'Hybrid: go to the second table (right)', group: 'Bill' },
  { id: 'hybrid.recopy', label: 'Hybrid: re-copy this table from the other side', group: 'Bill' },
  { id: 'output.printRough', label: 'Print - Rough', group: 'Bill' },
  { id: 'output.printPro', label: 'Print - Professional', group: 'Bill' },
  { id: 'output.imageRough', label: 'Copy image - Rough', group: 'Bill' },
  { id: 'output.imagePro', label: 'Copy image - Professional', group: 'Bill' },
  { id: 'output.tsv', label: 'Copy whole bill as TSV', group: 'Bill' },
  // Phase 38: palette-only (the print dialog's S key does the save; no global key so the frozen KB §8 map is untouched)
  { id: 'output.pdfRough', label: 'Save PDF - Rough', group: 'Bill' },
  { id: 'output.pdfPro', label: 'Save PDF - Professional', group: 'Bill' },
  { id: 'customers.search', label: 'Search customers', group: 'Navigate' },
  { id: 'customers.add', label: 'Add a customer', group: 'Navigate' },
  { id: 'customers.edit', label: 'Edit the customer', group: 'Navigate' },
  { id: 'customers.bills', label: "Show the customer's bills", group: 'Navigate' },
  { id: 'customers.delete', label: 'Delete the customer', group: 'Navigate' },
  { id: 'customers.duplicates', label: 'Customers: show / hide Possible duplicates', group: 'Navigate' },
  { id: 'customers.merge', label: 'Customers: merge the highlighted duplicate', group: 'Navigate' },
  { id: 'customers.notSame', label: 'Customers: these two are not the same', group: 'Navigate' },
  { id: 'customers.undoMerge', label: 'Customers: undo the last merge', group: 'Navigate' },
  { id: 'customers.unify', label: 'Customers: combine customers with exactly equal names', group: 'Navigate' },
  { id: 'items.search', label: 'Search items', group: 'Navigate' },
  { id: 'items.rebuild', label: 'Items: read all bills again', group: 'Navigate' },
  { id: 'items.window1', label: 'Items: go to Groups', group: 'Navigate' },
  { id: 'items.window2', label: 'Items: go to Spellings', group: 'Navigate' },
  { id: 'items.window3', label: 'Items: go to Sales', group: 'Navigate' },
  { id: 'items.undo', label: 'Items: undo the last decision', group: 'Navigate' },
  { id: 'items.merge', label: 'Items: merge (mark, pick the target, press again)', group: 'Navigate' },
  { id: 'items.split', label: 'Items: split the spelling into its own item', group: 'Navigate' },
  { id: 'items.move', label: 'Items: move the spelling to another item', group: 'Navigate' },
  { id: 'items.ignore', label: 'Items: not an item', group: 'Navigate' },
  { id: 'items.confirm', label: 'Items: confirm the suggested merge / open the sale', group: 'Navigate' },
  { id: 'items.reject', label: 'Items: these are different items', group: 'Navigate' },
  { id: 'items.salesTab', label: 'Items: switch Non-GST / GST sales', group: 'Navigate' },
  { id: 'items.salesParty', label: 'Items: sales of this party only (again = all)', group: 'Navigate' },
  { id: 'items.salesCopy', label: 'Items: copy the sales table (TSV)', group: 'Navigate' },
  { id: 'output.openPdf', label: 'Open last saved PDF', group: 'Bill' }
]

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'nav.dashboard', keys: 'Ctrl+0', label: 'Go to Dashboard', scope: 'global', action: 'nav.dashboard' },
  { id: 'nav.create', keys: 'Ctrl+1', label: 'Go to Create', scope: 'global', action: 'nav.create' },
  { id: 'nav.history', keys: 'Ctrl+2', label: 'Go to History', scope: 'global', action: 'nav.history' },
  { id: 'nav.customers', keys: 'Ctrl+3', label: 'Go to Customers', scope: 'global', action: 'nav.customers' },
  // Phase 112: Items is the sixth page; Ctrl+5 was free (the frozen map only covers Ctrl+0..4, which are unchanged).
  { id: 'nav.items', keys: 'Ctrl+5', label: 'Go to Items', scope: 'global', action: 'nav.items' },
  // Phase 202 (M19): Ctrl+6 was free [A]. Does nothing while Games is switched off in Settings.
  { id: 'nav.games', keys: 'Ctrl+6', label: 'Go to Games', scope: 'global', action: 'nav.games' },
  { id: 'nav.settings', keys: 'Ctrl+4', label: 'Go to Settings', scope: 'global', action: 'nav.settings' },
  { id: 'nav.back', keys: 'Escape', label: 'Back', scope: 'global', action: 'nav.back' },
  { id: 'bill.new', keys: 'Ctrl+N', label: 'New bill', scope: 'global', action: 'bill.new' },
  { id: 'palette.open', keys: 'Ctrl+K', label: 'Command palette', scope: 'global', action: 'palette.open' },
  { id: 'help.shortcuts.f1', keys: 'F1', label: 'Keyboard shortcuts', scope: 'global', action: 'help.shortcuts' },
  { id: 'grid.resetTotal', keys: 'Ctrl+Backspace', label: 'Reset total to auto', scope: 'grid', action: 'grid.resetTotal' },
  { id: 'grid.redBold', keys: 'Ctrl+Shift+R', label: 'Red + Bold', scope: 'grid', action: 'grid.redBold' },
  { id: 'grid.bold', keys: 'Ctrl+B', label: 'Bold', scope: 'grid', action: 'grid.bold' },
  { id: 'grid.highlight', keys: 'Ctrl+H', label: 'Highlight cell', scope: 'grid', action: 'grid.highlight' },
  { id: 'grid.clearFormat', keys: 'Ctrl+Shift+C', label: 'Clear formatting', scope: 'grid', action: 'grid.clearFormat' },
  { id: 'grid.formatPalette', keys: 'Ctrl+Shift+K', label: 'Format palette', scope: 'grid', action: 'grid.formatPalette' },
  { id: 'grid.copy', keys: 'Ctrl+C', label: 'Copy cell / range', scope: 'grid', action: 'grid.copy' },
  { id: 'grid.cut', keys: 'Ctrl+X', label: 'Cut cell / range', scope: 'grid', action: 'grid.cut' },
  { id: 'grid.paste', keys: 'Ctrl+V', label: 'Paste (Excel / Quot3)', scope: 'grid', action: 'grid.paste' },
  { id: 'grid.selectRow', keys: 'Ctrl+Space', label: 'Select row', scope: 'grid', action: 'grid.selectRow' },
  { id: 'grid.selectRow.shiftSpace', keys: 'Shift+Space', label: 'Select row (number cell)', scope: 'grid', action: 'grid.selectRow' },
  { id: 'grid.moveRowUp', keys: 'Alt+Shift+ArrowUp', label: 'Move row up', scope: 'grid', action: 'grid.moveRowUp' },
  { id: 'grid.moveRowDown', keys: 'Alt+Shift+ArrowDown', label: 'Move row down', scope: 'grid', action: 'grid.moveRowDown' },
  { id: 'edit.undo', keys: 'Ctrl+Z', label: 'Undo', scope: 'grid', action: 'edit.undo' },
  { id: 'edit.redo', keys: 'Ctrl+Y', label: 'Redo', scope: 'grid', action: 'edit.redo' },
  { id: 'edit.redo.shiftZ', keys: 'Ctrl+Shift+Z', label: 'Redo', scope: 'grid', action: 'edit.redo' },
  { id: 'edit.historyPanel', keys: 'Ctrl+Shift+H', label: 'Undo history panel', scope: 'global', action: 'edit.historyPanel' },
  { id: 'edit.revert', keys: 'Ctrl+Alt+Z', label: 'Revert to last saved', scope: 'global', action: 'edit.revert' },
  { id: 'bill.save', keys: 'Ctrl+S', label: 'Save bill', scope: 'global', action: 'bill.save' },
  { id: 'cols.add', keys: 'Ctrl+Alt+=', label: 'Add extra column', scope: 'global', action: 'cols.add' },
  { id: 'cols.remove', keys: 'Ctrl+Alt+-', label: 'Remove extra column', scope: 'global', action: 'cols.remove' },
  { id: 'cols.rename', keys: 'Ctrl+Alt+R', label: 'Rename extra column', scope: 'global', action: 'cols.rename' },
  { id: 'grid.colWiden', keys: 'Ctrl+Alt+]', label: 'Widen column', scope: 'global', action: 'grid.colWiden' },
  { id: 'grid.colNarrow', keys: 'Ctrl+Alt+[', label: 'Narrow column', scope: 'global', action: 'grid.colNarrow' },
  { id: 'grid.colWidthsReset', keys: 'Ctrl+Alt+0', label: 'Reset column widths', scope: 'global', action: 'grid.colWidthsReset' },
  { id: 'units.mark', keys: 'Ctrl+M', label: 'Mark / unmark cell', scope: 'global', action: 'units.mark' },
  { id: 'units.summary', keys: 'Ctrl+U', label: 'Units summary', scope: 'global', action: 'units.summary' },
  { id: 'units.marked', keys: 'Ctrl+Shift+M', label: 'Marked calculations', scope: 'global', action: 'units.marked' },
  // Phase 83: the calculator drawer. Alt+C was free in the shortcut-conflict test (shortcuts.test.ts), so the proposed key stands.
  { id: 'calc.toggle', keys: 'Alt+C', label: 'Calculator (show / hide)', scope: 'global', action: 'calc.toggle' },
  { id: 'calc.mode', keys: 'Alt+Shift+C', label: 'Calculator: switch between calculator and % calculator', scope: 'global', action: 'calc.mode' },
  { id: 'hybrid.toggle', keys: 'Alt+3', label: 'Switch to Hybrid (GST + Non-GST side by side)', scope: 'global', action: 'hybrid.toggle' },
  { id: 'hybrid.focusFirst', keys: 'Ctrl+Alt+ArrowLeft', label: 'Hybrid: go to the first table (left)', scope: 'global', action: 'hybrid.focusFirst' },
  { id: 'hybrid.focusSecond', keys: 'Ctrl+Alt+ArrowRight', label: 'Hybrid: go to the second table (right)', scope: 'global', action: 'hybrid.focusSecond' },
  { id: 'create.focusParty', keys: 'Ctrl+Shift+F', label: 'Focus party name', scope: 'global', action: 'create.focusParty' },
  { id: 'create.focusDate', keys: 'Ctrl+Shift+E', label: 'Focus bill date', scope: 'global', action: 'create.focusDate' },
  { id: 'create.address', keys: 'Alt+ArrowDown', label: 'Show / edit party address', scope: 'global', action: 'create.address' },
  { id: 'create.addressClose', keys: 'Alt+ArrowUp', label: 'Hide party address', scope: 'global', action: 'create.addressClose' },
  { id: 'help.shortcuts.slash', keys: 'Ctrl+/', label: 'Keyboard shortcuts', scope: 'global', action: 'help.shortcuts' },
  // Phase 30: the output actions of KB section 8 (frozen). Ctrl+Shift+P is Print - Professional; "focus party name" moved to Ctrl+Shift+F.
  { id: 'output.printRough', keys: 'Ctrl+P', label: 'Print - Rough', scope: 'global', action: 'output.printRough' },
  { id: 'output.printPro', keys: 'Ctrl+Shift+P', label: 'Print - Professional', scope: 'global', action: 'output.printPro' },
  { id: 'output.imageRough', keys: 'Ctrl+I', label: 'Copy image - Rough', scope: 'global', action: 'output.imageRough' },
  { id: 'output.imagePro', keys: 'Ctrl+Shift+I', label: 'Copy image - Professional', scope: 'global', action: 'output.imagePro' },
  { id: 'output.tsv', keys: 'Ctrl+Shift+T', label: 'Copy whole bill as TSV', scope: 'global', action: 'output.tsv' },
  // Phase 42: History. Print / image / TSV above act on the highlighted History bill when History is the page. Enter / Delete / Ctrl+A are handled by the bill list itself, Ctrl+F / Ctrl+O by the page.
  { id: 'history.search', keys: 'Ctrl+F', label: 'Search bills', scope: 'history', action: 'history.search' },
  { id: 'history.open', keys: 'Enter', label: 'Open / edit the bill', scope: 'history', action: 'history.open' },
  { id: 'history.openPdf', keys: 'Ctrl+O', label: 'Open the bill as PDF', scope: 'history', action: 'history.openPdf' },
  { id: 'history.delete', keys: 'Delete', label: 'Delete the bill(s)', scope: 'history', action: 'history.delete' },
  { id: 'history.selectAll', keys: 'Ctrl+A', label: 'Select all listed bills', scope: 'history', action: 'history.selectAll' },
  { id: 'history.trash', keys: 'Ctrl+Shift+D', label: 'Recently deleted', scope: 'history', action: 'history.trash' },
  { id: 'history.undoDelete', keys: 'Ctrl+Z', label: 'Undo delete', scope: 'history', action: 'history.undoDelete' },
  { id: 'history.emptyTrash', keys: 'Ctrl+Shift+Delete', label: 'Empty Recently deleted', scope: 'history', action: 'history.emptyTrash' },
  // Phase 44: revision history (undo layer L4). Global: acts on the open bill on Create and the highlighted bill on History.
  { id: 'partyImport.open', keys: 'Ctrl+Shift+J', label: 'Import parties from Excel', scope: 'global', action: 'partyImport.open' },
  { id: 'legacyImport.open', keys: 'Ctrl+Shift+L', label: 'Import legacy bills', scope: 'global', action: 'legacyImport.open' },
  { id: 'effects.toggle', keys: 'Ctrl+Alt+E', label: 'Turn visual effects on / off', scope: 'global', action: 'effects.toggle' },
  { id: 'backup.create', keys: 'Ctrl+Alt+B', label: 'Create a backup now', scope: 'global', action: 'backup.create' },
  { id: 'revisions.open', keys: 'Ctrl+Shift+V', label: 'Revisions - earlier versions of the bill', scope: 'global', action: 'revisions.open' },
  // Phase 45: Customers. Ctrl+F and Insert are handled by the page; Enter / F2 / Right / Delete by the list itself (they are listed here for the palette and the cheat-sheet).
  { id: 'customers.search', keys: 'Ctrl+F', label: 'Search customers', scope: 'customers', action: 'customers.search' },
  { id: 'customers.add', keys: 'Insert', label: 'Add a customer', scope: 'customers', action: 'customers.add' },
  { id: 'customers.edit', keys: 'Enter', label: 'Edit the customer', scope: 'customers', action: 'customers.edit' },
  { id: 'customers.edit.f2', keys: 'F2', label: 'Edit the customer', scope: 'customers', action: 'customers.edit' },
  { id: 'customers.bills', keys: 'ArrowRight', label: "Show the customer's bills", scope: 'customers', action: 'customers.bills' },
  { id: 'customers.delete', keys: 'Delete', label: 'Delete the customer', scope: 'customers', action: 'customers.delete' },
  // Phase 137: Possible duplicates. M / N only act while the section is open (the page ignores them otherwise and never swallows the key); unify is palette-only.
  { id: 'customers.duplicates', keys: 'Ctrl+D', label: 'Customers: show / hide Possible duplicates', scope: 'customers', action: 'customers.duplicates' },
  { id: 'customers.merge', keys: 'M', label: 'Customers: merge the highlighted duplicate', scope: 'customers', action: 'customers.merge' },
  { id: 'customers.notSame', keys: 'N', label: 'Customers: these two are not the same', scope: 'customers', action: 'customers.notSame' },
  { id: 'customers.undoMerge', keys: 'Ctrl+Shift+U', label: 'Customers: undo the last merge', scope: 'customers', action: 'customers.undoMerge' },
  // Phase 112: Items page. Handled by the page itself (like Customers). Alt+1 / Alt+2 are the format keys, so the three windows use Ctrl+Alt+1/2/3 [A] (Alt+Shift+digit would arrive as a symbol key);
  // Tab / Shift+Tab also walk the windows (listed on the F1 sheet as a context hint).
  { id: 'items.search', keys: 'Ctrl+F', label: 'Search items', scope: 'items', action: 'items.search' },
  { id: 'items.rebuild', keys: 'F5', label: 'Items: read all bills again', scope: 'items', action: 'items.rebuild' },
  { id: 'items.window1', keys: 'Ctrl+Alt+1', label: 'Items: go to Groups', scope: 'items', action: 'items.window1' },
  { id: 'items.window2', keys: 'Ctrl+Alt+2', label: 'Items: go to Spellings', scope: 'items', action: 'items.window2' },
  { id: 'items.window3', keys: 'Ctrl+Alt+3', label: 'Items: go to Sales', scope: 'items', action: 'items.window3' },
  // Phase 113: decisions. Ctrl+Z is handled by the page; M / S / V / Delete / Enter / X by the focused window (windowKeys.ts), so they never fire while typing in the search box.
  { id: 'items.undo', keys: 'Ctrl+Z', label: 'Items: undo the last decision', scope: 'items', action: 'items.undo' },
  { id: 'items.merge', keys: 'M', label: 'Items: merge (mark, pick the target, press again)', scope: 'items', action: 'items.merge' },
  { id: 'items.split', keys: 'S', label: 'Items: split the spelling into its own item', scope: 'items', action: 'items.split' },
  { id: 'items.move', keys: 'V', label: 'Items: move the spelling to another item', scope: 'items', action: 'items.move' },
  { id: 'items.ignore', keys: 'Delete', label: 'Items: not an item', scope: 'items', action: 'items.ignore' },
  { id: 'items.confirm', keys: 'Enter', label: 'Items: confirm the suggested merge / open the sale', scope: 'items', action: 'items.confirm' },
  { id: 'items.reject', keys: 'X', label: 'Items: these are different items', scope: 'items', action: 'items.reject' },
  // Phase 114: Sales window. G / P are handled by the focused Sales window (windowKeys.ts; Enter there opens the sale's bill and is the same registry key as `items.confirm`, which does whichever fits the focused window); Ctrl+Alt+T by the page [A] (Ctrl+Shift+T is the global whole-bill TSV key).
  { id: 'items.salesTab', keys: 'G', label: 'Items: switch Non-GST / GST sales', scope: 'items', action: 'items.salesTab' },
  { id: 'items.salesParty', keys: 'P', label: 'Items: sales of this party only (again = all)', scope: 'items', action: 'items.salesParty' },
  { id: 'items.salesCopy', keys: 'Ctrl+Alt+T', label: 'Items: copy the sales table (TSV)', scope: 'items', action: 'items.salesCopy' }
]

/** Phase 20: formats are data, so their palette actions and key bindings come from the registry, never from a hand-written list. */
export function formatActionId(formatId: string): FormatActionId { return `format.set.${formatId}` }

/** One palette action per registered format ("Switch to GST"), in registry order. Read live, so a newly registered format appears. */
export function formatActionDefs(): ActionDef[] {
  return listFormats().map((f) => ({ id: formatActionId(f.id), label: `Switch to ${f.label}`, group: 'Bill' as const }))
}

/** The key binding each registered format declares (`FormatDef.shortcut`, e.g. Alt+1) — global scope so it works from any focus. */
export function formatShortcutDefs(): ShortcutDef[] {
  return listFormats()
    .filter((f) => !!f.shortcut)
    .map((f) => ({ id: formatActionId(f.id), keys: f.shortcut as string, label: `Switch to ${f.label}`, scope: 'global' as const, action: formatActionId(f.id) }))
}

/** Static ACTIONS + the live per-format actions: everything the palette can run. */
export function allActions(): ActionDef[] { return [...ACTIONS, ...formatActionDefs()] }

/** Static SHORTCUTS + the live per-format bindings: everything the hotkey layer, tooltips and cheat-sheet use. */
export function allShortcuts(): ShortcutDef[] { return [...SHORTCUTS, ...formatShortcutDefs()] }

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  space: ' ',
  del: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  plus: '+'
}

function normalizeKey(key: string): string {
  if (key === ' ') return ' '
  const alias = KEY_ALIASES[key.toLowerCase()]
  if (alias) return alias
  return key.length === 1 ? key.toUpperCase() : key
}

/** Canonical form: "Ctrl+Alt+Shift+Meta+<Key>", letters upper-case. "ctrl+shift+k" → "Ctrl+Shift+K". */
export function normalizeKeys(keys: string): string {
  const parts = keys.split('+')
  // A trailing empty part means the key itself is "+" (e.g. "Ctrl++").
  const key = parts[parts.length - 1] === '' ? '+' : (parts.pop() as string)
  if (parts[parts.length - 1] === '') parts.pop()
  const mods = new Set<string>()
  for (const raw of parts) {
    const m = raw.toLowerCase()
    if (m === 'ctrl' || m === 'control') mods.add('Ctrl')
    else if (m === 'alt' || m === 'option') mods.add('Alt')
    else if (m === 'shift') mods.add('Shift')
    else if (m === 'meta' || m === 'cmd' || m === 'win') mods.add('Meta')
  }
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), normalizeKey(key)].join('+')
}

/** Canonical key string for a keyboard event. Bind shifted symbols by their base key + Shift. */
export function eventToKeys(e: KeyInput): string {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Meta')
  return [...mods, normalizeKey(e.key)].join('+')
}

const SCOPE_PRIORITY: Record<ShortcutScope, number> = { grid: 3, create: 2, history: 2, customers: 2, items: 2, global: 1 }

/**
 * Finds the shortcut for a key event. `scopes` are the currently active scopes (e.g. ['create','grid']);
 * `global` is always implied. When several match, the most specific scope wins.
 */
export function matchShortcut(
  e: KeyInput,
  scopes: readonly ShortcutScope[] = [],
  defs: readonly ShortcutDef[] = allShortcuts()
): ShortcutDef | null {
  const pressed = eventToKeys(e)
  const active = new Set<ShortcutScope>([...scopes, 'global'])
  let best: ShortcutDef | null = null
  for (const d of defs) {
    if (!active.has(d.scope) || normalizeKeys(d.keys) !== pressed) continue
    if (!best || SCOPE_PRIORITY[d.scope] > SCOPE_PRIORITY[best.scope]) best = d
  }
  return best
}

export interface ShortcutConflict {
  keys: string
  a: ShortcutDef
  b: ShortcutDef
}

/** Two bindings collide if they share normalised keys and can be active together (same scope, or one is global). */
export function findShortcutConflicts(defs: readonly ShortcutDef[] = allShortcuts()): ShortcutConflict[] {
  const out: ShortcutConflict[] = []
  for (let i = 0; i < defs.length; i++) {
    for (let j = i + 1; j < defs.length; j++) {
      const a = defs[i]!
      const b = defs[j]!
      if (normalizeKeys(a.keys) !== normalizeKeys(b.keys)) continue
      if (a.scope === b.scope || a.scope === 'global' || b.scope === 'global') out.push({ keys: normalizeKeys(a.keys), a, b })
    }
  }
  return out
}

export function shortcutsForAction(action: ActionId, defs: readonly ShortcutDef[] = allShortcuts()): ShortcutDef[] {
  return defs.filter((d) => d.action === action)
}

/** The first-registered key binding of an action, for tooltips/buttons/palette rows. */
export function primaryKeys(action: ActionId, defs: readonly ShortcutDef[] = allShortcuts()): string | undefined {
  return shortcutsForAction(action, defs)[0]?.keys
}
