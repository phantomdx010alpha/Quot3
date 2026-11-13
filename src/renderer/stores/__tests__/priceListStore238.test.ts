import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultColumnSet } from '@shared/pricelist/columns'
import { SEED_TIERS } from '@shared/pricelist/tiers'
import type { PriceRow, PriceTier } from '@shared/pricelist/types'
import type { PriceTree, SaveRowsInput } from '@shared/pricelist/api'
// The router store reads `window.location` when it is imported, so a minimal window exists before any import runs.
vi.hoisted(() => { (globalThis as unknown as { window: unknown }).window = { location: { hash: '' }, addEventListener: () => undefined, removeEventListener: () => undefined } })
import { runPriceListAction } from '../priceListActions'
import { usePriceListStore } from '../priceListStore'

// Invented data only. The bridge is mocked; nothing touches a database.
const tiers: PriceTier[] = SEED_TIERS.map((t, i) => ({ id: `ti${i}`, key: t.key, label: t.label, position: i }))
const columns = defaultColumnSet(SEED_TIERS)
const tree: PriceTree = {
  tiers,
  categories: [{ id: 'c1', name: 'Panna', color: null, position: 0 }],
  tabs: [{ id: 't1', categoryId: 'c1', name: 'Small', position: 0, columns }, { id: 't2', categoryId: 'c1', name: 'Big', position: 1, columns }]
}
const priceKey = columns[1]!.key
const mkRow = (id: string, name: string, idx: number, cells: Record<string, string> = {}): PriceRow => ({ id, tabId: 't1', idx, kind: 'item', nameRuns: name ? [{ t: name }] : [], cells })
let dbRows: PriceRow[]
let saved: SaveRowsInput[]
const st = () => usePriceListStore.getState()

beforeEach(() => {
  dbRows = [mkRow('r1', 'Acme one', 0, { [priceKey]: '10' }), mkRow('r2', 'Acme two', 1), mkRow('r3', 'Acme three', 2, { [priceKey]: '30' })]
  saved = []
  vi.stubGlobal('window', {
    location: { hash: '' },
    quot3: {
      pricelist: {
        tree: vi.fn(async () => ({ ok: true, data: tree })),
        rows: vi.fn(async (tabId: string) => ({ ok: true, data: tabId === 't1' ? dbRows : [] })),
        saveRows: vi.fn(async (input: SaveRowsInput) => {
          saved.push(input)
          let n = 0
          return { ok: true, data: { rows: input.rows.map((r) => ({ id: r.id ?? `real-${++n}`, tabId: input.tabId, idx: r.idx ?? 0, kind: r.kind, nameRuns: r.nameRuns, cells: r.cells })), deleted: input.deleteIds?.length ?? 0 } }
        }),
        structure: vi.fn(), columns: vi.fn()
      }
    }
  })
  st().reset()
})
afterEach(() => { st().reset(); vi.unstubAllGlobals() })

const open = async (): Promise<void> => { await st().load() }

describe('Phase 238 - Price List store', () => {
  it('loads the tree, opens the first tab and its rows', async () => {
    await open()
    expect(st().status).toBe('ready')
    expect(st().tabId).toBe('t1')
    expect(st().rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('typing in a cell is a draft; leaving commits it as ONE undo step, undo puts it back', async () => {
    await open()
    st().clickCell(1, 1)
    st().setDraft('55.5')
    expect(st().rows[1]!.cells[priceKey]).toBeUndefined() // not applied while typing
    st().commit()
    expect(st().rows[1]!.cells[priceKey]).toBe('55.5')
    expect(st().canUndo).toBe(true)
    st().undo()
    expect(st().rows[1]!.cells[priceKey]).toBeUndefined()
    st().redo()
    expect(st().rows[1]!.cells[priceKey]).toBe('55.5')
  })

  it('a price cell refuses letters in the draft', async () => {
    await open()
    st().clickCell(0, 1)
    st().setDraft('12x')
    expect(st().draft).toBeNull()
  })

  it('autosave sends only the changed row, not the whole tab', async () => {
    await open()
    st().clickCell(2, 1)
    st().setDraft('99')
    st().commit()
    await st().flush()
    expect(saved.length).toBe(1)
    expect(saved[0]!.rows.map((r) => r.id)).toEqual(['r3'])
    expect(st().save).toBe('saved')
  })

  it('a new row from Tab past the end is display-only until typed in (a blank row is never saved)', async () => {
    await open()
    st().insertRow('below')
    expect(st().rows.length).toBe(4)
    await st().flush()
    expect(saved.length).toBe(1) // the insert shifts nothing else but moves the later rows' idx only if needed
    expect(saved[0]!.rows.every((r) => r.nameRuns.length > 0)).toBe(true)
  })

  it('delete removes the selected row in one undo step and tells the database to delete it', async () => {
    await open()
    st().clickCell(1, 0)
    st().deleteSelected()
    expect(st().rows.map((r) => r.id)).toEqual(['r1', 'r3'])
    await st().flush()
    expect(saved.at(-1)!.deleteIds).toEqual(['r2'])
    st().undo()
    expect(st().rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('the filter hides rows and blocks inserting while on', async () => {
    await open()
    st().setFilter({ noPrice: true })
    expect(st().visibleRows().map((r) => r.id)).toEqual(['r2'])
    st().insertRow('above')
    expect(st().rows.length).toBe(3)
    expect(st().notice).toMatch(/filter/i)
  })

  it('page actions: no-price toggle, panel toggle, section toggle', async () => {
    await open()
    runPriceListAction('pricelist.noPrice')
    expect(st().filter.noPrice).toBe(true)
    runPriceListAction('pricelist.noPrice')
    expect(st().filter.noPrice).toBe(false)
    const was = st().panelOpen
    runPriceListAction('pricelist.panel')
    expect(st().panelOpen).toBe(!was)
    st().clickCell(1, 0)
    runPriceListAction('pricelist.section')
    expect(st().rows[1]!.kind).toBe('section')
    runPriceListAction('pricelist.section')
    expect(st().rows[1]!.kind).toBe('item')
  })

  it('moves rows down and keeps the cursor on the moved row', async () => {
    await open()
    st().clickCell(0, 0)
    runPriceListAction('pricelist.rowDown')
    expect(st().rows.map((r) => r.id)).toEqual(['r2', 'r1', 'r3'])
    expect(st().nav.row).toBe(1)
  })

  it('switching tab saves the open one first and loads the other', async () => {
    await open()
    st().clickCell(0, 1)
    st().setDraft('77')
    await st().selectTab('t2')
    expect(saved.length).toBe(1)
    expect(st().tabId).toBe('t2')
    expect(st().rows.length).toBe(1) // an empty tab opens with one blank row
  })
})
