import type Database from 'better-sqlite3'
import type { PartyLite } from '../../shared/party/partyLite'

export interface PartyRow extends PartyLite {
  source: string
}

export interface PartyWrite {
  id: string
  name: string
  nameNorm: string
  phone: string | null
  address: string | null
  transport: string | null
  at: string
}

/** A customer with the fields the merge needs (Phase 137). */
export interface PartyFull extends PartyLite {
  nameNorm: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  mergedInto: string | null
}

export interface MergeLogRow {
  id: string
  survivorId: string
  mergedId: string
  kind: 'unify' | 'manual'
  batchId: string
  byBranch: string
  at: string
  /** JSON of the survivor's phone / address / transport / updatedAt before the merge (for undo). */
  survivorBeforeJson: string
  /** JSON array of the bill ids that were re-pointed (for undo). */
  billIdsJson: string
  undoneAt: string | null
}

/** The only SQL that touches `parties` (Phase 26). Services decide the rules; this just reads and writes. */
export function createPartyRepo(sqlite: Database.Database) {
  const toLite = (r: { id: string; name: string; phone: string | null; address: string | null; transport: string | null }): PartyLite => ({
    id: r.id, name: r.name, phone: r.phone ?? '', address: r.address ?? '', transport: r.transport ?? ''
  })
  const cols = 'id, name, phone, address, transport'
  const listStmt = sqlite.prepare(`SELECT ${cols} FROM parties WHERE deleted_at IS NULL ORDER BY name_norm, id`)
  const byIdStmt = sqlite.prepare(`SELECT ${cols} FROM parties WHERE id = ? AND deleted_at IS NULL`)
  const byNormStmt = sqlite.prepare(`SELECT ${cols} FROM parties WHERE name_norm = ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`)
  const byNormExceptStmt = sqlite.prepare(`SELECT ${cols} FROM parties WHERE name_norm = ? AND id <> ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`)
  const softDeleteStmt = sqlite.prepare('UPDATE parties SET deleted_at = @at, updated_at = @at WHERE id = @id AND deleted_at IS NULL')
  const countStmt = sqlite.prepare('SELECT count(*) AS n FROM parties')
  const insertStmt = sqlite.prepare(
    `INSERT INTO parties (id, name, name_norm, phone, address, transport, source, created_at, updated_at)
     VALUES (@id, @name, @nameNorm, @phone, @address, @transport, @source, @at, @at)`
  )
  const updateStmt = sqlite.prepare(
    `UPDATE parties SET name = @name, name_norm = @nameNorm, phone = @phone, address = @address, transport = @transport, updated_at = @at
     WHERE id = @id AND deleted_at IS NULL`
  )
  type Row = Parameters<typeof toLite>[0]

  // ---- Phase 137: merges ----
  const fullCols = `${cols}, name_norm AS nameNorm, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, merged_into AS mergedInto`
  type FullRow = Row & { nameNorm: string; createdAt: string; updatedAt: string; deletedAt: string | null; mergedInto: string | null }
  const toFull = (r: FullRow): PartyFull => ({ ...toLite(r), nameNorm: r.nameNorm, createdAt: r.createdAt, updatedAt: r.updatedAt, deletedAt: r.deletedAt, mergedInto: r.mergedInto })
  const listFullStmt = sqlite.prepare(`SELECT ${fullCols} FROM parties WHERE deleted_at IS NULL ORDER BY name_norm, id`)
  const getAnyStmt = sqlite.prepare(`SELECT ${fullCols} FROM parties WHERE id = ?`)
  const billIdsStmt = sqlite.prepare('SELECT id FROM bills WHERE party_id = ? ORDER BY id')
  const repointStmt = sqlite.prepare('UPDATE bills SET party_id = @to WHERE id = @id AND party_id = @from')
  const markMergedStmt = sqlite.prepare('UPDATE parties SET deleted_at = @at, merged_into = @survivorId, updated_at = @at WHERE id = @id')
  const unmarkMergedStmt = sqlite.prepare('UPDATE parties SET deleted_at = NULL, merged_into = NULL, updated_at = @at WHERE id = @id')
  const setFieldsStmt = sqlite.prepare('UPDATE parties SET phone = @phone, address = @address, transport = @transport, updated_at = @at WHERE id = @id')
  const logInsert = sqlite.prepare(
    `INSERT OR REPLACE INTO party_merge_log (id, survivor_id, merged_id, kind, batch_id, by_branch, at, survivor_before_json, bill_ids_json)
     VALUES (@id, @survivorId, @mergedId, @kind, @batchId, @byBranch, @at, @survivorBeforeJson, @billIdsJson)`
  )
  const logCols = `id, survivor_id AS survivorId, merged_id AS mergedId, kind, batch_id AS batchId, by_branch AS byBranch, at, survivor_before_json AS survivorBeforeJson, bill_ids_json AS billIdsJson, undone_at AS undoneAt`
  const getMergeStmt = sqlite.prepare(`SELECT ${logCols} FROM party_merge_log WHERE id = ?`)
  const lastBatchStmt = sqlite.prepare('SELECT batch_id AS batchId FROM party_merge_log WHERE undone_at IS NULL ORDER BY at DESC, rowid DESC LIMIT 1')
  const batchRowsStmt = sqlite.prepare(`SELECT ${logCols} FROM party_merge_log WHERE batch_id = ? AND undone_at IS NULL ORDER BY rowid DESC`)
  const undoneStmt = sqlite.prepare('UPDATE party_merge_log SET undone_at = @at WHERE id = @id AND undone_at IS NULL')
  const allIdsStmt = sqlite.prepare('SELECT id FROM parties ORDER BY id')
  const mergeIdsStmt = sqlite.prepare('SELECT id FROM party_merge_log ORDER BY id')
  const notSameAdd = sqlite.prepare('INSERT OR IGNORE INTO party_not_same (a_id, b_id, at) VALUES (@a, @b, @at)')
  const notSameAll = sqlite.prepare('SELECT a_id AS a, b_id AS b FROM party_not_same')
  const notSameDel = sqlite.prepare('DELETE FROM party_not_same WHERE a_id = @a AND b_id = @b')
  return {
    list: (): PartyLite[] => (listStmt.all() as Row[]).map(toLite),
    get: (id: string): PartyLite | undefined => { const r = byIdStmt.get(id) as Row | undefined; return r && toLite(r) },
    findByNorm: (norm: string): PartyLite | undefined => { const r = byNormStmt.get(norm) as Row | undefined; return r && toLite(r) },
    /** Phase 45: another live party with this normalised name (a rename must not collide with it). */
    findByNormExcept: (norm: string, exceptId: string): PartyLite | undefined => { const r = byNormExceptStmt.get(norm, exceptId) as Row | undefined; return r && toLite(r) },
    /** Phase 45: soft delete (`deleted_at`); false when unknown / already deleted. Bills keep `party_id` and their snapshot. */
    softDelete: (id: string, at: string): boolean => softDeleteStmt.run({ id, at }).changes > 0,
    /** Every row including soft-deleted ones (the dev seed only runs on a truly empty table). */
    countAll: (): number => (countStmt.get() as { n: number }).n,
    insert: (w: PartyWrite, source: string): void => { insertStmt.run({ ...w, source }) },
    update: (w: PartyWrite): boolean => updateStmt.run(w).changes > 0,
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn)(),

    /** Phase 137: every live customer with the fields the merge and the unify need. */
    listFull: (): PartyFull[] => (listFullStmt.all() as FullRow[]).map(toFull),
    /** Phase 137: one customer, deleted or merged ones included. */
    getAny: (id: string): PartyFull | undefined => { const r = getAnyStmt.get(id) as FullRow | undefined; return r && toFull(r) },
    /** Phase 137: ids of every bill (trashed ones too, so a restore stays linked) that points at this customer. */
    billIdsOf: (id: string): string[] => (billIdsStmt.all(id) as { id: string }[]).map((r) => r.id),
    /** Phase 137: points the given bills (only those still pointing at `from`) at `to`. Only `party_id`: no revision, no outbox (the link is a local fact). */
    repoint: (billIds: readonly string[], from: string, to: string): number => { let n = 0; for (const id of billIds) n += repointStmt.run({ id, from, to }).changes; return n },
    markMerged: (id: string, survivorId: string, at: string): void => { markMergedStmt.run({ id, survivorId, at }) },
    unmarkMerged: (id: string, at: string): void => { unmarkMergedStmt.run({ id, at }) },
    setFields: (id: string, f: { phone: string | null; address: string | null; transport: string | null }, at: string): void => { setFieldsStmt.run({ id, ...f, at }) },
    logMerge: (r: Omit<MergeLogRow, 'undoneAt'>): void => { logInsert.run(r) },
    /** The newest merge batch that has not been undone (a manual merge is a batch of one; a unify is one batch). */
    lastBatchId: (): string | undefined => (lastBatchStmt.get() as { batchId: string } | undefined)?.batchId,
    /** Phase 137: every customer id in any state (the first-sync compare lists them all, merged and deleted ones too). */
    allIds: (): string[] => (allIdsStmt.all() as { id: string }[]).map((r) => r.id),
    mergeIds: (): string[] => (mergeIdsStmt.all() as { id: string }[]).map((r) => r.id),
    getMerge: (id: string): MergeLogRow | undefined => getMergeStmt.get(id) as MergeLogRow | undefined,
    batchRows: (batchId: string): MergeLogRow[] => batchRowsStmt.all(batchId) as MergeLogRow[],
    markUndone: (id: string, at: string): void => { undoneStmt.run({ id, at }) },
    addNotSame: (a: string, b: string, at: string): void => { const [x, y] = a < b ? [a, b] : [b, a]; notSameAdd.run({ a: x, b: y, at }) },
    removeNotSame: (a: string, b: string): void => { const [x, y] = a < b ? [a, b] : [b, a]; notSameDel.run({ a: x, b: y }) },
    notSamePairs: (): string[] => (notSameAll.all() as { a: string; b: string }[]).map((r) => `${r.a}|${r.b}`)
  }
}
export type PartyRepo = ReturnType<typeof createPartyRepo>
