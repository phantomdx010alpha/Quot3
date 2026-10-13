// @vitest-environment jsdom
/**
 * Phase 32 — Create page integration QA.
 * The REAL Create page, hotkeys, guard and stores in jsdom, talking over a fake bridge to the REAL ipc handlers, billService
 * and a real temp-file SQLite database (so PO numbers, party creation, revisions and totals are the production ones).
 * No Electron / Chromium: real caret, focus and layout are NOT covered (see PHASE_STATUS standing gaps).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../main/db/__tests__/helpers'
import { createBillRepo } from '../main/db/billRepo'
import { createPartyRepo } from '../main/db/partyRepo'
import { createBillService, type BillService } from '../main/services/billService'
import { createPartyService, type PartyService } from '../main/services/partyService'
import { seedHistoricalBills } from '../main/services/seedHistory'
import { billHandlers } from '../main/ipc/bills'
import { partyHandlers } from '../main/ipc/parties'
import Create from '../renderer/pages/Create'
import { UnsavedDialog } from '../renderer/components/create/UnsavedDialog'
import { useHotkeys } from '../renderer/hooks/useHotkeys'
import { useAppActions } from '../renderer/hooks/useAppActions'
import { useDirtyGuard } from '../renderer/hooks/useDirtyGuard'
import { useBillStore } from '../renderer/stores/billStore'
import { useGridUiStore } from '../renderer/stores/gridUiStore'
import { useGuardStore } from '../renderer/stores/guardStore'
import { usePartyIndexStore } from '../renderer/stores/partyIndexStore'
import { usePartyUiStore } from '../renderer/stores/partyUiStore'
import { useSaveUiStore } from '../renderer/stores/saveUiStore'
import { createSession, openBillForEdit } from '../renderer/stores/createSession'
import { useRouter } from '../renderer/router/routerStore'
import { computeBill } from '../shared/calc/billTotals'
import { getFormat } from '../shared/format'
import { historicalBills, HISTORICAL_BILL_COUNT } from '../shared/__fixtures__/historicalBills'
import { currentPath, initialNav, ROUTES } from '../shared/routes'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let t: TestDb
let svc: BillService
let partySvc: PartyService
let host: HTMLDivElement
let root: Root
const S = () => useBillStore.getState()
const path = () => currentPath(useRouter.getState().nav)
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]')
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }) }
const q = (sql: string, ...a: unknown[]) => t.handle.sqlite.prepare(sql).all(...a) as Record<string, unknown>[]
const one = (sql: string, ...a: unknown[]) => q(sql, ...a)[0]!
const field = (n: string) => host.querySelector<HTMLInputElement>(`[data-party-field="${n}"]`)!
const today = new Date().toISOString().slice(0, 10)

function Shell(): React.JSX.Element {
  useHotkeys([], useAppActions())
  useDirtyGuard()
  const onCreate = currentPath(useRouter((s) => s.nav)) === ROUTES.create
  return createElement('div', null, onCreate ? createElement(Create) : null, createElement(UnsavedDialog))
}
function key(k: string, m: Partial<KeyboardEventInit> = {}, target?: Element): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (target ?? document.activeElement ?? document.body).dispatchEvent(ev) })
  return ev
}
function typeInto(el: HTMLInputElement, value: string): void {
  act(() => {
    el.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  el.setSelectionRange(value.length, value.length)
}
const rowId = (i: number) => S().rows[i]!.id
function item(i: number, name: string, qty: string, rate: string): void {
  act(() => { S().ensureBodyRows(i + 4); S().setCellText(rowId(i), 'name', name); S().setCellText(rowId(i), 'qty', qty); S().setCellText(rowId(i), 'rate', rate) })
}

async function boot(): Promise<void> {
  const sqlite = t.handle.sqlite
  const partyRepo = createPartyRepo(sqlite)
  partySvc = createPartyService(partyRepo)
  svc = createBillService({ sqlite, bills: createBillRepo(sqlite), parties: partyRepo })
  const h = { ...billHandlers(svc), ...partyHandlers(partySvc) }
  ;(window as unknown as { quot3: unknown }).quot3 = {
    bills: {
      newDefaults: () => h['bills:newDefaults']!({}),
      save: (p: unknown) => h['bills:save']!(p),
      getForEdit: (id: string) => h['bills:getForEdit']!({ id })
    },
    parties: { list: () => h['parties:list']!({}), upsert: (p: unknown) => h['parties:upsert']!(p) },
    app: { confirmQuit: async () => ({ ok: true, data: {} }) },
    on: () => () => {}
  }
  createSession.set(null)
  useBillStore.setState({ billId: null })
  useGuardStore.setState({ open: false, saved: false, busy: false, pending: null })
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  usePartyUiStore.setState({ addressOpen: false })
  usePartyIndexStore.setState({ parties: [], loaded: false }) // so the page fetches over the bridge, as on first launch
  useSaveUiStore.setState({ saving: false, last: null })
  act(() => { useRouter.setState({ nav: initialNav(ROUTES.dashboard), navCount: 0 }) })
  act(() => { useRouter.getState().navigate(ROUTES.create) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(Shell)) })
  await flush()
}

beforeEach(() => { t = openTestDb() })
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  document.body.innerHTML = ''
  delete (window as unknown as { quot3?: unknown }).quot3
  t.cleanup()
})

describe('Phase 32 — Create page, end to end', () => {
  it('new bill → party autocomplete → 5 items + adjustment → formats → extra column → Mark → save → reopen → edit → Esc → discard', async () => {
    partySvc = createPartyService(createPartyRepo(t.handle.sqlite)); partySvc.seedSamples()
    await boot()
    expect(S().dirty).toBe(false)
    expect(usePartyIndexStore.getState().parties.length).toBe(30) // the page loaded the real party list over the bridge

    // 1. party autocomplete (typo) → ArrowDown + Enter picks and fills all four fields
    const name = field('name')
    typeInto(name, 'Rubi Trader')
    expect(host.querySelector('[role=listbox]')).not.toBeNull()
    key('ArrowDown', {}, name)
    key('Enter', {}, name)
    expect(S().party).toMatchObject({ name: 'Ruby Traders', phone: '98860 22001', transport: 'Sugama Transport' })

    // 2. five items + one adjustment (name + total only → leaves the body for the footer)
    item(0, 'Pen', '10', '9'); item(1, 'Book', '2', '45.50'); item(2, 'Ruler', '5', '12'); item(3, 'Eraser', '4', '2.5'); item(4, 'Bag', '1', '350')
    act(() => { S().ensureBodyRows(10); S().setCellText(rowId(5), 'name', 'Discount'); S().setCellText(rowId(5), 'total', '-50') })
    const calc = () => computeBill(getFormat(S().formatId), S().rows)
    expect(calc().itemsTotal).toBe('601.00') // 90 + 91 + 60 + 10 + 350 = 601, less 50
    expect(calc().grandTotal).toBe('551.00')
    expect(S().view.footer.map((f) => f.kind)).toContain('adjustment')

    // 3. switch formats with the real hotkeys: nothing is lost, GST % is kept
    key('1', { altKey: true }, document.body)
    expect(S().formatId).toBe('gst')
    act(() => { S().setCellText(rowId(0), 'gstRate', '18') })
    key('2', { altKey: true }, document.body)
    expect(S().formatId).toBe('non_gst')
    expect(S().rows[0]!.gstRate).toBe('18')
    expect(calc().grandTotal).toBe('551.00')

    // 4. extra column + text + Mark
    key('=', { ctrlKey: true, altKey: true }, document.body)
    expect(S().extraCols).toHaveLength(1)
    const ck = S().extraCols[0]!.key
    act(() => { S().setCellText(rowId(0), ck, '(125-5)'); S().setCellText(rowId(1), ck, 'tomato-7'); S().toggleMark(rowId(1), ck) })
    expect(S().rows[1]!.extras[ck]).toMatchObject({ text: 'tomato-7', marked: true })

    // 5. save with Ctrl+S → DB holds exactly what was entered
    await act(async () => { key('s', { ctrlKey: true }, document.body) })
    await flush()
    expect(S().dirty).toBe(false)
    const b = one('SELECT * FROM bills')
    expect(b).toMatchObject({ po_number: 'Q3-0001', revision: 1, format_id: 'non_gst', item_row_count: 5 })
    expect(JSON.parse(b['totals_json'] as string)).toMatchObject({ itemsSubtotal: '601.00', grandTotal: '551.00' })
    expect(JSON.parse(b['party_snapshot_json'] as string)).toMatchObject({ name: 'Ruby Traders' })
    expect(one('SELECT count(*) AS c FROM parties').c).toBe(30) // existing party linked, not duplicated
    expect(one('SELECT count(*) AS c FROM bill_revisions').c).toBe(1)
    const billId = S().billId!
    expect(one('SELECT party_id FROM bills').party_id).toBe(one('SELECT id FROM parties WHERE name = ?', 'Ruby Traders').id)

    // 6. leave (clean → silent), start over, reopen the saved bill for edit — identical content
    key('Escape', {}, document.body)
    expect(dialog()).toBeNull()
    expect(path()).toBe(ROUTES.dashboard)
    createSession.set(null); useBillStore.setState({ billId: null })
    expect(await openBillForEdit(billId)).toBe(true)
    act(() => { useRouter.getState().navigate(ROUTES.create) })
    await flush()
    expect(S().billId).toBe(billId)
    expect(S().poNumber).toBe('Q3-0001')
    expect(S().party.name).toBe('Ruby Traders')
    expect(S().extraCols[0]!.header).toBe('Col 1')
    expect(S().rows[1]!.extras[ck]).toMatchObject({ marked: true })
    expect(calc().grandTotal).toBe('551.00')
    expect(S().dirty).toBe(false)

    // 7. edit → Esc asks "Save changes?" → Discard leaves the stored bill untouched
    act(() => { S().setCellText(rowId(0), 'rate', '99') })
    expect(S().dirty).toBe(true)
    key('Escape', {}, document.body)
    expect(path()).toBe(ROUTES.create)
    expect(dialog()?.textContent).toContain('Save changes?')
    key('d', {}, dialog()!.querySelector('[data-guard-keys]')!)
    expect(dialog()).toBeNull()
    expect(path()).toBe(ROUTES.dashboard)
    expect(one('SELECT revision FROM bills').revision).toBe(1)
    expect(JSON.parse(one('SELECT totals_json FROM bills').totals_json as string).grandTotal).toBe('551.00')
  })

  it('edit → Esc → Save: same PO, revision 2, rows replaced, a second revision snapshot, no new party', async () => {
    await boot()
    typeInto(field('name'), 'Brand New Traders')
    item(0, 'Pen', '10', '9')
    await act(async () => { key('s', { ctrlKey: true }, document.body) })
    await flush()
    const id = S().billId!
    expect(one('SELECT count(*) AS c FROM parties').c).toBe(1) // new party created exactly once, at save
    act(() => { S().setCellText(rowId(0), 'qty', '20') })
    key('Escape', {}, document.body)
    expect(dialog()?.textContent).toContain('Save changes?')
    await act(async () => { key('s', {}, dialog()!.querySelector('[data-guard-keys]')!) })
    await flush()
    expect(path()).toBe(ROUTES.dashboard)
    expect(one('SELECT po_number, revision FROM bills WHERE id = ?', id)).toEqual({ po_number: 'Q3-0001', revision: 2 })
    expect(one('SELECT qty FROM bill_rows WHERE bill_id = ?', id).qty).toBe('20')
    expect(one('SELECT count(*) AS c FROM bill_revisions').c).toBe(2)
    expect(one('SELECT count(*) AS c FROM parties').c).toBe(1)
  })

  it('a new bill after a saved one gets the next PO and does not touch the first', async () => {
    await boot()
    typeInto(field('name'), 'First Party'); item(0, 'Pen', '1', '10')
    await act(async () => { key('s', { ctrlKey: true }, document.body) })
    await flush()
    key('n', { ctrlKey: true }, document.body)
    await flush()
    expect(S().party.name).toBe('')
    typeInto(field('name'), 'Second Party'); item(0, 'Book', '2', '20')
    await act(async () => { key('s', { ctrlKey: true }, document.body) })
    await flush()
    expect(q('SELECT po_number FROM bills ORDER BY po_seq').map((r) => r.po_number)).toEqual(['Q3-0001', 'Q3-0002'])
    expect(one('SELECT count(*) AS c FROM bill_rows').c).toBe(2)
  })

  it('save refuses without a party name (nothing written, Party name focused) and the guard still protects the bill', async () => {
    await boot()
    item(0, 'Pen', '1', '10')
    await act(async () => { key('s', { ctrlKey: true }, document.body) })
    await flush()
    expect(one('SELECT count(*) AS c FROM bills').c).toBe(0)
    expect(document.activeElement).toBe(field('name'))
    expect(S().dirty).toBe(true)
    key('Escape', {}, document.body)
    expect(dialog()?.textContent).toContain('Save this bill?')
  })
})

describe('Phase 32 — thirty historical bills for later phases', () => {
  it('the fixture is deterministic, varied and valid', () => {
    const a = historicalBills(); const b = historicalBills()
    expect(a).toHaveLength(HISTORICAL_BILL_COUNT)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(new Set(a.map((x) => x.formatId))).toEqual(new Set(['gst', 'non_gst']))
    expect(a.some((x) => x.extraCols.length > 0)).toBe(true)
    expect(a.some((x) => x.rows.some((r) => r.qty === null && r.totalOverride !== null))).toBe(true) // adjustments
    expect(a.some((x) => x.rows.some((r) => r.nameRuns.some((n) => n.r)))).toBe(true) // styled names
    expect(new Set(a.map((x) => x.billDate)).size).toBe(HISTORICAL_BILL_COUNT) // spread over time
  })

  it('seedHistoricalBills saves all 30 through the real save path, once, and refuses a database that already has bills', () => {
    const sqlite = t.handle.sqlite
    const partyRepo = createPartyRepo(sqlite)
    const s = createBillService({ sqlite, bills: createBillRepo(sqlite), parties: partyRepo })
    expect(seedHistoricalBills(s, sqlite)).toBe(30)
    expect(one('SELECT count(*) AS c FROM bills').c).toBe(30)
    expect(one('SELECT max(po_seq) AS m FROM bills').m).toBe(30)
    expect(one('SELECT count(*) AS c FROM bill_revisions').c).toBe(30)
    expect(one('SELECT count(*) AS c FROM parties').c).toBe(30)
    expect(one('SELECT count(*) AS c FROM bills WHERE totals_json IS NULL').c).toBe(0)
    expect(seedHistoricalBills(s, sqlite)).toBe(0) // idempotent: never mixes into existing data
    expect(one('SELECT count(*) AS c FROM bills').c).toBe(30)
    const adj = one("SELECT totals_json FROM bills WHERE id = 'hist-05'") // i = 4 → Discount adjustment
    expect(JSON.parse(adj.totals_json as string).adjustmentsTotal).toBe('-100.00')
  })
})
