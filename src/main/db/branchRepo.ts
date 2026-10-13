import type Database from 'better-sqlite3'

export interface BranchInfo { id: string; name: string; poPrefix: string; nextSeq: number }

/** Phase 48: the only SQL behind Settings > Branch (read the local branch + its counter, list prefixes, change the prefix). */
export interface BranchRepo {
  local(): BranchInfo | undefined
  /** Prefixes of every branch except `exceptId`. */
  otherPrefixes(exceptId: string): string[]
  setPrefix(id: string, prefix: string): void
  audit(a: { at: string; branchId: string | null; entity: string; entityId: string | null; action: string; detailJson: string | null }): void
}

export function createBranchRepo(sqlite: Database.Database): BranchRepo {
  const sel = sqlite.prepare(
    `SELECT b.id AS id, b.name AS name, b.po_prefix AS poPrefix, COALESCE(c.next_seq, 1) AS nextSeq
     FROM branches b LEFT JOIN po_counters c ON c.branch_id = b.id WHERE b.is_local = 1`
  )
  const others = sqlite.prepare('SELECT po_prefix AS p FROM branches WHERE id <> ?')
  const upd = sqlite.prepare('UPDATE branches SET po_prefix = ? WHERE id = ?')
  const aud = sqlite.prepare('INSERT INTO audit_log (at, branch_id, entity, entity_id, action, detail_json) VALUES (@at, @branchId, @entity, @entityId, @action, @detailJson)')
  return {
    local: () => sel.get() as BranchInfo | undefined,
    otherPrefixes: (id) => (others.all(id) as { p: string }[]).map((r) => r.p),
    setPrefix: (id, prefix) => void upd.run(prefix, id),
    audit: (a) => void aud.run(a)
  }
}
