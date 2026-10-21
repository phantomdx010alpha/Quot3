// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createElement, act, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import '../../shared/format'
import { row } from '../../shared/__fixtures__/bills'
import { createEmptyBill } from '../../shared/billModel'
import { getBillOptions } from '../../shared/calc/billOptions'
import { computeBill } from '../../shared/calc/billTotals'
import { resolveFormat } from '../../shared/format/registry'
import { summarizeUnits } from '../../shared/units'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { getBill, listBillHeads, saveBill } from '../data/billsRepo'
import {
  addColumn, buildEditorView, buildUnitsSummary, columnHasData, formatName, isDirty, isRoundOff, openExistingBill, openNewBill, removeColumn, renameColumn,
  setExtraCell, setItemField, setPartyField, setRoundOff, setTotalOverride, toSaveInput, toggleMark
} from '../ui/editor/editorModel'
import { App, type AppProps } from '../App'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 9, 21, 12, 0, 0)
const TODAY = '2026-10-21'
async function freshDb(): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  await setMetaValue(db, 'branch_id', 'branch-phone')
  await setMetaValue(db, 'po_prefix', 'PH-')
  return db
}
const fresh = (roundOff = false) => openNewBill({ branchId: 'b1', roundOff, today: TODAY, now: NOW.toISOString() })
const withItem = (qty: string, rate: string) => {
  let s = fresh()
  const id = s.bill.rows[0]!.id
  s = setItemField(setItemField(s, id, 'qty', qty), id, 'rate', rate)
  return { s, id }
}

describe('editor model, phase 183', () => {
  it('typed total overrides qty x rate exactly like the shared engine, and clearing returns to automatic', () => {
    const { s, id } = withItem('2', '50')
    const o = setTotalOverride(s, id, '90')
    const v = buildEditorView(o)
    const shared = computeBill(resolveFormat('non_gst'), o.bill.rows, getBillOptions(o.bill))
    expect(v.items[0]?.amount).toBe('90.00')
    expect(v.items[0]?.override).toBe('90')
    expect(v.grandTotal).toBe(shared.display.find((d) => d.kind === 'grandTotal')?.cells['total'])
    expect(buildEditorView(setTotalOverride(o, id, '')).items[0]?.amount).toBe('100.00')
  })

  it('round-off flag: per-bill, read through getBillOptions, travels in the save input', () => {
    let { s } = withItem('1', '100.40')
    expect(isRoundOff(s)).toBe(false)
    expect(buildEditorView(s).grandTotal).toBe('100.40')
    s = setRoundOff(s, true)
    expect(isRoundOff(s)).toBe(true)
    expect(buildEditorView(s).grandTotal).toBe('100.00')
    expect(computeBill(resolveFormat('non_gst'), s.bill.rows, getBillOptions(s.bill)).grandTotal).toBe('100.00')
    expect(toSaveInput(s).bill.roundOff).toBe(1)
    expect(toSaveInput(setRoundOff(s, false)).bill.roundOff).toBe(0)
    expect(isDirty(s)).toBe(true)
  })

  it('B and R+B apply to the selection only; no selection = the whole name; typing keeps styles', () => {
    let { s, id } = withItem('1', '1')
    s = setItemField(s, id, 'name', 'steel pipe')
    const bold = formatName(s, id, 'bold', 0, 5)
    expect(bold.bill.rows[0]?.nameRuns).toEqual([{ t: 'steel', b: 1 }, { t: ' pipe' }])
    const rb = formatName(s, id, 'redBold', 6, 10)
    expect(rb.bill.rows[0]?.nameRuns).toEqual([{ t: 'steel ' }, { t: 'pipe', b: 1, r: 1 }])
    const whole = formatName(s, id, 'bold', 3, 3)
    expect(whole.bill.rows[0]?.nameRuns).toEqual([{ t: 'steel pipe', b: 1 }])
    const typed = setItemField(rb, id, 'name', 'steel pipes')
    expect(typed.bill.rows[0]?.nameRuns.map((x) => x.t).join('')).toBe('steel pipes')
    expect(typed.bill.rows[0]?.nameRuns[0]).toEqual({ t: 'steel ' })
  })

  it('extra columns: add, rename, cells, Mark, units summary equals the shared engine, remove strips every trace', () => {
    let { s, id } = withItem('1', '10')
    const a = addColumn(s)!
    s = renameColumn(a.state, a.key, '  ameto ')
    expect(s.bill.extraCols[0]).toMatchObject({ key: 'c1', header: 'ameto' })
    expect(renameColumn(s, 'c1', '   ')).toBe(s)
    const b = addItemRow(s)
    s = b.state
    const id2 = b.id
    const id3 = addItemRow(s)
    s = id3.state
    s = setExtraCell(s, id, 'c1', '(125-5)')
    s = setExtraCell(s, id2, 'c1', 'second lot')
    s = toggleMark(s, id2, 'c1')
    s = setExtraCell(s, id3.id, 'c1', '7-3')
    expect(s.bill.rows[1]?.extras['c1']).toEqual({ text: 'second lot', marked: true })
    const sum = buildUnitsSummary(s)
    expect(sum).toEqual(summarizeUnits(s.bill.rows, s.bill.extraCols, {}))
    expect(sum.byColumn[0]?.base.units).toBe('5')
    expect(sum.byColumn[0]?.marked).toEqual([{ label: 'second lot', rowId: id2, units: '3' }])
    expect(buildEditorView(s).items[0]?.extras['c1']).toEqual({ text: '(125-5)', marked: false })
    expect(setExtraCell(s, id, 'zz', 'x')).toBe(s)
    expect(columnHasData(s, 'c1')).toBe(true)
    // unmark keeps the text; an emptied unmarked cell is dropped
    s = toggleMark(s, id2, 'c1')
    expect(s.bill.rows[1]?.extras['c1']).toEqual({ text: 'second lot' })
    s = setExtraCell(s, id2, 'c1', '')
    expect(s.bill.rows[1]?.extras['c1']).toBeUndefined()
    const base = { ...s.bill, footerExtras: { grandTotal: { c1: { text: 'f' } } }, tailRows: [{ extras: { c1: { text: 't' } } }] }
    const gone = removeColumn({ ...s, bill: base }, 'c1')
    expect(gone.bill.extraCols).toEqual([])
    expect(gone.bill.rows.every((r) => !('c1' in r.extras))).toBe(true)
    expect(gone.bill.footerExtras).toBeUndefined()
    expect(gone.bill.tailRows).toBeUndefined()
  })
})

