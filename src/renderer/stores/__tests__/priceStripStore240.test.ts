import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePriceStripStore, __rowStateOf } from '../priceStripStore'
import { useBillStore } from '../billStore'
import { createEmptyBill } from '@shared/billModel'
import { readPriceListSettings } from '@shared/pricelist/settings'
import { buildBillingData } from '@shared/pricelist/billing'
import { defaultColumnSet } from '@shared/pricelist/columns'
import { SEED_TIERS } from '@shared/pricelist/tiers'
import { newRow } from '@shared/pricelist/rows'
import { plain, fromPlain } from '@shared/richtext/runs'

import type { PriceRow } from '@shared/pricelist/types'

// Invented names only.
const columns = defaultColumnSet(SEED_TIERS)
const col = (tier: string): string => columns.find((c) => c.tier === tier)!.key
const mk = (id: string, name: string, wo: string, gst: string): PriceRow => ({ ...newRow(id, 't1', 0, 'item', name), cells: { [col('cash_wo')]: wo, [col('cash_gst')]: gst } })
const priceRows = [mk('p1', 'ZETA ROUND BOX 1001 (90 CMS)', '110', '108'), mk('p2', 'ZETA ROUND BOX 1002 (90 CMS)', '120', '118')]
const tab = { id: 't1', categoryId: 'c1', name: 'Boxes', position: 0, columns }

function setup(mode: 'auto' | 'suggest' | 'off' = 'auto'): string[] {
  const bill = createEmptyBill({ branchId: 'local', rowCount: 3, roundOff: false })
  useBillStore.getState().loadBill(bill)
  usePriceStripStore.getState().reset()
  usePriceStripStore.setState({
    settings: readPriceListSettings({ 'pricelist.billing.mode': mode }), data: buildBillingData([tab], { t1: priceRows }, [], (r) => plain(r.nameRuns)), loadedAt: Date.now()
  })
  return useBillStore.getState().rows.map((r) => r.id)
}
const name = (id: string, text: string): void => { useBillStore.getState().setNameRuns(id, fromPlain(text)) }
const rateOf = (id: string): string | null => useBillStore.getState().rows.find((r) => r.id === id)!.rate

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', { quot3: { settings: { set: vi.fn(async () => ({ ok: true, data: {} })), getAll: vi.fn(async () => ({ ok: false })) } } }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('priceStripStore (Phase 240)', () => {
  it('fills the Rate on leaving an edited item name, from the tier of the bill format, as ONE undo step that removes only the rate', async () => {
    const ids = setup()
    const id = ids[0]!
    name(id, 'zeta round box 1001 (90 cms)')
    const undoBefore = useBillStore.getState().undoLabel
    usePriceStripStore.getState().leaveName('primary', id)
    await vi.advanceTimersByTimeAsync(5)
    expect(rateOf(id)).toBe('110') // non_gst default tier cash_wo
    expect(useBillStore.getState().undoLabel).toBe('Rate filled from Price List')
    expect(undoBefore).not.toBe('Rate filled from Price List')
    useBillStore.getState().undo()
    expect(rateOf(id)).toBeNull()
    expect(plain(useBillStore.getState().rows.find((r) => r.id === id)!.nameRuns)).toBe('zeta round box 1001 (90 cms)')
  })
  it('uses the GST tier on a GST bill (mapping is data keyed by format id)', async () => {
    const ids = setup()
    useBillStore.getState().setFormatId('gst')
    name(ids[0]!, 'zeta round box 1001 (90 cms)')
    usePriceStripStore.getState().leaveName('primary', ids[0]!)
    await vi.advanceTimersByTimeAsync(5)
    expect(rateOf(ids[0]!)).toBe('108')
  })
  it('never fills in Suggest or Off mode, and never when nothing was typed (no leaveName call)', async () => {
    for (const mode of ['suggest', 'off'] as const) {
      const ids = setup(mode)
      name(ids[0]!, 'zeta round box 1001 (90 cms)')
      usePriceStripStore.getState().leaveName('primary', ids[0]!)
      await vi.advanceTimersByTimeAsync(5)
      expect(rateOf(ids[0]!)).toBeNull()
    }
    const ids = setup()
    name(ids[0]!, 'zeta round box 1001 (90 cms)')
    await vi.advanceTimersByTimeAsync(500)
    expect(rateOf(ids[0]!)).toBeNull()
  })
  it('never over a rate typed by hand, and a typed-then-cleared rate is not refilled', async () => {
    const ids = setup()
    useBillStore.getState().setCellText(ids[0]!, 'rate', '99')
    name(ids[0]!, 'zeta round box 1001 (90 cms)')
    usePriceStripStore.getState().leaveName('primary', ids[0]!)
    await vi.advanceTimersByTimeAsync(5)
    expect(rateOf(ids[0]!)).toBe('99')
    usePriceStripStore.getState().rateTyped('primary', ids[1]!)
    name(ids[1]!, 'zeta round box 1002 (90 cms)')
    usePriceStripStore.getState().leaveName('primary', ids[1]!)
    await vi.advanceTimersByTimeAsync(5)
    expect(rateOf(ids[1]!)).toBeNull()
    expect(__rowStateOf('primary', ids[1]!).rateTouched).toBe(true)
  })
  it('re-fills when the name changes to another item and the rate is still the auto-filled one; leaves it alone after a hand edit', async () => {
    const ids = setup()
    const id = ids[0]!
    name(id, 'zeta round box 1001 (90 cms)'); usePriceStripStore.getState().leaveName('primary', id); await vi.advanceTimersByTimeAsync(5)
    expect(rateOf(id)).toBe('110')
    name(id, 'zeta round box 1002 (90 cms)'); usePriceStripStore.getState().leaveName('primary', id); await vi.advanceTimersByTimeAsync(5)
    expect(rateOf(id)).toBe('120')
    useBillStore.getState().setCellText(id, 'rate', '125')
    name(id, 'zeta round box 1001 (90 cms)'); usePriceStripStore.getState().leaveName('primary', id); await vi.advanceTimersByTimeAsync(5)
    expect(rateOf(id)).toBe('125')
  })
  it('an ambiguous or unknown name fills nothing', async () => {
    const ids = setup()
    name(ids[0]!, 'zeta round box'); usePriceStripStore.getState().leaveName('primary', ids[0]!); await vi.advanceTimersByTimeAsync(5)
    expect(rateOf(ids[0]!)).toBeNull()
    name(ids[1]!, 'unheard of gadget'); usePriceStripStore.getState().leaveName('primary', ids[1]!); await vi.advanceTimersByTimeAsync(5)
    expect(rateOf(ids[1]!)).toBeNull()
  })
  it('does nothing on a stock transfer bill (no money columns)', async () => {
    const ids = setup()
    useBillStore.getState().setFormatId('stock_transfer')
    name(ids[0]!, 'zeta round box 1001 (90 cms)'); usePriceStripStore.getState().leaveName('primary', ids[0]!); await vi.advanceTimersByTimeAsync(5)
    expect(rateOf(ids[0]!)).toBeNull()
  })
  it('the strip match is debounced and a bill switch drops it (stale-answer guard)', async () => {
    const ids = setup('suggest')
    const st = usePriceStripStore.getState()
    for (const t of ['z', 'ze', 'zeta round box 1001']) { st.setCell({ side: 'primary', rowId: ids[0]! }, t); await vi.advanceTimersByTimeAsync(40) }
    expect(usePriceStripStore.getState().match).toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    expect(usePriceStripStore.getState().match?.best?.name).toContain('1001')
    st.reset()
    expect(usePriceStripStore.getState().match).toBeNull()
  })
})
