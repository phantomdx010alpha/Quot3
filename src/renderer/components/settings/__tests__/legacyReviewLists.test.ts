// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityList, ReviewList } from '../LegacyReviewLists'
import { useLegacyWatchStore } from '../../../stores/legacyWatchStore'
import type { ActivityItem, ReviewItem, ReviewLists } from '@shared/legacyWatch/reviewTypes'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// SYNTHETIC items only.
const item = (o: Partial<ReviewItem> = {}): ReviewItem => ({ id: 'r1', fileName: 'copy1.json', party: 'ACME TRADERS', billDate: '2026-10-08', total: '380', why: 'locally_edited', reason: '', candidates: [{ billId: 'b1', poNumber: 'BR1-100', deleted: false }], createdAt: '2026-10-10T09:00:00.000Z', ...o })
const act1 = (o: Partial<ActivityItem> = {}): ActivityItem => ({ id: 'a1', at: '2026-10-10T09:00:00.000Z', kind: 'imported', fileName: 'x.json', billId: 'b2', party: 'ZED CO', poNumber: 'BR1-101', detail: 'Imported BR1-101 from x.json.', undone: false, canUndo: true, ...o })

let lists: ReviewLists
let acts: ActivityItem[]
let host: HTMLElement
let root: Root
let lw: Record<string, ReturnType<typeof vi.fn>>
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const show = async (...els: Parameters<typeof createElement>[0][]): Promise<void> => { await act(async () => { root.render(createElement('div', null, ...els.map((e, i) => createElement(e as never, { key: i })))) }); await flush(); await flush() }
const btn = (text: string): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!
const click = async (el: Element): Promise<void> => { await act(async () => { (el as HTMLElement).click() }); await flush() }

beforeEach(() => {
  lists = { open: [item()], ignored: [] }
  acts = [act1()]
  lw = {
    reviewList: vi.fn(async () => ({ ok: true, data: lists })),
    reviewCount: vi.fn(async () => ({ ok: true, data: { count: lists.open.length } })),
    reviewResolve: vi.fn(async (i: { action: string }) => { lists = { open: [], ignored: i.action === 'ignore' ? [item()] : [] }; return { ok: true, data: { action: i.action, message: 'Done: ' + i.action, billId: null } } }),
    activityList: vi.fn(async () => ({ ok: true, data: acts })),
    activityUndo: vi.fn(async () => { acts = [act1({ canUndo: false, undone: true })]; return { ok: true, data: { message: 'Import undone: the bill is in Recently deleted.', billId: 'b2' } } }),
    status: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'x' } }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { legacyWatch: lw }
  useLegacyWatchStore.setState({ review: { open: [], ignored: [] }, activity: [], reviewCount: 0, notice: '', error: '', busy: false })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3 })

describe('Phase 163 - Needs review list', () => {
  it('shows the party, date, total, candidate PO and the plain reason with the three choices', async () => {
    await show(ReviewList)
    const t = host.querySelector('[data-testid="lw-review-item"]')!.textContent!
    expect(t).toContain('ACME TRADERS')
    expect(t).toContain('2026-10-08')
    expect(t).toContain('Total 380')
    expect(t).toContain('BR1-100')
    expect(t).toContain('changed in Quot3 after it was imported')
    expect(host.querySelector('h2')!.textContent).toBe('Needs review (1)')
    for (const b of ['Import as new bill', 'Replace existing bill with this', 'Ignore']) expect(btn(b)).toBeDefined()
    expect(useLegacyWatchStore.getState().reviewCount).toBe(1)
  })

  it('Import as new bill / Replace send the action (Replace names the only candidate); the list then reloads', async () => {
    await show(ReviewList)
    await click(btn('Replace existing bill with this'))
    expect(lw['reviewResolve']).toHaveBeenCalledWith({ id: 'r1', action: 'replace', billId: 'b1' })
    expect(host.querySelector('[data-testid="lw-review-empty"]')).not.toBeNull()
    lists = { open: [item()], ignored: [] }
    await act(async () => { await useLegacyWatchStore.getState().loadReview() })
    await click(btn('Import as new bill'))
    expect(lw['reviewResolve']).toHaveBeenLastCalledWith({ id: 'r1', action: 'import_new' })
    expect(useLegacyWatchStore.getState().notice).toBe('Done: import_new')
  })

  it('Ignore moves it to Recently ignored, where Put back on the list reopens it', async () => {
    await show(ReviewList)
    await click(btn('Ignore'))
    expect(lw['reviewResolve']).toHaveBeenCalledWith({ id: 'r1', action: 'ignore' })
    expect(host.querySelector('summary')!.textContent).toBe('Recently ignored (1)')
    await click(btn('Put back on the list'))
    expect(lw['reviewResolve']).toHaveBeenLastCalledWith({ id: 'r1', action: 'reopen' })
  })

  it('Replace is disabled when the only candidate is in Recently deleted; with two candidates it waits for a choice', async () => {
    lists = { open: [item({ candidates: [{ billId: 'b1', poNumber: 'BR1-100', deleted: true }] })], ignored: [] }
    await show(ReviewList)
    expect(btn('Replace existing bill with this').disabled).toBe(true)
    expect(host.textContent).toContain('(in Recently deleted)')
    lists = { open: [item({ candidates: [{ billId: 'b1', poNumber: 'BR1-100', deleted: false }, { billId: 'b2', poNumber: 'BR1-101', deleted: false }] })], ignored: [] }
    await act(async () => { await useLegacyWatchStore.getState().loadReview() }); await flush()
    expect(btn('Replace existing bill with this').disabled).toBe(true)
    const sel = host.querySelector('select')!
    await act(async () => { sel.value = 'b2'; sel.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(btn('Replace existing bill with this').disabled).toBe(false)
    await click(btn('Replace existing bill with this'))
    expect(lw['reviewResolve']).toHaveBeenCalledWith({ id: 'r1', action: 'replace', billId: 'b2' })
  })

  it('a refused action shows its reason', async () => {
    lw['reviewResolve']!.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION', message: 'That bill is in Recently deleted. Restore it first.' } })
    await show(ReviewList)
    await click(btn('Ignore'))
    expect(useLegacyWatchStore.getState().error).toBe('That bill is in Recently deleted. Restore it first.')
  })
})

describe('Phase 163 - Activity list', () => {
  it('lists events; Undo shows only where allowed and reports the result; the entry then reads undone', async () => {
    acts = [act1(), act1({ id: 'a2', kind: 'duplicate', canUndo: false, poNumber: 'BR1-102', detail: 'Skipped y.json: same bill as BR1-102.' })]
    await show(ActivityList)
    const rows = [...host.querySelectorAll('[data-testid="lw-activity-item"]')]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('Imported')
    expect(rows[1]!.textContent).toContain('Skipped duplicate')
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Undo'])
    await click(btn('Undo'))
    expect(lw['activityUndo']).toHaveBeenCalledWith('a1')
    expect(useLegacyWatchStore.getState().notice).toContain('Recently deleted')
    expect(host.textContent).toContain('(undone)')
    expect(host.querySelector('button')).toBeNull()
  })

  it('an undo the engine refuses shows its reason; an empty list says so', async () => {
    lw['activityUndo']!.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION', message: 'That bill was changed after this action, so it cannot be undone here.' } })
    await show(ActivityList)
    await click(btn('Undo'))
    expect(useLegacyWatchStore.getState().error).toContain('changed after this action')
    acts = []
    await act(async () => { await useLegacyWatchStore.getState().loadActivity() }); await flush()
    expect(host.querySelector('[data-testid="lw-activity-empty"]')).not.toBeNull()
  })
})
