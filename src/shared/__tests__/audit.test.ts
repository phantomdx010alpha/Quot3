import { describe, expect, it } from 'vitest'
import {
  AUDIT_PAGE_MAX, AUDIT_RETENTION_DEFAULT_DAYS, auditCutoff, clampRetentionDays, dayRangeIso, describeAudit, detailToText, likePattern,
  normaliseQuery, trimDetail
} from '../audit'

describe('Phase 61 - audit helpers (pure)', () => {
  it('describes bill create / edit / delete / restore with the PO number and party', () => {
    expect(describeAudit('bill', 'create', { poNumber: 'Q3-0042', partyName: 'Ruby Traders' })).toBe('Created bill Q3-0042 (Ruby Traders)')
    expect(describeAudit('bill', 'edit', { poNumber: 'Q3-0042', revision: 3 })).toBe('Edited bill Q3-0042, revision 3')
    expect(describeAudit('bill', 'delete', { poNumber: 'Q3-0042' })).toBe('Moved bill Q3-0042 to Recently deleted')
    expect(describeAudit('bill', 'restore', { poNumber: 'Q3-0042' })).toBe('Restored bill Q3-0042 from Recently deleted')
    expect(describeAudit('bill', 'create', null)).toBe('Created a bill')
  })

  it('describes purges, conflicts, imports and restores; unknown pairs fall back to a readable line', () => {
    expect(describeAudit('bill', 'purge', { count: 1 })).toBe('Deleted 1 bill for good')
    expect(describeAudit('bill', 'empty_trash', { count: 3 })).toBe('Emptied Recently deleted (3 bills)')
    expect(describeAudit('bill', 'conflict', { lost: 'delete' })).toContain("this computer's delete was replaced")
    expect(describeAudit('bill', 'conflict', { lost: 'edit' })).toContain("this computer's edit was replaced")
    expect(describeAudit('party_import', 'import', { created: 4, updated: 1 })).toBe('Imported customers: 4 added, 1 updated')
    expect(describeAudit('backup', 'restore', null)).toBe('Restored a backup')
    expect(describeAudit('backup', 'reset', null)).toBe('Reset local data')
    expect(describeAudit('branch', 'bootstrap_import', { billsAdded: 12 })).toContain('12 bills')
    expect(describeAudit('widget', 'do_thing', null)).toBe('Widget: do thing')
  })

  it('trims the sync-conflict snapshot to a row count and cuts long lists', () => {
    const json = JSON.stringify({ lost: 'edit', snapshot: { bill: { x: 1 }, rows: [1, 2, 3] }, ids: Array.from({ length: 30 }, (_, i) => `id${i}`) })
    const d = trimDetail(json)!
    expect(d['snapshot']).toBeUndefined()
    expect(d['snapshotRows']).toBe(3)
    expect((d['ids'] as unknown[]).length).toBe(21)
    expect((d['ids'] as unknown[])[20]).toBe('... and 10 more')
    expect(trimDetail(null)).toBeNull()
    expect(trimDetail('not json')).toBeNull()
    expect(trimDetail('5')).toEqual({ value: 5 })
  })

  it('caps the detail text', () => {
    const text = detailToText({ big: 'x'.repeat(5000) })
    expect(text.length).toBeLessThan(2100)
    expect(text.endsWith('...')).toBe(true)
    expect(detailToText(null)).toBe('')
  })

  it('clamps retention and finds the cutoff', () => {
    expect(clampRetentionDays(undefined)).toBe(AUDIT_RETENTION_DEFAULT_DAYS)
    expect(clampRetentionDays('abc')).toBe(AUDIT_RETENTION_DEFAULT_DAYS)
    expect(clampRetentionDays(1)).toBe(30)
    expect(clampRetentionDays(99999)).toBe(3650)
    expect(clampRetentionDays(90.9)).toBe(90)
    expect(auditCutoff(new Date('2026-10-10T00:00:00.000Z'), 30)).toBe('2026-09-10T00:00:00.000Z')
  })

  it('turns local days into inclusive ISO instants and ignores bad days', () => {
    const r = dayRangeIso('2026-10-01', '2026-10-01')
    expect(new Date(r.to!).getTime() - new Date(r.from!).getTime()).toBe(86_400_000 - 1)
    expect(dayRangeIso('', 'nonsense')).toEqual({})
    expect(dayRangeIso('2026-02-30', '')).toEqual({})
  })

  it('escapes LIKE wildcards and normalises queries', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%')
    const q = normaliseQuery({ limit: 99999, search: '  Ruby  ', entity: '' })
    expect(q.limit).toBe(AUDIT_PAGE_MAX)
    expect(q.search).toBe('Ruby')
    expect(q.entity).toBeUndefined()
    expect(normaliseQuery({}).limit).toBe(50)
  })
})
