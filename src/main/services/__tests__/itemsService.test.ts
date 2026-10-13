import { afterEach, describe, expect, it } from 'vitest'
import { createBillRepo } from '../../db/billRepo'
import { createItemRulesRepo } from '../../db/itemRulesRepo'
import { createItemsRepo } from '../../db/itemsRepo'
import { getLocalBranch } from '../../db/seed'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createItemsService, type ItemsService } from '../itemsService'
import { itemsHandlers } from '../../ipc/items'
import { createEmptyBill, createEmptyRow, serializeBill } from '../../../shared/billModel'
import { normaliseItem } from '../../../shared/items/normalise'
import type { Bill } from '../../../shared/types'

interface SeedRow { name: string; qty?: string; rate?: string; gst?: string; total?: string }
interface SeedBill { n: number; format?: 'non_gst' | 'gst'; date: string; party: string; rows: SeedRow[] }

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

function setup() {
  const t = openTestDb(); open.push(t)
  const sqlite = t.handle.sqlite
  const branchId = getLocalBranch(sqlite).id
  const billRepo = createBillRepo(sqlite)
  const rulesRepo = createItemRulesRepo(sqlite)
  let tick = 0
  const stamp = (): string => `2026-10-11T10:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}.000Z`
  const bills = new Map<number, Bill>()

  const build = (s: SeedBill, revision: number, base?: Bill): Bill => {
    const b = base ?? createEmptyBill({ branchId, formatId: s.format ?? 'non_gst', rowCount: 0, billDate: s.date, now: `${s.date}T09:00:00.000Z`, newId: () => `b${s.n}` })
    return {
      ...b, poSeq: s.n, poNumber: `PO${s.n}`, party: { name: s.party, phone: '', address: '', transport: '' }, formatId: s.format ?? 'non_gst', billDate: s.date,
      revision, updatedAt: stamp(),
      rows: s.rows.map((r, i) => ({ ...createEmptyRow(i, () => `b${s.n}-r${i}`), nameRuns: [{ t: r.name }], qty: r.qty ?? null, rate: r.rate ?? null, gstRate: r.gst ?? null, totalOverride: r.total ?? null }))
    }
  }
  const add = (s: SeedBill): void => {
    const b = build(s, 1)
    bills.set(s.n, b)
    const { bill, rows } = serializeBill(b)
    billRepo.insertBill(bill); billRepo.replaceRows(bill.id, rows)
  }
  const edit = (s: SeedBill): void => {
    const b = build(s, (bills.get(s.n)?.revision ?? 1) + 1, bills.get(s.n))
    bills.set(s.n, b)
    const { bill, rows } = serializeBill(b)
    billRepo.updateBill(bill); billRepo.replaceRows(bill.id, rows)
  }
  const trash = (n: number): void => { sqlite.prepare('UPDATE bills SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?').run(stamp(), stamp(), `b${n}`) }
  const restore = (n: number): void => { sqlite.prepare('UPDATE bills SET deleted_at = NULL, updated_at = ?, revision = revision + 1 WHERE id = ?').run(stamp(), `b${n}`) }
  let clock = 0
  const mkService = (): ItemsService => createItemsService({ repo: createItemsRepo(sqlite), rules: () => rulesRepo.list() }, { now: () => new Date(Date.UTC(2026, 9, 11, 12, 0, clock++)), yieldNow: async () => {}, chunk: 7 })
  return { t, sqlite, branchId, add, edit, trash, restore, rulesRepo, mkService, stamp }
}

const gid = (name: string): string => normaliseItem(name).key

