import { fmtMoney } from '../../../shared/money'

/** Phase 190 display helpers for the NEW phone layouts (pure). Display only: nothing here changes a stored value, and there is NO number arithmetic
 *  (rule 4.3): amounts are decimal strings, formatted by the shared `fmtMoney`. `shared/calc/billTotals.ts` is untouched (desktop grid and print use it). */

/** A plain decimal string as the calc and the editor produce them: optional minus, digits, optional fraction. Anything else is left alone. */
const DECIMAL = /^-?\d+(\.\d+)?$/
/** 0, 00, 0.0, 0.00 ... : "no GST" without parsing a number. */
const ZERO = /^-?0+(\.0*)?$/

/** An amount for display: Indian grouping, always 2 decimals ("12988.00" -> "12,988.00"). `symbol` adds the rupee sign (the final total only).
 *  Empty, non-string or non-numeric input comes back unchanged (an empty string for non-strings), never "NaN". */
export function moneyText(cell: string, opts: { symbol?: boolean } = {}): string {
  if (typeof cell !== 'string') return ''
  const t = cell.trim()
  if (!DECIMAL.test(t)) return cell
  return fmtMoney(t, { indian: true, symbol: opts.symbol === true })
}

/** A quantity or rate for display: Indian grouping of the whole part, the fraction exactly as entered ("1250.5" -> "1,250.5"). No decimals are added. */
export function plainNumber(cell: string): string {
  if (typeof cell !== 'string') return ''
  const t = cell.trim()
  if (!DECIMAL.test(t)) return cell
  const neg = t.startsWith('-')
  const [int = '', frac] = (neg ? t.slice(1) : t).split('.')
  const head = int.length > 3 ? `${groupLakh(int.slice(0, -3))},${int.slice(-3)}` : int
  return `${neg ? '-' : ''}${head}${frac === undefined ? '' : `.${frac}`}`
}

/** Digits before the last three, grouped in twos from the right ("1234" -> "12,34"). Text only. */
function groupLakh(s: string): string {
  return s.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
}

export interface ItemDetailInput {
  qty?: string
  rate?: string
  gstPct?: string
  /** The line total was typed by the owner instead of qty x rate. */
  priceSetByUser?: boolean
}

/** The muted second line of an item: "382 x Rs34 · +18% GST". Parts that are empty are left out; a GST % of zero or blank is not shown. */
export function itemDetail(i: ItemDetailInput): string {
  const qty = (i.qty ?? '').trim()
  const rate = (i.rate ?? '').trim()
  const gst = (i.gstPct ?? '').trim()
  const parts: string[] = []
  if (qty !== '' && rate !== '') parts.push(`${plainNumber(qty)} x Rs${plainNumber(rate)}`)
  else if (qty !== '') parts.push(plainNumber(qty))
  else if (rate !== '') parts.push(`Rs${plainNumber(rate)}`)
  if (gst !== '' && !ZERO.test(gst)) parts.push(`+${plainNumber(gst)}% GST`)
  if (i.priceSetByUser === true) parts.push('Set price yourself')
  return parts.join(' \u00b7 ')
}
