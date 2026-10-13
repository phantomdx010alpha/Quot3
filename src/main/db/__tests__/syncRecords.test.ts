import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../connection'
import { createSyncRecordRepo } from '../syncRecordRepo'
import { MIGRATIONS_DIR, openTestDb, type TestDb } from './helpers'

const open: TestDb[] = []
const dirs: string[] = []
afterEach(() => { open.splice(0).forEach((t) => t.cleanup()); dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })) })
const names = (t: TestDb, n: string): string[] => (t.handle.sqlite.prepare(`SELECT name FROM pragma_table_info('${n}')`).all() as { name: string }[]).map((r) => r.name)

describe('Phase 133 - migration 0006', () => {
  it('a database at migration 0005 upgrades: bills and parties kept, new tables empty, parties.merged_into is NULL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quot3-mig6-'))
    dirs.push(dir)
    const mig = join(dir, 'migrations')
    cpSync(MIGRATIONS_DIR, mig, { recursive: true })
    const jp = join(mig, 'meta', '_journal.json')
    const full = JSON.parse(readFileSync(jp, 'utf8')) as { entries: { tag: string }[] }
    expect(full.entries.some((e) => e.tag === '0006_shared_sync_records')).toBe(true)
    writeFileSync(jp, JSON.stringify({ ...full, entries: full.entries.filter((e) => e.tag !== '0006_shared_sync_records' && e.tag !== '0007_customer_merge') }))
    mkdirSync(join(dir, 'backups'))
    const file = join(dir, 'q.db')
    const h1 = openDatabase({ file, migrationsDir: mig, backupsDir: join(dir, 'backups') })
    const branch = h1.sqlite.prepare('SELECT id FROM branches LIMIT 1').get() as { id: string }
    for (let i = 1; i <= 3; i++) h1.sqlite.prepare(`INSERT INTO bills (id, branch_id, po_seq, po_number, party_snapshot_json, format_id, bill_date, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', 'non_gst', '2026-10-10', 'x', 'x')`).run(`b${i}`, branch.id, i, `Q3-000${i}`)
    h1.sqlite.prepare(`INSERT INTO parties (id, name, name_norm, created_at, updated_at) VALUES ('p1', 'Ruby', 'ruby', 'x', 'x')`).run()
    expect(h1.sqlite.prepare("SELECT name FROM sqlite_master WHERE name IN ('sync_record_state','sync_aside')").all()).toHaveLength(0)
    const before = h1.sqlite.pragma('user_version', { simple: true }) as number
    h1.close()
    writeFileSync(jp, JSON.stringify(full))
    const h2 = openDatabase({ file, migrationsDir: mig, backupsDir: join(dir, 'backups') })
    try {
      expect(h2.sqlite.pragma('user_version', { simple: true })).toBe(before + 2) // 0006 and 0007 (Phase 137) both apply
      expect(h2.sqlite.prepare('SELECT COUNT(*) AS n FROM bills').get()).toEqual({ n: 3 })
      expect(h2.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_record_state').get()).toEqual({ n: 0 })
      expect(h2.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_aside').get()).toEqual({ n: 0 })
      expect(h2.sqlite.prepare("SELECT name, merged_into FROM parties WHERE id = 'p1'").get()).toEqual({ name: 'Ruby', merged_into: null })
      expect(h2.preMigrationBackup).not.toBeNull()
    } finally { h2.close() }
  })

  it('a fresh database has the columns the contract lists, and the primary key is (kind, rec_id)', () => {
    const t = openTestDb(); open.push(t)
    expect(names(t, 'sync_record_state')).toEqual(['kind', 'rec_id', 'base_version', 'base_hash', 'server_seq', 'synced_at'])
    expect(names(t, 'sync_aside')).toEqual(['kind', 'rec_id', 'version', 'min_reader_ver', 'payload_json', 'seen_at'])
    expect(names(t, 'parties')).toContain('merged_into')
    const pk = (n: string): string[] => (t.handle.sqlite.prepare(`SELECT name FROM pragma_table_info('${n}') WHERE pk > 0 ORDER BY pk`).all() as { name: string }[]).map((r) => r.name)
    expect(pk('sync_record_state')).toEqual(['kind', 'rec_id'])
    expect(pk('sync_aside')).toEqual(['kind', 'rec_id'])
    expect(() => t.handle.sqlite.prepare("INSERT INTO sync_record_state (kind, rec_id, base_version, base_hash) VALUES ('bill','x',1,'h')").run()).not.toThrow()
    expect(() => t.handle.sqlite.prepare("INSERT INTO sync_record_state (kind, rec_id, base_version, base_hash) VALUES ('bill','x',2,'h')").run()).toThrow()
  })
})

describe('syncRecordRepo', () => {
  it('state: upsert, get, list per kind, max server_seq, remove', () => {
    const t = openTestDb(); open.push(t)
    const r = createSyncRecordRepo(t.handle.sqlite)
    expect(r.getState('bill', 'b1')).toBeUndefined()
    r.putState({ kind: 'bill', recId: 'b1', baseVersion: 1, baseHash: 'h1', serverSeq: 5, syncedAt: 't1' })
    r.putStates([{ kind: 'bill', recId: 'b2', baseVersion: 3, baseHash: 'h2', serverSeq: 9, syncedAt: null }, { kind: 'party', recId: 'p1', baseVersion: 1, baseHash: 'h3', serverSeq: 2, syncedAt: 't' }])
    r.putState({ kind: 'bill', recId: 'b1', baseVersion: 2, baseHash: 'h1b', serverSeq: 11, syncedAt: 't2' })
    expect(r.getState('bill', 'b1')).toEqual({ kind: 'bill', recId: 'b1', baseVersion: 2, baseHash: 'h1b', serverSeq: 11, syncedAt: 't2' })
    expect(r.listStates('bill').map((s) => s.recId)).toEqual(['b1', 'b2'])
    expect(r.stateCount()).toBe(3)
    expect(r.maxServerSeq()).toBe(11)
    r.removeState('bill', 'b1')
    expect(r.getState('bill', 'b1')).toBeUndefined()
  })
  it('aside: store, keep the newer version, count, list, remove', () => {
    const t = openTestDb(); open.push(t)
    const r = createSyncRecordRepo(t.handle.sqlite)
    const row = (id: string, version: number, kind = 'bill') => ({ kind, recId: id, version, minReaderVer: 2, payloadJson: `{"v":${version}}`, seenAt: `2026-10-12T00:00:0${version}Z` })
    expect(r.putAside(row('b1', 3))).toBe(true)
    expect(r.putAside(row('b1', 2))).toBe(false) // an older copy never replaces a newer one
    expect(r.getAside('bill', 'b1')?.version).toBe(3)
    expect(r.putAside(row('b1', 4))).toBe(true)
    r.putAside(row('b2', 1)); r.putAside(row('p1', 1, 'party'))
    expect(r.asideCount()).toBe(3)
    expect(r.asideCountsByKind()).toEqual({ bill: 2, party: 1 })
    expect(r.isAside('bill', 'b2')).toBe(true)
    expect(r.listAside(2)).toHaveLength(2)
    r.removeAside('bill', 'b2')
    expect(r.isAside('bill', 'b2')).toBe(false)
  })
})
