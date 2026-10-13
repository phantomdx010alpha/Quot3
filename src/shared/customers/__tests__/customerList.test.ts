import { describe, expect, it } from 'vitest'
import { addressPreview, aggregateCustomerStats, describeCustomers, searchCustomers, validateCustomerInput, type CustomerRow } from '../customerList'

const c = (id: string, name: string, over: Partial<CustomerRow> = {}): CustomerRow => ({ id, name, phone: '', address: '', transport: '', billCount: 0, lastBillDate: '', totalBilled: '0.00', ...over })

describe('aggregateCustomerStats', () => {
  it('counts bills, keeps the newest date and sums exactly (no float drift)', () => {
    const m = aggregateCustomerStats([
      { partyId: 'a', billDate: '2026-10-01', grandTotal: '0.10' },
      { partyId: 'a', billDate: '2026-10-05', grandTotal: '0.20' },
      { partyId: 'a', billDate: '2026-09-30', grandTotal: '1250.50' },
      { partyId: 'b', billDate: '2026-10-02', grandTotal: '90' }
    ])
    expect(m.get('a')).toEqual({ billCount: 3, lastBillDate: '2026-10-05', totalBilled: '1250.80' })
    expect(m.get('b')).toEqual({ billCount: 1, lastBillDate: '2026-10-02', totalBilled: '90.00' })
    expect(m.get('zzz')).toBeUndefined()
  })

  it('an unreadable or missing total still counts the bill but adds nothing', () => {
    const m = aggregateCustomerStats([
      { partyId: 'a', billDate: '2026-10-01', grandTotal: null },
      { partyId: 'a', billDate: '2026-10-02', grandTotal: 'oops' },
      { partyId: 'a', billDate: '2026-10-03', grandTotal: 100 }
    ])
    expect(m.get('a')).toEqual({ billCount: 3, lastBillDate: '2026-10-03', totalBilled: '100.00' })
  })
})

describe('searchCustomers', () => {
  const rows = [
    c('1', 'Lakshmi Cloth Center', { phone: '98450 11001', address: '12 Main Rd\nMysuru' }),
    c('2', 'Ruby Traders', { phone: '99000 22002' }),
    c('3', 'Zakers Clothing', { address: 'Brigade Road, Bengaluru' })
  ]
  it('blank query returns everyone in the given order', () => expect(searchCustomers(rows, '  ').map((r) => r.id)).toEqual(['1', '2', '3']))
  it('finds by name (prefix beats fuzzy), tolerating a typo', () => {
    expect(searchCustomers(rows, 'ruby')[0]?.id).toBe('2')
    expect(searchCustomers(rows, 'lakshmy')[0]?.id).toBe('1')
  })
  it('a numeric query is a phone-digit search', () => expect(searchCustomers(rows, '22002').map((r) => r.id)).toEqual(['2']))
  it('matches inside the address, across lines, after the name hits', () => {
    expect(searchCustomers(rows, 'bengaluru').map((r) => r.id)).toEqual(['3'])
    expect(searchCustomers(rows, 'mysuru').map((r) => r.id)).toEqual(['1'])
  })
  it('no match gives an empty list', () => expect(searchCustomers(rows, 'qqqq')).toEqual([]))
  it('returns the original row objects (stats intact)', () => {
    const r = [c('9', 'Alpha', { billCount: 4, totalBilled: '10.00' })]
    expect(searchCustomers(r, 'alpha')[0]).toBe(r[0])
  })
})

describe('small helpers', () => {
  it('addressPreview joins lines', () => expect(addressPreview('12 Main Rd\r\n\n Mysuru ')).toBe('12 Main Rd, Mysuru'))
  it('validateCustomerInput needs a name and respects the limits', () => {
    expect(validateCustomerInput({ name: '   ' })).toMatch(/needs a name/)
    expect(validateCustomerInput({ name: 'x'.repeat(121) })).toMatch(/too long/)
    expect(validateCustomerInput({ name: 'Ok', phone: '1'.repeat(41) })).toMatch(/phone is too long/)
    expect(validateCustomerInput({ name: 'Ok', phone: '1' })).toBeNull()
  })
  it('describeCustomers', () => {
    expect(describeCustomers(1, 1)).toBe('1 customer')
    expect(describeCustomers(3, 12)).toBe('3 of 12 customers')
    expect(describeCustomers(0, 0)).toBe('0 customers')
  })
})
