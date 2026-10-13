import Database from 'better-sqlite3'
import type { BootstrapBranch, BootstrapCounts } from '../../shared/sync/bootstrap'

export interface FileBranch { id: string; name: string; poPrefix: string; createdAt: string; bills: number }

export interface MergeOptions {
  /** Count only: everything is done inside the transaction and then rolled back. */
  dryRun?: boolean
  /** Changes this computer's PO prefix in the same transaction (before the imported branches are added, so the unique prefix rule holds). */
  setPrefix?: { branchId: string; to: string }
}
export interface MergeResult extends BootstrapCounts { branches: BootstrapBranch[] }

class DryRunDone extends Error { constructor(readonly result: MergeResult) { super('dry run') } }

/**
 * Phase 58: the only SQL behind the new-branch bootstrap. Opens the backup file READ-ONLY and merges its bills into the live
 * database in ONE transaction: branches and customers this computer does not know, live bills whose id is new (PO numbers,
 * branch ids, rows and revision history kept as they are). Nothing here touches the outbox, `sync_state`, settings, drafts or
 * the local branch, so imported history is never sent again and the license / keys on this computer are never disturbed.
 */
export interface BootstrapRepo {
  /** Branches in a backup file (read-only, never throws for a readable Quot3 file). */
  fileBranches(file: string): FileBranch[]
  merge(file: string, opts?: MergeOptions): MergeResult
}

interface BkBill {
  id: string; branch_id: string; po_seq: number; po_number: string; party_id: string | null; party_snapshot_json: string; format_id: string
  extra_cols_json: string; paper_override: string | null; round_off?: number | null; footer_extras_json?: string | null; tail_rows_json?: string | null; bill_date: string; totals_json: string; item_row_count: number; revision: number
  created_at: string; updated_at: string; deleted_at: string | null
}

function openFile(file: string): Database.Database {
  return new Database(file, { readonly: true, fileMustExist: true })
}

