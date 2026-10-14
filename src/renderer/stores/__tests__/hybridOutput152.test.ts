// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEmptyBill } from '@shared/billModel'
import { enterHybrid } from '@shared/hybrid/hybrid'
import type { Bill, BillRow } from '@shared/types'
import { useBillStore } from '../billStore'
import { copyBillTsv, copyImageOfBill } from '../outputActions'
import { closePrint, openPrintForBill } from '../printActions'
import { usePrintUiStore } from '../printUiStore'
import { cancelSidePick, chooseSide, useSidePickStore } from '../sidePick'

const row = (id: string, name: string, qty: string, rate: string, extra: Partial<BillRow> = {}): BillRow =>
  ({ id, idx: 0, nameRuns: [{ t: name }], qty, rate, totalOverride: null, gstRate: null, extras: {}, ...extra })

function hybridBill(): Bill {
  const base: Bill = { ...createEmptyBill({ branchId: 'b', formatId: 'gst', rowCount: 0 }), party: { name: 'Ruby', phone: '', address: '', transport: '' }, rows: [row('p1', 'Pipe', '2', '50', { gstRate: '18' })] }
  let n = 0
  const { bill } = enterHybrid(base, () => `n${++n}`)
  const h = bill.hybrid!
  return { ...bill, hybrid: { ...h, rows: h.rows.map((r) => ({ ...r, nameRuns: [{ t: 'NG-Pipe' }] })) } }
}

const imageCalls: unknown[] = []
const tsvCalls: { text: string }[] = []
const w = window as unknown as { quot3?: unknown }

beforeEach(() => {
  imageCalls.length = 0; tsvCalls.length = 0
  w.quot3 = {
    image: { copy: async (p: unknown) => { imageCalls.push(p); return { ok: true, data: { width: 10, height: 10 } } }, prerender: async () => ({ ok: true, data: { cached: false } }) },
    clipboard: { writeTsv: async (p: { text: string }) => { tsvCalls.push(p); return { ok: true, data: {} } } },
    print: { decideQuick: async () => ({ ok: false, error: { message: 'x' } }), decide: async () => ({ ok: false, error: { message: 'x' } }) }
  }
  useSidePickStore.getState().set({ open: false, bill: null, run: null })
  closePrint()
})
afterEach(() => { delete w.quot3 })

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('Phase 152 - Hybrid output routing', () => {
  it('image copy asks first; the chosen side alone is rendered', async () => {
    await copyImageOfBill(hybridBill(), 'rough')
    expect(useSidePickStore.getState().open).toBe(true)
    expect(imageCalls.length).toBe(0) // nothing rendered before the answer
    chooseSide('non_gst'); await flush()
    expect(imageCalls.length).toBe(1)
    const json = JSON.stringify(imageCalls[0])
    expect(json.includes('NG-Pipe')).toBe(true)
    expect(json.includes('"Pipe"')).toBe(false)
    expect((imageCalls[0] as { bill: { formatId: string } }).bill.formatId).toBe('non_gst')
  })

  it('Esc / cancel outputs nothing', async () => {
    await copyImageOfBill(hybridBill(), 'rough')
    cancelSidePick(); await flush()
    expect(useSidePickStore.getState().open).toBe(false)
    expect(imageCalls.length).toBe(0)
  })

  it('print / Save PDF dialog opens for the chosen side only (a normal bill)', () => {
    expect(openPrintForBill(hybridBill(), 'rough')).toBe(true)
    expect(usePrintUiStore.getState().open).toBe(false)
    expect(useSidePickStore.getState().purpose).toBe('print')
    chooseSide('gst')
    const s = usePrintUiStore.getState()
    expect(s.open).toBe(true)
    expect(s.side).toBe('gst')
    expect(s.bill?.hybrid).toBeUndefined()
    expect(s.bill?.formatId).toBe('gst')
    expect(JSON.stringify(s.bill?.rows).includes('NG-Pipe')).toBe(false)
    closePrint()
    expect(openPrintForBill(hybridBill(), 'professional', { pdf: true })).toBe(true)
    expect(useSidePickStore.getState().purpose).toBe('pdf')
    chooseSide('non_gst')
    expect(usePrintUiStore.getState().autoPdf).toBe(true)
    expect(JSON.stringify(usePrintUiStore.getState().bill?.rows).includes('NG-Pipe')).toBe(true)
    closePrint()
  })

  it('a normal bill is not asked anything', () => {
    const plain: Bill = { ...createEmptyBill({ branchId: 'b', formatId: 'gst', rowCount: 0 }), rows: [row('p1', 'Pipe', '2', '50', { gstRate: '18' })] }
    expect(openPrintForBill(plain, 'rough')).toBe(true)
    expect(useSidePickStore.getState().open).toBe(false)
    expect(usePrintUiStore.getState().open).toBe(true)
    expect(usePrintUiStore.getState().side).toBeNull()
    closePrint()
  })

  it('text copy on Create asks first and copies one side only', async () => {
    useBillStore.getState().loadBill(hybridBill())
    await copyBillTsv()
    expect(useSidePickStore.getState().open).toBe(true)
    expect(tsvCalls.length).toBe(0)
    chooseSide('non_gst'); await flush()
    expect(tsvCalls.length).toBe(1)
    expect(tsvCalls[0]!.text.includes('NG-Pipe')).toBe(true)
    expect(tsvCalls[0]!.text.includes('\tPipe')).toBe(false)
  })
})
