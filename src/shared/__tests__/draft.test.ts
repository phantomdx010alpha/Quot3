import { describe, expect, it } from 'vitest'
import { createEmptyBill } from '../billModel'
import { row } from '../__fixtures__/bills'
import { buildDraftPayload, draftLabel, formatDraftWhen, parseDraftPayload, shouldKeepDraft, staleCutoff, summarizeDraft } from '../draft'
import { DRAFT_AUTOSAVE_MS, DRAFT_STALE_DAYS } from '../constants'
import { ACTIONS, findShortcutConflicts } from '../shortcuts'
import type { Bill } from '../types'

const bill = (over: Partial<Bill> = {}): Bill => {
  const b = createEmptyBill({ branchId: 'br1', rowCount: 0 })
  return { ...b, party: { name: 'Ruby Traders', phone: '', address: '', transport: '' }, rows: [row('Pen', '2', '3'), row('', null, null), row('', null, null)], ...over }
}

describe('draft payload', () => {
  it('constants: 2 s debounce, 14 days', () => {
    expect(DRAFT_AUTOSAVE_MS).toBe(2000)
    expect(DRAFT_STALE_DAYS).toBe(14)
  })
  it('a draft is kept only for an open, dirty bill', () => {
    expect(shouldKeepDraft({ billId: 'a', dirty: true })).toBe(true)
    expect(shouldKeepDraft({ billId: 'a', dirty: false })).toBe(false)
    expect(shouldKeepDraft({ billId: null, dirty: true })).toBe(false)
  })
  it('build trims trailing blank padding and round-trips through parse', () => {
    const p = buildDraftPayload(bill())
    expect(p.bill.rows).toHaveLength(1)
    const back = parseDraftPayload(JSON.stringify(p))
    expect(back.ok).toBe(true)
    if (back.ok) {
      expect(back.bill.party.name).toBe('Ruby Traders')
      expect(back.bill.rows[0]!.qty).toBe('2')
    }
  })
  it('a party-name-only bill (no rows) is a valid draft', () => {
    const p = buildDraftPayload(bill({ rows: [] }))
    expect(parseDraftPayload(JSON.stringify(p)).ok).toBe(true)
  })
  it('parse rejects garbage without throwing', () => {
    for (const bad of ['', 'nope', '[]', '{}', '{"v":2,"bill":{}}', '{"v":1}', '{"v":1,"bill":{"id":"","rows":[],"party":{}}}', '{"v":1,"bill":{"id":"x","rows":"no","party":{}}}', 'null']) {
      expect(parseDraftPayload(bad).ok).toBe(false)
    }
  })
  it('summary: party, PO, only filled rows counted; unreadable → null', () => {
    const json = JSON.stringify(buildDraftPayload(bill({ poNumber: 'Q3-0007' })))
    expect(summarizeDraft({ id: 'd', billId: 'b', payloadJson: json, updatedAt: '2026-10-08T10:00:00.000Z' })).toEqual({
      id: 'd', billId: 'b', partyName: 'Ruby Traders', poNumber: 'Q3-0007', filledRows: 1, updatedAt: '2026-10-08T10:00:00.000Z'
    })
    expect(summarizeDraft({ id: 'd', billId: null, payloadJson: '{', updatedAt: 'x' })).toBeNull()
  })
})

describe('draft wording and time', () => {
  const now = new Date(2026, 9, 8, 15, 0, 0) // local 8 Oct 2026 15:00
  const at = (d: Date): string => d.toISOString()
  it('today / yesterday / older, in local time', () => {
    expect(formatDraftWhen(at(new Date(2026, 9, 8, 14, 32)), now)).toBe('today 14:32')
    expect(formatDraftWhen(at(new Date(2026, 9, 7, 9, 10)), now)).toBe('yesterday 09:10')
    expect(formatDraftWhen(at(new Date(2026, 9, 5, 8, 5)), now)).toBe('5 Oct 08:05')
    expect(formatDraftWhen('garbage', now)).toBe('unknown time')
  })
  it('label names party and time; blank party and edits are explained', () => {
    const s = { id: 'd', billId: null, partyName: 'Ruby Traders', poNumber: '', filledRows: 2, updatedAt: at(new Date(2026, 9, 8, 14, 32)) }
    expect(draftLabel(s, now)).toBe('Recover unsaved bill — Ruby Traders, today 14:32')
    expect(draftLabel({ ...s, partyName: '' }, now)).toContain('no party name yet')
    expect(draftLabel({ ...s, poNumber: 'Q3-0003', billId: 'b' }, now)).toContain('(edit of Q3-0003)')
  })
  it('stale cutoff is exactly N days before now', () => {
    const c = new Date(staleCutoff(new Date('2026-10-20T12:00:00.000Z'))).getTime()
    expect(new Date('2026-10-20T12:00:00.000Z').getTime() - c).toBe(14 * 86400000)
  })
})

describe('draft shortcut registry', () => {
  it('"Recover unsaved bill" is a palette action and the registry still has no conflicts', () => {
    expect(ACTIONS.some((a) => a.id === 'draft.recover' && a.label === 'Recover unsaved bill')).toBe(true)
    expect(findShortcutConflicts()).toEqual([])
  })
})
