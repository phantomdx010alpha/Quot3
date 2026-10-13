import { billHasContent } from '@shared/tsv/billTsv'
import type { PrintDecideInput, Quot3Bridge } from '@shared/ipc'
import { printDialogKey, type DialogKeyEvent, type ForcedPaper } from '@shared/print/printFlow'
import type { Bill, PrintMode } from '@shared/types'
import { useBillStore } from './billStore'
import { useGridUiStore } from './gridUiStore'
import { historyHooks } from './historyHooks'
import { usePrintUiStore } from './printUiStore'
import { useSaveUiStore } from './saveUiStore'
import { useHistoryStore } from './historyStore'

/**
 * Phase 37 - Ctrl+P (Rough) / Ctrl+Shift+P (Professional) / the bottom-bar buttons. Opens the print dialog with the paper
 * decision; Enter prints the suggested size, 4 / 5 force A4 / A5, A returns to the rules' choice, Y acknowledges the
 * extra-columns warning, Esc cancels. Printing goes through `print:print` (system dialog, or silent to the configured printer).
 */
type PrintBridge = Pick<Quot3Bridge, 'print'>
const bridge = (): PrintBridge | undefined => (window as unknown as { quot3?: PrintBridge }).quot3

const ui = (): ReturnType<typeof usePrintUiStore.getState> => usePrintUiStore.getState()
let seq = 0

/** The bill as `print:*` takes it (the save payload shape plus the PO number). */
export function printPayload(bill: Bill, mode: PrintMode, forced: ForcedPaper | undefined): PrintDecideInput {
  return {
    bill: { id: bill.id, party: bill.party, formatId: bill.formatId, extraCols: bill.extraCols, paperOverride: bill.paperOverride, billDate: bill.billDate, rows: bill.rows, poNumber: bill.poNumber, ...(bill.roundOff === 1 ? { roundOff: 1 as const } : {}), ...(bill.footerExtras ? { footerExtras: bill.footerExtras } : {}), ...(bill.tailRows ? { tailRows: bill.tailRows } : {}) },
    mode,
    ...(forced ? { forced } : {})
  }
}

async function decide(): Promise<void> {
  const s = ui()
  const api = bridge()?.print
  if (!s.bill || !api) { ui().set({ loading: false, measuring: false, error: 'Printing is not available (no connection to the app)' }); return }
  const mine = ++seq
  ui().set({ loading: true, measuring: false, error: '' })
  try {
    // Phase 73: the instant answer (pure paper engine, no hidden-window measurement) opens the dialog; the measured one refines it.
    if (api.decideQuick) {
      const q = await api.decideQuick(printPayload(s.bill, s.mode, s.forced))
      if (mine !== seq) return
      if (q.ok) ui().set({ loading: false, measuring: true, info: q.data, error: '' })
    }
    const res = await api.decide(printPayload(s.bill, s.mode, s.forced))
    if (mine !== seq) return // a newer request superseded this one
    if (!res.ok) {
      if (ui().info) ui().set({ loading: false, measuring: false, info: { ...ui().info!, measureFailed: true } }) // keep the instant answer; main re-checks when printing
      else ui().set({ loading: false, measuring: false, info: null, error: res.error.message })
      return
    }
    ui().set({ loading: false, measuring: false, info: res.data, error: '' })
    if (ui().autoPdf) { // opened by the "Save PDF" palette action
      ui().set({ autoPdf: false })
      if (!res.data.decision.requiresAck) void savePdf()
    }
  } catch (e) {
    if (mine !== seq) return
    if (ui().info) ui().set({ loading: false, measuring: false, info: { ...ui().info!, measureFailed: true } })
    else ui().set({ loading: false, measuring: false, info: null, error: e instanceof Error ? e.message : 'Could not decide the paper size' })
  }
}

/** Phase 42: open the dialog for a bill that is NOT the one on the Create page (History's Print / Open PDF). Same dialog, same rules. */
export function openPrintForBill(bill: Bill, mode: PrintMode, opts: { pdf?: boolean; openAfterSave?: boolean } = {}): boolean {
  const announce = useSaveUiStore.getState().announce
  if (ui().open) return false
  if (!billHasContent(bill)) { announce('warn', 'Nothing to print yet'); return false }
  ui().set({ open: true, mode, bill, forced: undefined, info: null, loading: true, measuring: false, printing: false, saving: false, autoPdf: opts.pdf === true, openAfterSave: opts.openAfterSave === true, acked: false, askAck: false, error: '' })
  void decide()
  return true
}

/** Open the dialog for the current bill. Returns whether it opened. */
export function openPrint(mode: PrintMode, opts: { pdf?: boolean } = {}): boolean {
  const announce = useSaveUiStore.getState().announce
  if (ui().open) return false
  if (useBillStore.getState().billId === null) { announce('warn', 'Nothing to print - open a bill first'); return false }
  historyHooks.selection?.flush() // commit a cell still being typed, so what is on screen is what prints
  return openPrintForBill(useBillStore.getState().toBill(), mode, opts)
}

