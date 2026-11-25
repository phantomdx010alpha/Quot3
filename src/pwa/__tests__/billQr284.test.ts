// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../shared/format'
import { row } from '../../shared/__fixtures__/bills'
import { PRINT_FIXTURE_IDS, printFixture } from '../../shared/__fixtures__/printBills'
import type { SearchCandidate } from '../../shared/history/historySearch'
import type { Bill } from '../../shared/types'
import { getBill, type SaveBillInput } from '../data/billsRepo'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { saveBillWithParty } from '../data/partiesRepo'
import { billQrAmount, billQrInfo, billQrLine, pickBills } from '../share/billQr'
import { modelFor } from '../share/shareBill'
import { withOutbox } from '../sync/outbox'
import { BillQrSheet } from '../ui/kit/BillQrSheet'
import { PaymentsPage } from '../ui/kit/PaymentsPage'
import { ShareBar } from '../ui/kit/ShareBar'
import { PAY_WORDS, setQrPort, type QrImageInput, type QrPort } from '../ui/kit/paymentsModel'

// Phase 284 (M25): bill -> QR. Invented data only. The QR picture is a FAKE port (the QR library is Phase 282, not in this build); a real scan and the real
// phone look are NOT checked.
;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = (): Date => new Date('2026-11-24T10:00:00Z')
const digits = (s: string): string => s.replace(/[^0-9.]/g, '')
const strip = (s: string): string => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s)

/** The grand total text the shared print model prints for a bill, as a plain number. */
function printedGrandTotal(bill: Bill): string {
  const m = modelFor(bill, 'professional', null)
  const g = m.footer.find((r) => r.kind === 'grandTotal')!
  const cells = Object.values(g.cells)
  return strip(digits(cells[cells.length - 1]!.text))
}

describe('amount = the bill grand total (shared calc / print model, money.ts)', () => {
  it('equals the printed grand total for every print fixture', () => {
    for (const id of PRINT_FIXTURE_IDS) {
      const bill = printFixture(id)
      const am = billQrAmount(bill)
      if (am === '') continue
      expect(am, id).toBe(printedGrandTotal(bill))
    }
    expect(billQrAmount(printFixture('gst'))).not.toBe('')
  })

  it('a round-off bill gives the rounded whole-rupee total', () => {
    const bill = { ...printFixture('gst'), roundOff: 1 } as Bill
    const am = billQrAmount(bill)
    expect(am).toMatch(/^\d+$/)
    expect(am).toBe(printedGrandTotal(bill))
  })

  it('no float drift: 3 x 0.1 on a plain bill is exactly 0.3', () => {
    const bill = { ...printFixture('legacy'), rows: [row('x', '3', '0.1')] } as Bill
    expect(billQrAmount(bill)).toBe('0.3')
  })

  it('zero total, hybrid and unknown layout give an empty amount (payer enters)', () => {
    expect(billQrAmount({ ...printFixture('legacy'), rows: [] } as Bill)).toBe('')
    expect(billQrAmount({ ...printFixture('legacy'), hybrid: { rows: [] } } as unknown as Bill)).toBe('')
    expect(billQrAmount({ ...printFixture('legacy'), formatId: 'no_such_format' } as Bill)).toBe('')
  })

  it('the line names the bill by PO number and party name only', () => {
    const bill = printFixture('legacy')
    const line = billQrLine(bill)
    expect(line).toContain(bill.poNumber)
    expect(line).toContain(bill.party.name)
    expect(line).not.toContain(bill.party.address)
    expect(line).not.toContain(bill.party.phone)
    expect(billQrLine({ poNumber: '', party: { ...bill.party, name: '' } })).toBe('')
    expect(billQrLine({ poNumber: 'P'.repeat(200), party: bill.party }).length).toBeLessThanOrEqual(80)
    expect(billQrInfo(bill).line).toBe(line)
  })
})

