/**
 * Phase 283 (M25) - pure helpers for the phone Payments page and its editor. No DOM, no storage, no network.
 * The page logic (what to show, the labels, the editor form <-> payee) lives here so jsdom tests stay small.
 * The QR picture itself comes from Phase 282 (`QrPort`); until it is plugged in the page says so in plain words.
 * No account number or IFSC is ever put in a label (the QR image carries none: API_CONTRACTS.md M25-12 [A] 4).
 */
import type { PayeeAccount, PayeeKind } from '../../../shared/payments/types'

export const PAY_WORDS = {
  title: 'Payments',
  entry: 'Payments',
  loading: 'Loading',
  noDb: 'Your data could not be opened, so Payments is unavailable.',
  offline: 'You are offline. This is the last list saved on this phone.',
  switchTitle: 'Pay to bank account',
  switchOff: 'Off \u00b7 QR uses the UPI ID',
  switchOn: 'On \u00b7 QR uses account number + IFSC',
  amountLabel: 'Amount (leave blank = payer enters)',
  generate: 'Generate QR code',
  share: 'Share QR',
  save: 'Save image',
  fullScreen: 'Full screen',
  edit: 'Edit payees',
  refresh: 'Refresh list',
  scan: 'Scan to pay',
  noPayees: 'Nothing to show in this mode. Switch the bank account option, or add a payee.',
  noQr: 'The QR picture could not be drawn on this phone.',
  noImage: 'Sharing the QR as a picture is not ready on this phone yet.',
  saved: 'Image saved.',
  shared: 'Shared.',
  cancelled: 'Cancelled.',
  published: 'Published to all phones.',
  refreshed: 'The list is up to date.',
  refreshedNew: 'The list was updated from your company.',
  refusedRead: 'This phone is not allowed to see Payments.',
  refreshFailed: 'Could not reach the server. The saved list is kept.',
  removeAsk: 'Remove this payee?',
  openAmount: 'Open amount',
  shareQr: 'Share QR',
  pickTitle: 'Pick a bill',
  pickSearch: 'Search by party, PO number or date',
  pickNone: 'No bill found.',
  pickEmpty: 'No bills on this phone yet.',
  pickClear: 'Remove bill',
  pickFailed: 'This bill could not be opened.',
  pickNoName: 'No name',
  billAmountNote: 'The amount is the bill total. Change it for a part or advance payment, or clear it to let the payer enter it.',
  billNoAmount: 'This bill has no payable total, so the amount is blank: the payer enters it.'
} as const

/** What the Phase 282 module plugs in. `matrix` answers the dark modules (rows of booleans) or null when the URL cannot be encoded. */
export interface QrImageInput { url: string; payeeName: string; bankLabel: string; amountLine: string; logoDataUrl: string | null
  /** Phase 284: the bill this QR is for, "PO number · party name" only (no address or contact); absent for a plain payment QR. */
  billLine?: string }
export interface QrPort {
  matrix(url: string): boolean[][] | null
  image?(input: QrImageInput): Promise<{ bytes: Uint8Array; fileName: string } | null>
}

let port: QrPort | null = null
/** Phase 282 calls this once at start-up. Tests may pass a fake. */
export function setQrPort(p: QrPort | null): void { port = p }
export const getQrPort = (): QrPort | null => port

/** The UPI id shown for a payee (merchant: its `pa`). Never the account number. */
export const upiIdOf = (p: PayeeAccount): string => p.upiId ?? p.merchant?.pa ?? ''

export interface QrLabels { head: string; payee: string; amountLine: string; bankLabel: string }

/** Labels for the QR card and the image. `am` is the validated amount text ('' = payer enters). */
export function qrLabels(p: PayeeAccount, am: string, accountMode: boolean): QrLabels {
  const bankLabel = accountMode ? 'Bank account transfer' : upiIdOf(p)
  return {
    head: am ? `Rs ${am}` : PAY_WORDS.openAmount,
    payee: bankLabel ? `${p.name} \u00b7 ${bankLabel}` : p.name,
    amountLine: am ? `Amount: Rs ${am}` : 'Payer enters the amount',
    bankLabel
  }
}

/** One SVG path for every dark module (quiet zone included in the viewBox). Pure and bounded by the matrix size. */
export function matrixPath(m: boolean[][], quiet = 4): { d: string; size: number } {
  const n = m.length
  let d = ''
  for (let y = 0; y < n; y++) {
    const row = m[y] ?? []
    for (let x = 0; x < n; x++) if (row[x] === true) d += `M${x + quiet} ${y + quiet}h1v1h-1z`
  }
  return { d, size: n + quiet * 2 }
}

/** The editor form: every field is a string so a half-typed form is never lost. */
export interface PayeeDraft {
  name: string; kind: PayeeKind
  upiId: string; number: string; ifsc: string
  pa: string; ver: string; mode: string; orgId: string; tr: string; mid: string; mtid: string; mc: string; qrMedium: string
}

export const emptyDraft = (kind: PayeeKind = 'upi'): PayeeDraft => ({
  name: '', kind, upiId: '', number: '', ifsc: '', pa: '', ver: '01', mode: '15', orgId: '', tr: '', mid: '', mtid: '', mc: '', qrMedium: '04'
})

export function draftOf(p: PayeeAccount): PayeeDraft {
  const m = p.merchant
  return {
    ...emptyDraft(p.kind), name: p.name, upiId: p.upiId ?? '', number: p.account?.number ?? '', ifsc: p.account?.ifsc ?? '',
    ...(m ? { pa: m.pa, ver: m.ver, mode: m.mode, orgId: m.orgId, tr: m.tr, mid: m.mid, mtid: m.mtid, mc: m.mc, qrMedium: m.qrMedium } : {})
  }
}

/** The (unvalidated) payee object for `addPayee` / `editPayee`; validation and its plain words live in `shared/payments`. */
export function payeeFromDraft(d: PayeeDraft): Record<string, unknown> {
  const out: Record<string, unknown> = { name: d.name, kind: d.kind }
  if (d.kind === 'upi') out.upiId = d.upiId
  if (d.kind === 'merchant') out.merchant = { pa: d.pa, ver: d.ver, mode: d.mode, orgId: d.orgId, tr: d.tr, mid: d.mid, mtid: d.mtid, mc: d.mc, qrMedium: d.qrMedium }
  if (d.kind === 'account' || d.number.trim() !== '' || d.ifsc.trim() !== '') out.account = { number: d.number, ifsc: d.ifsc }
  return out
}

export const KIND_LABELS: Record<PayeeKind, string> = { upi: 'UPI ID', merchant: 'Merchant QR', account: 'Bank account only' }
