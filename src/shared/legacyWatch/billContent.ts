/**
 * Phase 159 - the content of a stored Quot3 bill, for matching an incoming legacy file against it (best effort).
 * A stored row with no qty and no rate but a typed amount could have been an adjustment or an amount-only line in the legacy file;
 * the two cannot be told apart here, so such rows count as lines. Bills the watcher wrote keep their exact content (`content_json`) and
 * never need this. Pure.
 */
import type { Bill } from '../types'
import type { ContentInput, ContentLine } from './fingerprint'

export function contentOfBill(b: Bill): ContentInput {
  const lines: ContentLine[] = []
  for (const r of b.rows) {
    const name = r.nameRuns.map((x) => x.t).join('')
    if (name.trim() === '' && r.qty === null && r.rate === null && r.totalOverride === null) continue
    lines.push({ name, qty: r.qty, rate: r.rate, amt: r.totalOverride })
  }
  return { party: b.party.name, isoDate: b.billDate, lines, adjustments: [] }
}
