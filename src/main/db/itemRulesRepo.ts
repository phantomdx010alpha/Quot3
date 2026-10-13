import type Database from 'better-sqlite3'
import { checkItemRule, RULE_LOG_KEEP, type ItemRuleDraft, type ItemRuleRow, type RuleLogOp } from '../../shared/items/rules'
import { itemRuleFingerprint, itemRuleIncomingWins } from '../../shared/sync/itemRule'

/**
 * The only SQL for `item_rules` and its undo log (Phase 109; ITEM_SORTER_SPEC sections 3-4, DATA_MODEL). The page never touches bills:
 * a rule only says how names are grouped. One decision = one row (deterministic id), deletes are soft (`deleted_at`) so a delete can
 * sync and be undone, and every change writes an `audit_log` row (entity `item_rule`) and one undo step, all in ONE transaction.
 *
 * Undo is "the last decision": the newest step not yet undone is reverted by restoring the row as it was BEFORE it. An undo is itself
 * a new change (`updated_at` = now) so that, once rules sync (Phase 111), it wins over the decision it reverted. There is no redo.
 */
interface RawRule {
  id: string; kind: string; keyA: string; keyB: string; canonical: string | null; note: string | null
  createdAt: string; updatedAt: string; deletedAt: string | null; branchId: string
}
const COLS = 'id, kind, key_a AS keyA, key_b AS keyB, canonical, note, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, branch_id AS branchId'

export interface RuleChange { rule: ItemRuleRow; changed: boolean; op: RuleLogOp | null }
export interface UndoResult { ruleId: string; op: RuleLogOp; rule: ItemRuleRow }
export interface LastDecision { logId: number; ruleId: string; op: RuleLogOp; at: string }

const asRow = (r: RawRule): ItemRuleRow => r as ItemRuleRow

/** Phase 111: what `applyRemote` did with a rule that came from another branch. */
export type RemoteRuleOutcome = 'inserted' | 'updated' | 'ignored'

export interface ItemRulesRepoOptions {
  /**
   * Phase 111: called INSIDE the write transaction after every LOCAL change (save that changed something, remove, undo), with the row
   * as stored. The sync outbox hooks in here so the rule and its outbox row commit together. Never called by `applyRemote`
   * (a change that came from another branch is never sent back out).
   */
  onChange?: (rule: ItemRuleRow) => void
}