describe('pickBills', () => {
  const c = (id: string, po: string, party: string, date: string, seq: number): SearchCandidate =>
    ({ id, poNumber: po, poSeq: seq, billDate: date, partyName: party, grandTotal: '100.00', branchId: 'b', revision: 1, itemText: '' })
  const all = [c('1', 'PH-1', 'Alpha Traders', '2026-11-20', 1), c('2', 'PH-2', 'Beta Stores', '2026-11-24', 2), c('3', 'PH-3', 'Gamma Pipes', '2026-11-24', 3)]

  it('blank query: newest first, bounded', () => {
    expect(pickBills(all, '').map((r) => r.id)).toEqual(['3', '2', '1'])
    expect(pickBills(all, '', 2)).toHaveLength(2)
  })
  it('finds by party, by PO number and by date (ISO or DD-MM-YY)', () => {
    expect(pickBills(all, 'alpha').map((r) => r.id)).toEqual(['1'])
    expect(pickBills(all, 'PH-2').map((r) => r.id)).toContain('2')
    expect(pickBills(all, '2026-11-20').map((r) => r.id)).toEqual(['1'])
    expect(pickBills(all, '24-11-26').map((r) => r.id).sort()).toEqual(['2', '3'])
    expect(pickBills(all, 'zzzzzz')).toEqual([])
  })
})

// ---- UI ----
let root: Root | null = null
let host: HTMLElement
beforeEach(() => { setQrPort(null) })
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ''; setQrPort(null); vi.restoreAllMocks() })
const settle = (ms = 60): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
async function mount(el: ReturnType<typeof createElement>): Promise<void> {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(el) })
  await settle()
}
const click = async (el: Element | null | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const type = async (el: Element | null, value: string): Promise<void> => {
  expect(el).toBeTruthy()
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el!.dispatchEvent(new Event('input', { bubbles: true })) })
}
const btn = (label: string): HTMLButtonElement | undefined => [...document.body.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label)
const amountInput = (): HTMLInputElement => document.body.querySelector('input[aria-label="Amount"]') as HTMLInputElement

const mk = (id: string, name: string, rows: SaveBillInput['bill']['rows'], date = '2026-11-24'): SaveBillInput => ({
  bill: { id, party: { name, phone: '9800000001', address: 'Secret lane 5', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: date, rows }
})
async function fixtureDb(): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  await setMetaValue(db, 'branch_id', 'branch-phone')
  await setMetaValue(db, 'po_prefix', 'PH-')
  const opts = { ...withOutbox({ now: NOW }), now: NOW }
  await saveBillWithParty(db, mk('b-alpha', 'Alpha Traders', [row('steel pipe', '2', '50.25')], '2026-11-20'), opts)
  await saveBillWithParty(db, mk('b-beta', 'Beta Stores', [row('bolt', '4', '10')]), opts)
  return db
}

/** A fake port: records the URL it was asked to draw and the image input. */
function fakePort(): { port: QrPort; urls: string[]; inputs: QrImageInput[] } {
  const urls: string[] = []; const inputs: QrImageInput[] = []
  const port: QrPort = {
    matrix: (u) => { urls.push(u); return [[true, false], [false, true]] },
    image: async (i) => { inputs.push(i); return { bytes: new Uint8Array([1, 2, 3]), fileName: 'payment-qr.png' } }
  }
  return { port, urls, inputs }
}
const lastAm = (urls: string[]): string | null => { const u = urls[urls.length - 1]; return u ? new URL(u.replace('upi://', 'http://x/')).searchParams.get('am') : null }

