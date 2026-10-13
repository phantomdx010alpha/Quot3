import { describe, expect, it } from 'vitest'
import { sameContent } from '../conflict'

const bill = (over: Record<string, unknown> = {}) => ({
  branchId: 'b', poSeq: 1, poNumber: 'A-1', partySnapshotJson: '{"name":"R"}', formatId: 'non_gst', extraColsJson: '[]', paperOverride: null as 'A4' | 'A5' | null,
  billDate: '2026-10-10', deletedAt: null as string | null, ...over
})
const row = (idx: number, qty: string | null = '1') => ({ idx, nameRunsJson: '[]', namePlain: 'Pen', qty, rate: '9', totalOverride: null, gstRate: null, extrasJson: '{}', cellStyleJson: null })

describe('sameContent (Phase 57)', () => {
  it('equal copies match, whatever the order of the rows or the deleted time', () => {
    expect(sameContent({ bill: bill(), rows: [row(0), row(1)] }, { bill: bill(), rows: [row(1), row(0)] })).toBe(true)
    expect(sameContent({ bill: bill({ deletedAt: 'x' }), rows: [] }, { bill: bill({ deletedAt: 'y' }), rows: [] })).toBe(true)
  })
  it('any visible difference is a difference', () => {
    expect(sameContent({ bill: bill(), rows: [row(0)] }, { bill: bill(), rows: [row(0, '2')] })).toBe(false)
    expect(sameContent({ bill: bill(), rows: [row(0)] }, { bill: bill(), rows: [row(0), row(1)] })).toBe(false)
    expect(sameContent({ bill: bill(), rows: [] }, { bill: bill({ partySnapshotJson: '{"name":"S"}' }), rows: [] })).toBe(false)
    expect(sameContent({ bill: bill(), rows: [] }, { bill: bill({ deletedAt: '2026-10-10T10:00:00.000Z' }), rows: [] })).toBe(false)
    expect(sameContent({ bill: bill(), rows: [] }, { bill: bill({ billDate: '2026-10-11' }), rows: [] })).toBe(false)
  })
})
