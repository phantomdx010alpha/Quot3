import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, billInput, U, HARNESS_BASE, type Harness, type SimBranch } from './simHarness'
import { createItemRuleApplier } from '../itemRuleApplier'
import { createItemRulesRepo } from '../../db/itemRulesRepo'
import { applyPendingWipeData, writeWipeOptions } from '../../db/wipeApply'
import { itemRuleFingerprint, itemRuleSnapshot } from '../../../shared/sync/itemRule'
import { openTestDb } from '../../db/__tests__/helpers'
import { normaliseItem } from '../../../shared/items/normalise'

/** Phase 111: item rules over the postbox, on InMemoryTransport (no real Supabase). */
const open: Harness[] = []
afterEach(() => { open.splice(0).forEach((h) => h.close()) })
const mk = async (o: Parameters<typeof createHarness>[0] = {}): Promise<Harness> => { const h = await createHarness(o); open.push(h); return h }

const live = (b: SimBranch) => b.rules.list(true)
const content = (b: SimBranch) => live(b).map((r) => ({ id: r.id, fp: itemRuleFingerprint(r) })).sort((x, y) => x.id.localeCompare(y.id))
const T = (s: number): number => HARNESS_BASE + s * 1000

describe('Phase 111 - two virtual branches converge on the same rules', () => {
  it('different decisions on each branch reach both; the rows are identical', async () => {
    const h = await mk()
    const [a, b] = h.bs as [SimBranch, SimBranch]
    a.setClock(T(1)); a.decide({ kind: 'merge', keyA: 'AMETO SMALL', keyB: 'AMETO SML' })
    b.setClock(T(2)); b.decide({ kind: 'ignore', keyA: 'GST EXTRA' })
    a.setClock(T(3)); a.decide({ kind: 'family', keyA: 'MILTON 505', canonical: 'MILTON' })
    expect(await h.settle()).toBeGreaterThan(0)
    expect(live(a)).toHaveLength(3)
    expect(live(b)).toEqual(live(a)) // verbatim: same times, same branch, same everything
    expect(content(a)).toEqual(content(b))
    expect(live(b).find((r) => r.kind === 'ignore')?.branchId).toBe(b.id) // the maker is kept, not the receiver
  })

  it('the same decision on both branches is ONE rule (same id, nothing rewritten)', async () => {
    const h = await mk()
    const [a, b] = h.bs as [SimBranch, SimBranch]
    a.setClock(T(1)); a.decide({ kind: 'merge', keyA: 'ARIHANT 32X50', keyB: 'ARIHANT 32X50 BIG' })
    b.setClock(T(5)); b.decide({ kind: 'merge', keyA: 'ARIHANT 32X50', keyB: 'ARIHANT 32X50 BIG' })
    await h.settle()
    for (const x of [a, b]) expect(x.q('SELECT COUNT(*) AS n FROM item_rules')[0]).toEqual({ n: 1 })
    expect(content(a)).toEqual(content(b))
    // fingerprint dedupe: the later arrival did not rewrite the earlier row
    expect(live(a)[0]?.updatedAt).toBe(new Date(T(1)).toISOString())
    expect(live(b)[0]?.updatedAt).toBe(new Date(T(5)).toISOString())
    expect(a.q('SELECT COUNT(*) AS n FROM audit_log WHERE entity = ? AND action = ?', 'item_rule', 'sync')[0]).toEqual({ n: 0 })
    // opposite order of the pair on the other branch: still one row (id ignores the order), direction decided last-write-wins
    b.setClock(T(9)); b.decide({ kind: 'merge', keyA: 'ARIHANT 32X50 BIG', keyB: 'ARIHANT 32X50' })
    await h.settle()
    for (const x of [a, b]) expect(x.q('SELECT COUNT(*) AS n FROM item_rules')[0]).toEqual({ n: 1 })
    expect(live(a)).toEqual(live(b))
    expect(live(a)[0]?.keyA).toBe(normaliseItem('ARIHANT 32X50 BIG').key)
  })

  it('last write wins on updatedAt, whichever branch pushed first', async () => {
    const h = await mk()
    const [a, b] = h.bs as [SimBranch, SimBranch]
    a.setClock(T(10)); a.decide({ kind: 'merge', keyA: 'JUPITER 5', keyB: 'JUPITOR 5', canonical: 'Jupiter 5' })
    b.setClock(T(20)); b.decide({ kind: 'merge', keyA: 'JUPITER 5', keyB: 'JUPITOR 5', canonical: 'JUPITER FIVE' })
    await h.bs[1]!.push.runOnce() // B's newer decision goes out first
    await h.settle()
    expect(live(a)).toEqual(live(b))
    expect(live(a)[0]?.canonical).toBe('JUPITER FIVE')
    expect(live(a)[0]?.updatedAt).toBe(new Date(T(20)).toISOString())
  })

  it('equal times fall to the greater branch id (deterministic on both sides)', async () => {
    const h = await mk()
    const [a, b] = h.bs as [SimBranch, SimBranch]
    a.setClock(T(30)); b.setClock(T(30))
    a.decide({ kind: 'family', keyA: 'TALCO 2044', canonical: 'TALCO ONE' })
    b.decide({ kind: 'family', keyA: 'TALCO 2044', canonical: 'TALCO TWO' })
    await h.settle()
    expect(live(a)).toEqual(live(b))
    const winner = a.id > b.id ? 'TALCO ONE' : 'TALCO TWO'
    expect(live(a)[0]?.canonical).toBe(winner)
  })

  it('a delete (tombstone) and a revive travel; undo on one branch undoes it on the other', async () => {
    const h = await mk()
    const [a, b] = h.bs as [SimBranch, SimBranch]
    a.setClock(T(1)); const r = a.decide({ kind: 'ignore', keyA: 'ADVANCE' })
    await h.settle()
    expect(live(b)[0]?.deletedAt).toBeNull()
    b.setClock(T(2)); expect(b.rules.remove(r.rule.id, { at: new Date(T(2)).toISOString(), branchId: b.id })).toBe(true)
    await h.settle()
    expect(live(a)[0]?.deletedAt).toBe(new Date(T(2)).toISOString()) // the tombstone arrived (soft delete: the row stays)
    a.setClock(T(3)); a.decide({ kind: 'ignore', keyA: 'ADVANCE' }) // revive
    await h.settle()
    expect(live(b)[0]?.deletedAt).toBeNull()
    expect(live(b)).toEqual(live(a))
    a.setClock(T(4)); a.rules.undoLast({ at: new Date(T(4)).toISOString(), branchId: a.id }) // undoes the revive -> deleted again
    await h.settle()
    expect(live(b)[0]?.deletedAt).not.toBeNull()
    expect(live(b)).toEqual(live(a))
  })

  it('a rule received from another branch is never sent back out, and leaves no undo step', async () => {
    const h = await mk()
    const [a, b] = h.bs as [SimBranch, SimBranch]
    a.setClock(T(1)); a.decide({ kind: 'ignore', keyA: 'LESS' })
    await h.settle()
    expect(live(b)).toHaveLength(1)
    expect(b.outbox.repo.counts()).toEqual({ pending: 0, failed: 0, synced: 0 }) // nothing captured on the receiver
    expect(b.rules.lastDecision()).toBeNull() // item_rule_log is local-only
    expect(b.q('SELECT COUNT(*) AS n FROM audit_log WHERE entity = ? AND action = ?', 'item_rule', 'sync')[0]).toEqual({ n: 1 })
  })

  it('two quick edits of one rule leave ONE pending outbox row (the newer supersedes)', async () => {
    const h = await mk()
    const a = h.bs[0] as SimBranch
    a.setClock(T(1)); a.decide({ kind: 'family', keyA: 'MILTON 505', canonical: 'MILTON' })
    a.setClock(T(2)); a.decide({ kind: 'family', keyA: 'MILTON 505', canonical: 'MILTON STEEL' })
    expect(a.outbox.repo.counts().pending).toBe(1)
    await h.settle()
    expect(live(h.bs[1] as SimBranch)[0]?.canonical).toBe('MILTON STEEL')
  })

  it('rules and bills share the postbox: both arrive, in one settle', async () => {
    const h = await mk()
    const [a, b] = h.bs as [SimBranch, SimBranch]
    a.setClock(T(1))
    a.bills.save(billInput(U('bill-1'), '5'))
    a.decide({ kind: 'merge', keyA: 'PEN BLUE', keyB: 'PEN BLU' })
    await h.settle()
    expect(b.q('SELECT COUNT(*) AS n FROM bills')[0]).toEqual({ n: 1 })
    expect(live(b)).toHaveLength(1)
    expect(b.pull.status().skipped).toEqual([])
  })

  it('converges through a lossy network (dropped requests and replies), then everything is acknowledged', async () => {
    for (const seed of [3, 11, 42]) {
      const h = await mk({ seed, dropBefore: 0.3, dropAfter: 0.3 })
      const [a, b] = h.bs as [SimBranch, SimBranch]
      a.setClock(T(1)); a.decide({ kind: 'merge', keyA: 'GRIPPER 3', keyB: 'GRIPER 3' })
      b.setClock(T(2)); b.decide({ kind: 'ignore', keyA: 'GST EXTRA' })
      a.setClock(T(3)); a.decide({ kind: 'split', keyA: 'STEAM IRON', keyB: 'SEAM IRON' })
      h.heal()
      for (let i = 0; i < 8; i++) await h.settle()
      expect(live(a)).toHaveLength(3)
      expect(live(b)).toEqual(live(a))
      expect(h.mem.postboxSize).toBe(0)
    }
  })
})

