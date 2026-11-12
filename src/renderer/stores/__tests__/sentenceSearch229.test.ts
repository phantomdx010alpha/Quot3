import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSentenceSearch } from '../sentenceSearch'
import { useHistoryStore } from '../historyStore'
import { usePartyIndexStore } from '../partyIndexStore'
import type { BillListItem } from '@shared/history/historyList'

const bill = (id: string, party: string, date: string, total: string): BillListItem => ({ id, poNumber: id, poSeq: 1, billDate: date, partyName: party, grandTotal: total, branchId: 'b', revision: 1 })
const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const TODAY = iso(new Date())
const hit = (b: BillListItem) => ({ ...b, score: 1, matchedOn: ['item' as const] })

let search: ReturnType<typeof vi.fn>
let searchSentence: ReturnType<typeof vi.fn>
let listDates: ReturnType<typeof vi.fn>
let listBills: ReturnType<typeof vi.fn>

function install(settings: Record<string, unknown>, answer?: { scores?: Record<string, number>; formats?: Record<string, 'gst' | 'nongst'>; embeddingsUsed?: boolean }): void {
  search = vi.fn(async () => ({ ok: true, data: { items: [hit(bill('a', 'Invented Traders', TODAY, '6000')), hit(bill('b', 'Sample Stores', TODAY, '9000')), hit(bill('c', 'Invented Traders', TODAY, '100'))], truncated: false } }))
  searchSentence = vi.fn(async () => ({ ok: true, data: { scores: answer?.scores ?? {}, formats: answer?.formats ?? {}, embeddingsUsed: answer?.embeddingsUsed ?? false } }))
  listDates = vi.fn(async () => ({ ok: true, data: [{ date: TODAY, count: 3 }] }))
  listBills = vi.fn(async () => ({ ok: true, data: { items: [bill('a', 'Invented Traders', TODAY, '6000'), bill('b', 'Sample Stores', TODAY, '9000')] } }))
  vi.stubGlobal('window', { quot3: { settings: { getAll: vi.fn(async () => ({ ok: true, data: settings })) }, history: { search, listDates, listBills }, ai: { searchSentence } } })
}
beforeEach(() => { usePartyIndexStore.getState().setParties([{ id: 'p1', name: 'Invented Traders', phone: '', address: '', transport: '' }, { id: 'p2', name: 'Sample Stores', phone: '', address: '', transport: '' }]) })
afterEach(() => { vi.unstubAllGlobals() })

describe('runSentenceSearch (Phase 229)', () => {
  it('AI master switch off: the sentence path does not apply (old search, no chips)', async () => {
    install({ 'ai.enabled': false })
    expect(await runSentenceSearch('ruby tomato last month', {})).toBeNull()
    expect(search).not.toHaveBeenCalled()
  })

  it('plain words are not a sentence even with AI on', async () => {
    install({ 'ai.enabled': true })
    expect(await runSentenceSearch('ruby tomato', {})).toBeNull()
  })

  it('structured filter applied through the existing search; chips returned; no model call without the switch', async () => {
    install({ 'ai.enabled': true, 'ai.sentenceSearch': false })
    const out = await runSentenceSearch('ruby for Invented Traders above 5000', {})
    expect(search).toHaveBeenCalledWith({ query: 'ruby' })
    expect(out?.items.map((x) => x.id)).toEqual(['a'])
    expect(out?.view.chips.map((c) => c.kind)).toEqual(expect.arrayContaining(['item', 'party', 'amount']))
    expect(out?.view.reranked).toBe(false)
    expect(searchSentence).not.toHaveBeenCalled()
  })

  it('with only dates and an amount it walks the existing date lists', async () => {
    install({ 'ai.enabled': true })
    const out = await runSentenceSearch('over 7000 today', {})
    expect(search).not.toHaveBeenCalled()
    expect(listBills).toHaveBeenCalled()
    expect(out?.items.map((x) => x.id)).toEqual(['b'])
  })

  it('re-rank is used only when the switch is on AND the model answered; otherwise the text order stays', async () => {
    install({ 'ai.enabled': true, 'ai.sentenceSearch': true }, { scores: { c: 1 }, embeddingsUsed: true })
    const on = await runSentenceSearch('ruby for Invented Traders', {})
    expect(on?.view.reranked).toBe(true)
    expect(on?.items.map((x) => x.id)).toEqual(['c', 'a'])
    install({ 'ai.enabled': true, 'ai.sentenceSearch': true }, { scores: {}, embeddingsUsed: false })
    const off = await runSentenceSearch('ruby for Invented Traders', {})
    expect(off?.view.reranked).toBe(false)
    expect(off?.items.map((x) => x.id)).toEqual(['a', 'c'])
  })

  it('the format chip filters through the items index and says when a bill\'s format is unknown', async () => {
    install({ 'ai.enabled': true }, { formats: { a: 'gst', c: 'nongst' } })
    const out = await runSentenceSearch('ruby gst for Invented Traders', {})
    expect(out?.items.map((x) => x.id)).toEqual(['a'])
    expect(out?.view.formatUnknown).toBe(0)
    install({ 'ai.enabled': true }, { formats: {} })
    const unknown = await runSentenceSearch('ruby gst for Invented Traders', {})
    expect(unknown?.items.length).toBe(2)
    expect(unknown?.view.formatUnknown).toBe(2)
  })

  it('a failing bridge falls back to the old search (null), never throws', async () => {
    install({ 'ai.enabled': true })
    search.mockRejectedValueOnce(new Error('x'))
    expect(await runSentenceSearch('ruby last month', {})).toBeNull()
  })
})

describe('History store with a sentence (Phase 229)', () => {
  it('setQuery stores the results and the chips; clearing the text drops them; non-sentence input is the old search', async () => {
    install({ 'ai.enabled': true })
    useHistoryStore.setState({ query: '', sentence: null, bills: [], billId: null, from: '', to: '', source: 'all', batch: '', branch: 'all', dates: [], date: null })
    await useHistoryStore.getState().setQuery('ruby for Invented Traders')
    let s = useHistoryStore.getState()
    expect(s.sentence?.chips.some((c) => c.kind === 'party')).toBe(true)
    expect(s.bills.map((b) => b.id)).toEqual(['a', 'c'])
    expect(s.billId).toBe('a')
    await useHistoryStore.getState().setQuery('ruby')
    s = useHistoryStore.getState()
    expect(s.sentence).toBeNull()
    expect(search).toHaveBeenLastCalledWith({ query: 'ruby' })
  })
})
