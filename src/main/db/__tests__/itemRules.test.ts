import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../connection'
import { createItemRulesRepo } from '../itemRulesRepo'
import { getLocalBranch } from '../seed'
import { normaliseItem } from '../../../shared/items/normalise'
import { groupItems } from '../../../shared/items/grouping'
import { toGroupingRule } from '../../../shared/items/rules'
import { MIGRATIONS_DIR, openTestDb, type TestDb } from './helpers'

const open: TestDb[] = []
const mk = (): TestDb => { const t = openTestDb(); open.push(t); return t }
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

const setup = () => {
  const t = mk()
  const sqlite = t.handle.sqlite
  const branchId = getLocalBranch(sqlite).id
  const repo = createItemRulesRepo(sqlite)
  let n = 0
  const ctx = () => ({ at: `2026-10-11T10:00:${String(10 + n++).padStart(2, '0')}Z`, branchId })
  const count = (table: string, where = '1=1'): number => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n
  return { t, sqlite, repo, ctx, count, branchId }
}

describe('Phase 109 - migration 0005', () => {
  it('creates item_rules and item_rule_log with the planned columns', () => {
    const { sqlite } = setup()
    const cols = (t: string): string[] => (sqlite.prepare(`PRAGMA table_info('${t}')`).all() as { name: string }[]).map((c) => c.name)
    expect(cols('item_rules')).toEqual(['id', 'kind', 'key_a', 'key_b', 'canonical', 'note', 'created_at', 'updated_at', 'deleted_at', 'branch_id'])
    expect(cols('item_rule_log')).toEqual(['id', 'at', 'rule_id', 'op', 'before_json', 'after_json', 'undone_at'])
  })

  it('on a Phase 91-era database (migrations 0000-0004) keeps every bill and party', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quot3-mig-'))
    const mig = join(dir, 'migrations')
    cpSync(MIGRATIONS_DIR, mig, { recursive: true })
    const jp = join(mig, 'meta', '_journal.json')
    const full = JSON.parse(readFileSync(jp, 'utf8')) as { entries: { tag: string }[] }
    const old = { ...full, entries: full.entries.filter((e) => e.tag !== '0005_item_rules' && e.tag !== '0006_shared_sync_records' && e.tag !== '0007_customer_merge' && e.tag !== '0008_hybrid_second_table') }
    writeFileSync(jp, JSON.stringify(old))
    mkdirSync(join(dir, 'backups'))
    const file = join(dir, 'q.db')
    const h1 = openDatabase({ file, migrationsDir: mig, backupsDir: join(dir, 'backups') })
    const branch = h1.sqlite.prepare('SELECT id FROM branches LIMIT 1').get() as { id: string }
    for (let i = 1; i <= 3; i++) h1.sqlite.prepare(`INSERT INTO bills (id, branch_id, po_seq, po_number, party_snapshot_json, format_id, bill_date, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', 'non_gst', '2026-10-10', 'x', 'x')`).run(`b${i}`, branch.id, i, `Q3-000${i}`)
    expect(h1.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'item_rules'").get()).toBeUndefined()
    h1.close()
    writeFileSync(jp, JSON.stringify(full))
    const h2 = openDatabase({ file, migrationsDir: mig, backupsDir: join(dir, 'backups') })
    try {
      expect(h2.sqlite.prepare('SELECT COUNT(*) AS n FROM bills').get()).toEqual({ n: 3 })
      expect(h2.sqlite.prepare("SELECT name FROM sqlite_master WHERE name IN ('item_rules','item_rule_log') ORDER BY name").all()).toHaveLength(2)
      expect(h2.sqlite.prepare('SELECT COUNT(*) AS n FROM item_rules').get()).toEqual({ n: 0 })
      expect(h2.preMigrationBackup).not.toBeNull()
    } finally { h2.close() }
  })
})

describe('Phase 109 - save / same decision twice / delete / revive', () => {
  it('creates a rule with a deterministic id, an audit row and one undo step', () => {
    const { repo, ctx, count, branchId } = setup()
    const r = repo.save({ kind: 'merge', keyA: 'shakti tape', keyB: 'sakthi tape', canonical: 'Shakti tape', note: 'same' }, ctx())
    expect(r).toMatchObject({ changed: true, op: 'create' })
    expect(r.rule).toMatchObject({ kind: 'merge', keyA: 'SHAKTI TAPE', keyB: 'SAKTHI TAPE', canonical: 'Shakti tape', note: 'same', deletedAt: null, branchId })
    expect(repo.list()).toHaveLength(1)
    expect(count('audit_log', "entity = 'item_rule' AND action = 'create'")).toBe(1)
    expect(count('item_rule_log')).toBe(1)
  })

  it('the same decision twice (or in the other order) is ONE row and writes nothing the second time', () => {
    const { repo, ctx, count } = setup()
    repo.save({ kind: 'merge', keyA: 'A TAPE', keyB: 'B TAPE' }, ctx())
    const again = repo.save({ kind: 'merge', keyA: 'a tape', keyB: 'b  tape' }, ctx())
    expect(again).toMatchObject({ changed: false, op: null })
    const swapped = repo.save({ kind: 'merge', keyA: 'B TAPE', keyB: 'A TAPE' }, ctx())
    expect(swapped.changed).toBe(true) // direction changed: the row is updated, not duplicated
    expect(swapped.op).toBe('update')
    expect(repo.list()).toHaveLength(1)
    expect(repo.list()[0]).toMatchObject({ keyA: 'B TAPE', keyB: 'A TAPE' })
    expect(count('item_rules')).toBe(1)
    expect(count('item_rule_log')).toBe(2)
    repo.save({ kind: 'ignore', keyA: 'sample' }, ctx())
    repo.save({ kind: 'ignore', keyA: 'SAMPLE' }, ctx())
    expect(count('item_rules', "kind = 'ignore'")).toBe(1)
  })

  it('invalid input throws a readable message and writes nothing', () => {
    const { repo, ctx, count } = setup()
    expect(() => repo.save({ kind: 'merge', keyA: 'X', keyB: 'x' }, ctx())).toThrow(/itself/)
    expect(() => repo.save({ kind: 'family', keyA: 'X' }, ctx())).toThrow(/name/)
    expect(count('item_rules')).toBe(0)
    expect(count('audit_log', "entity = 'item_rule'")).toBe(0)
  })

  it('delete is soft (tombstone kept, audited); deleting twice is a no-op; deciding again revives and keeps created_at', () => {
    const { repo, ctx, count } = setup()
    const made = repo.save({ kind: 'ignore', keyA: 'SAMPLE' }, ctx()).rule
    expect(repo.remove(made.id, ctx())).toBe(true)
    expect(repo.remove(made.id, ctx())).toBe(false)
    expect(repo.remove('nope', ctx())).toBe(false)
    expect(repo.list()).toEqual([])
    expect(repo.list(true)).toHaveLength(1)
    expect(repo.list(true)[0]!.deletedAt).not.toBeNull()
    expect(count('audit_log', "action = 'delete'")).toBe(1)
    const back = repo.save({ kind: 'ignore', keyA: 'sample' }, ctx())
    expect(back).toMatchObject({ changed: true, op: 'revive' })
    expect(back.rule.deletedAt).toBeNull()
    expect(back.rule.createdAt).toBe(made.createdAt)
    expect(repo.count()).toBe(1)
  })
})

