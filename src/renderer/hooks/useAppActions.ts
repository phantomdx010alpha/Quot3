import { useMemo } from 'react'
import { ROUTES } from '@shared/routes'
import type { ActionHandlers } from './useHotkeys'
import { keepMine, loadTheirs } from '../stores/remoteChangeStore'
import { useRouter } from '../router/routerStore'
import { useUiStore } from '../stores/uiStore'
import type { FormatKind } from '@shared/richtext/format'
import { useGridUiStore } from '../stores/gridUiStore'
import { usePartyUiStore } from '../stores/partyUiStore'
import { runRedo, runUndo, requestRevert } from '../stores/undoActions'
import { useUndoUiStore } from '../stores/undoUiStore'
import { useCalcPanelStore } from '../stores/calcPanelStore'
import { runSave } from '../stores/saveActions'
import { openLastPdf, openPrint } from '../stores/printActions'
import { requestLeave } from '../stores/guardStore'
import { startFreshBill } from '../stores/createSession'
import { currentPath } from '@shared/routes'
import { switchFormat } from '../stores/formatActions'
import { enterHybrid, focusHybridTable, requestRecopy } from '../stores/hybridActions'
import { resetColumnWidths, stepActiveColWidth } from '../stores/columnWidthActions'
import { openUnitsPopup, runToggleMark, requestRemoveExtraCol, requestRenameExtraCol, runAddExtraCol } from '../stores/extraColActions'
import { runOutput } from '../stores/outputActions'
import { requestEmptyTrash, requestPurge, restoreSelected, toggleTrash, undoLastDelete } from '../stores/trashActions'
import { onHistoryPage, openSelectedBill, pdfSelectedBill, requestDelete, runHistoryOutput } from '../stores/historyActions'
import { useDraftStore } from '../stores/draftStore'
import { useHistoryStore } from '../stores/historyStore'
import { useCustomersStore } from '../stores/customersStore'
import { useDuplicatesStore } from '../stores/duplicatesStore'
import { useItemsStore } from '../stores/itemsStore'
import { onCustomersPage, showCustomerBills } from '../stores/customersActions'
import { toggleRevisions } from '../stores/revisionActions'
import { useLegacyImportStore } from '../stores/legacyImportStore'
import { usePartyImportStore } from '../stores/partyImportStore'
import { openSettingsSection } from '../stores/settingsStore'
import { compareAndSyncNow, focusBranchName } from '../stores/sharedSyncStore'
import { createBackupNow } from '../stores/backupStore'
import { useDiagnosticsStore } from '../stores/diagnosticsStore'
import { useUpdateStore } from '../stores/updateStore'
import { toggleSync, useSyncStatusStore } from '../stores/syncStatusStore'
import { formatActionId, type ActionId } from '@shared/shortcuts'
import { listFormats } from '@shared/format/registry'

/** Run a party-bar port; from another page, go to Create first and run it once the bar has mounted. */
function viaBar(pick: (s: ReturnType<typeof usePartyUiStore.getState>) => (() => void) | null, navigate: (p: string) => void): void {
  const port = pick(usePartyUiStore.getState())
  if (port) { port(); return }
  navigate(ROUTES.create)
  setTimeout(() => { pick(usePartyUiStore.getState())?.() }, 0)
}

/** Run a History focus port; from another page, open History first (its mount loads and focuses Dates). */
function viaHistory(pick: (s: ReturnType<typeof useHistoryStore.getState>) => (() => void) | null, navigate: (p: string) => void): void {
  const port = pick(useHistoryStore.getState())
  if (port) { port(); return }
  navigate(ROUTES.history)
  setTimeout(() => { pick(useHistoryStore.getState())?.() }, 0)
}

/** Phase 112: run an Items action; from another page, go to Items first. */
function viaItems(run: () => void, navigate: (p: string) => void): void {
  if (currentPath(useRouter.getState().nav) === ROUTES.items) { run(); return }
  navigate(ROUTES.items)
}

