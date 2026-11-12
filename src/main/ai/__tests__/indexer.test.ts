import { afterEach, describe, expect, it } from 'vitest'
import { fakeVector } from '../fakeEmbedder'
import { createIndexer, modelCacheKey, type IndexerDeps } from '../indexer'
import { createAiVectorRepo, createBillNameSource, stripAiVectorsFromFile } from '../../db/aiVectorRepo'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import type { EmbedOutcome } from '../../../shared/ai/aiStatus'
import { textKey } from '../../../shared/ai/textKey'

let t: TestDb | null = null
afterEach(() => { t?.cleanup(); t = null })

let poSeq = 0 // the (branch, po_seq) pair must be unique per fixture bill
function addBill(sqlite: TestDb['handle']['sqlite'], id: string, names: string[], deleted = false): void {
  const branch = (sqlite.prepare('SELECT id FROM branches LIMIT 1').get() as { id: string }).id
  const cols = (sqlite.prepare("SELECT name, \"notnull\" AS nn, dflt_value AS d FROM pragma_table_info('bills')").all() as { name: string; nn: number; d: unknown }[])
  const base: Record<string, unknown> = {}
  for (const c of cols) if (c.nn && c.d === null) base[c.name] = c.name.endsWith('_json') ? '{}' : c.name.includes('revision') || c.name.endsWith('_at') ? 1 : 'x'
  Object.assign(base, { po_seq: ++poSeq, id, branch_id: branch, po_number: id, bill_date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: deleted ? '2026-02-01T00:00:00Z' : null, revision: 1 })
  const keys = cols.map((c) => c.name).filter((n) => n in base)
  sqlite.prepare(`INSERT INTO bills (${keys.join(',')}) VALUES (${keys.map((k) => '@' + k).join(',')})`).run(base)
  const rc = (sqlite.prepare("SELECT name, \"notnull\" AS nn, dflt_value AS d FROM pragma_table_info('bill_rows')").all() as { name: string; nn: number; d: unknown }[])
  names.forEach((n, i) => {
    const row: Record<string, unknown> = {}
    for (const c of rc) if (c.nn && c.d === null) row[c.name] = 0
    Object.assign(row, { id: `${id}-r${i}`, bill_id: id, idx: i, name_runs_json: JSON.stringify([{ t: n }]) })
    const rk = rc.map((c) => c.name).filter((k) => k in row)
    sqlite.prepare(`INSERT INTO bill_rows (${rk.join(',')}) VALUES (${rk.map((k) => '@' + k).join(',')})`).run(row)
  })
}

function setup(over: Partial<IndexerDeps> = {}) {
  t = openTestDb()
  const sqlite = t.handle.sqlite
  const repo = createAiVectorRepo(sqlite)
  const names = createBillNameSource(sqlite)
  const ticks: (() => void)[] = []
  const calls: string[][] = []
  let enabled = true
  const deps: IndexerDeps = {
    repo, names, modelKey: 'fake@r1', dim: 384, isEnabled: () => enabled,
    embed: async (texts): Promise<EmbedOutcome> => { calls.push(texts); return { ok: true, vectors: texts.map((x) => fakeVector(x)) } },
    schedule: (fn) => { ticks.push(fn); return () => { const i = ticks.indexOf(fn); if (i >= 0) ticks.splice(i, 1) } },
    chunk: 2, ...over
  }
  const idx = createIndexer(deps)
  const run = async (): Promise<void> => { for (let n = 0; n < 50 && ticks.length; n++) { ticks.shift()!(); await new Promise((r) => setTimeout(r, 0)) } }
  return { sqlite, repo, idx, calls, run, setEnabled: (v: boolean) => { enabled = v }, ticks }
}

