import { outputDisabledReason, type OutputActionId } from '@shared/outputActions'
import { billHasContent, billToTsv } from '@shared/tsv/billTsv'
import type { Quot3Bridge } from '@shared/ipc'
import { imageToast } from '@shared/print/imageFlow'
import type { Bill, PrintMode } from '@shared/types'
import { useBillStore } from './billStore'
import { historyHooks } from './historyHooks'
import { openPrint, printPayload } from './printActions'
import { useSaveUiStore } from './saveUiStore'
import { setPrerenderMode } from './imagePrerender'

/**
 * Phase 30 - run a bottom-bar output action. Phase 31 implemented TSV, Phase 37 print, Phase 39 image. The stub branch below is now unreachable (every action has phase null) but kept for future actions.
 * Returns whether the action started.
 */
type ClipBridge = Pick<Quot3Bridge, 'clipboard' | 'image'>
const bridge = (): ClipBridge | undefined => (window as unknown as { quot3?: ClipBridge }).quot3

let copying = false

/**
 * Phase 31 - copy the whole bill (party lines + table + totals) for Excel. Commits the typed-but-uncommitted cell first
 * (same rule as Save) so what is on screen is what is copied. Resolves true when the clipboard was written.
 */
export async function copyBillTsv(): Promise<boolean> {
  const ui = useSaveUiStore.getState()
  if (copying) return false
  if (useBillStore.getState().billId === null) { ui.announce('warn', 'Nothing to copy - open a bill first'); return false }
  historyHooks.selection?.flush()
  const bill = useBillStore.getState().toBill()
  if (!billHasContent(bill)) { ui.announce('warn', 'Nothing to copy yet'); return false }
  const api = bridge()?.clipboard
  if (!api) { ui.announce('danger', 'Could not copy: clipboard is not available'); return false }
  copying = true
  try {
    const { text, html } = billToTsv(bill)
    const r = await api.writeTsv({ text, html })
    if (!r.ok) { ui.announce('danger', `Could not copy: ${r.error.message}`); return false }
    ui.announce('ok', 'Bill copied - paste into Excel')
    return true
  } catch (e) {
    ui.announce('danger', `Could not copy: ${e instanceof Error ? e.message : 'unknown error'}`)
    return false
  } finally { copying = false }
}

let imaging = false

/**
 * Phase 39 - copy the bill as a tightly cropped image (Rough: Ctrl+I, Professional: Ctrl+Shift+I). Commits the typed cell
 * first, like Save / TSV. The toast carries the real pixel size; failures (including the too-tall guard) say why.
 */
export async function copyBillImage(mode: PrintMode): Promise<boolean> {
  const ui = useSaveUiStore.getState()
  if (imaging) return false
  if (useBillStore.getState().billId === null) { ui.announce('warn', 'Nothing to copy - open a bill first'); return false }
  historyHooks.selection?.flush()
  return copyImageOfBill(useBillStore.getState().toBill(), mode)
}

/** Phase 42: the same image copy for any bill (History's Copy image). Reports through the save-status line like the Create page does. */
export async function copyImageOfBill(bill: Bill, mode: PrintMode): Promise<boolean> {
  const ui = useSaveUiStore.getState()
  if (imaging) return false
  if (!billHasContent(bill)) { ui.announce('warn', 'Nothing to copy yet'); return false }
  const api = bridge()?.image
  if (!api) { ui.announce('danger', 'Could not copy the image: not connected to the app'); return false }
  imaging = true
  setPrerenderMode(mode) // Phase 71: pre-render the mode the owner actually uses
  try {
    const r = await api.copy({ ...printPayload(bill, mode, undefined), mode })
    if (!r.ok) { ui.announce('danger', r.error.message); return false }
    ui.announce('ok', `${imageToast(r.data.width, r.data.height)} - paste into WhatsApp`)
    return true
  } catch (e) {
    ui.announce('danger', `Could not copy the image: ${e instanceof Error ? e.message : 'unknown error'}`)
    return false
  } finally { imaging = false }
}

export function runOutput(id: OutputActionId): boolean {
  if (id === 'output.tsv') { void copyBillTsv(); return true }
  if (id === 'output.printRough') return openPrint('rough')
  if (id === 'output.printPro') return openPrint('professional')
  if (id === 'output.imageRough') { void copyBillImage('rough'); return true }
  if (id === 'output.imagePro') { void copyBillImage('professional'); return true }
  const reason = outputDisabledReason(id)
  if (reason) { useSaveUiStore.getState().announce('warn', reason); return false }
  return true
}