/** Phase 45: run a Customers action; from another page, go to Customers first. */
function viaCustomers(run: () => void, navigate: (p: string) => void): void {
  if (onCustomersPage()) { run(); return }
  navigate(ROUTES.customers)
}

function fmt(kind: FormatKind): void {
  const st = useGridUiStore.getState()
  if (st.format?.(kind)) st.refocus?.()
}

/** The single action → behaviour map used by both hotkeys and the command palette. */
export function useAppActions(): ActionHandlers {
  const navigate = useRouter((s) => s.navigate)
  const back = useRouter((s) => s.back)
  const togglePalette = useUiStore((s) => s.togglePalette)
  const openSheet = useUiStore((s) => s.openSheet)
  return useMemo<ActionHandlers>(
    () => ({
      // Phase 20: one handler per registered format (Alt+1 / Alt+2 and the palette), generated from the registry.
      ...Object.fromEntries(listFormats().map((f) => [formatActionId(f.id), () => { switchFormat(f.id) }])) as Partial<Record<ActionId, () => void>>,
      'nav.dashboard': () => navigate(ROUTES.dashboard),
      'nav.create': () => navigate(ROUTES.create),
      'nav.history': () => navigate(ROUTES.history),
      'nav.customers': () => navigate(ROUTES.customers),
      'nav.items': () => navigate(ROUTES.items),
      'nav.settings': () => navigate(ROUTES.settings),
      'nav.back': () => back(),
      // Until Phase 25+, "new bill" simply opens the (placeholder) Create page.
      // Phase 28: New bill starts over (asks first when the open bill has unsaved changes); from another page it opens Create.
      'bill.new': () => { requestLeave(startFreshBill) },
      // Phase 29: palette-only (no key): go to the Dashboard banner of unsaved bills.
      'draft.recover': () => { void useDraftStore.getState().showBanner() },
      'palette.open': () => togglePalette(),
      'help.shortcuts': () => openSheet(),
      'dev.designPreview': () => navigate(ROUTES.designPreview),
      'dev.grid': () => navigate(ROUTES.devGrid),
      'dev.perf': () => navigate(ROUTES.devPerf),
      'dev.printPreview': () => navigate(ROUTES.devPrintPreview),
      // Phase 45: Customers. Off the Customers page they only take you there (they need its list).
      'customers.search': () => viaCustomers(() => useCustomersStore.getState().focusSearch?.(), navigate),
      'customers.add': () => viaCustomers(() => { useCustomersStore.getState().startEdit(null) }, navigate),
      'customers.edit': () => viaCustomers(() => { const s = useCustomersStore.getState(); s.startEdit(s.selectedId) }, navigate),
      'customers.bills': () => viaCustomers(() => { void showCustomerBills() }, navigate),
      'customers.delete': () => viaCustomers(() => { useCustomersStore.getState().askDelete() }, navigate),
      'customers.duplicates': () => viaCustomers(() => { void useDuplicatesStore.getState().toggle() }, navigate),
      'customers.merge': () => viaCustomers(() => { if (useDuplicatesStore.getState().open) void useDuplicatesStore.getState().merge() }, navigate),
      'customers.notSame': () => viaCustomers(() => { if (useDuplicatesStore.getState().open) void useDuplicatesStore.getState().notSame() }, navigate),
      'customers.undoMerge': () => viaCustomers(() => { void useDuplicatesStore.getState().undoLast() }, navigate),
      'customers.unify': () => viaCustomers(() => { void useDuplicatesStore.getState().unify() }, navigate),
      // Phase 112: Items. Off the Items page they only take you there (they need its windows).
      'items.search': () => viaItems(() => useItemsStore.getState().ports.focusSearch?.(), navigate),
      'items.rebuild': () => viaItems(() => { void useItemsStore.getState().rebuild() }, navigate),
      'items.window1': () => viaItems(() => useItemsStore.getState().ports.focusWindow?.('groups'), navigate),
      'items.window2': () => viaItems(() => useItemsStore.getState().ports.focusWindow?.('spellings'), navigate),
      'items.window3': () => viaItems(() => useItemsStore.getState().ports.focusWindow?.('sales'), navigate),
      // Phase 113: decisions (palette; the keys themselves are handled by the Items windows). They act on the highlighted item / spelling.
      'items.undo': () => viaItems(() => { void useItemsStore.getState().undoDecision() }, navigate),
      'items.merge': () => viaItems(() => { void useItemsStore.getState().mergeKey() }, navigate),
      'items.split': () => viaItems(() => { void useItemsStore.getState().splitKey() }, navigate),
      'items.move': () => viaItems(() => useItemsStore.getState().moveKey(), navigate),
      'items.ignore': () => viaItems(() => { void useItemsStore.getState().ignoreKey() }, navigate),
      'items.confirm': () => viaItems(() => { const st = useItemsStore.getState(); if (st.window === 'sales') void st.openSaleBill(); else void st.confirmKey() }, navigate),
      // Phase 114: Sales window (palette; G / P are handled by the window itself).
      'items.salesTab': () => viaItems(() => { useItemsStore.getState().toggleSalesTab() }, navigate),
      'items.salesParty': () => viaItems(() => { void useItemsStore.getState().filterByCursorParty() }, navigate),
      'items.salesCopy': () => viaItems(() => { void useItemsStore.getState().copySales() }, navigate),
      'items.reject': () => viaItems(() => { void useItemsStore.getState().rejectKey() }, navigate),
      // Phase 41: palette-only. From another page go to History first, then run once its panels have mounted.
      'history.focusDates': () => viaHistory((s) => s.focusDates, navigate),
      'history.focusBills': () => viaHistory((s) => s.focusBills, navigate),
      'history.refresh': () => { if (currentPath(useRouter.getState().nav) !== ROUTES.history) navigate(ROUTES.history); else void useHistoryStore.getState().refresh() },
      // Phase 42: History actions. Off the History page they only take you there (they need its list).
      'history.search': () => viaHistory((s) => s.focusSearch, navigate),
      'history.dateRange': () => viaHistory((s) => s.focusDateRange, navigate),
      'history.clearFilters': () => { if (!onHistoryPage()) navigate(ROUTES.history); else void useHistoryStore.getState().clearFilters() },
      'history.open': () => { if (!onHistoryPage()) navigate(ROUTES.history); else openSelectedBill() },
      'history.openPdf': () => { if (!onHistoryPage()) navigate(ROUTES.history); else void pdfSelectedBill() },
      'history.delete': () => { if (!onHistoryPage()) navigate(ROUTES.history); else requestDelete() },
      // Phase 43: Recently deleted. Off the History page they only take you there.
      'history.trash': () => { if (!onHistoryPage()) navigate(ROUTES.history); else void toggleTrash() },
      // Phase 44: earlier versions of the bill (Create: the open bill, History: the highlighted one).
      'revisions.open': () => { toggleRevisions() },
      // Phase 47: party Excel import (a modal; Settings gets its own button in Phase 48).
      // Phase 48: palette-only jumps to a Settings section.
      'settings.company': () => openSettingsSection('company', navigate),
      'settings.branch': () => openSettingsSection('branch', navigate),
      'settings.print': () => openSettingsSection('print', navigate),
      'settings.behaviour': () => openSettingsSection('behaviour', navigate),
      'settings.themes': () => openSettingsSection('themes', navigate),
      'settings.appearance': () => openSettingsSection('appearance', navigate),
      'settings.shortcuts': () => openSettingsSection('shortcuts', navigate),
      'settings.backup': () => openSettingsSection('backup', navigate),
      'settings.fresh': () => openSettingsSection('fresh', navigate),
      'settings.sync': () => openSettingsSection('sync', navigate),
      'settings.joinBranch': () => openSettingsSection('sync', navigate),
      // Phase 61: the activity log; Copy diagnostics shows its result there.
      'settings.audit': () => openSettingsSection('audit', navigate),
      // Phase 62: updates (the Updates section shows progress and the Restart button).
      'settings.updates': () => openSettingsSection('updates', navigate),
      // Phase 63: About screen.
      'settings.about': () => openSettingsSection('about', navigate),
      'updates.check': () => { openSettingsSection('updates', navigate); void useUpdateStore.getState().check() },
      'diagnostics.copy': () => { openSettingsSection('audit', navigate); void useDiagnosticsStore.getState().copy() },
      // Phase 50: manual backup from any page; the Backup section shows the outcome.
      // Phase 56: the bill open on Create was changed on another branch (the banner has the same two buttons).
      'sync.keepMine': () => { void keepMine() },
      'sync.loadTheirs': () => { void loadTheirs() },
      // Phase 59: the switch and Sync now from anywhere; the Sync status page (Settings > Sync) shows the outcome.
      'sync.toggle': () => { openSettingsSection('sync', navigate); void toggleSync() },
      'sync.now': () => { openSettingsSection('sync', navigate); void useSyncStatusStore.getState().syncNow() },
      // Phase 139: the shared-notebook screen.
      'sync.compare': () => { openSettingsSection('sync', navigate); void compareAndSyncNow() },
      'sync.renameBranch': () => { openSettingsSection('sync', navigate); setTimeout(focusBranchName, 0) },
      'backup.create': () => { openSettingsSection('backup', navigate); void createBackupNow() },
      'partyImport.open': () => { void usePartyImportStore.getState().start() },
      'legacyImport.open': () => { void useLegacyImportStore.getState().open() },
      'history.undoDelete': () => { if (!onHistoryPage()) navigate(ROUTES.history); else void undoLastDelete() },
      'history.restore': () => { if (!onHistoryPage()) navigate(ROUTES.history); else void restoreSelected() },
      'history.purge': () => { if (!onHistoryPage()) navigate(ROUTES.history); else requestPurge() },
      'history.emptyTrash': () => { if (!onHistoryPage()) navigate(ROUTES.history); else requestEmptyTrash() },
      'history.selectAll': () => { if (!onHistoryPage()) navigate(ROUTES.history); else useHistoryStore.getState().selectAll() },
      'create.focusParty': () => viaBar((s) => s.focusParty, navigate),
      'create.focusDate': () => viaBar((s) => s.focusDate, navigate),
      'create.address': () => viaBar((s) => s.openAddress, navigate),
      'create.addressClose': () => { usePartyUiStore.getState().closeAddress?.() },
      'grid.resetTotal': () => useGridUiStore.getState().resetTotal?.(),
      // Phase 15: formatting from the command palette acts on the grid's remembered active name cell.
      'grid.redBold': () => fmt('redBold'),
      'grid.bold': () => fmt('bold'),
      'grid.red': () => fmt('red'),
      'grid.highlight': () => fmt('highlight'),
      'grid.clearFormat': () => fmt('clear'),
      'grid.formatPalette': () => useGridUiStore.getState().openFormatPalette?.(),
      'grid.copy': () => useGridUiStore.getState().copy?.(),
      'grid.cut': () => useGridUiStore.getState().cut?.(),
      'grid.paste': () => useGridUiStore.getState().paste?.(),
      'grid.selectRow': () => useGridUiStore.getState().selectRow?.(),
      'grid.deleteRows': () => useGridUiStore.getState().deleteRows?.(),
      'grid.moveRowUp': () => useGridUiStore.getState().moveRow?.('up'),
      'grid.moveRowDown': () => useGridUiStore.getState().moveRow?.('down'),
      'grid.moveRowTop': () => useGridUiStore.getState().moveRow?.('top'),
      'grid.moveRowBottom': () => useGridUiStore.getState().moveRow?.('bottom'),
      // Phase 17: bill-wide undo/redo (the keys are handled by the grid controller; palette runs the same store action)
      'edit.undo': () => { runUndo() },
      'edit.redo': () => { runRedo() },
      // Phase 18: history panel + revert to last saved (a revert prompt that is already open swallows the keys)
      'edit.historyPanel': () => { if (!useUndoUiStore.getState().revertOpen) useUndoUiStore.getState().togglePanel() },
      'edit.revert': () => { if (!useUndoUiStore.getState().revertOpen) requestRevert() },
      // Phase 27: save (only meaningful where a bill is being edited, i.e. the Create page)
      'bill.save': () => { if (currentPath(useRouter.getState().nav) === ROUTES.create) void runSave() },
      // Phase 21: extra columns (undoable; removal of a column with data asks first)
      'cols.add': () => { runAddExtraCol() },
      'cols.remove': () => requestRemoveExtraCol(),
      'cols.rename': () => requestRenameExtraCol(),
      // Phase 23: column widths
      'grid.colWiden': () => { stepActiveColWidth(1) },
      'grid.colNarrow': () => { stepActiveColWidth(-1) },
      'grid.colWidthsReset': () => resetColumnWidths(),
      // Phase 22: units feature
      'units.mark': () => { runToggleMark() },
      'units.summary': () => openUnitsPopup('units'),
      'units.marked': () => openUnitsPopup('marked'),
      // Phase 83: the calculator drawer lives on the Create page; from another page the key goes there first.
      'calc.toggle': () => { if (currentPath(useRouter.getState().nav) !== ROUTES.create) { navigate(ROUTES.create); useCalcPanelStore.getState().setOpen(true) } else useCalcPanelStore.getState().toggle() },
      'calc.mode': () => { if (currentPath(useRouter.getState().nav) !== ROUTES.create) navigate(ROUTES.create); useCalcPanelStore.getState().switchMode() },
      // Phase 151: Hybrid (GST + Non-GST side by side) lives on the Create page; the keys do nothing elsewhere.
      'hybrid.toggle': () => { if (currentPath(useRouter.getState().nav) === ROUTES.create) enterHybrid() },
      'hybrid.focusFirst': () => { if (currentPath(useRouter.getState().nav) === ROUTES.create) focusHybridTable('primary') },
      'hybrid.focusSecond': () => { if (currentPath(useRouter.getState().nav) === ROUTES.create) focusHybridTable('second') },
      'hybrid.recopy': () => { if (currentPath(useRouter.getState().nav) === ROUTES.create) requestRecopy() },
      // Phase 30: output actions (stubs until Phases 31 / 37 / 39; each says why it cannot run yet)
      'output.printRough': () => { if (!runHistoryOutput('output.printRough')) runOutput('output.printRough') },
      'output.printPro': () => { if (!runHistoryOutput('output.printPro')) runOutput('output.printPro') },
      'output.imageRough': () => { if (!runHistoryOutput('output.imageRough')) runOutput('output.imageRough') },
      'output.imagePro': () => { if (!runHistoryOutput('output.imagePro')) runOutput('output.imagePro') },
      'output.tsv': () => { if (!runHistoryOutput('output.tsv')) runOutput('output.tsv') },
      // Phase 38: PDF (palette only; the print dialog's S key saves too)
      'output.pdfRough': () => { if (!runHistoryOutput('output.pdfRough')) openPrint('rough', { pdf: true }) },
      'output.pdfPro': () => { if (!runHistoryOutput('output.pdfPro')) openPrint('professional', { pdf: true }) },
      'output.openPdf': () => { void openLastPdf() }
    }),
    [navigate, back, togglePalette, openSheet]
  )
}