export function createItemRulesRepo(sqlite: Database.Database, opts: ItemRulesRepoOptions = {}) {
  const listAllStmt = sqlite.prepare(`SELECT ${COLS} FROM item_rules ORDER BY updated_at, id`)
  const listLiveStmt = sqlite.prepare(`SELECT ${COLS} FROM item_rules WHERE deleted_at IS NULL ORDER BY updated_at, id`)
  const getStmt = sqlite.prepare(`SELECT ${COLS} FROM item_rules WHERE id = ?`)
  const insertStmt = sqlite.prepare(
    `INSERT INTO item_rules (id, kind, key_a, key_b, canonical, note, created_at, updated_at, deleted_at, branch_id)
     VALUES (@id, @kind, @keyA, @keyB, @canonical, @note, @createdAt, @updatedAt, @deletedAt, @branchId)`
  )
  const updateStmt = sqlite.prepare(
    `UPDATE item_rules SET kind = @kind, key_a = @keyA, key_b = @keyB, canonical = @canonical, note = @note, created_at = @createdAt,
            updated_at = @updatedAt, deleted_at = @deletedAt, branch_id = @branchId WHERE id = @id`
  )
  const logInsertStmt = sqlite.prepare('INSERT INTO item_rule_log (at, rule_id, op, before_json, after_json) VALUES (@at, @ruleId, @op, @beforeJson, @afterJson)')
  const logLastStmt = sqlite.prepare('SELECT id, at, rule_id AS ruleId, op, before_json AS beforeJson, after_json AS afterJson FROM item_rule_log WHERE undone_at IS NULL ORDER BY id DESC LIMIT 1')
  const logUndoneStmt = sqlite.prepare('UPDATE item_rule_log SET undone_at = ? WHERE id = ?')
  const logTrimStmt = sqlite.prepare('DELETE FROM item_rule_log WHERE id <= (SELECT MAX(id) FROM item_rule_log) - ?')
  const auditStmt = sqlite.prepare(
    'INSERT INTO audit_log (at, branch_id, entity, entity_id, action, detail_json) VALUES (@at, @branchId, @entity, @entityId, @action, @detailJson)'
  )

  const tx = <T>(fn: () => T): T => sqlite.transaction(fn).immediate()
  const get = (id: string): ItemRuleRow | undefined => { const r = getStmt.get(id) as RawRule | undefined; return r ? asRow(r) : undefined }
  const write = (r: ItemRuleRow, exists: boolean): void => { (exists ? updateStmt : insertStmt).run(r) }
  const note = (at: string, branchId: string, r: ItemRuleRow, action: string, op: RuleLogOp | null, before: ItemRuleRow | undefined): void => {
    auditStmt.run({ at, branchId, entity: 'item_rule', entityId: r.id, action, detailJson: JSON.stringify({ kind: r.kind, keyA: r.keyA, keyB: r.keyB, canonical: r.canonical }) })
    if (op) {
      logInsertStmt.run({ at, ruleId: r.id, op, beforeJson: before ? JSON.stringify(before) : null, afterJson: JSON.stringify(r) })
      logTrimStmt.run(RULE_LOG_KEEP)
    }
  }
  const sameContent = (a: ItemRuleRow, d: ItemRuleDraft): boolean =>
    a.keyA === d.keyA && a.keyB === d.keyB && a.canonical === d.canonical && a.note === d.note

  return {
    /** Live rules by default (oldest decision first); `includeDeleted` adds tombstones (sync needs them). */
    list: (includeDeleted = false): ItemRuleRow[] => ((includeDeleted ? listAllStmt : listLiveStmt).all() as RawRule[]).map(asRow),
    get,

    /**
     * Records a decision. The same decision again changes nothing (`changed: false`, no log, no audit). A different direction / name / note
     * on the same decision updates its row; a deleted decision made again is revived. Invalid input throws `Error` with a readable message.
     */
    save: (input: { kind: unknown; keyA: unknown; keyB?: unknown; canonical?: unknown; note?: unknown }, ctx: { at: string; branchId: string }): RuleChange =>
      tx(() => {
        const c = checkItemRule(input)
        if (!c.ok) throw new Error(c.error)
        const before = get(c.id)
        if (before && !before.deletedAt && sameContent(before, c.draft)) return { rule: before, changed: false, op: null }
        const rule: ItemRuleRow = { id: c.id, ...c.draft, createdAt: before?.createdAt ?? ctx.at, updatedAt: ctx.at, deletedAt: null, branchId: ctx.branchId }
        const op: RuleLogOp = !before ? 'create' : before.deletedAt ? 'revive' : 'update'
        write(rule, !!before)
        note(ctx.at, ctx.branchId, rule, op === 'create' ? 'create' : op === 'revive' ? 'revive' : 'update', op, before)
        opts.onChange?.(rule)
        return { rule, changed: true, op }
      }),

    /** Soft delete: the automatic grouping comes back for that decision. Returns false when there is no live rule with that id. */
    remove: (id: string, ctx: { at: string; branchId: string }): boolean =>
      tx(() => {
        const before = get(id)
        if (!before || before.deletedAt) return false
        const rule: ItemRuleRow = { ...before, updatedAt: ctx.at, deletedAt: ctx.at }
        write(rule, true)
        note(ctx.at, ctx.branchId, rule, 'delete', 'delete', before)
        opts.onChange?.(rule)
        return true
      }),

    /** The newest decision that can still be undone, for the page's Undo button. */
    lastDecision: (): LastDecision | null => {
      const r = logLastStmt.get() as { id: number; at: string; ruleId: string; op: RuleLogOp } | undefined
      return r ? { logId: r.id, ruleId: r.ruleId, op: r.op, at: r.at } : null
    },

    /** Reverts the newest decision not yet undone; null when there is nothing to undo. */
    undoLast: (ctx: { at: string; branchId: string }): UndoResult | null =>
      tx(() => {
        const l = logLastStmt.get() as { id: number; ruleId: string; op: RuleLogOp; beforeJson: string | null } | undefined
        if (!l) return null
        const current = get(l.ruleId)
        // before_json null = the rule was created by that step: undoing it deletes it again
        const target: ItemRuleRow | undefined = l.beforeJson ? (JSON.parse(l.beforeJson) as ItemRuleRow) : current ? { ...current, deletedAt: ctx.at } : undefined
        logUndoneStmt.run(ctx.at, l.id)
        if (!target) return null
        const rule: ItemRuleRow = { ...target, updatedAt: ctx.at, branchId: current?.branchId ?? target.branchId }
        write(rule, !!current)
        note(ctx.at, ctx.branchId, rule, 'undo', null, undefined)
        opts.onChange?.(rule)
        return { ruleId: rule.id, op: l.op, rule }
      }),

    /**
     * Phase 111: stores a rule that arrived from another branch. Runs inside the CALLER's transaction (the pull worker's, which also moves
     * the cursor), so it does not open one. Rules: a rule this computer has never seen is inserted; a known one is replaced only when the
     * incoming version wins (newer `updatedAt`, then branch id; equal = same version = ignored); a decision with the same content as the
     * local one (the same fingerprint) is ignored even when newer, so the same decision made on two branches stays one unchanged row.
     * The row is kept exactly as sent (its times and branch). One `audit_log` row (action `sync`). No undo step, no outbox, no `onChange`.
     */
    applyRemote: (incoming: ItemRuleRow, ctx: { at: string; branchId: string }): RemoteRuleOutcome => {
      const before = get(incoming.id)
      if (before && itemRuleFingerprint(before) === itemRuleFingerprint(incoming)) return 'ignored'
      if (before && !itemRuleIncomingWins(before, incoming)) return 'ignored'
      write(incoming, !!before)
      note(ctx.at, ctx.branchId, incoming, 'sync', null, undefined)
      return before ? 'updated' : 'inserted'
    },

    count: (): number => (sqlite.prepare('SELECT COUNT(*) AS n FROM item_rules WHERE deleted_at IS NULL').get() as { n: number }).n,
    transaction: tx
  }
}
export type ItemRulesRepo = ReturnType<typeof createItemRulesRepo>
