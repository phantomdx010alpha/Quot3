import { describe, expect, it } from 'vitest'
import { printFixture } from '../../__fixtures__/printBills'
import {
  contentHeightPx, contentWidthPx, decideForBill, decisionSummary, isOverflow, printDialogKey, printRowCount, resolvePrintSettings
} from '../printFlow'

describe('Phase 37 - decideForBill (decision wiring)', () => {
  it('40 rough rows -> A5; 41 -> A4; row count excludes footer rows', () => {
    expect(printRowCount(printFixture('rows40'), 'rough')).toBe(40)
    expect(decideForBill(printFixture('rows40'), 'rough')).toMatchObject({ size: 'A5', pages: 1 })
    const b = printFixture('rows40')
    b.rows = [...b.rows, { ...b.rows[0]!, id: 'extra', idx: 40 }]
    expect(decideForBill(b, 'rough')).toMatchObject({ size: 'A4', pages: 1, requiresAck: false })
  })
  it('professional uses the professional limit (30 rows -> A5, 31 -> A4)', () => {
    expect(decideForBill(printFixture('rows30'), 'professional').size).toBe('A5')
    expect(decideForBill(printFixture('rows40'), 'professional').size).toBe('A4')
  })
  it('extra columns beyond the format limit -> A4 and an acknowledgement (GST with extras, non-GST with 3)', () => {
    expect(decideForBill(printFixture('gstExtra3'), 'rough')).toMatchObject({ size: 'A4', requiresAck: true })
    expect(decideForBill(printFixture('extraCols'), 'rough').requiresAck).toBe(false) // 2 extras on non-GST is allowed on A5
  })
  it('81 rough rows paginate on A4', () => {
    expect(decideForBill(printFixture('rows81'), 'rough')).toMatchObject({ size: 'A4', pages: 2 })
  })
  it('forced size wins; "auto" ignores the bill override; the bill override counts as forced', () => {
    const b = printFixture('legacy')
    expect(decideForBill(b, 'rough', { forced: 'A4' })).toMatchObject({ size: 'A4', requiresAck: false, warnings: [] })
    expect(decideForBill({ ...b, paperOverride: 'A4' }, 'rough').size).toBe('A4')
    expect(decideForBill({ ...b, paperOverride: 'A4' }, 'rough', { forced: 'auto' }).size).toBe('A5')
    expect(decideForBill({ ...b, paperOverride: 'A4' }, 'rough', { forced: 'A5' }).size).toBe('A5')
  })
  it('forced A5 on a long bill warns about cramping but needs no acknowledgement', () => {
    const d = decideForBill(printFixture('rows81'), 'rough', { forced: 'A5' })
    expect(d.size).toBe('A5')
    expect(d.warnings[0]).toMatch(/cramped on A5/)
    expect(d.requiresAck).toBe(false)
  })
  it('measuredOverflow turns an A5 result into A4', () => {
    const b = printFixture('legacy')
    expect(decideForBill(b, 'rough').size).toBe('A5')
    expect(decideForBill(b, 'rough', { measuredOverflow: true })).toMatchObject({ size: 'A4', requiresAck: false })
  })
  it('decisionSummary', () => {
    expect(decisionSummary(decideForBill(printFixture('legacy'), 'rough'))).toBe('A5')
    expect(decisionSummary(decideForBill(printFixture('rows81'), 'rough'))).toBe('A4 - 2 pages')
  })
})

describe('Phase 37 - resolvePrintSettings', () => {
  it('defaults when nothing is set', () => {
    expect(resolvePrintSettings({})).toEqual({ print: { rupeeOnTotal: true, company: null }, silent: false, printer: '' })
  })
  it('silent needs a printer; the company needs a name; wrong types fall back', () => {
    expect(resolvePrintSettings({ 'print.silent': true }).silent).toBe(false)
    expect(resolvePrintSettings({ 'print.silent': true, 'print.printer': ' HP LaserJet ' })).toMatchObject({ silent: true, printer: 'HP LaserJet' })
    expect(resolvePrintSettings({ 'company.profile': { name: '  ', phone: '1' } }).print.company).toBeNull()
    expect(resolvePrintSettings({ 'company.profile': { name: 'Acme', phone: 5, address: 'X' } }).print.company).toEqual({ logo: '', name: 'Acme', phone: '', address: 'X' })
    expect(resolvePrintSettings({ 'print.rupeeOnTotal': 'yes', 'print.silent': 1, 'print.printer': 7 })).toEqual({ print: { rupeeOnTotal: true, company: null }, silent: false, printer: '' })
    expect(resolvePrintSettings({ 'print.rupeeOnTotal': false }).print.rupeeOnTotal).toBe(false)
  })
})

describe('Phase 37 - overflow geometry', () => {
  it('printable area is the page minus the fixed margins', () => {
    expect(contentWidthPx('A5')).toBe(Math.round((148 - 12) * 96 / 25.4))
    expect(contentHeightPx('A5')).toBe(Math.round((210 - 12) * 96 / 25.4))
    expect(contentHeightPx('A4')).toBeGreaterThan(contentHeightPx('A5'))
  })
  it('overflow only when the sheet is taller than one page (1 px slack); -1 / NaN are not overflow', () => {
    const h = contentHeightPx('A5')
    expect(isOverflow('A5', h)).toBe(false)
    expect(isOverflow('A5', h + 1)).toBe(false)
    expect(isOverflow('A5', h + 2)).toBe(true)
    expect(isOverflow('A5', -1)).toBe(false)
    expect(isOverflow('A5', Number.NaN)).toBe(false)
  })
})

describe('Phase 37 - print dialog keys', () => {
  const free = { requiresAck: false, acked: false }
  const ack = { requiresAck: true, acked: false }
  it('Enter prints the suggested size; 4 / 5 force; A is automatic; other keys are not ours', () => {
    expect(printDialogKey({ key: 'Enter' }, free)).toBe('print')
    expect(printDialogKey({ key: '4' }, free)).toBe('force4')
    expect(printDialogKey({ key: '5' }, free)).toBe('force5')
    expect(printDialogKey({ key: 'a' }, free)).toBe('auto')
    expect(printDialogKey({ key: 'A' }, free)).toBe('auto')
    expect(printDialogKey({ key: 'x' }, free)).toBeNull()
    expect(printDialogKey({ key: 'y' }, free)).toBeNull() // nothing to acknowledge
  })
  it('with an unacknowledged warning Enter only asks for Y; Y acknowledges; then Enter prints', () => {
    expect(printDialogKey({ key: 'Enter' }, ack)).toBe('needAck')
    expect(printDialogKey({ key: 'y' }, ack)).toBe('ack')
    expect(printDialogKey({ key: 'Y' }, ack)).toBe('ack')
    expect(printDialogKey({ key: 'Enter' }, { requiresAck: true, acked: true })).toBe('print')
    expect(printDialogKey({ key: '5' }, ack)).toBe('force5') // forcing a size is allowed without acknowledging
  })
  it('modified keys are never ours', () => {
    for (const m of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(printDialogKey({ key: 'Enter', ...m }, free)).toBeNull()
      expect(printDialogKey({ key: '4', ...m }, free)).toBeNull()
    }
  })
})
