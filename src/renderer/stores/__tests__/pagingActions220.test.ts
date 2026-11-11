// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const opened: string[] = []
const gone = new Set<string>()
vi.mock('../createSession', async (orig) => {
  const real = await orig<typeof import('../createSession')>()
  return {
    ...real,
    openBillInPlace: vi.fn(async (id: string) => {
      if (gone.has(id)) return 'gone'
      opened.push(id)
      const { useBillStore } = await import('../billStore')
      useBillStore.setState({ billId: id, dirty: false })
      return 'ok'
    })
  }
})

import { ROUTES, initialNav } from '@shared/routes'
import { useRouter } from '../../router/routerStore'
import { usePageMemoryStore, resetPageMemoryForTests, selectViewedBill } from '../pageMemoryStore'
import { useBillStore } from '../billStore'
import { useGuardStore, chooseDiscard } from '../guardStore'
import { useSaveUiStore } from '../saveUiStore'
import { useCustomersStore } from '../customersStore'
import { billSteppingActive, currentPagingMode, resetPagingForTests, stepOpenedBill, stepParty } from '../pagingActions'

const flush = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 15)) }
const IDS = ['b1', 'b2', 'b3', 'b4', 'b5']
const openFrom = (current: string, ids: readonly string[] = IDS): void => {
  useRouter.setState({ nav: initialNav(ROUTES.create) })
  useBillStore.setState({ billId: current, dirty: false })
  usePageMemoryStore.getState().setBillContext({ sourcePath: ROUTES.history, orderedBillIds: ids, currentId: current })
}
const ctxId = (): string | undefined => usePageMemoryStore.getState().billContext?.currentId
const lastNote = (): string => useSaveUiStore.getState().last?.message ?? ''

beforeEach(() => {
  opened.length = 0
  gone.clear()
  resetPagingForTests()
  resetPageMemoryForTests()
  useGuardStore.setState({ open: false, pending: null, busy: false, saved: false })
  useSaveUiStore.setState({ last: null, quiet: null })
})

describe('Phase 220 bill stepping (store level, openBillInPlace mocked)', () => {
  it('PageDown / PageUp step through the captured list and the stack does not grow', async () => {
    openFrom('b2')
    const nav0 = useRouter.getState().nav
    stepOpenedBill('next'); await flush()
    expect(ctxId()).toBe('b3')
    stepOpenedBill('next'); await flush()
    stepOpenedBill('prev'); await flush()
    expect(opened).toEqual(['b3', 'b4', 'b3'])
    expect(useRouter.getState().nav).toBe(nav0)
  })

  it('skips a deleted bill (across what may be a date boundary: the list is flat)', async () => {
    openFrom('b2'); gone.add('b3')
    stepOpenedBill('next'); await flush()
    expect(opened).toEqual(['b4'])
    expect(ctxId()).toBe('b4')
  })

  it('ends: no wrap and one quiet note, not stacked', async () => {
    openFrom('b5')
    stepOpenedBill('next'); await flush()
    expect(opened).toEqual([])
    expect(ctxId()).toBe('b5')
    expect(lastNote()).toMatch(/Last bill/)
    const seq = useSaveUiStore.getState().last?.seq
    stepOpenedBill('next'); await flush()
    expect(useSaveUiStore.getState().last?.seq).toBe(seq) // the same note is not repeated
    openFrom('b1')
    stepOpenedBill('prev'); await flush()
    expect(lastNote()).toMatch(/First bill/)
  })

  it('unsaved changes: Save / Discard / Cancel dialog first; Discard then steps', async () => {
    openFrom('b2')
    useBillStore.setState({ dirty: true })
    stepOpenedBill('next'); await flush()
    expect(useGuardStore.getState().open).toBe(true)
    expect(opened).toEqual([]) // nothing opened yet
    chooseDiscard(); await flush()
    expect(opened).toEqual(['b3'])
  })

  it('unsaved changes: Cancel leaves the bill where it is', async () => {
    openFrom('b2')
    useBillStore.setState({ dirty: true })
    stepOpenedBill('next'); await flush()
    useGuardStore.setState({ open: false, pending: null })
    await flush()
    expect(opened).toEqual([])
    expect(useBillStore.getState().billId).toBe('b2')
  })

  it('no BillContext (a new bill / Create): never steps, mode is null so the grid keeps PageUp / PageDown', async () => {
    useRouter.setState({ nav: initialNav(ROUTES.create) })
    useBillStore.setState({ billId: null, dirty: false })
    expect(billSteppingActive()).toBe(false)
    expect(currentPagingMode()).toBeNull()
    stepOpenedBill('next'); await flush()
    expect(opened).toEqual([])
  })

  it('a stale context (the screen shows another bill) does not step', () => {
    openFrom('b2')
    useBillStore.setState({ billId: 'zzz' })
    expect(billSteppingActive()).toBe(false)
  })

  it('a bill opened from a list is in bill mode', () => {
    openFrom('b2')
    expect(billSteppingActive()).toBe(true)
    expect(currentPagingMode()).toBe('bill')
  })

  it('Esc return selects the bill currently viewed (selectViewedBill reads the updated context)', async () => {
    openFrom('b2')
    stepOpenedBill('next'); await flush()
    stepOpenedBill('next'); await flush()
    const ctx = usePageMemoryStore.getState().billContext!
    expect(ctx.currentId).toBe('b4')
    expect(() => selectViewedBill(ctx.sourcePath, ctx.currentId, ctx.orderedBillIds)).not.toThrow()
  })
})

describe('Phase 220 party paging (Customers)', () => {
  const rows = [
    { id: 'c1', name: 'A', billCount: 2 }, { id: 'c2', name: 'B', billCount: 0 }, { id: 'c3', name: 'C', billCount: 1 }
  ] as never[]
  beforeEach(() => {
    useRouter.setState({ nav: initialNav(ROUTES.customers) })
    useCustomersStore.setState({ rows, selectedId: 'c1', edit: null, view: 'list', billsOf: null } as never)
  })

  it('moves the selection one customer at a time, ends are quiet, no wrap', () => {
    expect(currentPagingMode()).toBe('parties')
    expect(stepParty('next')).toBe(true)
    expect(useCustomersStore.getState().selectedId).toBe('c2')
    stepParty('next')
    expect(useCustomersStore.getState().selectedId).toBe('c3')
    expect(stepParty('next')).toBe(true)
    expect(useCustomersStore.getState().selectedId).toBe('c3')
    expect(lastNote()).toMatch(/Last customer/)
    stepParty('prev'); stepParty('prev')
    expect(stepParty('prev')).toBe(true)
    expect(useCustomersStore.getState().selectedId).toBe('c1')
    expect(lastNote()).toMatch(/First customer/)
  })

  it('does nothing while a customer is being edited or the list is empty', () => {
    useCustomersStore.setState({ edit: {} } as never)
    expect(stepParty('next')).toBe(false)
    useCustomersStore.setState({ edit: null, rows: [] } as never)
    expect(stepParty('next')).toBe(false)
  })
})

describe('Phase 220 party paging focus rules', () => {
  it('History with no party in focus and Items outside the Sales window keep normal paging', () => {
    useRouter.setState({ nav: initialNav(ROUTES.history) })
    expect(currentPagingMode()).toBeNull()
    expect(stepParty('next')).toBe(false)
    useRouter.setState({ nav: initialNav(ROUTES.dashboard) })
    expect(currentPagingMode()).toBeNull()
    expect(stepParty('next')).toBe(false)
  })
})