export function closePrint(): void {
  seq++
  ui().set({ open: false, bill: null, info: null, loading: false, measuring: false, printing: false, saving: false, autoPdf: false, openAfterSave: false, error: '' })
  useGridUiStore.getState().refocus?.()
  useHistoryStore.getState().focusBills?.() // Phase 42: on History the list gets the focus back (the port is null elsewhere)
}

/** 4 / 5 / A: change the forced size and re-decide. */
export function forcePaper(forced: ForcedPaper): void {
  if (!ui().open || ui().printing || ui().saving) return
  ui().set({ forced, acked: false, askAck: false, autoPdf: false })
  void decide()
}

export function acknowledge(): void {
  const i = ui().info
  if (i?.decision.requiresAck) ui().set({ acked: true, askAck: false })
}

/** Print the current decision. Resolves true when the job reached the printer. */
export async function confirmPrint(): Promise<boolean> {
  const s = ui()
  const api = bridge()?.print
  const announce = useSaveUiStore.getState().announce
  if (!s.open || !s.bill || !s.info || s.loading || s.printing || s.saving || !api) return false
  if (s.info.decision.requiresAck && !s.acked) { ui().set({ askAck: true }); return false }
  ui().set({ printing: true, error: '' })
  try {
    const res = await api.print({ ...printPayload(s.bill, s.mode, s.forced), ack: s.acked })
    if (!res.ok) { ui().set({ printing: false, error: res.error.message }); return false }
    const d = res.data
    ui().set({ printing: false })
    if (d.cancelled) { closePrint(); return false } // the owner closed the system print dialog: nothing to report
    closePrint()
    announce('ok', d.switchedByMeasure ? `Sent to the printer on ${d.decision.size} - the text did not fit A5` : `Sent to the printer (${d.decision.size}${d.decision.pages > 1 ? `, ${d.decision.pages} pages` : ''})`)
    return true
  } catch (e) {
    ui().set({ printing: false, error: e instanceof Error ? e.message : 'Printing failed' })
    return false
  }
}

/** The last PDF this session saved (for the "Open last saved PDF" action). */
let lastPdfPath: string | null = null
export const lastSavedPdf = (): string | null => lastPdfPath

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/**
 * Phase 38 - save the dialog's bill as a PDF (the same decision and HTML as printing; same acknowledgement rule). The Save
 * dialog is the system one, opened by main. Resolves true when a file was written; closing the Save dialog keeps this dialog open.
 */
export async function savePdf(): Promise<boolean> {
  const s = ui()
  const api = bridge()?.print
  const announce = useSaveUiStore.getState().announce
  if (!s.open || !s.bill || !s.info || s.loading || s.printing || s.saving || !api) return false
  if (s.info.decision.requiresAck && !s.acked) { ui().set({ askAck: true }); return false }
  ui().set({ saving: true, error: '' })
  try {
    const res = await api.pdf({ ...printPayload(s.bill, s.mode, s.forced), ack: s.acked })
    ui().set({ saving: false })
    if (!res.ok) { ui().set({ error: res.error.message }); return false }
    const d = res.data
    if (d.cancelled || !d.filePath) return false // the owner closed the Save dialog: nothing to report, the print dialog stays
    lastPdfPath = d.filePath
    const openAfter = s.openAfterSave
    closePrint()
    if (openAfter) void openLastPdf()
    announce('ok', `Saved ${baseName(d.filePath)} (${d.decision.size}${d.pages > 1 ? `, ${d.pages} pages` : ''}) - Open last saved PDF from the palette`)
    return true
  } catch (e) {
    ui().set({ saving: false, error: e instanceof Error ? e.message : 'Could not save the PDF' })
    return false
  }
}

/** Open the PDF saved most recently this session in the system viewer. */
export async function openLastPdf(): Promise<boolean> {
  const announce = useSaveUiStore.getState().announce
  const api = bridge()?.print
  if (!lastPdfPath) { announce('warn', 'No PDF saved yet - use Save PDF first'); return false }
  if (!api) { announce('danger', 'Could not open the PDF: not available'); return false }
  try {
    const res = await api.openPdf({ filePath: lastPdfPath })
    if (!res.ok) { announce('danger', res.error.message); return false }
    return true
  } catch (e) {
    announce('danger', `Could not open the PDF: ${e instanceof Error ? e.message : 'unknown error'}`)
    return false
  }
}

/** Test hook: forget the remembered PDF. */
export function resetPdfMemory(): void { lastPdfPath = null }

/** Dialog key handler: returns true when the key was ours (the caller prevents default). */
export function handlePrintKey(e: DialogKeyEvent): boolean {
  const s = ui()
  if (!s.open || s.loading && e.key !== 'Enter') return false
  const a = printDialogKey(e, { requiresAck: s.info?.decision.requiresAck === true, acked: s.acked })
  if (a === null) return false
  if (a === 'print') void confirmPrint()
  else if (a === 'pdf') void savePdf()
  else if (a === 'needAck') ui().set({ askAck: true })
  else if (a === 'ack') acknowledge()
  else if (a === 'force4') forcePaper('A4')
  else if (a === 'force5') forcePaper('A5')
  else forcePaper('auto')
  return true
}
