import { create } from 'zustand'
import type { PrintDecideResponse } from '@shared/ipc'
import type { ForcedPaper } from '@shared/print/printFlow'
import type { Bill, PrintMode } from '@shared/types'

/** Phase 37 - state of the print dialog. The bill is a snapshot taken when the dialog opened: edits after that never change what prints. */
export interface PrintUiState {
  open: boolean
  mode: PrintMode
  bill: Bill | null
  /** The owner's forced size for this print (`undefined` = whatever the rules / the bill's saved override say). */
  forced: ForcedPaper | undefined
  /** The latest decision from `print:decide`; null while the first one loads. */
  info: PrintDecideResponse | null
  loading: boolean
  /** Phase 73: the dialog is showing the instant (rules-only) answer while main measures the real text fit in the background. */
  measuring: boolean
  printing: boolean
  /** A PDF is being written (Phase 38). */
  saving: boolean
  /** Opened by the "Save PDF" palette action: save as soon as the decision is in (unless it needs the acknowledgement). */
  autoPdf: boolean
  /** Phase 42 (History -> Open PDF): open the saved file in the viewer right after it is written. */
  openAfterSave: boolean
  /** The extra-columns warning was explicitly acknowledged (Y). */
  acked: boolean
  /** Enter was pressed before acknowledging: the dialog highlights the warning. */
  askAck: boolean
  error: string
  set: (patch: Partial<Omit<PrintUiState, 'set'>>) => void
}

export const usePrintUiStore = create<PrintUiState>((set) => ({
  open: false, mode: 'rough', bill: null, forced: undefined, info: null, loading: false, measuring: false, printing: false, saving: false, autoPdf: false, openAfterSave: false, acked: false, askAck: false, error: '',
  set: (patch) => set(patch)
}))
