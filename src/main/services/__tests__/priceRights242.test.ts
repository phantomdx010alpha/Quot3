import { afterEach, describe, expect, it } from 'vitest'
import { createPriceListRepo } from '../../db/priceListRepo'
import { createPriceLogRepo } from '../../db/priceLogRepo'
import { createSyncStateRepo } from '../../db/syncStateRepo'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { getLocalBranch } from '../../db/seed'
import { priceListHandlers } from '../../ipc/pricelist'
import { InMemorySharedServer, InMemorySharedTransport } from '../../sync/sharedTransport'
import { createPriceListService } from '../priceListService'
import { createPriceRightsService } from '../priceRightsService'
import { ALL_RIGHTS, NO_RIGHTS, type PermFlags } from '../../../shared/pricelist/perms'
import { fromPlain } from '../../../shared/richtext/runs'

// Phase 242 (M23), items 5-7: the rights service, the local guard of the Price List service, and the three IPC channels. Invented names only.
let t: TestDb | undefined
afterEach(() => { t?.cleanup(); t = undefined })
const KEY = 'Q3-ABCD-EFGH-JKLM'
const silent = { info: () => undefined, warn: () => undefined }
const item = (name: string, cells: Record<string, string> = {}) => ({ kind: 'item' as const, nameRuns: fromPlain(name), cells })

function svcWith(rights: { current: PermFlags }) {
  t = openTestDb()
  const s = t.handle.sqlite
  const svc = createPriceListService({ repo: createPriceListRepo(s), logRepo: createPriceLogRepo(s), branchId: () => getLocalBranch(s).id }, { rights: () => rights.current })
  return { svc, sqlite: s }
}
const setup = (svc: ReturnType<typeof svcWith>['svc']) => {
  const cat = svc.structure({ op: 'addCategory', name: 'Taps' }).id!
  const tab = svc.structure({ op: 'addTab', categoryId: cat, name: 'Brass' }).id!
  return { cat, tab }
}

describe('Phase 242 - the local guard of the Price List service', () => {
  it('no rights option = full rights; with rights each change needs its flag and refuses in plain words before writing', () => {
    const r = { current: { ...ALL_RIGHTS } as PermFlags }
    const { svc } = svcWith(r)
    const { cat, tab } = setup(svc)
    svc.saveRows({ tabId: tab, rows: [item('Elbow', { cash_wo: '10' }), item('Tee')] })
    const rows = svc.rows(tab)
    r.current = { ...NO_RIGHTS }
    expect(() => svc.saveRows({ tabId: tab, rows: [item('New one')] })).toThrow(/Add new items/)
    expect(() => svc.structure({ op: 'renameCategory', id: cat, name: 'Taps 2' })).toThrow(/not allowed/)
    expect(() => svc.structure({ op: 'deleteTab', id: tab })).toThrow(/Delete items/)
    expect(() => svc.columns({ tabId: tab, action: 'add', label: 'Note' })).toThrow(/Change categories/)
    expect(svc.rows(tab)).toHaveLength(rows.length) // nothing was written
    expect(svc.tree().categories[0]!.name).toBe('Taps')
  })

  it('row rules: add; fill an empty price = edit; change an existing price = overwrite; delete rows = delete', () => {
    const r = { current: { ...ALL_RIGHTS } as PermFlags }
    const { svc } = svcWith(r)
    const { tab } = setup(svc)
    svc.saveRows({ tabId: tab, rows: [item('Elbow', { cash_wo: '10' }), item('Tee')] })
    const [elbow, tee] = svc.rows(tab) as [ReturnType<typeof svc.rows>[number], ReturnType<typeof svc.rows>[number]]
    r.current = { ...NO_RIGHTS, edit: true }
    // fill the empty price of "Tee": edit is enough
    svc.saveRows({ tabId: tab, rows: [{ id: tee.id, kind: 'item', nameRuns: tee.nameRuns, cells: { cash_wo: '7' } }] })
    // change "Elbow" 10 -> 12: needs overwrite
    expect(() => svc.saveRows({ tabId: tab, rows: [{ id: elbow.id, kind: 'item', nameRuns: elbow.nameRuns, cells: { cash_wo: '12' } }] })).toThrow(/Change existing prices/)
    expect(svc.rows(tab).find((x) => x.id === elbow.id)!.cells.cash_wo).toBe('10')
    expect(() => svc.saveRows({ tabId: tab, rows: [], deleteIds: [tee.id] })).toThrow(/Delete items/)
    r.current = { ...NO_RIGHTS, overwrite: true, delete: true }
    svc.saveRows({ tabId: tab, rows: [{ id: elbow.id, kind: 'item', nameRuns: elbow.nameRuns, cells: { cash_wo: '12' } }], deleteIds: [tee.id] })
    expect(svc.rows(tab).map((x) => x.cells.cash_wo)).toEqual(['12'])
  })

  it('trash, restore and clear follow the same flags', async () => {
    const r = { current: { ...ALL_RIGHTS } as PermFlags }
    const { svc } = svcWith(r)
    const { cat, tab } = setup(svc)
    svc.structure({ op: 'deleteTab', id: tab })
    r.current = { ...NO_RIGHTS }
    expect(() => svc.restore({ kind: 'tab', id: tab })).toThrow(/Change categories/)
    expect(() => svc.purge({ kind: 'tab', id: tab })).toThrow(/Delete items/)
    await expect(svc.clearAll('CLEAR PRICE LIST')).rejects.toThrow(/not allowed/)
    r.current = { ...NO_RIGHTS, structure: true }
    expect(svc.restore({ kind: 'tab', id: tab })).toEqual({ restored: true })
    expect(cat).toBeTruthy()
  })
})

