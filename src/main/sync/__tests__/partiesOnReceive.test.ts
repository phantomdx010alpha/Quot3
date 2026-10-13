import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createRemoteApplyRepo } from '../../db/remoteApplyRepo'
import { createSyncStateRepo } from '../../db/syncStateRepo'
import { getLocalBranch } from '../../db/seed'
import { createBillService, type SaveBillInput } from '../../services/billService'
import { createOutbox } from '../outbox'
import { createPullWorker } from '../pullWorker'
import { createPushWorker } from '../pushWorker'
import { createRemoteApplier } from '../remoteApplier'
import { InMemoryTransport } from '../transport'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const KEY = randomBytes(32)
const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const dbs: TestDb[] = []
afterEach(() => dbs.splice(0).forEach((t) => t.cleanup()))
const BASE = Date.parse('2026-10-10T10:00:00.000Z')

function branch(mem: InMemoryTransport, name: string) {
  const t = openTestDb(); dbs.push(t)
  const sqlite = t.handle.sqlite
  const id = getLocalBranch(sqlite).id
  const now = (): Date => new Date(BASE)
  const outbox = createOutbox({ repo: createOutboxRepo(sqlite), capturing: () => true }, { now })
  const billRepo = createBillRepo(sqlite)
  const bills = createBillService({ sqlite, bills: billRepo, parties: createPartyRepo(sqlite) }, { now, newId: () => randomUUID(), outbox: (i) => outbox.capture({ billId: i.billId, revision: i.revision, op: i.op ?? 'upsert' }) })
  const sync = createSyncStateRepo(sqlite)
  const repo = createRemoteApplyRepo(sqlite)
  const applier = createRemoteApplier({ repo, sync, localBranchId: () => id, log, emit: () => undefined }, { now })
  const creds = { url: 'u', anonKey: 'k', license: LICENSE, branchId: id }
  return {
    id, name, sqlite, bills, outbox, applier, billRepo, creds,
    q: <T>(sql: string, ...a: unknown[]): T[] => sqlite.prepare(sql).all(...a) as T[],
    pull: createPullWorker({ sync, repo, applier, credentials: () => creds, encryptionKey: () => KEY, makeTransport: () => mem, emit: () => undefined, log }),
    push: null as unknown as ReturnType<typeof createPushWorker>
  }
}
type Branch = ReturnType<typeof branch>

async function world() {
  const mem = new InMemoryTransport()
  mem.addLicense(LICENSE, { maxBranches: 10 })
  const bs = [branch(mem, 'A'), branch(mem, 'B')] as [Branch, Branch]
  for (const b of bs) await mem.registerBranch({ license: LICENSE, branchId: b.id, name: b.name, poPrefix: `${b.name}${b.name}${b.name}-`, device: 'PC' })
  for (const b of bs) b.push = createPushWorker({ outbox: b.outbox.repo, bills: b.billRepo, credentials: () => b.creds, encryptionKey: () => KEY, recipients: () => bs.filter((x) => x !== b).map((x) => x.id), makeTransport: () => mem, log })
  return bs
}
const settle = async (bs: Branch[]): Promise<void> => { for (let i = 0; i < 4; i++) { for (const b of bs) await b.push.runOnce(); for (const b of bs) await b.pull.runOnce() } }
const save = (id: string, party: string, address = ''): SaveBillInput => ({
  bill: { id, party: { name: party, phone: '', address, transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-10', rows: [row('Pen', '1', '9'), blankRow()] }
})
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']

describe('parties on receive + relink (Phase 87)', () => {
  it('a received bill creates ONE party (source sync) per exact normalised name and links to it', async () => {
    const [a, b] = await world()
    a.bills.save(save(ids[0]!, 'Ruby Traders', 'Main Road'))
    a.bills.save(save(ids[1]!, '  ruby   TRADERS '))
    a.bills.save(save(ids[2]!, 'Other Co'))
    await settle([a, b])
    const parties = b.q<{ id: string; name: string; source: string; address: string | null }>('SELECT id, name, source, address FROM parties ORDER BY name')
    expect(parties.map((p) => p.name).sort()).toEqual(['Other Co', 'Ruby Traders'].sort())
    expect(parties.every((p) => p.source === 'sync')).toBe(true)
    const links = b.q<{ id: string; party_id: string | null }>('SELECT id, party_id FROM bills')
    expect(links).toHaveLength(3)
    expect(links.every((l) => l.party_id !== null)).toBe(true)
    expect(new Set(links.filter((l) => l.id !== ids[2]).map((l) => l.party_id)).size).toBe(1)
    expect(b.q('SELECT 1 FROM sync_outbox')).toHaveLength(0) // nothing is sent back
  })

  it('an existing local party with the same normalised name is reused, not duplicated', async () => {
    const [a, b] = await world()
    b.bills.save(save('44444444-4444-4444-8444-444444444444', 'Ruby Traders'))
    const before = b.q<{ id: string }>('SELECT id FROM parties')
    a.bills.save(save(ids[0]!, 'RUBY traders'))
    await settle([a, b])
    const after = b.q<{ id: string }>('SELECT id FROM parties')
    expect(after).toEqual(before)
    expect(b.q<{ party_id: string }>('SELECT party_id FROM bills WHERE id = ?', ids[0])[0]!.party_id).toBe(before[0]!.id)
  })

  it('relink repairs old unlinked bills and is idempotent', async () => {
    const [a, b] = await world()
    a.bills.save(save(ids[0]!, 'Ruby Traders'))
    a.bills.save(save(ids[1]!, 'Other Co'))
    await settle([a, b])
    b.sqlite.exec('UPDATE bills SET party_id = NULL')
    b.sqlite.exec('DELETE FROM parties')
    const first = b.applier.relinkParties()
    expect(first).toEqual({ linked: 2, created: 2 })
    expect(b.q('SELECT 1 FROM parties')).toHaveLength(2)
    expect(b.q('SELECT 1 FROM bills WHERE party_id IS NULL')).toHaveLength(0)
    const snapshot = JSON.stringify(b.q('SELECT id, party_id, revision, updated_at FROM bills ORDER BY id'))
    expect(b.applier.relinkParties()).toEqual({ linked: 0, created: 0 })
    expect(JSON.stringify(b.q('SELECT id, party_id, revision, updated_at FROM bills ORDER BY id'))).toBe(snapshot)
    expect(b.q('SELECT 1 FROM parties')).toHaveLength(2)
  })

  it('a bill with a blank party name stays unlinked and creates nothing', async () => {
    const [a, b] = await world()
    a.bills.save(save(ids[0]!, 'Temp'))
    await settle([a, b])
    b.sqlite.exec(`UPDATE bills SET party_id = NULL, party_snapshot_json = '{"name":"   ","phone":"","address":"","transport":""}'`)
    b.sqlite.exec('DELETE FROM parties')
    expect(b.q('SELECT 1 FROM bills')).toHaveLength(1)
    expect(b.q('SELECT 1 FROM parties')).toHaveLength(0)
    expect(b.applier.relinkParties()).toEqual({ linked: 0, created: 0 })
  })
})
