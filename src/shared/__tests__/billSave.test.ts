import { describe, expect, it } from 'vitest'
import { createEmptyBill } from '../billModel'
import { finalizeParty, prepareBillForSave, trimTrailingBlankRows, validateBillForSave } from '../billSave'
import { blankRow, row } from '../__fixtures__/bills'
import type { Bill } from '../types'

const bill = (over: Partial<Bill> = {}): Bill => ({ ...createEmptyBill({ branchId: 'b1', rowCount: 0 }), ...over })
const party = (name: string) => ({ name, phone: '', address: '', transport: '' })

describe('validateBillForSave', () => {
  it('blank / whitespace party name is the first problem, even with no rows', () => {
    expect(validateBillForSave(bill({ party: party('   '), rows: [] }))?.code).toBe('PARTY_NAME_REQUIRED')
    expect(validateBillForSave(bill({ party: party(''), rows: [row('Pen', '1', '2')] }))?.code).toBe('PARTY_NAME_REQUIRED')
  })

  it('needs at least one item or adjustment row', () => {
    expect(validateBillForSave(bill({ party: party('Ruby'), rows: [blankRow(), blankRow()] }))?.code).toBe('NO_ROWS')
    expect(validateBillForSave(bill({ party: party('Ruby'), rows: [] }))?.code).toBe('NO_ROWS')
  })

  it('a name-only or total-only (partial) row does not count', () => {
    expect(validateBillForSave(bill({ party: party('Ruby'), rows: [row('Just a name', null, null)] }))?.code).toBe('NO_ROWS')
    expect(validateBillForSave(bill({ party: party('Ruby'), rows: [row('', null, null, { total: '50' })] }))?.code).toBe('NO_ROWS')
  })

  it('an item (qty or rate) passes, and so does an adjustment (name + total only)', () => {
    expect(validateBillForSave(bill({ party: party('Ruby'), rows: [row('Pen', '2', null)] }))).toBeNull()
    expect(validateBillForSave(bill({ party: party('Ruby'), rows: [row('Pen', null, '5')] }))).toBeNull()
    expect(validateBillForSave(bill({ party: party('Ruby'), rows: [row('Discount', null, null, { total: '-20' })] }))).toBeNull()
  })
})

describe('trimTrailingBlankRows / prepareBillForSave', () => {
  it('drops trailing blanks, keeps internal blanks, renumbers idx', () => {
    const rows = [row('A', '1', '1'), blankRow(), row('B', '1', '1'), blankRow(), blankRow(), blankRow()].map((r, i) => ({ ...r, idx: i }))
    const out = trimTrailingBlankRows(rows)
    expect(out.map((r) => r.id)).toEqual([rows[0]!.id, rows[1]!.id, rows[2]!.id])
    expect(out.map((r) => r.idx)).toEqual([0, 1, 2])
  })

  it('a trailing row that only has an extra-column note is NOT blank and survives', () => {
    const noted = { ...blankRow(), extras: { c1: { text: 'see tag' } } }
    expect(trimTrailingBlankRows([row('A', '1', '1'), noted, blankRow()])).toHaveLength(2)
  })

  it('all blank → empty list', () => {
    expect(trimTrailingBlankRows([blankRow(), blankRow()])).toEqual([])
  })

  it('finalizeParty trims every field and the address lines; prepare applies it and trims rows', () => {
    expect(finalizeParty({ name: '  Ruby  ', phone: ' 98 ', transport: ' VRL ', address: ' 1 Main \n  Bengaluru  ' })).toEqual({ name: 'Ruby', phone: '98', transport: 'VRL', address: '1 Main\nBengaluru' })
    const b = prepareBillForSave(bill({ party: party('  Ruby '), rows: [row('Pen', '1', '2'), blankRow(), blankRow()] }))
    expect(b.party.name).toBe('Ruby')
    expect(b.rows).toHaveLength(1)
  })

  it('does not mutate its input', () => {
    const input = bill({ party: party(' X '), rows: [row('Pen', '1', '2'), blankRow()] })
    const snapshot = JSON.stringify(input)
    prepareBillForSave(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
