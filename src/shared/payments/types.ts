/** Phase 279 - Payments model (API_CONTRACTS.md M25-1). Pure: no DOM / Node / Electron. */

export type PayeeKind = 'merchant' | 'upi' | 'account'

export interface MerchantFields {
  pa: string
  ver: string
  mode: string
  orgId: string
  tr: string
  mid: string
  mtid: string
  mc: string
  qrMedium: string
}

export interface BankAccount {
  number: string
  ifsc: string
}

export interface PayeeAccount {
  id: string
  name: string
  kind: PayeeKind
  merchant?: MerchantFields
  upiId?: string
  account?: BankAccount
}

/** What is stored on the master and sent on the wire. */
export interface PaymentsBody {
  recipient: string
  defaultId: string
  accounts: PayeeAccount[]
}

/** The phone's copy; `version` is the master version it is based on (0 = never published). */
export interface PaymentsList extends PaymentsBody {
  version: number
}

export type Result<T> = { ok: true; value: T } | { ok: false; words: string }
