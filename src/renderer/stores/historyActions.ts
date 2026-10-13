import type { Quot3Bridge } from '@shared/ipc'
import { describeBills, historyRowsToTsv, type BillListItem } from '@shared/history/historyList'
import { billToTsv } from '@shared/tsv/billTsv'
import { currentPath, ROUTES } from '@shared/routes'
import type { Bill, PrintMode } from '@shared/types'
import { useRouter } from '../router/routerStore'
import { forgetDraft } from './draftAutosave'
import { useBillStore } from './billStore'
import { createSession, openBillForEdit } from './createSession'
import { requestLeave } from './guardStore'
import { useHistoryStore } from './historyStore'
import { copyImageOfBill } from './outputActions'
import { openPrintForBill } from './printActions'
import { useSaveUiStore } from './saveUiStore'
import type { OutputActionId } from '@shared/outputActions'
import { offerUndoDelete } from './trashActions'

/**
 * Phase 42 - everything the owner can do with a saved bill on the History page. Each action works on the highlighted bill
 * (print / image / PDF / open need exactly one) or on the multi-selection (delete, list export). Results are announced through
 * the same status line the Create page uses. Nothing here touches the Create page's open bill except Open/Edit (guarded) and
 * deleting the very bill that is open there.
 */
type Bridge = Pick<Quot3Bridge, 'bills' | 'clipboard'>
const bridge = (): Bridge | undefined => (window as unknown as { quot3?: Bridge }).quot3
const say = (tone: 'ok' | 'warn' | 'danger', msg: string): void => useSaveUiStore.getState().announce(tone, msg)

export const onHistoryPage = (): boolean => currentPath(useRouter.getState().nav) === ROUTES.history

/** The one bill an action needs; with several selected it explains instead of guessing. */
function single(verb: string): BillListItem | null {
  const t = useHistoryStore.getState().targets()
  if (t.length === 0) { say('warn', `Nothing to ${verb} - select a bill first`); return null }
  if (t.length > 1) { say('warn', `${t.length} bills selected - select one bill to ${verb}`); return null }
  return t[0]!
}

async function fetchBill(id: string): Promise<Bill | null> {
  const api = bridge()?.bills
  if (!api) { say('danger', 'Could not read the bill: not connected to the app'); return null }
  try {
    const r = await api.getForEdit(id)
    if (!r.ok) { say('danger', r.error.message); return null }
    return r.data
  } catch (e) {
    say('danger', `Could not read the bill: ${e instanceof Error ? e.message : 'unknown error'}`)
    return null
  }
}

/** Enter: open the highlighted bill in Create (asks first when the bill open there has unsaved changes). */
export function openSelectedBill(): boolean {
  const b = single('open')
  if (!b) return false
  requestLeave(() => {
    void openBillForEdit(b.id).then((ok) => { if (!ok) say('danger', `Could not open ${b.poNumber}`) })
  })
  return true
}

/** Print the highlighted bill (Rough: Ctrl+P, Professional: Ctrl+Shift+P) through the normal print dialog. */
export async function printSelectedBill(mode: PrintMode): Promise<boolean> {
  const b = single('print')
  if (!b) return false
  const bill = await fetchBill(b.id)
  return bill ? openPrintForBill(bill, mode) : false
}

/** Open PDF (Ctrl+O): the print dialog's PDF path in Professional mode, then the file opens in the viewer. `open: false` = only save it. */
export async function pdfSelectedBill(mode: PrintMode = 'professional', open = true): Promise<boolean> {
  const b = single('make a PDF of')
  if (!b) return false
  const bill = await fetchBill(b.id)
  return bill ? openPrintForBill(bill, mode, { pdf: true, openAfterSave: open }) : false
}

/** Copy image (Ctrl+I Rough / Ctrl+Shift+I Professional) of the highlighted bill. */
export async function imageSelectedBill(mode: PrintMode): Promise<boolean> {
  const b = single('copy as an image')
  if (!b) return false
  const bill = await fetchBill(b.id)
  return bill ? copyImageOfBill(bill, mode) : false
}

/**
 * Ctrl+Shift+T: one bill -> the whole bill as TSV (as on Create); several -> the list of those bills (Bill No, Date, Party, Total)
 * for Excel - the bulk export.
 */
export async function exportSelected(): Promise<boolean> {
  const targets = useHistoryStore.getState().targets()
  if (targets.length === 0) { say('warn', 'Nothing to copy - select a bill first'); return false }
  const clip = bridge()?.clipboard
  if (!clip) { say('danger', 'Could not copy: clipboard is not available'); return false }
  let payload: { text: string; html?: string }
  if (targets.length === 1) {
    const bill = await fetchBill(targets[0]!.id)
    if (!bill) return false
    payload = billToTsv(bill)
  } else {
    payload = { text: historyRowsToTsv(targets) }
  }
  try {
    const r = await clip.writeTsv(payload)
    if (!r.ok) { say('danger', `Could not copy: ${r.error.message}`); return false }
    say('ok', targets.length === 1 ? 'Bill copied - paste into Excel' : `${targets.length} bills copied as a list - paste into Excel`)
    return true
  } catch (e) {
    say('danger', `Could not copy: ${e instanceof Error ? e.message : 'unknown error'}`)
    return false
  }
}

/** Delete / the Delete button: asks first (the confirm dialog names what goes). */
export function requestDelete(): boolean {
  if (!useHistoryStore.getState().askDelete()) { say('warn', 'Nothing to delete - select a bill first'); return false }
  return true
}

/** The confirm dialog's Delete: soft delete to the trash; the Create page forgets a deleted bill it still had open. */
export async function confirmDelete(): Promise<boolean> {
  const pending = useHistoryStore.getState().confirmDelete
  if (!pending) return false
  let deleted: string[] = []
  try {
    deleted = await useHistoryStore.getState().confirmDeleteNow()
  } catch (e) {
    say('danger', `Could not delete: ${e instanceof Error ? e.message : 'unknown error'}`)
    return false
  }
  const open = createSession.get()
  if (open !== null && deleted.includes(open)) {
    createSession.set(null)
    useBillStore.setState({ billId: null })
    void forgetDraft(open)
  }
  if (deleted.length === 0) { say('danger', 'Nothing was deleted'); return false }
  const gone = pending.filter((b) => deleted.includes(b.id))
  offerUndoDelete(deleted, describeBills(gone))
  say('ok', `Deleted ${describeBills(gone)} - moved to Recently deleted (Ctrl+Z to undo)`)
  useHistoryStore.getState().focusBills?.()
  return true
}

export function cancelDelete(): void {
  useHistoryStore.getState().cancelDelete()
  useHistoryStore.getState().focusBills?.()
}

/** Route an output action (Ctrl+P / Ctrl+Shift+P / Ctrl+I / Ctrl+Shift+I / Ctrl+Shift+T / the Save PDF palette entries) to the History bill when History is the page. Returns whether it was handled. */
export function runHistoryOutput(id: OutputActionId | 'output.pdfRough' | 'output.pdfPro'): boolean {
  if (!onHistoryPage()) return false
  if (id === 'output.printRough') void printSelectedBill('rough')
  else if (id === 'output.printPro') void printSelectedBill('professional')
  else if (id === 'output.imageRough') void imageSelectedBill('rough')
  else if (id === 'output.imagePro') void imageSelectedBill('professional')
  else if (id === 'output.tsv') void exportSelected()
  else if (id === 'output.pdfRough') void pdfSelectedBill('rough', false)
  else if (id === 'output.pdfPro') void pdfSelectedBill('professional', false)
  else return false
  return true
}
