import type { ItemsRepo, LoadedBill } from '../db/itemsRepo'
import type { ItemRuleRow } from '../../shared/items/rules'
import { toGroupingRule } from '../../shared/items/rules'
import { groupItems, type GroupingResult, type ItemGroup, type ItemSpelling } from '../../shared/items/grouping'
import { buildSalesTab, saleLine, type SaleLine } from '../../shared/items/sales'
import type { DecisionInput, DecisionResult, GroupDetail, GroupSales, GroupSummary, ItemsOverview, LastDecisionInfo, OpenTarget, RebuildProgress, RebuildSummary, UndoOutcome } from '../../shared/items/api'
import { planDecision } from '../../shared/items/decide'
import { resolveFormat } from '../../shared/format/registry'
import { AppError } from '../ipc/envelope'

export interface ItemsService {
  /** Groups (light rows), families, not-items and totals for the Groups window. */
  overview(): ItemsOverview
  /** Spellings (with the rule that put each one there) and the suggested merges of one group. */
  group(groupId: string): GroupDetail
  /** The group's sales, Non-GST and GST separately, with stats, outlier flags and the last rate per party. */
  sales(input: { groupId: string; partyKey?: string }): GroupSales
  /** Throws the cached index away and reads every non-trashed bill again, reporting progress. */
  rebuild(onProgress?: (p: RebuildProgress) => void): Promise<RebuildSummary>
  /** The bill a sales row opens (null when it was deleted since). */
  openTarget(billId: string): OpenTarget | null
  /** Phase 113: saves one owner decision as Item rules (a move = two). Bills are never touched; the next read regroups. */
  decide(input: DecisionInput): DecisionResult
  /** Phase 113: reverts the newest decision, every rule step of that one action. */
  undoLast(): UndoOutcome
  /** Phase 113: what Undo would revert now. */
  lastDecision(): LastDecisionInfo
}

/** Phase 113: the rule writes the service needs (the Phase 109 repo, with the branch id filled in by the caller). */
export interface RuleOps {
  /** Saves one decision; `changed` is false when the same decision already exists. Throws `Error` with a readable message on bad input. */
  save(input: { kind: 'merge' | 'split' | 'ignore'; keyA: string; keyB?: string }, at: string): { changed: boolean }
  /** Reverts the newest decision step; false when there is nothing to undo. */
  undoLast(at: string): boolean
  /** Whether some step can still be undone (also from an earlier session). */
  hasUndo(): boolean
}

export interface ItemsDeps {
  repo: ItemsRepo
  /** Live owner rules (Phase 109 repo `list()`). */
  rules: () => ItemRuleRow[]
  /** Phase 113: rule writes. Without it `decide` / `undoLast` refuse (read-only database). */
  ruleOps?: RuleOps
}
export interface ItemsOpts {
  now?: () => Date
  /** Lets a long rebuild hand the event loop back between chunks (progress events reach the window). Default `setImmediate`. */
  yieldNow?: () => Promise<void>
  /** Bills per chunk when reading everything (default 200). */
  chunk?: number
}

const sigOf = (s: { revision: number; updatedAt: string }): string => `${s.revision}|${s.updatedAt}`

/**
 * Phase 110 - the Items read model. Bills stay the truth (DATA_MODEL: derived data is never truth): this keeps an in-memory index
 * of every non-trashed bill's sale lines and the Phase 108 grouping computed from it.
 *
 * Staying current is incremental and needs no hook: every read compares a cheap per-bill signature (`revision`, `updated_at`,
 * `deleted_at`) with what was indexed and reloads only the bills that differ, so save / edit / delete / restore / purge / legacy
 * import / remote apply all show up, and Save itself does no items work at all. The grouping is recomputed only when the spellings
 * (name, count, last date) or the owner rules changed, so a rate edit never re-runs it. `rebuild` starts from nothing.
 */