describe('Phase 111 - a branch that does not know the kind', () => {
  it('acknowledges and ignores item rules: nothing stored, nothing blamed, cursor moves on, the server row is gone', async () => {
    const h = await mk({ branches: 3, legacyBranches: [2] })
    const [a, b, c] = h.bs as [SimBranch, SimBranch, SimBranch]
    a.setClock(T(1)); a.decide({ kind: 'ignore', keyA: 'GST EXTRA' })
    expect(await h.settle()).toBeGreaterThan(0)
    expect(live(b)).toHaveLength(1)
    expect(live(c)).toHaveLength(0) // ignored, not stored
    expect(c.pull.status().skipped).toEqual([])
    expect(c.pull.status().unacked).toBe(0)
    expect(c.pull.status().cursor).toBeGreaterThan(0)
    expect(h.mem.postboxSize).toBe(0) // acknowledged, so the server dropped it
    expect(c.q('SELECT COUNT(*) AS n FROM audit_log WHERE entity = ?', 'item_rule')[0]).toEqual({ n: 0 })
  })

  it('a bill sent right behind a rule is not held up on a branch that ignores rules', async () => {
    const h = await mk({ branches: 3, legacyBranches: [2] })
    const [a, , c] = h.bs as [SimBranch, SimBranch, SimBranch]
    a.setClock(T(1)); a.decide({ kind: 'ignore', keyA: 'GST EXTRA' })
    a.bills.save(billInput(U('bill-legacy'), '2'))
    await h.settle()
    expect(c.q('SELECT COUNT(*) AS n FROM bills')[0]).toEqual({ n: 1 })
    expect(c.pull.status().skipped).toEqual([])
  })
})

