import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createAuditRepo } from '../../db/auditRepo'
import { createBillRepo } from '../../db/billRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createTrashRepo } from '../../db/trashRepo'
import { getLocalBranch } from '../../db/seed'
import { createAuditService } from '../auditService'
import { createBillService, type SaveBillInput } from '../billService'
import { createTrashService } from '../trashService'
import { auditHandlers } from '../../ipc/audit'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))
let n = 0

function mk(opts: { writable?: boolean; retention?: unknown } = {}) {
  const t = openTestDb()
  open.push(t)
  const sqlite = t.handle.sqlite
  let clock = Date.UTC(2026, 9, 8, 10, 0, 0)
  const now = (): Date => new Date(clock)
  const advance = (ms: number): void => { clock += ms }
  const audit = createAuditService(
    { repo: createAuditRepo(sqlite), branchId: () => getLocalBranch(sqlite).id, retention: () => opts.retention },
    { writable: opts.writable, now }
  )
  const bills = createBillService({ sqlite, bills: createBillRepo(sqlite), parties: createPartyRepo(sqlite) }, { newId: () => `gen-${++n}`, now, audit: audit.record })
  const trash = createTrashService({ repo: createTrashRepo(sqlite), branchId: () => getLocalBranch(sqlite).id }, { now, audit: audit.record })
  return { sqlite, audit, bills, trash, advance }
}

