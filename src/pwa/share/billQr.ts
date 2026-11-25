/**
 * Phase 284 (M25) - bill -> QR: pure helpers. The amount is the bill's grand total from the shared calc (the same `computeBill` the shared print
 * model reads), as a decimal string through `money.ts` (never float math), then through the Payments amount rule (`amountText`): whole rupees
 * lose their ".00", "1234.50" becomes "1234.5". A bill with no payable total (zero, hybrid, stock transfer, unknown layout) gives '' = the payer
 * enters the amount. The line that names the bill holds the PO number and the party name ONLY (no address, no phone, no contact) [A].
 * Nothing here writes or modifies a bill.
 */
import '../../shared/format'
import { getBillOptions } from '../../shared/calc/billOptions'
import { computeBill } from '../../shared/calc/billTotals'
import { hasFormat, resolveFormat } from '../../shared/format/registry'
import { formatHistoryDate, formatHistoryTotal } from '../../shared/history/historyList'
import { rankBills, searchTokens, type SearchCandidate } from '../../shared/history/historySearch'
import { tryD, toMoney } from '../../shared/money'
import { amountText } from '../../shared/payments/upiUrl'
import type { Bill } from '../../shared/types'

/** What the QR needs to know about a bill. */
export interface BillQrInfo { billId: string; /** "PO number - party name" */ line: string; /** '' = payer enters */ amount: string }

export const BILL_LINE_MAX = 80
export const PICK_LIMIT = 30

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** "PO · Party" (either part may be missing); bounded. Never an address or contact. */
export function billQrLine(bill: Pick<Bill, 'poNumber' | 'party'>): string {
  const po = clean(bill.poNumber ?? '')
  const name = clean(bill.party?.name ?? '')
  const line = po !== '' && name !== '' ? `${po} - ${name}` : po || name
  return line.slice(0, BILL_LINE_MAX)
}

/** The amount text for the QR: the grand total ('' when there is nothing sensible to prefill). */
export function billQrAmount(bill: Bill): string {
  if (bill.hybrid || !hasFormat(bill.formatId)) return ''
  try {
    const format = resolveFormat(bill.formatId)
    if (format.partyMode === 'branch') return ''
    const total = tryD(computeBill(format, bill.rows, getBillOptions(bill)).grandTotal)
    if (total === null || total.lte(0)) return ''
    const r = amountText(toMoney(total))
    return r.ok ? r.value : ''
  } catch { return '' }
}

export const billQrInfo = (bill: Bill): BillQrInfo => ({ billId: bill.id, line: billQrLine(bill), amount: billQrAmount(bill) })

/** One row of the "Pick a bill" list. */
export interface PickRow { id: string; poNumber: string; partyName: string; dateText: string; totalText: string }

const toRow = (c: Pick<SearchCandidate, 'id' | 'poNumber' | 'partyName' | 'billDate' | 'grandTotal'>): PickRow =>
  ({ id: c.id, poNumber: c.poNumber, partyName: c.partyName, dateText: formatHistoryDate(c.billDate), totalText: formatHistoryTotal(c.grandTotal) })

/** Blank query = the newest bills; otherwise party / PO / amount / item hits from the shared History ranking, then bills whose date holds every word
 *  (`2026-11-24` or `24-11-26`). Bounded. Reads only. */
export function pickBills(candidates: readonly SearchCandidate[], query: string, limit = PICK_LIMIT): PickRow[] {
  const q = query.trim()
  const cap = Math.max(1, Math.floor(limit))
  if (q === '') {
    return [...candidates].sort((a, b) => (a.billDate < b.billDate ? 1 : a.billDate > b.billDate ? -1 : b.poSeq - a.poSeq)).slice(0, cap).map(toRow)
  }
  const out: PickRow[] = []
  const seen = new Set<string>()
  for (const h of rankBills(candidates, q, cap).hits) { seen.add(h.id); out.push(toRow(h)) }
  const tokens = searchTokens(q)
  for (const c of candidates) {
    if (out.length >= cap) break
    if (seen.has(c.id)) continue
    const text = `${c.billDate} ${formatHistoryDate(c.billDate)}`.toLowerCase()
    if (tokens.every((t) => text.includes(t))) { seen.add(c.id); out.push(toRow(c)) }
  }
  return out.slice(0, cap)
}