describe('Phase 109 - undo the last decision', () => {
  it('nothing to undo on a fresh database', () => {
    const { repo, ctx } = setup()
    expect(repo.lastDecision()).toBeNull()
    expect(repo.undoLast(ctx())).toBeNull()
  })

  it('undo of a create removes the rule (tombstone), and undoing again goes one step further back', () => {
    const { repo, ctx } = setup()
    repo.save({ kind: 'ignore', keyA: 'ONE' }, ctx())
    repo.save({ kind: 'ignore', keyA: 'TWO' }, ctx())
    expect(repo.lastDecision()).toMatchObject({ op: 'create' })
    const u = repo.undoLast(ctx())
    expect(u?.op).toBe('create')
    expect(repo.list().map((r) => r.keyA)).toEqual(['ONE'])
    repo.undoLast(ctx())
    expect(repo.list()).toEqual([])
    expect(repo.undoLast(ctx())).toBeNull()
    expect(repo.lastDecision()).toBeNull()
  })

  it('undo of a delete brings the rule back; undo of an update restores the old direction; undo of a revive deletes again', () => {
    const { repo, ctx } = setup()
    const m = repo.save({ kind: 'merge', keyA: 'A TAPE', keyB: 'B TAPE', canonical: 'A tape' }, ctx()).rule
    repo.save({ kind: 'merge', keyA: 'B TAPE', keyB: 'A TAPE', canonical: 'B tape' }, ctx())
    repo.undoLast(ctx())
    expect(repo.get(m.id)).toMatchObject({ keyA: 'A TAPE', keyB: 'B TAPE', canonical: 'A tape', deletedAt: null })
    repo.remove(m.id, ctx())
    expect(repo.list()).toEqual([])
    repo.undoLast(ctx())
    expect(repo.list()).toHaveLength(1)
    repo.remove(m.id, ctx())
    repo.save({ kind: 'merge', keyA: 'A TAPE', keyB: 'B TAPE', canonical: 'A tape' }, ctx()) // revive
    repo.undoLast(ctx())
    expect(repo.list()).toEqual([])
  })

  it('an undo is a NEW change: updated_at moves forward so it would win a later sync', () => {
    const { repo, ctx } = setup()
    const made = repo.save({ kind: 'ignore', keyA: 'ONE' }, ctx()).rule
    const u = repo.undoLast(ctx())!
    expect(u.rule.updatedAt > made.updatedAt).toBe(true)
  })

  it('the undo log is capped', () => {
    const { repo, ctx, count } = setup()
    for (let i = 0; i < 230; i++) repo.save({ kind: 'ignore', keyA: `ITEM ${i}` }, ctx())
    expect(count('item_rule_log')).toBeLessThanOrEqual(200)
  })
})

describe('Phase 109 - end to end with the Phase 108 grouping', () => {
  it('stored rules change the groups; deleting a rule restores the automatic result', () => {
    const { repo, ctx } = setup()
    const sp = [{ name: 'SHAKTI TAPE', count: 5 }, { name: 'SAKTHI TAPE', count: 4 }, { name: 'SAMPLE PIECE', count: 1 }]
    const auto = groupItems(sp, [])
    expect(auto.groups).toHaveLength(3)
    const m = repo.save({ kind: 'merge', keyA: normaliseItem('SHAKTI TAPE').key, keyB: normaliseItem('SAKTHI TAPE').key }, ctx()).rule
    repo.save({ kind: 'ignore', keyA: normaliseItem('SAMPLE PIECE').key }, ctx())
    const ruled = groupItems(sp, repo.list(true).map(toGroupingRule))
    expect(ruled.groups).toHaveLength(1)
    expect(ruled.notItems).toHaveLength(1)
    repo.remove(m.id, ctx())
    expect(groupItems(sp, repo.list(true).map(toGroupingRule)).groups).toHaveLength(2)
  })
})
