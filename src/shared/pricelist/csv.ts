/** Phase 235 (M23) - Price List CSV export (pure; RFC 4180 quoting, CRLF). Text cells that a spreadsheet could run as a formula are neutralised with a leading apostrophe. */
import { plain } from '../richtext/runs'
import { isNumericStr } from '../money'
import type { PriceColumn, PriceRow } from './types'

const FORMULA_START = /^[=+\-@\t\r]/

export function csvField(raw: string, numeric = false): string {
  let s = raw
  if (!numeric && FORMULA_START.test(s) && !isNumericStr(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Header = visible column labels; rows in idx order; section rows write their name only. `bom` adds the UTF-8 mark Excel needs for non-ASCII names. */
export function toCsv(columns: readonly PriceColumn[], rows: readonly PriceRow[], opts: { bom?: boolean; includeHidden?: boolean } = {}): string {
  const cols = columns.filter((c) => opts.includeHidden || !c.hidden)
  const lines = [cols.map((c) => csvField(c.label)).join(',')]
  for (const r of [...rows].sort((a, b) => a.idx - b.idx)) {
    lines.push(cols.map((c) => {
      if (c.role === 'name') return csvField(plain(r.nameRuns))
      const v = r.cells[c.key] ?? ''
      return csvField(v, c.type === 'number' || c.role === 'price')
    }).join(','))
  }
  return `${opts.bom ? '\uFEFF' : ''}${lines.join('\r\n')}\r\n`
}