describe('indexer', () => {
  it('dedupes by hash across bills and embeds in chunks', async () => {
    const s = setup()
    addBill(s.sqlite, 'b1', ['Bolt 10', 'Nut 5', 'Coolie'])
    addBill(s.sqlite, 'b2', ['BOLT-10', 'Washer 3'])
    s.idx.scan()
    await s.run()
    expect(s.repo.count('fake@r1')).toBe(3)
    expect(s.calls.flat().sort()).toEqual(['bolt 10', 'nut 5', 'washer 3'])
    expect(s.calls.every((c) => c.length <= 2)).toBe(true)
    expect(s.idx.progress()).toMatchObject({ state: 'idle', total: 3, done: 3, pending: 0 })
  })

  it('resumes after a restart: a fresh indexer only embeds what is missing', async () => {
    const s = setup()
    addBill(s.sqlite, 'b1', ['Bolt 10', 'Nut 5', 'Washer 3'])
    s.idx.scan()
    s.ticks.shift()!() // one chunk only
    await new Promise((r) => setTimeout(r, 0))
    expect(s.repo.count()).toBe(2)
    s.idx.stop()
    const second = setup2(s)
    second.idx.scan()
    await second.run()
    expect(second.calls.flat()).toEqual(['washer 3'])
    expect(s.repo.count()).toBe(3)
  })

  it('a changed model key drops the old vectors and re-indexes', async () => {
    const s = setup()
    addBill(s.sqlite, 'b1', ['Bolt 10', 'Nut 5'])
    s.idx.scan(); await s.run()
    expect(s.repo.count('fake@r1')).toBe(2)
    const s2 = setup2(s, { modelKey: 'fake@r2' })
    s2.idx.scan(); await s2.run()
    expect(s.repo.count('fake@r1')).toBe(0)
    expect(s.repo.count('fake@r2')).toBe(2)
  })

  it('deleting a bill leaves the cache valid; a new save queues only new names', async () => {
    const s = setup()
    addBill(s.sqlite, 'b1', ['Bolt 10'])
    s.idx.scan(); await s.run()
    s.sqlite.prepare("UPDATE bills SET deleted_at = '2026-03-01T00:00:00Z' WHERE id = 'b1'").run()
    expect(s.repo.count('fake@r1')).toBe(1)
    addBill(s.sqlite, 'b3', ['Bolt 10', 'Screw 8'])
    s.idx.notifyBills(['b3']); await s.run()
    expect(s.calls.flat()).toEqual(['bolt 10', 'screw 8']) // bolt 10 was not embedded a second time
    expect(s.repo.count('fake@r1')).toBe(2)
  })

  it('pause stops work, resume continues; off does nothing', async () => {
    const s = setup()
    addBill(s.sqlite, 'b1', ['Bolt 10', 'Nut 5', 'Washer 3'])
    s.idx.scan()
    s.idx.pause()
    await s.run()
    expect(s.repo.count()).toBe(0)
    expect(s.idx.progress().state).toBe('paused')
    s.idx.resume(); await s.run()
    expect(s.repo.count()).toBe(3)
    s.setEnabled(false)
    expect(s.idx.progress().state).toBe('off')
  })

  it('failures stop after the limit and never throw; resume retries', async () => {
    let fail = true
    const s = setup({ embed: async (x): Promise<EmbedOutcome> => (fail ? { ok: false, reason: 'error' } : { ok: true, vectors: x.map((y) => fakeVector(y)) }) })
    addBill(s.sqlite, 'b1', ['Bolt 10', 'Nut 5'])
    s.idx.scan(); await s.run()
    expect(s.idx.progress().state).toBe('error')
    expect(s.repo.count()).toBe(0)
    fail = false
    s.idx.resume(); await s.run()
    expect(s.repo.count()).toBe(2)
  })

  it('the cache can be dropped and rebuilt; stored vectors round-trip', async () => {
    const s = setup()
    addBill(s.sqlite, 'b1', ['Bolt 10'])
    s.idx.scan(); await s.run()
    const key = textKey('Bolt 10')!
    const got = s.repo.getMany('fake@r1', [key.hash])
    expect(Array.from(got[0]!.vector)).toEqual(Array.from(fakeVector('bolt 10')))
    expect(s.idx.dropAll()).toBe(1)
    expect(s.repo.count()).toBe(0)
    s.idx.scan(); await s.run()
    expect(s.repo.count()).toBe(1)
  })

  it('migration 0010 is additive and the strip helper empties a backup copy', () => {
    t = openTestDb()
    const names = (t.handle.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'ai_text_vectors'").all() as unknown[]).length
    expect(names).toBe(1)
    createAiVectorRepo(t.handle.sqlite).upsertMany('m', [{ hash: 'h', vector: new Float32Array([1, 0]) }], 'now')
    t.handle.sqlite.pragma('wal_checkpoint(TRUNCATE)')
    const copy = t.file.replace(/\.db$/, '-copy.db')
    t.handle.sqlite.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`)
    expect(stripAiVectorsFromFile(copy)).toBe(true)
    expect(stripAiVectorsFromFile(t.file + '.missing')).toBe(false)
    expect(modelCacheKey({ id: 'x', revision: '' })).toBe('x@unpinned')
  })
})

/** A second indexer over the SAME database (simulates a restart / new model key). */
function setup2(s: ReturnType<typeof setup>, over: Partial<IndexerDeps> = {}) {
  const ticks: (() => void)[] = []
  const calls: string[][] = []
  const idx = createIndexer({
    repo: s.repo, names: createBillNameSource(s.sqlite), modelKey: 'fake@r1', dim: 384, isEnabled: () => true, chunk: 2,
    embed: async (x): Promise<EmbedOutcome> => { calls.push(x); return { ok: true, vectors: x.map((y) => fakeVector(y)) } },
    schedule: (fn) => { ticks.push(fn); return () => undefined }, ...over
  })
  return { idx, calls, run: async (): Promise<void> => { for (let n = 0; n < 50 && ticks.length; n++) { ticks.shift()!(); await new Promise((r) => setTimeout(r, 0)) } } }
}