describe('Phase 111 - the applier never blocks the pipeline', () => {
  it('drops a rule whose keys or id do not check out (ignored + logged), stores nothing', () => {
    const t = openTestDb()
    try {
      const rules = createItemRulesRepo(t.handle.sqlite)
      const warned: unknown[] = []
      const ap = createItemRuleApplier({ rules, localBranchId: () => 'local', log: { info: () => undefined, warn: (...a: unknown[]) => { warned.push(a) }, error: () => undefined } })
      const good = rules.save({ kind: 'ignore', keyA: 'LESS' }, { at: '2026-10-11T10:00:00.000Z', branchId: 'x' }).rule
      rules.remove(good.id, { at: '2026-10-11T10:00:01.000Z', branchId: 'x' })
      const snap = itemRuleSnapshot({ ...good, keyA: 'less  ', updatedAt: '2026-10-12T00:00:00.000Z' })
      const out = ap.apply({ fromBranch: 'r', billId: good.id, op: 'upsert', revision: 0, updatedAt: '2026-10-12T00:00:00.000Z' }, snap)
      expect(out).toBe('ignored')
      expect(warned).toHaveLength(1)
      expect(rules.get(good.id)?.deletedAt).not.toBeNull() // untouched
    } finally { t.cleanup() }
  })
})

describe('Phase 111 - a wipe never sends deletes', () => {
  it('Level 1 clears the outbox (rule rows included), captures nothing, and does not tombstone any rule', () => {
    const t = openTestDb()
    try {
      const sqlite = t.handle.sqlite
      const captured: unknown[] = []
      const rules = createItemRulesRepo(sqlite, { onChange: (r) => { captured.push(r.id); sqlite.prepare("INSERT INTO sync_outbox (bill_id, op, revision, created_at, state) VALUES (?, 'upsert', 0, 'now', 'pending')").run(r.id) } })
      rules.save({ kind: 'ignore', keyA: 'LESS' }, { at: '2026-10-11T10:00:00.000Z', branchId: 'x' })
      expect(captured).toHaveLength(1)
      expect((sqlite.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as { n: number }).n).toBe(1)
      writeWipeOptions(t.dir, { level: 1, poStart: 1 })
      const w = applyPendingWipeData(sqlite, t.dir)
      expect(w.error).toBeNull()
      expect((sqlite.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as { n: number }).n).toBe(0)
      expect((sqlite.prepare("SELECT COUNT(*) AS n FROM sync_outbox WHERE op = 'delete'").get() as { n: number }).n).toBe(0)
      expect(captured).toHaveLength(1) // the wipe itself did not touch the rules repo
      expect(rules.list(true).every((r) => r.deletedAt === null)).toBe(true)
    } finally { t.cleanup() }
  })
})