const input = (id: string, party = 'Ruby Traders'): SaveBillInput => ({
  bill: {
    id, party: { name: party, phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-08',
    rows: [row('Pen', '10', '9'), row('Book', '2', '45.50'), blankRow()]
  }
})

describe('Phase 61 - audit service', () => {
  it('writes one row for create, edit, delete and restore of a bill, with the local branch as author', () => {
    const { audit, bills, trash, advance, sqlite } = mk()
    const saved = bills.save(input('b1'))
    advance(1000)
    bills.save(input('b1'))
    advance(1000)
    bills.delete(['b1'])
    advance(1000)
    trash.restore(['b1'])
    const page = audit.list({})
    expect(page.items.map((i) => i.action)).toEqual(['restore', 'delete', 'edit', 'create'])
    expect(page.items[3]!.summary).toBe(`Created bill ${saved.poNumber} (Ruby Traders)`)
    expect(page.items[2]!.summary).toContain('revision 2')
    expect(page.items[1]!.summary).toBe(`Moved bill ${saved.poNumber} to Recently deleted`)
    expect(page.items[0]!.summary).toBe(`Restored bill ${saved.poNumber} from Recently deleted`)
    expect(page.items.every((i) => i.branchId === getLocalBranch(sqlite).id && i.branchName !== '')).toBe(true)
    expect(page.items.every((i) => i.entity === 'bill' && i.entityId === 'b1')).toBe(true)
  })

  it('a failed save writes no audit row (same transaction)', () => {
    const { audit, bills } = mk()
    expect(() => bills.save({ bill: { ...input('b2').bill, party: { name: '', phone: '', address: '', transport: '' } } })).toThrow()
    expect(audit.facets().total).toBe(0)
  })

  it('filters by entity, action, day range and text (wildcards are literal) and pages newest first', () => {
    const { audit, bills, advance, sqlite } = mk()
    bills.save(input('b1', 'Ruby Traders'))
    advance(2 * 86_400_000)
    bills.save(input('b2', '50% Off Store'))
    audit.record({ entity: 'backup', entityId: 'f.db', action: 'import', detail: { file: 'f.db' } })
    expect(audit.list({ entity: 'backup' }).items).toHaveLength(1)
    expect(audit.list({ action: 'create' }).items).toHaveLength(2)
    expect(audit.list({ search: '50%' }).items.map((i) => i.entityId)).toEqual(['b2'])
    expect(audit.list({ search: '5_%' }).items).toHaveLength(0)
    expect(audit.list({ search: 'ruby' }).items.map((i) => i.entityId)).toEqual(['b1'])
    const day1 = new Date(Date.UTC(2026, 9, 8, 0, 0, 0)).toISOString()
    const day1End = new Date(Date.UTC(2026, 9, 8, 23, 59, 59)).toISOString()
    expect(audit.list({ from: day1, to: day1End }).items.map((i) => i.entityId)).toEqual(['b1'])
    const p1 = audit.list({ limit: 2 })
    expect(p1.items).toHaveLength(2)
    expect(p1.hasMore).toBe(true)
    const p2 = audit.list({ limit: 2, beforeId: p1.nextBeforeId! })
    expect(p2.items).toHaveLength(1)
    expect(p2.hasMore).toBe(false)
    expect(p2.nextBeforeId).toBeNull()
    expect(audit.facets().entities).toEqual(['backup', 'bill'])
    expect(sqlite.prepare('SELECT COUNT(*) AS c FROM audit_log').get()).toEqual({ c: 3 })
  })

  it('shows a sync conflict without its big snapshot', () => {
    const { audit, sqlite } = mk()
    sqlite.prepare("INSERT INTO audit_log (at, branch_id, entity, entity_id, action, detail_json) VALUES ('2026-10-08T10:00:00.000Z', NULL, 'bill', 'b9', 'conflict', @d)")
      .run({ d: JSON.stringify({ lost: 'edit', loserRevision: 3, snapshot: { bill: { big: 'x'.repeat(50_000) }, rows: [1, 2] } }) })
    const item = audit.list({ action: 'conflict' }).items[0]!
    expect(item.summary).toContain('replaced by a newer change')
    expect(item.detailText).toContain('"snapshotRows": 2')
    expect(item.detailText).not.toContain('xxxxx')
  })

  it('the retention sweep removes old rows, keeps conflict rows of bills still in conflict, and writes ONE purge row', () => {
    const { audit, bills, sqlite } = mk({ retention: 30 })
    bills.save(input('keep'))
    const ins = sqlite.prepare("INSERT INTO audit_log (at, branch_id, entity, entity_id, action, detail_json) VALUES (@at, NULL, @entity, @id, @action, '{}')")
    ins.run({ at: '2025-01-01T00:00:00.000Z', entity: 'bill', id: 'old1', action: 'edit' })
    ins.run({ at: '2025-01-02T00:00:00.000Z', entity: 'backup', id: 'old2', action: 'import' })
    ins.run({ at: '2025-01-03T00:00:00.000Z', entity: 'bill', id: 'keep', action: 'conflict' })
    ins.run({ at: '2025-01-04T00:00:00.000Z', entity: 'bill', id: 'resolved', action: 'conflict' })
    sqlite.prepare("UPDATE bills SET sync_state = 'conflict' WHERE id = 'keep'").run()
    expect(audit.retentionDays()).toBe(30)
    const removed = audit.purgeOld()
    expect(removed).toBe(3) // old1, old2, resolved
    const left = audit.list({}).items
    expect(left.some((i) => i.entityId === 'keep' && i.action === 'conflict')).toBe(true)
    expect(left.filter((i) => i.entity === 'audit' && i.action === 'purge')).toHaveLength(1)
    expect(left.find((i) => i.action === 'purge')!.summary).toBe('Removed 3 old log entries')
    expect(audit.purgeOld()).toBe(0)
    expect(audit.list({ action: 'purge' }).items).toHaveLength(1)
  })

  it('does nothing on a read-only database and never throws from record()', () => {
    const ro = mk({ writable: false })
    ro.audit.record({ entity: 'bill', action: 'create' })
    expect(ro.audit.purgeOld()).toBe(0)
    expect(ro.audit.facets().total).toBe(0)
    const logs: unknown[] = []
    const boom = createAuditService(
      { repo: { ...createAuditRepo(ro.sqlite), insert: () => { throw new Error('disk full') } }, branchId: () => null, log: { debug: () => undefined, info: () => undefined, warn: (m) => { logs.push(m) }, error: () => undefined } }
    )
    expect(() => boom.record({ entity: 'bill', action: 'edit' })).not.toThrow()
    expect(logs).toHaveLength(1)
  })

  it('IPC: strict inputs, limits enforced', async () => {
    const { audit } = mk()
    const h = auditHandlers(audit, { report: () => ({ logged: true }), copy: () => ({ chars: 0, lines: 0 }), crashNotice: () => null, dismissCrash: () => undefined, text: () => '' })
    expect((await h['audit:list']!({ limit: 10 }) as { ok: boolean }).ok).toBe(true)
    expect((await h['audit:list']!({ limit: 100000 }) as { ok: boolean }).ok).toBe(false)
    expect((await h['audit:list']!({ extra: 1 }) as { ok: boolean }).ok).toBe(false)
    expect((await h['audit:list']!({ search: 'x'.repeat(101) }) as { ok: boolean }).ok).toBe(false)
    expect((await h['audit:facets']!({}) as { ok: boolean }).ok).toBe(true)
    expect((await h['diagnostics:report']!({ kind: 'weird', message: 'x' }) as { ok: boolean }).ok).toBe(false)
    expect((await h['diagnostics:report']!({ kind: 'error', message: 'x' }) as { ok: boolean }).ok).toBe(true)
    expect((await h['diagnostics:copy']!({ a: 1 }) as { ok: boolean }).ok).toBe(false)
  })
})
