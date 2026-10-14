import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../connection'
import { applyMigrations, getUserVersion, loadMigrations } from '../migrate'
import { allocatePoNumber, peekNextPoNumber } from '../poCounter'
import { getLocalBranch } from '../seed'
import { createSettingsRepo } from '../settingsRepo'
import { createSettingsService } from '../../services/settingsService'
import { MIGRATIONS_DIR, openTestDb, type TestDb } from './helpers'

const open: TestDb[] = []
const mk = (o?: Parameters<typeof openTestDb>[0]): TestDb => {
  const t = openTestDb(o)
  open.push(t)
  return t
}
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

const tables = (s: Database.Database): string[] =>
  (s.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name)

describe('migrations', () => {
  it('apply to an empty DB: every DATA_MODEL table exists, pragmas set, user_version = schemaVersion', () => {
    const t = mk()
    const h = t.handle
    expect(tables(h.sqlite)).toEqual(
      ['audit_log', 'backups', 'bill_revisions', 'bill_rows', 'bills', 'branches', 'drafts', 'import_batches', 'item_rule_log', 'item_rules', 'parties', 'party_imports', 'party_merge_log', 'party_not_same', 'po_counters', 'settings', 'sync_aside', 'sync_outbox', 'sync_record_state', 'sync_state']
    )
    expect(getUserVersion(h.sqlite)).toBe(h.schemaVersion)
    expect(h.schemaVersion).toBeGreaterThanOrEqual(1)
    expect(h.sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(h.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(h.writable).toBe(true)
    expect(h.preMigrationBackup).toBeNull() // brand-new DB needs no backup
  })

  it('re-opening is a no-op (no re-run, no backup, branch not re-seeded)', () => {
    const t = mk()
    const branchId = getLocalBranch(t.handle.sqlite).id
    const h2 = t.reopen()
    expect(h2.openedVersion).toBe(h2.schemaVersion)
    expect(h2.preMigrationBackup).toBeNull()
    expect(getLocalBranch(h2.sqlite).id).toBe(branchId)
    expect(h2.sqlite.prepare('SELECT count(*) AS n FROM branches').get()).toEqual({ n: 1 })
  })

  it('a DB from a NEWER app is refused for writes (opened query_only, not migrated or seeded)', () => {
    const t = mk()
    t.handle.sqlite.pragma('user_version = 999')
    const h = t.reopen()
    expect(h.writable).toBe(false)
    expect(getUserVersion(h.sqlite)).toBe(999)
    expect(() => h.sqlite.prepare("INSERT INTO settings VALUES ('a.b','1','x')").run()).toThrow(/readonly|read-only/i)
    const svc = createSettingsService(createSettingsRepo(h.sqlite), { writable: h.writable })
    expect(() => svc.set('a.b', 1)).toThrow(/read-only/)
  })

  it('pending migration on an existing DB takes a consistent pre-migration backup first, then migrates', () => {
    // Build a fake 2-migration folder; open the DB at v1, then ship v2.
    const t = mk()
    const mig = join(t.dir, 'mig')
    mkdirSync(join(mig, 'meta'), { recursive: true })
    const journal = (n: number): string =>
      JSON.stringify({ entries: Array.from({ length: n }, (_, i) => ({ idx: i, tag: `000${i}_m` })) })
    writeFileSync(join(mig, '0000_m.sql'), 'CREATE TABLE settings (key text primary key, value_json text, updated_at text);--> statement-breakpoint\nCREATE TABLE branches (id text primary key, name text, po_prefix text, is_local integer, created_at text);--> statement-breakpoint\nCREATE TABLE po_counters (branch_id text primary key, next_seq integer);')
    writeFileSync(join(mig, '0001_m.sql'), 'CREATE TABLE extra (id integer);')
    const file = join(t.dir, 'other.db')
    writeFileSync(join(mig, 'meta', '_journal.json'), journal(1))
    const h1 = openDatabase({ file, migrationsDir: mig, backupsDir: t.backupsDir })
    h1.sqlite.prepare("INSERT INTO settings VALUES ('keep.me','1','x')").run()
    h1.close()
    writeFileSync(join(mig, 'meta', '_journal.json'), journal(2))
    const h2 = openDatabase({ file, migrationsDir: mig, backupsDir: t.backupsDir })
    expect(h2.openedVersion).toBe(1)
    expect(getUserVersion(h2.sqlite)).toBe(2)
    expect(h2.preMigrationBackup).not.toBeNull()
    expect(readdirSync(t.backupsDir).some((f) => f.startsWith('pre-migration-v1-to-v2'))).toBe(true)
    // The backup is a real, openable copy of the OLD state (v1, no `extra` table, data intact).
    const bak = new Database(h2.preMigrationBackup!, { readonly: true })
    expect(bak.pragma('user_version', { simple: true })).toBe(1)
    expect(tables(bak)).not.toContain('extra')
    expect(bak.prepare("SELECT value_json FROM settings WHERE key='keep.me'").get()).toEqual({ value_json: '1' })
    bak.close()
    expect(tables(h2.sqlite)).toContain('extra')
    h2.close()
  })

  it('a failing migration rolls back completely and leaves user_version unchanged', () => {
    const s = new Database(':memory:')
    const bad = [
      { tag: '0000_ok', statements: ['CREATE TABLE a (x integer)'] },
      { tag: '0001_bad', statements: ['CREATE TABLE b (x integer)', 'THIS IS NOT SQL'] }
    ]
    expect(() => applyMigrations(s, bad)).toThrow()
    expect(getUserVersion(s)).toBe(1)
    expect(tables(s)).toEqual(['a'])
    s.close()
  })

  it('the shipped journal and SQL files agree', () => {
    const m = loadMigrations(MIGRATIONS_DIR)
    expect(m.length).toBeGreaterThanOrEqual(1)
    expect(m.every((x) => x.statements.length > 0)).toBe(true)
  })
})

describe('Phase 76 - bills.round_off', () => {
  it('the shipped migrations add bills.round_off INTEGER NOT NULL DEFAULT 0; existing-style inserts get 0', () => {
    const t = mk()
    const sqlite = t.handle.sqlite
    const col = (sqlite.prepare("PRAGMA table_info('bills')").all() as { name: string; type: string; notnull: number; dflt_value: string | null }[]).find((c) => c.name === 'round_off')!
    expect(col).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' })
    const branch = sqlite.prepare('SELECT id FROM branches LIMIT 1').get() as { id: string }
    sqlite.prepare(`INSERT INTO bills (id, branch_id, po_seq, po_number, party_snapshot_json, format_id, bill_date, created_at, updated_at) VALUES ('ro1', ?, 1, 'Q3-0001', '{}', 'non_gst', '2026-10-10', 'x', 'x')`).run(branch.id)
    expect(sqlite.prepare("SELECT round_off AS r FROM bills WHERE id='ro1'").get()).toEqual({ r: 0 })
  })
})

describe('Phase 79 - bills.footer_extras_json / tail_rows_json', () => {
  it('the shipped migrations add both TEXT NOT NULL columns with {} / [] defaults; plain inserts get them', () => {
    const t = mk()
    const sqlite = t.handle.sqlite
    const cols = sqlite.prepare("PRAGMA table_info('bills')").all() as { name: string; type: string; notnull: number; dflt_value: string | null }[]
    expect(cols.find((c) => c.name === 'footer_extras_json')).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'{}'" })
    expect(cols.find((c) => c.name === 'tail_rows_json')).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'[]'" })
    const branch = sqlite.prepare('SELECT id FROM branches LIMIT 1').get() as { id: string }
    sqlite.prepare(`INSERT INTO bills (id, branch_id, po_seq, po_number, party_snapshot_json, format_id, bill_date, created_at, updated_at) VALUES ('fc1', ?, 1, 'Q3-0001', '{}', 'non_gst', '2026-10-10', 'x', 'x')`).run(branch.id)
    expect(sqlite.prepare("SELECT footer_extras_json AS f, tail_rows_json AS t FROM bills WHERE id='fc1'").get()).toEqual({ f: '{}', t: '[]' })
  })
})

describe('Phase 150 - bills.second_table_json', () => {
  it('migration 0008 adds a TEXT NOT NULL column that defaults to the empty string (= no Hybrid second table)', () => {
    const t = mk()
    const sqlite = t.handle.sqlite
    const cols = sqlite.prepare("PRAGMA table_info('bills')").all() as { name: string; type: string; notnull: number; dflt_value: string | null }[]
    expect(cols.find((c) => c.name === 'second_table_json')).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "''" })
    const branch = sqlite.prepare('SELECT id FROM branches LIMIT 1').get() as { id: string }
    sqlite.prepare(`INSERT INTO bills (id, branch_id, po_seq, po_number, party_snapshot_json, format_id, bill_date, created_at, updated_at) VALUES ('h1', ?, 1, 'Q3-0001', '{}', 'non_gst', '2026-10-10', 'x', 'x')`).run(branch.id)
    expect(sqlite.prepare("SELECT second_table_json AS s FROM bills WHERE id='h1'").get()).toEqual({ s: '' })
  })
})

