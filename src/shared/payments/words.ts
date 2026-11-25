/** Phase 279 - plain-words messages (API_CONTRACTS.md M25-1 validation table and M25-2b). */
export const PAYMENTS_WORDS = {
  recipient: 'Type the name people will see when they pay (up to 60 letters).',
  name: 'Give this payee a short name (up to 40 letters) that no other payee uses.',
  upiId: 'That UPI ID does not look right. It should look like name@bank.',
  ifsc: 'The IFSC code should be 11 characters, like SBIN0040015.',
  accountNumber: 'The account number should be 9 to 18 digits.',
  twoDigits: 'A merchant detail (ver, mode or qrMedium) must be 2 digits.',
  orgId: 'The merchant orgId must be digits only.',
  mc: 'The merchant category (mc) must be 4 digits.',
  alnum: 'A merchant detail (tr, mid or mtid) must be letters and digits only.',
  missing: 'This payee is missing its details.',
  count: 'Keep between 1 and 20 payees.',
  tooBig: 'The Payments list is too big.',
  amountFormat: 'Enter an amount like 500 or 1250.50, or leave it blank.',
  amountZero: 'Enter an amount above zero, or leave it blank.',
  lastPayee: 'You need at least one payee. Add another before removing this one.',
  notFound: 'That payee was not found.'
} as const
