/**
 * Phase 16 — TSV codec (pure). Excel-compatible: cells containing a tab, CR/LF or a double quote are wrapped in `"` with
 * inner quotes doubled; rows are separated by CRLF on output and by CRLF / LF / CR on input. A single trailing row
 * separator on input is ignored (Excel always appends one). `billToTsv` (whole-bill copy) is Phase 31.
 */

/** Parse clipboard text into rows of cells. `''` → `[]`. Quoted cells may contain tabs/newlines; `""` is a quote. */
export function parseTsv(text: string): string[][] {
  if (text === '') return []
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  const n = text.length
  let atCellStart = true
  while (i < n) {
    const ch = text[i] as string
    if (atCellStart && ch === '"') {
      // quoted cell: runs to the closing quote that is not doubled
      i++
      let closed = false
      while (i < n) {
        const c = text[i] as string
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue }
          i++; closed = true; break
        }
        cell += c; i++
      }
      atCellStart = false
      // junk between the closing quote and the next separator is kept literally (lenient, like Excel)
      if (closed) {
        while (i < n && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') { cell += text[i]; i++ }
      }
      continue
    }
    if (ch === '\t') { row.push(cell); cell = ''; i++; atCellStart = true; continue }
    if (ch === '\r' || ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
      atCellStart = true
      if (i >= n) return rows // single trailing separator → no extra empty row
      continue
    }
    cell += ch; i++; atCellStart = false
  }
  row.push(cell); rows.push(row)
  return rows
}

function quoteCell(c: string): string {
  return /[\t\r\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c
}

/** Rows of cells → clipboard text (CRLF rows, no trailing separator). `parseTsv(formatTsv(x))` equals `x` for non-empty `x`. */
export function formatTsv(rows: string[][]): string {
  const lines = rows.map((r) => r.map(quoteCell).join('\t'))
  // A final row that is one blank cell would end in a bare separator, which the parser (like Excel) treats as the
  // trailing one — quote it so the row survives the round trip.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines[lines.length - 1] = '""'
  return lines.join('\r\n')
}

/**
 * "Recognisably TSV" (KB §5): only then does multi-line text split into rows. True when the text has a tab, or ends with a
 * row separator (Excel's single-column copy) and has ≥ 2 rows. Plain multi-line text without either stays one cell.
 */
export function looksLikeTsv(text: string): boolean {
  if (text.includes('\t')) return true
  return /[\r\n]$/.test(text) && parseTsv(text).length >= 2
}
