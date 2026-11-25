/** Phase 279 - the original page's defaults, byte for byte (API_CONTRACTS.md M25-1 "Seed"). */
import type { PaymentsList } from './types'

/** A fresh deep copy each call, so callers can never mutate the seed. */
export function seedList(): PaymentsList {
  return {
    recipient: 'Meenakshi Buttons',
    defaultId: 'kotak-merchant',
    version: 0,
    accounts: [
      {
        id: 'kotak-merchant',
        name: 'Kotak Mahindra (Merchant)',
        kind: 'merchant',
        merchant: {
          pa: '0798048A0284669.bqr@kotak', ver: '01', mode: '02', orgId: '00079', tr: '3373252A',
          mid: '0798048A0284669', mtid: '3373252A', mc: '5949', qrMedium: '04'
        },
        account: { number: '112011011564', ifsc: 'KKBK0008048' }
      },
      { id: 'sbi', name: 'SBI', kind: 'upi', upiId: 'meenakshibuttons@sbi', account: { number: '54047475538', ifsc: 'SBIN0040015' } },
      { id: 'kotak-basic', name: 'Kotak Mahindra (Basic)', kind: 'upi', upiId: '9448366753@KAYPAY' }
    ]
  }
}