describe('local branch seed', () => {
  it('seeds exactly one local branch with prefix Q3- and a PO counter at 1', () => {
    const t = mk()
    const b = getLocalBranch(t.handle.sqlite)
    expect(b.poPrefix).toBe('Q3-')
    expect(t.handle.sqlite.prepare('SELECT next_seq AS n FROM po_counters WHERE branch_id = ?').get(b.id)).toEqual({ n: 1 })
    expect(peekNextPoNumber(t.handle.sqlite, b.id)).toBe('Q3-0001')
  })
})

describe('settings', () => {
  it('round-trips JSON values, overlays defaults, persists across reopen', () => {
    const t = mk()
    const svc = createSettingsService(createSettingsRepo(t.handle.sqlite))
    expect(svc.get('ui.theme')).toBe('navy-ember') // default
    svc.set('company.name', 'Meenakshi Buttons')
    svc.set('print.margins', { top: 5, left: 4 })
    svc.set('behaviour.flag', false)
    svc.set('company.name', 'Renamed') // upsert
    const h2 = t.reopen()
    const svc2 = createSettingsService(createSettingsRepo(h2.sqlite))
    expect(svc2.get('company.name')).toBe('Renamed')
    expect(svc2.get('print.margins')).toEqual({ top: 5, left: 4 })
    expect(svc2.get('behaviour.flag')).toBe(false)
    expect(svc2.get('nothing.here')).toBeUndefined()
    const all = svc2.getAll()
    expect(all['company.name']).toBe('Renamed')
    expect(all['ui.theme']).toBe('navy-ember')
  })

  it('rejects bad keys and oversized values; corrupt stored JSON behaves as unset', () => {
    const t = mk()
    const repo = createSettingsRepo(t.handle.sqlite)
    const svc = createSettingsService(repo)
    expect(() => svc.set('NoDot', 1)).toThrow()
    expect(() => svc.set('a.b', 'x'.repeat(70 * 1024))).toThrow()
    repo.setRaw('ui.theme', '{not json', 'x')
    expect(svc.get('ui.theme')).toBe('navy-ember')
  })
})