describe('Phase 110 - items service: groups and sales', () => {
  it('shows Non-GST and GST sales separately, by the bill format (never by the row GST %)', () => {
    const s = setup()
    s.add({ n: 1, date: '2026-09-01', party: 'RAVI', rows: [{ name: 'AMETO SMALL', qty: '10', rate: '80' }] })
    s.add({ n: 2, date: '2026-09-02', party: 'SITA', format: 'gst', rows: [{ name: 'AMETO SMALL', qty: '2', rate: '100', gst: '18' }] })
    // a row that still carries a GST % but sits on a non-GST bill stays on the Non-GST tab
    s.add({ n: 3, date: '2026-09-03', party: 'RAVI', rows: [{ name: 'AMETO SMALL', qty: '1', rate: '90', gst: '5' }] })
    const svc = s.mkService()
    const sales = svc.sales({ groupId: gid('AMETO SMALL') })
    expect(sales.nonGst.rows.map((r) => r.billId)).toEqual(['b3', 'b1'])
    expect(sales.gst.rows.map((r) => r.billId)).toEqual(['b2'])
    expect(sales.nonGst.rows.every((r) => !r.gst && r.gstAmt === null && r.amount === null)).toBe(true)
    const g = sales.gst.rows[0]!
    expect(g).toMatchObject({ gst: true, gstPct: '18', lineTotal: '200.00', gstAmt: '36.00', amount: '236.00', partyName: 'SITA', poNumber: 'PO2' })
    expect(sales.nonGst.stats.count).toBe(2)
    expect(sales.gst.stats.count).toBe(1)
    const sum = svc.overview().groups.find((x) => x.id === gid('AMETO SMALL'))!
    expect(sum).toMatchObject({ count: 3, nonGstCount: 2, gstCount: 1 })
  })

  it('stats: count, min / median / max, latest rate, total qty, parties', () => {
    const s = setup()
    const rates = ['75', '80', '82', '82', '85', '90']
    rates.forEach((r, i) => s.add({ n: i + 1, date: `2026-09-0${i + 1}`, party: i % 2 ? 'RAVI' : 'SITA', rows: [{ name: 'AMETO SMALL', qty: '2', rate: r }] }))
    s.add({ n: 7, date: '2026-09-09', party: 'GOPAL', rows: [{ name: 'AMETO SMALL', qty: '4' }] }) // no rate
    const st = s.mkService().sales({ groupId: gid('AMETO SMALL') }).nonGst.stats
    expect(st).toEqual({ count: 7, priced: 6, minRate: '75', medianRate: '82', maxRate: '90', latestRate: '90', latestDate: '2026-09-06', totalQty: '16', parties: 3 })
  })

  it('median of an even number of rates is the exact mean (decimal)', () => {
    const s = setup()
    ;['81', '82'].forEach((r, i) => s.add({ n: i + 1, date: `2026-09-0${i + 1}`, party: 'A', rows: [{ name: 'ZIP LONG', qty: '1', rate: r }] }))
    expect(s.mkService().sales({ groupId: gid('ZIP LONG') }).nonGst.stats.medianRate).toBe('81.5')
  })

  it('last rate per party, outlier flags and the per-party filter', () => {
    const s = setup()
    const data: Array<[string, string]> = [['RAVI', '80'], ['SITA', '82'], ['RAVI', '84'], ['GOPAL', '81'], ['SITA', '83'], ['MEERA', '140'], ['ASHA', '40']]
    data.forEach(([p, r], i) => s.add({ n: i + 1, date: `2026-09-${String(i + 1).padStart(2, '0')}`, party: p, rows: [{ name: 'AMETO SMALL', qty: '1', rate: r }] }))
    const svc = s.mkService()
    const tab = svc.sales({ groupId: gid('AMETO SMALL') }).nonGst
    expect(tab.groupMedianRate).toBe('82')
    expect(tab.rows.filter((r) => r.outlier).map((r) => [r.partyName, r.outlier])).toEqual([['ASHA', 'low'], ['MEERA', 'high']])
    const ravi = tab.lastByParty.find((p) => p.partyName === 'RAVI')!
    expect(ravi).toMatchObject({ rate: '84', date: '2026-09-03', sales: 2, billId: 'b3' })
    const only = svc.sales({ groupId: gid('AMETO SMALL'), partyKey: ravi.partyKey }).nonGst
    expect(only.rows.map((r) => r.rate)).toEqual(['84', '80'])
    expect(only.stats).toMatchObject({ count: 2, minRate: '80', maxRate: '84' })
    expect(only.groupMedianRate).toBe('82')
    expect(only.lastByParty.length).toBe(5)
  })

  it('no flags below five priced sales', () => {
    const s = setup()
    ;['10', '11', '12', '100'].forEach((r, i) => s.add({ n: i + 1, date: `2026-09-0${i + 1}`, party: 'A', rows: [{ name: 'CLIP', qty: '1', rate: r }] }))
    expect(s.mkService().sales({ groupId: gid('CLIP') }).nonGst.rows.every((r) => r.outlier === null)).toBe(true)
  })

  it('spelling variants of one item share a group; trashed bills never count', () => {
    const s = setup()
    s.add({ n: 1, date: '2026-09-01', party: 'A', rows: [{ name: 'TALCO 2044', qty: '1', rate: '5' }] })
    s.add({ n: 2, date: '2026-09-02', party: 'B', rows: [{ name: '2044 talco', qty: '1', rate: '6' }] })
    s.add({ n: 3, date: '2026-09-03', party: 'C', rows: [{ name: 'TALCO 2044', qty: '1', rate: '7' }] })
    s.trash(3)
    const svc = s.mkService()
    const sales = svc.sales({ groupId: gid('TALCO 2044') })
    expect(sales.nonGst.rows.map((r) => r.billId)).toEqual(['b2', 'b1'])
    expect(svc.overview().bills).toBe(2)
    expect(svc.group(gid('TALCO 2044')).spellings.map((x) => x.name).sort()).toEqual(['2044 talco', 'TALCO 2044'])
  })

  it('blank and name-only rows are not sales; charges are not items', () => {
    const s = setup()
    s.add({ n: 1, date: '2026-09-01', party: 'A', rows: [{ name: 'HEADING ONLY' }, { name: 'PIN', qty: '1', rate: '2' }, { name: 'GST EXTRA - 18%', total: '50' }] })
    const o = s.mkService().overview()
    expect(o.groups.map((g) => g.id)).toEqual(['PIN'])
    expect(o.notItems.map((n) => n.name)).toEqual(['GST EXTRA - 18%'])
    expect(o.lines).toBe(2)
  })

  it('incremental update (edit, delete, restore, add) equals a full rebuild and a cold start', async () => {
    const s = setup()
    const names = ['AMETO SMALL', 'SMALL AMETO', 'ZIP LONG', 'BUTTON FANCY', 'FANCY BUTTON', 'PIN']
    for (let i = 1; i <= 30; i++) s.add({ n: i, date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, party: `P${i % 5}`, format: i % 4 === 0 ? 'gst' : 'non_gst', rows: [{ name: names[i % 6]!, qty: String(i), rate: String(50 + (i % 9)), gst: '18' }, { name: names[(i + 2) % 6]!, qty: '1', rate: '9' }] })
    const live = s.mkService()
    live.overview() // warm: everything indexed once
    s.edit({ n: 5, date: '2026-09-06', party: 'P9', rows: [{ name: 'ZIP LONG', qty: '3', rate: '61' }] })
    s.trash(7); s.trash(8); s.restore(8)
    s.add({ n: 31, date: '2026-10-01', party: 'NEW', rows: [{ name: 'NEW THING', qty: '2', rate: '300' }] })
    const snapshot = (svc: ItemsService): string => {
      const o = svc.overview()
      return JSON.stringify({ g: o.groups, f: o.families, n: o.notItems, b: o.bills, l: o.lines, sales: o.groups.map((x) => svc.sales({ groupId: x.id })), det: o.groups.map((x) => svc.group(x.id)) })
    }
    const incremental = snapshot(live)
    const cold = snapshot(s.mkService())
    const rebuilt = s.mkService()
    const progress: number[] = []
    const summary = await rebuilt.rebuild((p) => progress.push(p.done))
    expect(incremental).toBe(cold)
    expect(snapshot(rebuilt)).toBe(incremental)
    expect(summary.bills).toBe(30)
    expect(summary.groups).toBeGreaterThan(3)
    expect(progress[0]).toBe(0)
    expect(progress[progress.length - 1]).toBe(30)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
  })

  it('a rate edit does not regroup; a new spelling does; owner rules apply on the next read', () => {
    const s = setup()
    for (let i = 1; i <= 4; i++) s.add({ n: i, date: `2026-09-0${i}`, party: 'A', rows: [{ name: 'AMETO SMALL', qty: '1', rate: '80' }, { name: 'CLIP BIG', qty: '1', rate: '3' }] })
    const svc = s.mkService()
    const t0 = svc.overview().builtAt
    s.edit({ n: 1, date: '2026-09-01', party: 'A', rows: [{ name: 'AMETO SMALL', qty: '1', rate: '99' }, { name: 'CLIP BIG', qty: '1', rate: '3' }] })
    expect(svc.sales({ groupId: gid('AMETO SMALL') }).nonGst.stats.maxRate).toBe('99')
    expect(svc.overview().builtAt).toBe(t0)
    s.edit({ n: 2, date: '2026-09-02', party: 'A', rows: [{ name: 'AMETO SMALL', qty: '1', rate: '80' }, { name: 'CLIP BIG', qty: '1', rate: '3' }, { name: 'NEW ITEM', qty: '1', rate: '1' }] })
    const t1 = svc.overview().builtAt
    expect(t1).not.toBe(t0)
    s.rulesRepo.save({ kind: 'merge', keyA: 'AMETO SMALL', keyB: 'CLIP BIG' }, { at: '2026-10-11T11:00:00Z', branchId: s.branchId })
    const o = svc.overview()
    expect(o.builtAt).not.toBe(t1)
    expect(o.groups.find((g) => g.id === gid('AMETO SMALL'))).toMatchObject({ count: 8, spellingCount: 2 })
    expect(svc.sales({ groupId: gid('AMETO SMALL') }).nonGst.stats.count).toBe(8)
    expect(o.groups.some((g) => g.id === gid('CLIP BIG'))).toBe(false)
  })

  it('syncing after one save is quick (budget proposed: < 5 ms; asserted loosely here)', () => {
    const s = setup()
    for (let i = 1; i <= 300; i++) s.add({ n: i, date: '2026-09-01', party: `P${i % 20}`, rows: [{ name: `ITEM ${i % 40}`, qty: '1', rate: '5' }, { name: `THING ${i % 25}`, qty: '2', rate: '7' }, { name: 'PIN', qty: '1', rate: '1' }] })
    const svc = s.mkService()
    svc.overview()
    s.edit({ n: 10, date: '2026-09-01', party: 'P1', rows: [{ name: 'ITEM 10', qty: '1', rate: '6' }, { name: 'PIN', qty: '1', rate: '1' }] })
    const t0 = performance.now()
    svc.sales({ groupId: gid('PIN') })
    const ms = performance.now() - t0
    // eslint-disable-next-line no-console
    console.log(`[items] sync + read after one saved bill among 300: ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(250)
  })

  it('unknown group is NOT_FOUND; openTarget finds live bills only', () => {
    const s = setup()
    s.add({ n: 1, date: '2026-09-01', party: 'A', rows: [{ name: 'PIN', qty: '1', rate: '1' }] })
    s.add({ n: 2, date: '2026-09-02', party: 'B', rows: [{ name: 'PIN', qty: '1', rate: '1' }] })
    const svc = s.mkService()
    expect(() => svc.group('NOPE')).toThrow(/no longer exists/)
    expect(svc.openTarget('b1')).toEqual({ billId: 'b1', poNumber: 'PO1', billDate: '2026-09-01', partyName: 'A' })
    s.trash(2)
    expect(svc.openTarget('b2')).toBeNull()
    expect(svc.openTarget('missing')).toBeNull()
  })

  it('the index never writes: bills, rows and rules are untouched', () => {
    const s = setup()
    s.add({ n: 1, date: '2026-09-01', party: 'A', rows: [{ name: 'PIN', qty: '1', rate: '1' }] })
    const dump = (): string => JSON.stringify([s.sqlite.prepare('SELECT * FROM bills').all(), s.sqlite.prepare('SELECT * FROM bill_rows').all(), s.sqlite.prepare('SELECT * FROM item_rules').all()])
    const before = dump()
    const svc = s.mkService()
    svc.overview(); svc.sales({ groupId: 'PIN' })
    expect(dump()).toBe(before)
  })
})

describe('Phase 110 - items IPC', () => {
  const stub = { overview: () => ({ ok: 1 }), group: (id: string) => ({ id }), sales: (i: unknown) => i, openTarget: () => null, rebuild: async (cb?: (p: { done: number; total: number }) => void) => { cb?.({ done: 1, total: 1 }); return { bills: 1 } } }
  const events: unknown[] = []
  const h = itemsHandlers(stub as unknown as ItemsService, (_c, p) => events.push(p))

  it('validates input and returns results', async () => {
    expect(await h['items:group']!({ groupId: 'X' })).toEqual({ ok: true, data: { id: 'X' } })
    expect((await h['items:group']!({}) as { ok: boolean }).ok).toBe(false)
    expect((await h['items:sales']!({ groupId: 'X', extra: 1 }) as { ok: boolean }).ok).toBe(false)
    expect(await h['items:sales']!({ groupId: 'X', partyKey: 'id:1' })).toEqual({ ok: true, data: { groupId: 'X', partyKey: 'id:1' } })
    expect(await h['items:openTarget']!({ billId: 'b' })).toEqual({ ok: true, data: null })
  })

  it('rebuild forwards progress and refuses a second run while one is active', async () => {
    expect(await h['items:rebuild']!({})).toEqual({ ok: true, data: { bills: 1 } })
    expect(events).toEqual([{ done: 1, total: 1 }])
    let release: () => void = () => {}
    const slow = itemsHandlers({ ...stub, rebuild: () => new Promise((r) => { release = () => r({ bills: 0 }) }) } as unknown as ItemsService, () => {})
    const first = slow['items:rebuild']!({})
    const second = (await slow['items:rebuild']!({})) as { ok: boolean; error?: { code: string } }
    expect(second.ok).toBe(false)
    release(); await first
  })
})

describe('Phase 113 - items decisions', () => {
  const withRules = () => {
    const s = setup()
    s.add({ n: 1, date: '2026-09-01', party: 'RAVI', rows: [{ name: 'HOOK LONG', qty: '1', rate: '5' }, { name: 'HOOK LONGER', qty: '1', rate: '6' }, { name: 'CLIP STEEL', qty: '1', rate: '2' }] })
    s.add({ n: 2, date: '2026-09-02', party: 'SITA', rows: [{ name: 'HOOK LONG', qty: '1', rate: '5' }, { name: 'ZIP RED', qty: '1', rate: '9' }] })
    const svc = createItemsService(
      {
        repo: createItemsRepo(s.sqlite),
        rules: () => s.rulesRepo.list(),
        ruleOps: {
          save: (i, at) => ({ changed: s.rulesRepo.save(i, { at, branchId: s.branchId }).changed }),
          undoLast: (at) => s.rulesRepo.undoLast({ at, branchId: s.branchId }) !== null,
          hasUndo: () => s.rulesRepo.lastDecision() !== null
        }
      },
      { now: () => new Date(Date.UTC(2026, 9, 11, 12, 0, 0)), yieldNow: async () => {}, chunk: 7 }
    )
    return { s, svc }
  }

  it('merge saves a rule, regroups, and never changes a bill', () => {
    const { s, svc } = withRules()
    const billsBefore = JSON.stringify(s.sqlite.prepare('SELECT id, revision, updated_at FROM bills ORDER BY id').all())
    const r = svc.decide({ op: 'merge', fromGroupId: gid('HOOK LONGER'), intoGroupId: gid('HOOK LONG') })
    expect(r).toMatchObject({ changed: true, steps: 1, selectId: gid('HOOK LONG') })
    expect(svc.group(gid('HOOK LONG')).spellings.map((x) => x.name).sort()).toEqual(['HOOK LONG', 'HOOK LONGER'])
    expect(s.rulesRepo.count()).toBe(1)
    expect(JSON.stringify(s.sqlite.prepare('SELECT id, revision, updated_at FROM bills ORDER BY id').all())).toBe(billsBefore)
  })

  it('the same decision twice never writes a second rule (the merged-away group is gone)', () => {
    const { s, svc } = withRules()
    svc.decide({ op: 'merge', fromGroupId: gid('HOOK LONGER'), intoGroupId: gid('HOOK LONG') })
    // the merged-away group no longer exists, so the repeat is refused (NOT_FOUND-style VALIDATION), and no second rule is written
    expect(() => svc.decide({ op: 'merge', fromGroupId: gid('HOOK LONGER'), intoGroupId: gid('HOOK LONG') })).toThrow(/no longer exists/)
    expect(s.rulesRepo.count()).toBe(1)
  })

  it('a move is two rules, split strictly before merge, and ONE undo reverts both', () => {
    const { s, svc } = withRules()
    svc.decide({ op: 'merge', fromGroupId: gid('HOOK LONGER'), intoGroupId: gid('HOOK LONG') })
    const key = normaliseItem('HOOK LONGER').key
    const mv = svc.decide({ op: 'move', groupId: gid('HOOK LONG'), spellingKey: key, intoGroupId: gid('CLIP STEEL') })
    expect(mv.steps).toBe(2)
    const rows = s.rulesRepo.list()
    const split = rows.find((r) => r.kind === 'split')!
    const mergeBack = rows.filter((r) => r.kind === 'merge').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    expect(split.updatedAt < mergeBack[mergeBack.length - 1]!.updatedAt).toBe(true)
    expect(svc.group(gid('CLIP STEEL')).spellings.map((x) => x.name).sort()).toEqual(['CLIP STEEL', 'HOOK LONGER'])
    const u = svc.undoLast()
    expect(u).toMatchObject({ undone: true, steps: 2 })
    expect(svc.group(gid('HOOK LONG')).spellings.map((x) => x.name).sort()).toEqual(['HOOK LONG', 'HOOK LONGER'])
  })

  it('ignore moves the item to not-items; undo brings it back', () => {
    const { svc } = withRules()
    svc.decide({ op: 'ignore', groupId: gid('ZIP RED') })
    expect(svc.overview().groups.some((g) => g.id === gid('ZIP RED'))).toBe(false)
    expect(svc.overview().notItems.some((n) => n.name === 'ZIP RED' && n.byOwner)).toBe(true)
    expect(svc.lastDecision().undo).not.toBeNull()
    svc.undoLast()
    expect(svc.overview().groups.some((g) => g.id === gid('ZIP RED'))).toBe(true)
  })

  it('refuses bad input with VALIDATION and no write; undo with nothing to undo is a quiet no-op', () => {
    const { s, svc } = withRules()
    expect(() => svc.decide({ op: 'merge', fromGroupId: 'NOPE', intoGroupId: gid('HOOK LONG') })).toThrow()
    expect(s.rulesRepo.count()).toBe(0)
    expect(svc.undoLast().undone).toBe(false)
    expect(svc.lastDecision().undo).toBeNull()
  })

  it('without rule ops (read-only database) decisions are refused', () => {
    const s = setup()
    s.add({ n: 1, date: '2026-09-01', party: 'RAVI', rows: [{ name: 'A B', qty: '1', rate: '1' }] })
    expect(() => s.mkService().decide({ op: 'ignore', groupId: gid('A B') })).toThrow()
  })
})

describe('Phase 113 - items decision IPC', () => {
  const calls: unknown[] = []
  const stub = { decide: (i: unknown) => { calls.push(i); return { changed: true } }, undoLast: () => ({ undone: true }), lastDecision: () => ({ undo: null }) }
  const h = itemsHandlers(stub as unknown as ItemsService, () => {})
  it('validates each decision shape strictly', async () => {
    expect((await h['items:decide']!({ op: 'merge', fromGroupId: 'a', intoGroupId: 'b' }) as { ok: boolean }).ok).toBe(true)
    expect((await h['items:decide']!({ op: 'split', groupId: 'a', spellingKey: 'K' }) as { ok: boolean }).ok).toBe(true)
    expect((await h['items:decide']!({ op: 'merge', fromGroupId: 'a' }) as { ok: boolean }).ok).toBe(false)
    expect((await h['items:decide']!({ op: 'delete', groupId: 'a' }) as { ok: boolean }).ok).toBe(false)
    expect((await h['items:decide']!({ op: 'ignore', groupId: 'a', extra: 1 }) as { ok: boolean }).ok).toBe(false)
    expect(calls).toHaveLength(2)
    expect(await h['items:undo']!({})).toEqual({ ok: true, data: { undone: true } })
    expect(await h['items:lastDecision']!({})).toEqual({ ok: true, data: { undo: null } })
  })
})
