import type { ItemRulesRepo, RemoteRuleOutcome } from '../db/itemRulesRepo'
import type { Logger } from '../logger'
import { checkIncomingRule, type ItemRuleSnapshot } from '../../shared/sync/itemRule'
import type { IncomingMeta } from './remoteApplier'

/**
 * Phase 111 - applies ONE decrypted `item_rule` row from another branch (docs/SYNC_POSTBOX_SPEC.md section 11). The caller (pull worker)
 * wraps it in the same transaction that moves the cursor, exactly like a bill.
 * A rule that fails its checks is DROPPED (outcome `ignored`, logged), never thrown: a rule must not be able to block the bills behind it.
 */
export type ItemRuleOutcome = RemoteRuleOutcome

export interface ItemRuleApplier {
  /** Inside the caller's transaction. Never throws for a bad rule. */
  apply(meta: IncomingMeta, snap: ItemRuleSnapshot): ItemRuleOutcome
}

export function createItemRuleApplier(deps: { rules: Pick<ItemRulesRepo, 'applyRemote'>; localBranchId: () => string; log: Pick<Logger, 'info' | 'warn' | 'error'> }, opts: { now?: () => Date } = {}): ItemRuleApplier {
  const now = opts.now ?? (() => new Date())
  return {
    apply(meta, snap) {
      const c = checkIncomingRule(meta, snap)
      if (!c.ok) { deps.log.warn('Dropped an incoming item rule', { ruleId: snap.rule.id, reason: c.error }); return 'ignored' }
      return deps.rules.applyRemote(c.rule, { at: now().toISOString(), branchId: deps.localBranchId() })
    }
  }
}