describe('PO counter', () => {
  it('increments atomically and formats prefix + padded seq', () => {
    const t = mk()
    const { sqlite } = t.handle
    const id = getLocalBranch(sqlite).id
    expect(allocatePoNumber(sqlite, id)).toEqual({ seq: 1, poNumber: 'Q3-0001' })
    expect(allocatePoNumber(sqlite, id)).toEqual({ seq: 2, poNumber: 'Q3-0002' })
    expect(peekNextPoNumber(sqlite, id)).toBe('Q3-0003')
  })

  it('is unique across many calls and across a reopen; rolls back with the caller transaction', () => {
    const t = mk()
    let { sqlite } = t.handle
    const id = getLocalBranch(sqlite).id
    const seen = new Set<number>()
    for (let i = 0; i < 50; i++) seen.add(allocatePoNumber(sqlite, id).seq)
    expect(seen.size).toBe(50)
    sqlite = t.reopen().sqlite
    expect(allocatePoNumber(sqlite, id).seq).toBe(51)
    expect(() =>
      sqlite.transaction(() => {
        allocatePoNumber(sqlite, id)
        throw new Error('bill save failed')
      })()
    ).toThrow('bill save failed')
    expect(allocatePoNumber(sqlite, id).seq).toBe(52) // no gap, no duplicate
  })

  it('rolls past 9999 without breaking and throws for an unknown branch', () => {
    const t = mk()
    const { sqlite } = t.handle
    const id = getLocalBranch(sqlite).id
    sqlite.prepare('UPDATE po_counters SET next_seq = 9999 WHERE branch_id = ?').run(id)
    expect(allocatePoNumber(sqlite, id).poNumber).toBe('Q3-9999')
    expect(allocatePoNumber(sqlite, id).poNumber).toBe('Q3-10000')
    expect(() => allocatePoNumber(sqlite, 'nope')).toThrow()
  })
})

describe('foreign keys', () => {
  const ins = (s: Database.Database, billId: string, branchId: string): void => {
    s.prepare(
      `INSERT INTO bills (id, branch_id, po_seq, po_number, party_snapshot_json, format_id, bill_date, created_at, updated_at)
       VALUES (?, ?, 1, 'Q3-0001', '{}', 'non_gst', '2026-10-08', 'x', 'x')`
    ).run(billId, branchId)
  }
  it('deleting a bill cascades to bill_rows and bill_revisions', () => {
    const t = mk()
    const { sqlite } = t.handle
    const br = getLocalBranch(sqlite).id
    ins(sqlite, 'b1', br)
    sqlite.prepare("INSERT INTO bill_rows (id, bill_id, idx) VALUES ('r1','b1',0),('r2','b1',1)").run()
    sqlite.prepare("INSERT INTO bill_revisions (id, bill_id, revision, snapshot_json, saved_at, saved_by_branch) VALUES ('v1','b1',1,'{}','x',?)").run(br)
    sqlite.prepare("DELETE FROM bills WHERE id='b1'").run()
    expect(sqlite.prepare('SELECT count(*) AS n FROM bill_rows').get()).toEqual({ n: 0 })
    expect(sqlite.prepare('SELECT count(*) AS n FROM bill_revisions').get()).toEqual({ n: 0 })
  })
  it('enforces FK integrity, (bill_id, idx) uniqueness and (branch, po_seq) uniqueness', () => {
    const t = mk()
    const { sqlite } = t.handle
    const br = getLocalBranch(sqlite).id
    expect(() => sqlite.prepare("INSERT INTO bill_rows (id, bill_id, idx) VALUES ('r','missing',0)").run()).toThrow(/FOREIGN KEY/)
    ins(sqlite, 'b1', br)
    expect(() => ins(sqlite, 'b2', br)).toThrow(/UNIQUE/)
    sqlite.prepare("INSERT INTO bill_rows (id, bill_id, idx) VALUES ('r1','b1',0)").run()
    expect(() => sqlite.prepare("INSERT INTO bill_rows (id, bill_id, idx) VALUES ('r2','b1',0)").run()).toThrow(/UNIQUE/)
  })
})