describe('Share QR sheet and Pick a bill', () => {
  it('the bill sheet prefills the grand total; Generate uses it; the bill is not modified', async () => {
    const db = await fixtureDb()
    const before = JSON.stringify(await getBill(db, 'b-alpha'))
    const bill = await getBill(db, 'b-alpha')
    const f = fakePort(); setQrPort(f.port)
    await mount(createElement(BillQrSheet, { open: true, onClose: () => undefined, db, bill }))
    expect(amountInput().value).toBe(billQrAmount(bill))
    expect(amountInput().value).toBe('101')
    expect(document.body.textContent).toContain(PAY_WORDS.billAmountNote)
    await click(btn(PAY_WORDS.generate))
    expect(lastAm(f.urls)).toBe('101')
    expect(document.body.textContent).toContain(billQrLine(bill))
    expect(JSON.stringify(await getBill(db, 'b-alpha'))).toBe(before)
  })

  it('an edited amount wins; an empty amount means the payer enters (no am)', async () => {
    const db = await fixtureDb(); const bill = await getBill(db, 'b-beta')
    const f = fakePort(); setQrPort(f.port)
    await mount(createElement(BillQrSheet, { open: true, onClose: () => undefined, db, bill }))
    expect(amountInput().value).toBe('40')
    await type(amountInput(), '15.5'); await click(btn(PAY_WORDS.generate))
    expect(lastAm(f.urls)).toBe('15.5')
    await type(amountInput(), ''); await click(btn(PAY_WORDS.generate))
    expect(lastAm(f.urls) ?? '').toBe('')
    expect(document.body.textContent).toContain(PAY_WORDS.openAmount)
  })

  it('the QR is its own image through the share sheet, named for the bill (PO + party only), never the bill image', async () => {
    const db = await fixtureDb(); const bill = await getBill(db, 'b-alpha')
    const f = fakePort(); setQrPort(f.port)
    const share = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    await mount(createElement(BillQrSheet, { open: true, onClose: () => undefined, db, bill }))
    await click(btn(PAY_WORDS.generate)); await click(btn(PAY_WORDS.share))
    expect(f.inputs).toHaveLength(1)
    expect(f.inputs[0]!.billLine).toBe(billQrLine(bill))
    expect(JSON.stringify(f.inputs[0])).not.toContain('Secret lane')
    expect(JSON.stringify(f.inputs[0])).not.toContain('9800000001')
    expect(share).toHaveBeenCalledTimes(1)
    const arg = (share.mock.calls[0] as unknown as [{ files: File[] }])[0]
    expect(arg.files[0]!.name).toBe('payment-qr.png')
    expect(arg.files[0]!.type).toBe('image/png')
    Reflect.deleteProperty(navigator, 'canShare'); Reflect.deleteProperty(navigator, 'share')
  })

  it('Payments page: search for a bill, pick it, the amount is filled, remove it again', async () => {
    const db = await fixtureDb()
    const f = fakePort(); setQrPort(f.port)
    await mount(createElement(PaymentsPage, { db }))
    expect(document.body.textContent).toContain(PAY_WORDS.pickTitle)
    expect(document.body.textContent).toContain('Alpha Traders')
    await type(document.body.querySelector(`input[aria-label="${PAY_WORDS.pickSearch}"]`), 'alpha')
    expect(document.body.textContent).not.toContain('Beta Stores')
    const row1 = [...document.body.querySelectorAll('.q3x-pay-picklist button')][0]
    await click(row1)
    expect(amountInput().value).toBe('101')
    await click(btn(PAY_WORDS.generate))
    expect(document.body.textContent).toContain('Alpha Traders')
    await click(document.body.querySelector(`button[aria-label="${PAY_WORDS.pickClear}"]`))
    expect(document.body.querySelector('.q3x-pay-picked')).toBeNull()
  })

  it('the Share QR button exists only when the layout asks for it', async () => {
    const db = await fixtureDb(); const bill = await getBill(db, 'b-alpha')
    let n = 0
    await mount(createElement(ShareBar, { db, bill, mode: 'view', onShareQr: () => { n++ } }))
    await click(btn('Share QR')); expect(n).toBe(1)
    act(() => root!.render(createElement(ShareBar, { db, bill, mode: 'view' }))); await settle()
    expect(btn('Share QR')).toBeUndefined()
  })

  it('source scan: the new files hold no emoji, no raw colours, no main imports, no bill writes', () => {
    const files = [['share', 'billQr.ts'], ['ui', 'kit', 'BillPicker.tsx'], ['ui', 'kit', 'BillQrSheet.tsx']]
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, '..', ...f), 'utf8')
      expect(src, f.join('/')).not.toMatch(/\p{Extended_Pictographic}/u)
      expect(src, f.join('/')).not.toMatch(/from '[./]*\/main\//)
      expect(src, f.join('/')).not.toMatch(/saveBill|deleteBills|restoreBills|setSetting/)
    }
    const css = readFileSync(resolve(__dirname, '..', 'ui', 'kit', 'payments.css'), 'utf8')
    expect(css.slice(css.indexOf('Phase 284'))).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/)
  })
})