export function createBootstrapRepo(sqlite: Database.Database): BootstrapRepo {
  const hasBill = sqlite.prepare('SELECT 1 AS x FROM bills WHERE id = ?')
  const hasPo = sqlite.prepare('SELECT 1 AS x FROM bills WHERE branch_id = ? AND po_seq = ?')
  const hasBranch = sqlite.prepare('SELECT 1 AS x FROM branches WHERE id = ?')
  const hasParty = sqlite.prepare('SELECT 1 AS x FROM parties WHERE id = ?')
  const insBranch = sqlite.prepare('INSERT INTO branches (id, name, po_prefix, is_local, created_at) VALUES (@id, @name, @poPrefix, 0, @createdAt)')
  const insParty = sqlite.prepare(
    `INSERT INTO parties (id, name, name_norm, phone, address, transport, source, created_at, updated_at)
     VALUES (@id, @name, @nameNorm, @phone, @address, @transport, @source, @createdAt, @updatedAt)`
  )
  const insBill = sqlite.prepare(
    `INSERT INTO bills (id, branch_id, po_seq, po_number, party_id, party_snapshot_json, format_id, extra_cols_json, paper_override, round_off, footer_extras_json, tail_rows_json, bill_date,
       totals_json, item_row_count, revision, created_at, updated_at, deleted_at, sync_state)
     VALUES (@id, @branchId, @poSeq, @poNumber, @partyId, @partySnapshotJson, @formatId, @extraColsJson, @paperOverride, @roundOff, @footerExtrasJson, @tailRowsJson, @billDate,
       @totalsJson, @itemRowCount, @revision, @createdAt, @updatedAt, NULL, 'synced')`
  )
  const insRow = sqlite.prepare(
    `INSERT INTO bill_rows (id, bill_id, idx, name_runs_json, name_plain, qty, rate, total_override, gst_rate, extras_json, cell_style_json)
     VALUES (@id, @billId, @idx, @nameRunsJson, @namePlain, @qty, @rate, @totalOverride, @gstRate, @extrasJson, @cellStyleJson)`
  )
  const insRev = sqlite.prepare(
    `INSERT INTO bill_revisions (id, bill_id, revision, snapshot_json, saved_at, saved_by_branch)
     VALUES (@id, @billId, @revision, @snapshotJson, @savedAt, @savedByBranch)`
  )
  const setPrefix = sqlite.prepare('UPDATE branches SET po_prefix = ? WHERE id = ?')

  function fileBranches(file: string): FileBranch[] {
    const bk = openFile(file)
    try {
      return bk
        .prepare(
          `SELECT b.id AS id, b.name AS name, b.po_prefix AS poPrefix, b.created_at AS createdAt,
                  (SELECT COUNT(*) FROM bills x WHERE x.branch_id = b.id AND x.deleted_at IS NULL) AS bills
           FROM branches b ORDER BY b.created_at, b.id`
        )
        .all() as FileBranch[]
    } finally {
      bk.close()
    }
  }

  function mergeInto(bk: Database.Database, opts: MergeOptions): MergeResult {
    const counts: BootstrapCounts = { branchesAdded: 0, partiesAdded: 0, billsAdded: 0, rowsAdded: 0, skippedExisting: 0, skippedTrashed: 0, skippedClash: 0 }
    if (opts.setPrefix) setPrefix.run(opts.setPrefix.to, opts.setPrefix.branchId)

    // 1. Branches this computer does not know (always as remote branches: this computer keeps its own local branch).
    const listed: BootstrapBranch[] = []
    const fileBr = bk.prepare('SELECT id, name, po_prefix AS poPrefix, created_at AS createdAt, is_local AS isLocal FROM branches ORDER BY created_at, id').all() as
      { id: string; name: string; poPrefix: string; createdAt: string; isLocal: number }[]
    for (const b of fileBr) {
      if (!hasBranch.get(b.id)) { insBranch.run({ id: b.id, name: b.name, poPrefix: b.poPrefix, createdAt: b.createdAt }); counts.branchesAdded++ }
    }

    // 2. Customers (live ones, by id). A bill whose customer is not added keeps its snapshot and loses only the link.
    for (const p of bk.prepare(
      'SELECT id, name, name_norm AS nameNorm, phone, address, transport, source, created_at AS createdAt, updated_at AS updatedAt FROM parties WHERE deleted_at IS NULL'
    ).all() as { id: string; name: string; nameNorm: string; phone: string | null; address: string | null; transport: string | null; source: string; createdAt: string; updatedAt: string }[]) {
      if (hasParty.get(p.id)) continue
      insParty.run(p)
      counts.partiesAdded++
    }

    // 3. Bills, oldest first so a branch's sequence stays in order.
    const bills = bk.prepare('SELECT * FROM bills ORDER BY branch_id, po_seq').all() as BkBill[]
    const rowsOf = bk.prepare(
      `SELECT id, bill_id AS billId, idx, name_runs_json AS nameRunsJson, name_plain AS namePlain, qty, rate, total_override AS totalOverride,
              gst_rate AS gstRate, extras_json AS extrasJson, cell_style_json AS cellStyleJson FROM bill_rows WHERE bill_id = ? ORDER BY idx`
    )
    const revsOf = bk.prepare(
      'SELECT id, bill_id AS billId, revision, snapshot_json AS snapshotJson, saved_at AS savedAt, saved_by_branch AS savedByBranch FROM bill_revisions WHERE bill_id = ? ORDER BY revision'
    )
    const perBranch = new Map<string, { bills: number; newBills: number }>()
    for (const b of bills) {
      if (b.deleted_at !== null) { counts.skippedTrashed++; continue }
      const slot = perBranch.get(b.branch_id) ?? { bills: 0, newBills: 0 }
      slot.bills++
      perBranch.set(b.branch_id, slot)
      if (hasBill.get(b.id)) { counts.skippedExisting++; continue }
      if (!hasBranch.get(b.branch_id) || hasPo.get(b.branch_id, b.po_seq)) { counts.skippedClash++; continue }
      insBill.run({
        id: b.id, branchId: b.branch_id, poSeq: b.po_seq, poNumber: b.po_number, partyId: b.party_id && hasParty.get(b.party_id) ? b.party_id : null,
        partySnapshotJson: b.party_snapshot_json, formatId: b.format_id, extraColsJson: b.extra_cols_json, paperOverride: b.paper_override, roundOff: b.round_off === 1 ? 1 : 0, footerExtrasJson: b.footer_extras_json || '{}', tailRowsJson: b.tail_rows_json || '[]',
        billDate: b.bill_date, totalsJson: b.totals_json, itemRowCount: b.item_row_count, revision: b.revision, createdAt: b.created_at, updatedAt: b.updated_at
      })
      for (const r of rowsOf.all(b.id) as Record<string, unknown>[]) { insRow.run(r); counts.rowsAdded++ }
      for (const r of revsOf.all(b.id) as Record<string, unknown>[]) insRev.run(r)
      slot.newBills++
      counts.billsAdded++
    }
    for (const b of fileBr) {
      const s = perBranch.get(b.id)
      if (s) listed.push({ id: b.id, name: b.name, poPrefix: b.poPrefix, bills: s.bills, newBills: s.newBills })
    }
    return { ...counts, branches: listed }
  }

  return {
    fileBranches,
    merge(file, opts = {}) {
      const bk = openFile(file)
      try {
        const run = sqlite.transaction((): MergeResult => {
          const r = mergeInto(bk, opts)
          if (opts.dryRun) throw new DryRunDone(r)
          return r
        })
        try {
          return run()
        } catch (err) {
          if (err instanceof DryRunDone) return err.result
          throw err
        }
      } finally {
        bk.close()
      }
    }
  }
}
