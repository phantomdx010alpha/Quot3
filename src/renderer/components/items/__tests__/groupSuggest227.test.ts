// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DISMISSED_KEY, useItemsStore } from '../../../stores/itemsStore'
import { buildSpellingRows } from '@shared/items/groupRows'
import type { DecisionInput, GroupDetail, GroupSummary } from '@shared/items/api'
import type { GroupMergeSuggestion } from '@shared/ai/groupSuggest'

const sum = (id: string, count: number): GroupSummary => ({ id, display: id, count, nonGstCount: count, gstCount: 0, lastUsed: '2026-10-01', familyId: null, spellingCount: 1, suggestionCount: 0 })
const detail = (id: string): GroupDetail => ({ id, display: id, familyId: null, spellings: [{ name: id, cleaned: id, note: '', count: 1, lastUsed: '2026-10-01', originalKey: id, why: { rule: 'most-used', text: '' } }], suggestions: [] })
const ai: GroupMergeSuggestion = { pairKey: 'RUBY TOMATO\u0001RUBY TOMATOE', fromId: 'RUBY TOMATOE', fromName: 'RUBY TOMATOE', fromCount: 4, toId: 'RUBY TOMATO', toName: 'RUBY TOMATO', toCount: 30, score: 0.93, why: 'looks similar', explanation: 'Reads like the same item (match 93%).' }

let settings: Record<string, unknown>
let decide: ReturnType<typeof vi.fn>
let suggestGroups: ReturnType<typeof vi.fn>
let setSetting: ReturnType<typeof vi.fn>

function bridge(): void {
  decide = vi.fn(async (_i: DecisionInput) => ({ ok: true as const, data: { changed: true, steps: 1, message: 'Merged RUBY TOMATOE into RUBY TOMATO.', selectId: 'RUBY TOMATO', undo: 'Merged.' } }))
  suggestGroups = vi.fn(async () => ({ ok: true as const, data: { suggestions: [ai], embeddingsUsed: true } }))
  setSetting = vi.fn(async (k: string, v: unknown) => { settings[k] = v; return { ok: true as const, data: null } })
  ;(window as unknown as { quot3: unknown }).quot3 = {
    items: {
      overview: vi.fn(async () => ({ ok: true as const, data: { groups: [sum('RUBY TOMATO', 30), sum('RUBY TOMATOE', 4)], families: [], notItems: [], bills: 2, lines: 34, builtAt: 'x' } })),
      group: vi.fn(async ({ groupId }: { groupId: string }) => ({ ok: true as const, data: detail(groupId) })),
      sales: vi.fn(async () => ({ ok: false as const, error: { code: 'NOT_FOUND', message: 'x' } })),
      lastDecision: vi.fn(async () => ({ ok: true as const, data: { undo: null } })), decide
    },
    settings: { getAll: vi.fn(async () => ({ ok: true as const, data: { ...settings } })), set: setSetting },
    ai: { suggestGroups }
  }
}
const on = { 'ai.enabled': true, 'ai.itemSuggestions': true }

beforeEach(() => {
  settings = {}
  useItemsStore.setState({ status: 'idle', overview: null, selectedGroupId: null, detail: null, sales: null, aiOn: false, aiRows: [], aiFor: null, dismissed: [], cursor: 0, notice: '', error: '', busy: false, pending: null })
})

describe('Items page: suggested merges (Phase 227)', () => {
  it('suggestions appear as a Suggested row after the rule rows when both switches are on', async () => {
    bridge(); settings = { ...on }
    await useItemsStore.getState().load({ select: 'RUBY TOMATO' })
    expect(suggestGroups).toHaveBeenCalledWith({ groupId: 'RUBY TOMATO' })
    const rows = useItemsStore.getState().spellingRows()
    expect(rows.map((r) => r.kind)).toEqual(['spelling', 'aiSuggestion'])
    expect(rows[1]).toMatchObject({ kind: 'aiSuggestion', ai: { why: 'looks similar', score: 0.93 } })
  })

  it('off means no change: no AI call, no AI row (master off, or only the feature switch off)', async () => {
    for (const s of [{}, { 'ai.enabled': true }, { 'ai.itemSuggestions': true }]) {
      bridge(); settings = { ...s }
      useItemsStore.setState({ overview: null, selectedGroupId: null })
      await useItemsStore.getState().load({ select: 'RUBY TOMATO' })
      expect(suggestGroups).not.toHaveBeenCalled()
      expect(useItemsStore.getState().spellingRows().map((r) => r.kind)).toEqual(['spelling'])
    }
  })

  it('Accept uses the existing merge decision (the same item rule path), from the less used into the more used', async () => {
    bridge(); settings = { ...on }
    await useItemsStore.getState().load({ select: 'RUBY TOMATO' })
    useItemsStore.getState().setCursor(1)
    await useItemsStore.getState().confirmKey()
    expect(decide).toHaveBeenCalledTimes(1)
    expect(decide).toHaveBeenCalledWith({ op: 'merge', fromGroupId: 'RUBY TOMATOE', intoGroupId: 'RUBY TOMATO' })
    expect(useItemsStore.getState().notice).toBe('Merged RUBY TOMATOE into RUBY TOMATO.') // the same result line as any merge (Undo comes from the service)
  })

  it('Dismiss is remembered (saved, survives a reload), hides the row and writes no rule', async () => {
    bridge(); settings = { ...on }
    await useItemsStore.getState().load({ select: 'RUBY TOMATO' })
    useItemsStore.getState().setCursor(1)
    await useItemsStore.getState().rejectKey()
    expect(decide).not.toHaveBeenCalled()
    expect(setSetting).toHaveBeenCalledWith(DISMISSED_KEY, [ai.pairKey])
    expect(useItemsStore.getState().spellingRows().map((r) => r.kind)).toEqual(['spelling'])
    // a fresh page load (new session) reads the saved dismissal and still hides it
    useItemsStore.setState({ overview: null, selectedGroupId: null, dismissed: [], aiRows: [], aiFor: null })
    await useItemsStore.getState().load({ select: 'RUBY TOMATO' })
    expect(useItemsStore.getState().dismissed).toEqual([ai.pairKey])
    expect(useItemsStore.getState().spellingRows().map((r) => r.kind)).toEqual(['spelling'])
  })

  it('a failing AI answer leaves the page as before; a stale answer for another group is dropped', async () => {
    bridge(); settings = { ...on }
    suggestGroups.mockRejectedValueOnce(new Error('down'))
    await useItemsStore.getState().load({ select: 'RUBY TOMATO' })
    expect(useItemsStore.getState().spellingRows().map((r) => r.kind)).toEqual(['spelling'])
    let release!: () => void
    suggestGroups.mockImplementationOnce(() => new Promise((res) => { release = () => res({ ok: true, data: { suggestions: [ai], embeddingsUsed: true } }) }))
    const p = useItemsStore.getState().loadAi()
    useItemsStore.setState({ selectedGroupId: 'RUBY TOMATOE' }) // the owner moved on while the answer was in flight
    release(); await p
    expect(useItemsStore.getState().aiRows).toEqual([])
  })

  it('numbers and units are never merged by the engine, so no such row can reach the window', () => {
    // the window only shows what the engine returned; the engine's own rejection is covered in groupSuggest.test.ts
    const rows = buildSpellingRows(detail('MILTON 505'), (id) => id, [])
    expect(rows.every((r) => r.kind !== 'aiSuggestion')).toBe(true)
  })
})