describe('Phase 242 - the rights service', () => {
  function world() {
    t = openTestDb()
    const state = createSyncStateRepo(t.handle.sqlite)
    const server = new InMemorySharedServer()
    const { orgId } = server.addOrg({ licenseKey: KEY, seats: [{ email: 's1@example.com', password: 'a' }, { email: 's2@example.com', password: 'b' }] })
    const mkSvc = async (seat: number, sync = true) => {
      const tr = new InMemorySharedTransport(server)
      await tr.signIn({ email: `s${seat}@example.com`, password: seat === 1 ? 'a' : 'b' })
      return createPriceRightsService({ sync: state, syncActive: () => sync, seatNo: () => (sync ? seat : null), connect: async () => ({ transport: tr, creds: { license: KEY } }), log: silent })
    }
    return { server, orgId, mkSvc, state }
  }

  it('no sync = full rights; seat 1 = full rights; another seat with nothing cached has none, then what the server says', async () => {
    const w = world()
    expect((await w.mkSvc(2, false)).own()).toEqual(ALL_RIGHTS)
    expect((await w.mkSvc(1)).own()).toEqual(ALL_RIGHTS)
    const s2 = await w.mkSvc(2)
    expect(s2.own()).toEqual(NO_RIGHTS)
    w.server.setPricePerms(w.orgId, 2, { add: true })
    const info = await s2.refresh()
    expect(info).toMatchObject({ seatNo: 2, syncActive: true, isSeat1: false, refused: 0 })
    expect(info.flags).toEqual({ ...NO_RIGHTS, add: true })
    expect(s2.own().add).toBe(true) // cached
  })

  it('offline keeps the last answer; a revoke shows up on the next refresh', async () => {
    const w = world()
    const s2 = await w.mkSvc(2)
    w.server.setPricePerms(w.orgId, 2, { add: true, edit: true })
    await s2.refresh()
    w.server.setOffline(true)
    expect((await s2.refresh()).flags.edit).toBe(true) // never throws, keeps the cache
    w.server.setOffline(false)
    w.server.setPricePerms(w.orgId, 2, { add: true })
    expect((await s2.refresh()).flags).toEqual({ ...NO_RIGHTS, add: true })
  })

  it('seat 1 lists and sets; another seat is told in plain words; no sync says rights are not used', async () => {
    const w = world()
    const s1 = await w.mkSvc(1)
    const s2 = await w.mkSvc(2)
    const saved = await s1.set(2, { add: true, structure: true })
    expect(saved).toMatchObject({ seatNo: 2, flags: { ...NO_RIGHTS, add: true, structure: true } })
    expect((await s1.list()).map((r) => r.seatNo)).toEqual([1, 2])
    await expect(s2.list()).rejects.toThrow(/Only the main branch/)
    await expect(s2.set(1, {})).rejects.toThrow(/Only the main branch/)
    await expect((await w.mkSvc(1, false)).list()).rejects.toThrow(/only used when shared sync is on/)
    await expect(s1.set(99, {})).rejects.toThrow(/not valid/)
  })
})

describe('Phase 242 - the IPC channels', () => {
  it('perms / permsList / permsSet validate input and answer through the service', async () => {
    t = openTestDb()
    const s = t.handle.sqlite
    const server = new InMemorySharedServer()
    server.addOrg({ licenseKey: KEY, seats: [{ email: 's1@example.com', password: 'a' }, { email: 's2@example.com', password: 'b' }] })
    const tr = new InMemorySharedTransport(server)
    await tr.signIn({ email: 's1@example.com', password: 'a' })
    const rights = createPriceRightsService({ sync: createSyncStateRepo(s), syncActive: () => true, seatNo: () => 1, connect: async () => ({ transport: tr, creds: { license: KEY } }), log: silent })
    const h = priceListHandlers(createPriceListService({ repo: createPriceListRepo(s), logRepo: createPriceLogRepo(s), branchId: () => getLocalBranch(s).id }), undefined, rights)
    type R = { ok: boolean; data?: any; error?: { code: string } } // eslint-disable-line @typescript-eslint/no-explicit-any
    const call = async (c: string, a: unknown): Promise<R> => (await h[c]!(a)) as R
    expect((await call('pricelist:perms', {})).data).toMatchObject({ seatNo: 1, isSeat1: true, syncActive: true })
    expect((await call('pricelist:perms', { refresh: true })).ok).toBe(true)
    const set = await call('pricelist:permsSet', { seatNo: 2, flags: { add: true, edit: false, overwrite: false, delete: false, structure: false } })
    expect(set.data.flags.add).toBe(true)
    expect(((await call('pricelist:permsList', {})).data as unknown[]).length).toBe(2)
    expect((await call('pricelist:permsSet', { seatNo: 2, flags: { add: true } })).ok).toBe(false) // missing flags
    expect((await call('pricelist:permsSet', { seatNo: 2, flags: { add: true, edit: true, overwrite: true, delete: true, structure: true, extra: 1 } })).ok).toBe(false) // strict
    expect((await call('pricelist:perms', { nope: 1 })).ok).toBe(false)
  })
})
