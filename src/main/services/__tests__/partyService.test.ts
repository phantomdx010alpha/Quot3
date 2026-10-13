import { afterEach, describe, expect, it } from 'vitest'
import { createPartyRepo } from '../../db/partyRepo'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createPartyService } from '../partyService'
import { partyHandlers } from '../../ipc/parties'
import { SAMPLE_PARTIES } from '../../../shared/party/sampleParties'
import { normalizePartyName } from '../../../shared/party/partyLite'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))
function mk(opts: { writable?: boolean } = {}) {
  const t = openTestDb()
  open.push(t)
  let n = 0
  const repo = createPartyRepo(t.handle.sqlite)
  const svc = createPartyService(repo, { ...opts, newId: () => `id-${++n}`, now: () => new Date('2026-10-08T10:00:00Z') })
  return { t, repo, svc }
}
const rows = (t: TestDb) => t.handle.sqlite.prepare('SELECT * FROM parties ORDER BY id').all() as Record<string, unknown>[]

describe('partyService', () => {
  it('upsert of a new name inserts a row (norm, source manual, blanks stored as NULL)', () => {
    const { t, svc } = mk()
    expect(svc.upsert({ name: '  Ruby   Traders ', phone: '98450 1', address: '', transport: 'VRL' })).toEqual({ id: 'id-1' })
    expect(rows(t)).toEqual([expect.objectContaining({ id: 'id-1', name: 'Ruby Traders', name_norm: 'ruby traders', phone: '98450 1', address: null, transport: 'VRL', source: 'manual', deleted_at: null })])
    expect(svc.list()).toEqual([{ id: 'id-1', name: 'Ruby Traders', phone: '98450 1', address: '', transport: 'VRL' }])
  })

  it('same normalised name → the existing row is filled in, never duplicated, and blanks never wipe stored values', () => {
    const { t, svc } = mk()
    svc.upsert({ name: 'Ruby Traders', phone: '111', transport: 'VRL' })
    expect(svc.upsert({ name: 'RUBY  traders', address: 'Main St', phone: '' })).toEqual({ id: 'id-1' })
    expect(rows(t)).toHaveLength(1)
    expect(svc.list()[0]).toEqual({ id: 'id-1', name: 'Ruby Traders', phone: '111', address: 'Main St', transport: 'VRL' })
  })

  it('upsert with an id replaces the stored values (blank = cleared) and may rename', () => {
    const { svc } = mk()
    svc.upsert({ name: 'Ruby Traders', phone: '111', address: 'A', transport: 'VRL' })
    expect(svc.upsert({ id: 'id-1', name: 'Ruby Trading Co', phone: '222' })).toEqual({ id: 'id-1' })
    expect(svc.list()).toEqual([{ id: 'id-1', name: 'Ruby Trading Co', phone: '222', address: '', transport: '' }])
  })

  it('unknown id and soft-deleted id → NOT_FOUND; blank name → VALIDATION', () => {
    const { t, svc } = mk()
    expect(() => svc.upsert({ id: 'nope', name: 'X' })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    svc.upsert({ name: 'Gone' })
    t.handle.sqlite.prepare("UPDATE parties SET deleted_at = '2026-10-08T00:00:00Z'").run()
    expect(() => svc.upsert({ id: 'id-1', name: 'Gone' })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    expect(() => svc.upsert({ name: '   ' })).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
  })

  it('a soft-deleted party is not listed and does not block re-adding the same name', () => {
    const { t, svc } = mk()
    svc.upsert({ name: 'Old Party' })
    t.handle.sqlite.prepare("UPDATE parties SET deleted_at = '2026-10-08T00:00:00Z'").run()
    expect(svc.list()).toEqual([])
    expect(svc.upsert({ name: 'Old Party' })).toEqual({ id: 'id-2' })
    expect(svc.list()).toHaveLength(1)
  })

  it('list is name A–Z, case-insensitive', () => {
    const { svc } = mk()
    for (const n of ['banana', 'Apple', 'cherry']) svc.upsert({ name: n })
    expect(svc.list().map((p) => p.name)).toEqual(['Apple', 'banana', 'cherry'])
  })

  it('read-only database refuses writes', () => {
    const { svc } = mk({ writable: false })
    expect(() => svc.upsert({ name: 'X' })).toThrow(expect.objectContaining({ code: 'DB_ERROR' }))
    expect(() => svc.seedSamples()).toThrow(expect.objectContaining({ code: 'DB_ERROR' }))
  })

  it('seedSamples inserts the 30 sample parties once, only into a never-used table (also after a restart)', () => {
    const { t, svc } = mk()
    expect(svc.seedSamples()).toBe(30)
    expect(svc.list()).toHaveLength(30)
    expect(svc.seedSamples()).toBe(0)
    expect(rows(t).every((r) => r['name_norm'] === normalizePartyName(String(r['name'])))).toBe(true)
    const h2 = t.reopen()
    const svc2 = createPartyService(createPartyRepo(h2.sqlite))
    expect(svc2.seedSamples()).toBe(0)
    h2.sqlite.prepare("UPDATE parties SET deleted_at = '2026-10-08T00:00:00Z'").run()
    expect(svc2.seedSamples()).toBe(0) // deleted rows still count: the owner emptied the list on purpose
    expect(SAMPLE_PARTIES).toHaveLength(30)
  })

  it('seed on a table that already has a party does nothing', () => {
    const { svc } = mk()
    svc.upsert({ name: 'Mine' })
    expect(svc.seedSamples()).toBe(0)
    expect(svc.list()).toHaveLength(1)
  })
})

describe('parties:* IPC handlers', () => {
  const call = (svc: ReturnType<typeof mk>['svc'], ch: string, raw: unknown) => partyHandlers(svc)[ch]!(raw) as Promise<{ ok: boolean; data?: unknown; error?: { code: string } }>

  it('list → ok; upsert → { id }; round trip', async () => {
    const { svc } = mk()
    expect(await call(svc, 'parties:list', {})).toEqual({ ok: true, data: [] })
    expect(await call(svc, 'parties:upsert', { party: { name: 'Ruby', phone: '1' } })).toEqual({ ok: true, data: { id: 'id-1' } })
    expect(((await call(svc, 'parties:list', {})).data as unknown[]).length).toBe(1)
  })
  it('validation: unknown keys, empty/oversized name, wrong types and extra input are rejected without touching the DB', async () => {
    const { svc } = mk()
    for (const bad of [
      { party: { name: '' } }, { party: { name: 'x'.repeat(121) } }, { party: { name: 'a', extra: 1 } },
      { party: { name: 'a', phone: 5 } }, { party: { name: 'a', address: 'x'.repeat(401) } }, { nope: 1 }, {}
    ]) {
      const r = await call(svc, 'parties:upsert', bad)
      expect(r.ok).toBe(false)
      expect(r.error?.code).toBe('VALIDATION')
    }
    expect(svc.list()).toEqual([])
    expect((await call(svc, 'parties:list', { x: 1 })).ok).toBe(false)
  })
  it('service errors come back as stable codes', async () => {
    const { svc } = mk()
    expect((await call(svc, 'parties:upsert', { party: { id: 'zzz', name: 'A' } })).error?.code).toBe('NOT_FOUND')
    const ro = mk({ writable: false })
    expect((await call(ro.svc, 'parties:upsert', { party: { name: 'A' } })).error?.code).toBe('DB_ERROR')
  })
})