function addItemRow(s: ReturnType<typeof fresh>) {
  const next = { ...s.bill, rows: [...s.bill.rows, { ...row('', null, null), id: `r${s.bill.rows.length + 1}`, idx: s.bill.rows.length }] }
  return { state: { ...s, bill: next }, id: `r${s.bill.rows.length + 1}` }
}

describe('save round trip, phase 183', () => {
  it('unknown fields (footer extras, tail rows, cell styles, extras of other columns) round-trip unchanged', async () => {
    const db = await freshDb()
    const r = row('steel pipe', '2', '50')
    r.cellStyle = { name: { hl: 1 } }
    r.extras = { c1: { text: '9-1', marked: true }, c9: { text: 'orphan' } }
    const base = createEmptyBill({ branchId: 'b1', formatId: 'non_gst', billDate: TODAY })
    const bill = { ...base, party: { name: 'Round Trip', phone: '', address: '', transport: '' }, extraCols: [{ key: 'c1', header: 'ameto', kind: 'units' as const }], rows: [r],
      footerExtras: { grandTotal: { c1: { text: 'f-2' } } }, tailRows: [{ extras: { c1: { text: 't-3' } } }] }
    const saved = await saveBill(db, toSaveInput(openExistingBill(bill)))
    const back = await getBill(db, saved.id)
    expect(back.rows[0]?.cellStyle).toEqual({ name: { hl: 1 } })
    expect(back.rows[0]?.extras).toEqual(r.extras)
    expect(back.footerExtras).toEqual(bill.footerExtras)
    expect(back.tailRows).toEqual(bill.tailRows)
    expect(back.extraCols).toEqual(bill.extraCols)
    // open the STORED bill, edit nothing, save again: nothing but the revision moves
    const again = await saveBill(db, { ...toSaveInput(openExistingBill(back)), expectedRevision: back.revision })
    const back2 = await getBill(db, again.id)
    expect(back2.revision).toBe(2)
    expect(back2.rows).toEqual(back.rows)
    expect(back2.footerExtras).toEqual(back.footerExtras)
    expect(back2.tailRows).toEqual(back.tailRows)
  })

  it('the per-bill round-off flag is stored as sent (the setting only decides when none is sent)', async () => {
    const db = await freshDb()
    const mk = (id: string, ro?: 0 | 1) => ({ bill: { id, party: { name: 'P', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: TODAY, rows: [row('a', '1', '100.40')], ...(ro === undefined ? {} : { roundOff: ro }) } })
    expect((await getBill(db, (await saveBill(db, mk('x0', 0))).id)).roundOff).toBeFalsy()
    expect((await getBill(db, (await saveBill(db, mk('x1', 1))).id)).roundOff).toBe(1)
    expect((await getBill(db, (await saveBill(db, mk('x2'))).id)).roundOff).toBe(1)
  })
})

describe('editor screen, phase 183', () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })
  const settle = (ms = 120): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
  async function mount(db: PhoneDb): Promise<HTMLElement> {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root?.render(createElement(App as FC<AppProps>, { services: { db, now: () => NOW, engine: null }, backEnv: null })) })
    await settle()
    return host
  }
  const click = async (el: Element | null | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
  const btn = (h: ParentNode, text: string | RegExp): HTMLButtonElement | undefined =>
    [...h.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')))
  const input = (h: ParentNode, label: string): HTMLInputElement => h.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  const type = async (el: HTMLInputElement, value: string): Promise<void> => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const open = async (h: HTMLElement): Promise<void> => {
    await click([...h.querySelectorAll<HTMLButtonElement>('.q3-nav-item')].find((b) => b.textContent === 'New'))
    await click(h.querySelector('.q3-erow-line'))
  }

  it('typed total and Round off change the strip; the typed total is saved', async () => {
    const db = await freshDb()
    const h = await mount(db)
    await open(h)
    await type(input(h, 'Qty'), '2')
    await type(input(h, 'Rate'), '50.20')
    // a new bill follows the round-off setting (default ON): 100.40 shows as 100.00
    expect(h.querySelector('.q3-grand strong')?.textContent).toBe('100.00')
    await type(input(h, 'Total (typed)'), '90.40')
    expect(h.querySelector('.q3-grand strong')?.textContent).toBe('90.00')
    await click(btn(h, 'Round off'))
    expect(h.querySelector('.q3-grand strong')?.textContent).toBe('90.40')
    await type(input(h, 'Party name'), 'Ovr Co')
    await click(btn(h, 'Save'))
    await settle(200)
    const id = (await listBillHeads(db))[0]!.id
    const stored = await getBill(db, id)
    expect(stored.rows[0]?.totalOverride).toBe('90.40')
    expect(stored.roundOff).toBeFalsy()
  })

  it('Columns sheet adds a column, the row gets a cell and Mark, the Units sheet totals it', async () => {
    const h = await mount(await freshDb())
    await open(h)
    await type(input(h, 'Qty'), '1')
    await type(input(h, 'Rate'), '1')
    await click(btn(h, 'Columns'))
    expect(h.querySelector('[role="dialog"][aria-label="Columns"]')).toBeTruthy()
    await click(btn(h, 'Add column'))
    await type(input(h, 'Header of c1'), 'ameto')
    await act(async () => { input(h, 'Header of c1').dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    await click(btn(h, 'Close'))
    expect(btn(h, /^Columns \(1\)/)).toBeTruthy()
    await type(input(h, 'Col 1 cell') ?? input(h, 'ameto cell'), '(125-5)')
    expect(btn(h, 'Units')).toBeTruthy()
    await click(btn(h, 'Units'))
    const dlg = h.querySelector<HTMLElement>('[role="dialog"][aria-label="Units summary"]')!
    expect(dlg.textContent).toContain('5')
    await click(btn(dlg, 'Close'))
    expect(h.querySelector('[role="dialog"]')).toBeNull()
  })

  it('B on a selected part of the name styles only that part (shown in the collapsed row)', async () => {
    const h = await mount(await freshDb())
    await open(h)
    const name = input(h, 'Item name')
    await type(name, 'steel pipe')
    name.focus()
    name.setSelectionRange(0, 5)
    await click(btn(h, 'B'))
    await click(btn(h, 'Done'))
    const runs = [...h.querySelectorAll('.q3-ename span')]
    expect(runs.some((e) => e.className.includes('q3-run-b') && e.textContent === 'steel')).toBe(true)
    expect(runs.some((e) => e.textContent === ' pipe' && !e.className.includes('q3-run-b'))).toBe(true)
  })

  it('unused: party helper stays importable', () => {
    expect(setPartyField(fresh(), 'name', 'x').bill.party.name).toBe('x')
  })
})
