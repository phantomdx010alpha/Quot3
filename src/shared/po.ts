/** PO number formatting (pure). `prefix + zero-padded per-branch sequence`, e.g. `Q3-0001`. */
export const PO_SEQ_PAD = 4
export const DEFAULT_PO_PREFIX = 'Q3-'

export function formatPoNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(PO_SEQ_PAD, '0')}`
}