export function createItemsService({ repo, rules, ruleOps }: ItemsDeps, opts: ItemsOpts = {}): ItemsService {
  const now = opts.now ?? (() => new Date())
  const yieldNow = opts.yieldNow ?? (() => new Promise<void>((r) => setImmediate(r)))
  const CHUNK = Math.max(1, opts.chunk ?? 200)

  const indexed = new Map<string, string>() // billId -> signature
  const linesOf = new Map<string, SaleLine[]>() // billId -> its lines
  const byName = new Map<string, Map<string, SaleLine[]>>() // trimmed name -> billId -> lines
  let lineTotal = 0

  let spellSig = ''
  let rulesSig = ''
  let grouping: GroupingResult | null = null
  let groupById = new Map<string, ItemGroup>()
  let summaries: GroupSummary[] = []
  let builtAt = now().toISOString()

  const dropBill = (billId: string): void => {
    const old = linesOf.get(billId)
    if (old) {
      for (const l of old) {
        const m = byName.get(l.name)
        if (!m) continue
        m.delete(billId)
        if (m.size === 0) byName.delete(l.name)
      }
      lineTotal -= old.length
      linesOf.delete(billId)
    }
    indexed.delete(billId)
  }

  const addBill = ({ head, rows }: LoadedBill, sig: string): void => {
    dropBill(head.id)
    const format = resolveFormat(head.formatId)
    const bh = { billId: head.id, poNumber: head.poNumber, billDate: head.billDate, createdAt: head.createdAt, partyId: head.partyId, partyName: head.partyName, legacyRef: head.legacyRef }
    const lines: SaleLine[] = []
    for (const row of rows) {
      const l = saleLine(format, bh, row)
      if (l) lines.push(l)
    }
    linesOf.set(head.id, lines)
    for (const l of lines) {
      let m = byName.get(l.name)
      if (!m) { m = new Map(); byName.set(l.name, m) }
      const list = m.get(head.id)
      if (list) list.push(l); else m.set(head.id, [l])
    }
    lineTotal += lines.length
    indexed.set(head.id, sig)
  }

  /** Bring the index in line with `bills`. Returns whether anything changed. */
  const sync = (): boolean => {
    const sigs = repo.signatures()
    const live = new Set<string>()
    const want: Array<{ id: string; sig: string }> = []
    for (const s of sigs) {
      if (s.deletedAt !== null) continue
      live.add(s.id)
      const sig = sigOf(s)
      if (indexed.get(s.id) !== sig) want.push({ id: s.id, sig })
    }
    let changed = false
    for (const id of [...indexed.keys()]) if (!live.has(id)) { dropBill(id); changed = true }
    for (let i = 0; i < want.length; i += CHUNK) {
      const part = want.slice(i, i + CHUNK)
      const sigById = new Map(part.map((w) => [w.id, w.sig]))
      const loaded = repo.loadBills(part.map((w) => w.id))
      for (const b of loaded) addBill(b, sigById.get(b.head.id) as string)
      for (const w of part) if (!loaded.some((b) => b.head.id === w.id)) dropBill(w.id) // vanished between the two reads
      changed = true
    }
    return changed
  }

  const spellings = (): ItemSpelling[] => {
    const out: ItemSpelling[] = []
    for (const [name, bills] of byName) {
      let count = 0
      let last = ''
      for (const list of bills.values()) {
        count += list.length
        for (const l of list) if (l.billDate > last) last = l.billDate
      }
      out.push({ name, count, ...(last ? { lastUsed: last } : {}) })
    }
    return out
  }

  const ensure = (): GroupingResult => {
    sync()
    const ruleRows = rules()
    const rSig = ruleRows.map((r) => `${r.id}@${r.updatedAt}`).join(',')
    const sp = spellings()
    const sSig = sp.map((s) => `${s.name}\u0001${s.count}\u0001${s.lastUsed ?? ''}`).sort().join('\u0002')
    if (grouping && sSig === spellSig && rSig === rulesSig) return grouping
    grouping = groupItems(sp, ruleRows.map(toGroupingRule))
    spellSig = sSig
    rulesSig = rSig
    builtAt = now().toISOString()
    groupById = new Map(grouping.groups.map((g) => [g.id, g]))
    const perName = new Map<string, { gst: number; non: number }>()
    for (const [name, bills] of byName) {
      const c = { gst: 0, non: 0 }
      for (const list of bills.values()) for (const l of list) { if (l.gst) c.gst++; else c.non++ }
      perName.set(name, c)
    }
    summaries = grouping.groups.map((g) => {
      let gst = 0, non = 0
      for (const s of g.spellings) { const c = perName.get(s.name); if (c) { gst += c.gst; non += c.non } }
      return { id: g.id, display: g.display, count: g.count, nonGstCount: non, gstCount: gst, lastUsed: g.lastUsed, familyId: g.familyId, spellingCount: g.spellings.length, suggestionCount: g.suggestions.length }
    })
    return grouping
  }

  // Phase 113: one entry per owner action (steps = rule changes it made), so Undo reverts the whole action. Rules from an earlier session
  // have no entry: they undo one step at a time.
  const batches: Array<{ steps: number; label: string }> = []
  let lastAt = 0
  /** Strictly increasing rule times: rules apply oldest first, so a move's split must be older than its merge even inside one millisecond. */
  const stamp = (): string => { lastAt = Math.max(now().getTime(), lastAt + 1); return new Date(lastAt).toISOString() }
  const undoLabel = (): string | null => (batches.length > 0 ? (batches[batches.length - 1] as { label: string }).label : ruleOps?.hasUndo() ? 'the last decision' : null)

  const need = (id: string): ItemGroup => {
    ensure()
    const g = groupById.get(id)
    if (!g) throw new AppError('NOT_FOUND', 'That item group no longer exists')
    return g
  }

  return {
    overview() {
      const r = ensure()
      return { groups: summaries, families: r.families, notItems: r.notItems, bills: indexed.size, lines: lineTotal, builtAt }
    },

    group(groupId) {
      const g = need(groupId)
      return { id: g.id, display: g.display, familyId: g.familyId, spellings: g.spellings, suggestions: g.suggestions }
    },

    sales({ groupId, partyKey }) {
      const g = need(groupId)
      const non: SaleLine[] = []
      const gst: SaleLine[] = []
      for (const s of g.spellings) {
        const bills = byName.get(s.name)
        if (!bills) continue
        for (const list of bills.values()) for (const l of list) (l.gst ? gst : non).push(l)
      }
      return { groupId: g.id, display: g.display, nonGst: buildSalesTab(non, partyKey), gst: buildSalesTab(gst, partyKey) }
    },

    async rebuild(onProgress) {
      const t0 = Date.now()
      indexed.clear(); linesOf.clear(); byName.clear(); lineTotal = 0
      grouping = null; spellSig = ''; rulesSig = ''
      const sigs = repo.signatures().filter((s) => s.deletedAt === null)
      const total = sigs.length
      onProgress?.({ done: 0, total })
      for (let i = 0; i < total; i += CHUNK) {
        const part = sigs.slice(i, i + CHUNK)
        const sigById = new Map(part.map((s) => [s.id, sigOf(s)]))
        for (const b of repo.loadBills(part.map((s) => s.id))) addBill(b, sigById.get(b.head.id) as string)
        onProgress?.({ done: Math.min(total, i + CHUNK), total })
        await yieldNow()
      }
      const r = ensure()
      return { bills: indexed.size, lines: lineTotal, spellings: byName.size, groups: r.groups.length, ms: Date.now() - t0 }
    },

    decide(input) {
      if (!ruleOps) throw new AppError('VALIDATION', 'The database is read-only, so decisions cannot be saved')
      ensure()
      const plan = planDecision(input, (id) => groupById.get(id))
      if (!plan.ok) throw new AppError('VALIDATION', plan.error)
      let steps = 0
      for (const d of plan.drafts) {
        try { if (ruleOps.save(d, stamp()).changed) steps++ } catch (e) { throw new AppError('VALIDATION', e instanceof Error ? e.message : 'The decision could not be saved') }
      }
      if (steps > 0) batches.push({ steps, label: plan.message })
      ensure()
      return { changed: steps > 0, steps, message: steps > 0 ? plan.message : 'Already decided that way.', selectId: plan.selectId, undo: undoLabel() }
    },

    undoLast() {
      if (!ruleOps) throw new AppError('VALIDATION', 'The database is read-only, so decisions cannot be undone')
      const b = batches.pop()
      const want = b ? b.steps : 1
      let done = 0
      for (let i = 0; i < want; i++) { if (!ruleOps.undoLast(stamp())) break; done++ }
      ensure()
      return { undone: done > 0, steps: done, message: done > 0 ? (b ? `Undone: ${b.label}` : 'Undid the last decision.') : 'Nothing to undo.', undo: undoLabel() }
    },

    lastDecision() { return { undo: undoLabel() } },

    openTarget(billId) {
      const b = repo.bill(billId)
      return b ? { billId: b.id, poNumber: b.poNumber, billDate: b.billDate, partyName: b.partyName } : null
    }
  }
}
