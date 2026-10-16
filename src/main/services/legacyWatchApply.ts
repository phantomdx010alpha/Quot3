import { randomUUID } from 'node:crypto'
import type { AuditInput } from '../../shared/audit'
import { deserializeBill, serializeBill } from '../../shared/billModel'
import { validateBillForSave } from '../../shared/billSave'
import { convertLegacyBill, parseLegacyFile, planLegacyImport, uuidFromText, type LegacyBill } from '../../shared/legacyImport'
import { contentOfBill } from '../../shared/legacyWatch/billContent'
import { classify, type Candidate, type Classification } from '../../shared/legacyWatch/classify'
import { contentFingerprintOf, contentOfLegacy, type ContentInput } from '../../shared/legacyWatch/fingerprint'
import { orderOldestFirst } from '../../shared/legacyWatch/order'
import type { ActivityItem, ReviewAction, ReviewItem, ReviewLists } from '../../shared/legacyWatch/reviewTypes'
import { normalizePartyName } from '../../shared/party/partyLite'
import type { BackupInfo } from '../../shared/backup/backupRules'
import type { Bill } from '../../shared/types'
import type { BillRepo } from '../db/billRepo'
import type { LegacyImportRepo } from '../db/legacyImportRepo'
import type { ActivityRow, LegacyWatchRepo, ReviewRow } from '../db/legacyWatchRepo'
import { getLocalBranch } from '../db/seed'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import type { SavedInfo } from './billService'

type SqliteHandle = Parameters<typeof getLocalBranch>[0]

/**
 * Phase 159 - the legacy-watch apply engine (MILESTONE15_DESIGN 3.2-3.5, 3.8). Main process only; no folders, timers or UI (Phase 160+).
 * It takes legacy files the scanner already read and, ONE TRANSACTION PER FILE through the normal bill write path (`billRepo`, the
 * revision row, the sync outbox hook, the audit hook):
 *   - imports a new bill (planned by the existing importer rules: PO / same-number clash, parties, old fingerprint, already-imported),
 *   - updates an existing bill in place as a NEW REVISION (newer file wins; never when the bill was edited in Quot3),
 *   - skips an exact duplicate or an older copy (logged),
 *   - or files a Needs-review item.
 * One `pre-import` backup per batch, taken just before the first write. Undo is never a hard delete: an import goes to Recently
 * deleted, an update is restored from the previous revision as another new revision, and the file is marked ignored.
 *
 * "Bill edited inside Quot3 after import" (design 3.3, decided here): the engine records the revision it wrote
 * (`legacy_watch_bills.applied_revision`); a bill whose current revision differs - or is in Recently deleted - counts as edited in Quot3.
 * A bill the engine did not write counts as edited, except a manually imported legacy bill still at revision 1.
 */
export type WatchResultKind = 'imported' | 'updated' | 'duplicate' | 'older' | 'review' | 'already_imported' | 'error' | 'unchanged'

export interface WatchFile { name: string; text: string; size: number; mtimeMs: number }
export interface FileOutcome { file: string; kind: WatchResultKind; billId: string | null; detail: string; activityId: string | null }
export interface BatchOutcome { outcomes: FileOutcome[]; counts: Record<WatchResultKind, number>; backupFile: string | null; batchId: string | null }
export interface UndoResult { kind: 'imported' | 'updated'; billId: string; revision: number }

export interface LegacyWatchApply {
  applyBatch(files: readonly WatchFile[]): Promise<BatchOutcome>
  /** Undo one automatic import / update from the Activity list. Refused (VALIDATION) when the bill changed since. */
  undo(activityId: string): UndoResult
  listActivity(limit?: number): ActivityRow[]
  /** Phase 163: the Activity list for the UI (newest first, each with `canUndo`). */
  activityItems(): ActivityItem[]
  /** Phase 163: open Needs-review items + the most recently ignored ones (which can be put back). The stored file text is not included. */
  reviewLists(): ReviewLists
  /** Phase 163: how many items wait (the badge). */
  reviewCount(): number
  /** Phase 163: import as a new bill / replace a candidate bill (new revision) / ignore / put an ignored item back. Every outcome is reversible; nothing is deleted. */
  resolveReview(id: string, action: ReviewAction, billId?: string): Promise<ResolveResult>
}

export interface ResolveResult { action: ReviewAction; message: string; billId: string | null }

export interface LegacyWatchApplyDeps {
  sqlite: SqliteHandle
  repo: LegacyWatchRepo
  importRepo: LegacyImportRepo
  bills: BillRepo
  /** The `pre-import` safety backup; called once per batch, just before the first write. */
  backup: { create(kind: 'pre-import'): Promise<BackupInfo> }
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface LegacyWatchApplyOpts {
  writable?: boolean
  now?: () => Date
  newId?: () => string
  audit?: (a: AuditInput) => void
  /** The same hook `billService` uses: feeds the sync outbox inside the transaction (a no-op while sync is off). */
  outbox?: (info: SavedInfo) => void
}

const emptyCounts = (): Record<WatchResultKind, number> => ({ imported: 0, updated: 0, duplicate: 0, older: 0, review: 0, already_imported: 0, error: 0, unchanged: 0 })
const SOURCE_LABEL = 'Legacy watch'

export function createLegacyWatchApply(deps: LegacyWatchApplyDeps, opts: LegacyWatchApplyOpts = {}): LegacyWatchApply {
  const { sqlite, repo, importRepo, bills } = deps
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomUUID
  const guard = (): void => {
    if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
  }

  const storedBill = (id: string): Bill | null => {
    const parsed = deserializeBill(bills.getRecord(id), bills.getRows(id))
    return parsed.ok ? parsed.data : null
  }

  /** Every bill of this party and date as a classifier candidate (trashed ones too: they are never overwritten). */
  function candidatesFor(lb: LegacyBill): Array<{ cand: Candidate; revision: number }> {
    const party = normalizePartyName(lb.party)
    const out: Array<{ cand: Candidate; revision: number }> = []
    for (const b of repo.billsOnDate(lb.isoDate)) {
      if (normalizePartyName(b.partyName) !== party) continue
      const bill = storedBill(b.id)
      if (!bill) continue
      const tracked = repo.getWatchBill(b.id)
      let content: ContentInput
      try { content = tracked ? (JSON.parse(tracked.contentJson) as ContentInput) : contentOfBill(bill) } catch { content = contentOfBill(bill) }
      const edited = b.deletedAt !== null || (tracked ? b.revision !== tracked.appliedRevision : b.legacyRef !== null ? b.revision !== 1 : true)
      out.push({ cand: { billId: b.id, content, sourceMtimeMs: tracked?.sourceMtimeMs ?? null, locallyEdited: edited }, revision: b.revision })
    }
    return out
  }

  const activity = (a: { kind: string; file: string; billId: string | null; party: string; po: string; detail: string; revision?: number | null; prevRevision?: number | null; prevSourceMtimeMs?: number | null }, at: string): string => {
    const id = newId()
    repo.addActivity({
      id, at, kind: a.kind, fileName: a.file, billId: a.billId, party: a.party, poNumber: a.po, detail: a.detail,
      revision: a.revision ?? null, prevRevision: a.prevRevision ?? null, prevSourceMtimeMs: a.prevSourceMtimeMs ?? null
    })
    return id
  }

  /** Records the file's state row (what was seen and what came of it). */
  const remember = (f: WatchFile, hash: string, result: string, billId: string | null, at: string): void => {
    repo.upsertFile({ fileName: f.name, size: f.size, mtimeMs: f.mtimeMs, contentHash: hash, lastResult: result, billId, seenAt: at })
  }

  async function applyBatch(files: readonly WatchFile[]): Promise<BatchOutcome> {
    guard()
    const ordered = orderOldestFirst(files, (f) => ({ name: f.name, mtimeMs: f.mtimeMs }))
    const outcomes: FileOutcome[] = []
    const counts = emptyCounts()
    let backupFile: string | null = null
    let backedUp = false
    let batchId: string | null = null
    const done = (o: FileOutcome): void => { outcomes.push(o); counts[o.kind]++ }

    for (const f of ordered) {
      const prev = repo.getFile(f.name)
      if (prev && prev.size === f.size && prev.mtimeMs === f.mtimeMs && prev.lastResult !== 'error') {
        done({ file: f.name, kind: 'unchanged', billId: prev.billId, detail: 'Already handled.', activityId: null })
        continue
      }
      const parsed = parseLegacyFile(f.text, f.size)
      if (!parsed.ok) {
        const at = now().toISOString()
        repo.transaction(() => remember(f, '', 'error', null, at))
        done({ file: f.name, kind: 'error', billId: null, detail: parsed.error, activityId: null })
        continue
      }
      const lb = parsed.bill

      // The backup is taken once, just before the first file that will write a bill.
      if (!backedUp) {
        const pre = classify({ file: f.name, content: contentOfLegacy(lb), mtimeMs: f.mtimeMs }, candidatesFor(lb).map((c) => c.cand))
        if (pre.kind === 'new' || pre.kind === 'edited') {
          const info = await deps.backup.create('pre-import')
          backedUp = true
          backupFile = info.file
        }
      }

      try {
        const out = repo.transaction(() => applyOne(f, lb, () => {
          if (batchId === null) batchId = ensureBatch()
          return batchId
        }))
        done(out)
      } catch (err) {
        if (batchId !== null && !importRepo.getBatch(batchId)) batchId = null // the batch row was created inside the rolled-back transaction
        if (err instanceof AppError) throw err
        deps.log?.error('legacy watch: file failed and was rolled back', { file: f.name, err })
        try { repo.transaction(() => remember(f, '', 'error', null, now().toISOString())) } catch { /* the file is retried on the next scan anyway */ }
        done({ file: f.name, kind: 'error', billId: null, detail: err instanceof Error ? err.message : 'unknown error', activityId: null })
      }
    }
    if (counts.imported + counts.updated > 0) deps.log?.info('legacy watch batch applied', { ...counts, backup: backupFile })
    return { outcomes, counts, backupFile, batchId }
  }

  /** One `import_batches` row per apply run that imports something (so the normal Import history lists it and can undo it). */
  function ensureBatch(): string {
    const branch = getLocalBranch(sqlite)
    const id = newId()
    const counter = (sqlite.prepare('SELECT next_seq AS n FROM po_counters WHERE branch_id = ?').get(branch.id) as { n: number } | undefined)?.n ?? 1
    importRepo.insertBatch({
      id, at: now().toISOString(), sourceLabel: SOURCE_LABEL, branchId: branch.id, poPrefix: branch.poPrefix, filesFound: 0, created: 0, skipped: 0,
      errors: 0, newParties: 0, poFirst: null, poLast: null, nextSeqAfter: counter, partyIds: []
    })
    return id
  }

  /** Runs inside the file's transaction: decides afresh (a sync pull or an earlier file may have changed things) and writes. */
  function applyOne(f: WatchFile, lb: LegacyBill, batch: () => string): FileOutcome {
    const at = now().toISOString()
    const content = contentOfLegacy(lb)
    const hash = contentFingerprintOf(content)
    const cands = candidatesFor(lb)
    const cls: Classification = classify({ file: f.name, content, mtimeMs: f.mtimeMs }, cands.map((c) => c.cand))
    const party = lb.party
    const logOnly = (kind: 'duplicate' | 'older', billId: string): FileOutcome => {
      remember(f, hash, kind, billId, at)
      const po = bills.getHead(billId)?.poNumber ?? ''
      const detail = kind === 'duplicate' ? `Skipped ${f.name}: same bill as ${po}.` : `Ignored ${f.name}: an older copy of ${po}.`
      return { file: f.name, kind, billId, detail, activityId: activity({ kind, file: f.name, billId, party, po, detail }, at) }
    }
    const toReview = (why: string, reason: string, candidateIds: string[]): FileOutcome => {
      const id = uuidFromText(`legacy-watch-review|${f.name}|${f.mtimeMs}`)
      repo.insertReview({ id, fileName: f.name, party, billDate: lb.isoDate, total: lb.storedTotal ?? '', mtimeMs: f.mtimeMs, why, reason, candidateIds, payloadText: f.text, createdAt: at })
      remember(f, hash, 'review', candidateIds[0] ?? null, at)
      const detail = `Needs review: ${f.name} (${reason})`
      return { file: f.name, kind: 'review', billId: candidateIds[0] ?? null, detail, activityId: activity({ kind: 'review', file: f.name, billId: candidateIds[0] ?? null, party, po: '', detail }, at) }
    }

    if (cls.kind === 'duplicate') return logOnly('duplicate', cls.candidates[0]!)
    if (cls.kind === 'older') return logOnly('older', cls.candidates[0]!)
    if (cls.kind === 'review') return toReview(cls.why ?? 'few_shared_lines', cls.reason, cls.candidates)

    if (cls.kind === 'edited') {
      const billId = cls.candidates[0]!
      const old = storedBill(billId)
      if (!old) return toReview('few_shared_lines', 'The matching bill could not be read.', [billId])
      const conv = convertLegacyBill(lb, billId, old.branchId, at).bill
      const next: Bill = {
        ...conv, branchId: old.branchId, poSeq: old.poSeq, poNumber: old.poNumber, partyId: old.partyId, createdAt: old.createdAt,
        revision: old.revision + 1, updatedAt: at, roundOff: old.roundOff, syncState: old.syncState
      }
      const issue = validateBillForSave(next)
      if (issue) return toReview('few_shared_lines', `The newer copy cannot be saved: ${issue.message}`, [billId])
      const a = serializeBill(next)
      const b = serializeBill(old)
      if (JSON.stringify(a.rows) === JSON.stringify(b.rows) && a.bill.partySnapshotJson === b.bill.partySnapshotJson && a.bill.billDate === b.bill.billDate) {
        return logOnly('duplicate', billId) // same rows after conversion (e.g. a manually imported bill): nothing to write
      }
      return commitUpdate(f, lb, hash, content, old, next, a, at)
    }

    return writeNew(f, lb, content, hash, at, batch, false)
  }

  /** Writes an update of an existing bill as a NEW revision (inside the caller's transaction): shared by the automatic path and the review "Replace". */
  function commitUpdate(f: WatchFile, lb: LegacyBill, hash: string, content: ContentInput, old: Bill, next: Bill, a: ReturnType<typeof serializeBill>, at: string): FileOutcome {
    const billId = old.id
    const party = lb.party
    const tracked = repo.getWatchBill(billId)
    bills.updateBill(a.bill)
    bills.replaceRows(billId, a.rows)
    bills.insertRevision({ id: newId(), billId, revision: next.revision, snapshotJson: JSON.stringify({ bill: a.bill, rows: a.rows }), savedAt: at, savedByBranch: old.branchId })
    bills.pruneRevisions(billId)
    repo.upsertWatchBill({ billId, fileName: f.name, sourceMtimeMs: f.mtimeMs, contentFp: hash, contentJson: JSON.stringify(content), appliedRevision: next.revision, updatedAt: at })
    remember(f, hash, 'updated', billId, at)
    opts.outbox?.({ billId, revision: next.revision, created: false, branchId: old.branchId })
    opts.audit?.({ entity: 'bill', entityId: billId, action: 'edit', detail: { poNumber: old.poNumber, revision: next.revision, partyName: lb.party, rows: a.rows.length, via: 'legacy-watch', file: f.name } })
    const detail = `Updated ${old.poNumber} from ${f.name} (new revision ${next.revision}).`
    const id = activity({ kind: 'updated', file: f.name, billId, party, po: old.poNumber, detail, revision: next.revision, prevRevision: old.revision, prevSourceMtimeMs: tracked?.sourceMtimeMs ?? null }, at)
    return { file: f.name, kind: 'updated', billId, detail, activityId: id }
  }

  /** Plans and writes a NEW bill (inside the caller's transaction). `strict` = the owner asked for it (review "Import as new"): a refusal throws instead of being filed. */
  function writeNew(f: WatchFile, lb: LegacyBill, content: ContentInput, hash: string, at: string, batch: () => string, strict: boolean): FileOutcome {
    const party = lb.party
    // new bill: the existing importer's planner applies the PO, same-number clash, party and already-imported rules.
    const branch = getLocalBranch(sqlite)
    const plan = planLegacyImport({ files: [{ name: f.name, text: f.text, bytes: f.size }], poPrefix: branch.poPrefix, branchId: branch.id, existing: strict ? { ...importRepo.existingState(branch.id), importedRefs: [], fingerprints: new Set<string>() } : importRepo.existingState(branch.id), now: at })
    const planned = plan.bills[0]
    if (!planned) {
      const err = plan.report.errors[0]
      const skip = plan.report.skipped[0]
      if (strict) throw new AppError('VALIDATION', err?.error ?? skip?.detail ?? 'This bill cannot be imported.')
      remember(f, hash, err ? 'error' : 'already_imported', null, at)
      return err
        ? { file: f.name, kind: 'error', billId: null, detail: err.error, activityId: null }
        : { file: f.name, kind: 'already_imported', billId: null, detail: skip?.detail ?? 'Already imported.', activityId: activity({ kind: 'duplicate', file: f.name, billId: null, party, po: '', detail: `Skipped ${f.name}: ${skip?.detail ?? 'already imported'}` }, at) }
    }
    const issue = validateBillForSave(planned.bill)
    if (issue) {
      if (strict) throw new AppError('VALIDATION', issue.message)
      remember(f, hash, 'error', null, at)
      return { file: f.name, kind: 'error', billId: null, detail: issue.message, activityId: null }
    }
    const batchId = batch()
    for (const p of plan.newParties) {
      importRepo.upsertParty({ id: p.id, name: p.name, nameNorm: normalizePartyName(p.name), phone: p.phone === '' ? null : p.phone, address: p.address === '' ? null : p.address, transport: p.transport === '' ? null : p.transport }, at)
    }
    const { bill: record, rows } = serializeBill(planned.bill)
    bills.insertBill(record)
    bills.replaceRows(record.id, rows)
    bills.insertRevision({ id: uuidFromText(`${record.id}|rev|${record.revision}`), billId: record.id, revision: record.revision, snapshotJson: JSON.stringify({ bill: record, rows }), savedAt: at, savedByBranch: branch.id })
    importRepo.tagBill(record.id, { legacyRef: planned.legacyRef, batchId, fingerprint: planned.fingerprint })
    importRepo.bumpCounter(branch.id, plan.report.nextSeqAfter)
    importRepo.addToBatch(batchId, { poSeq: record.poSeq, nextSeq: plan.report.nextSeqAfter, newPartyIds: plan.newParties.map((p) => p.id) })
    repo.upsertWatchBill({ billId: record.id, fileName: f.name, sourceMtimeMs: f.mtimeMs, contentFp: hash, contentJson: JSON.stringify(content), appliedRevision: record.revision, updatedAt: at })
    remember(f, hash, 'imported', record.id, at)
    opts.outbox?.({ billId: record.id, revision: record.revision, created: true, branchId: record.branchId })
    opts.audit?.({ entity: 'bill', entityId: record.id, action: 'import', detail: { poNumber: record.poNumber, legacyRef: planned.legacyRef, batchId, partyName: lb.party, rows: rows.length, via: 'legacy-watch' } })
    const detail = `Imported ${record.poNumber} from ${f.name}.`
    const id = activity({ kind: 'imported', file: f.name, billId: record.id, party, po: record.poNumber, detail, revision: record.revision }, at)
    return { file: f.name, kind: 'imported', billId: record.id, detail, activityId: id }
  }

  function undo(activityId: string): UndoResult {
    guard()
    const act = repo.getActivity(activityId)
    if (!act) throw new AppError('NOT_FOUND', 'That activity entry was not found.')
    if (act.undoneAt !== null) throw new AppError('VALIDATION', 'That action has already been undone.')
    if ((act.kind !== 'imported' && act.kind !== 'updated') || act.billId === null || act.revision === null) throw new AppError('VALIDATION', 'Only an automatic import or update can be undone.')
    const billId = act.billId
    const at = now().toISOString()
    return repo.transaction((): UndoResult => {
      const head = bills.getHead(billId)
      if (!head || head.deletedAt !== null) throw new AppError('VALIDATION', 'That bill is no longer in the list, so there is nothing to undo.')
      if (head.revision !== act.revision) throw new AppError('VALIDATION', 'That bill was changed after this action, so it cannot be undone here. Use the bill\'s History instead.')
      const file = repo.getFile(act.fileName)
      if (act.kind === 'imported') {
        if (!bills.softDelete(billId, at)) throw new AppError('VALIDATION', 'That bill is no longer in the list, so there is nothing to undo.')
        opts.outbox?.({ billId, revision: head.revision + 1, created: false, branchId: head.branchId, op: 'delete' })
        opts.audit?.({ entity: 'bill', entityId: billId, action: 'delete', detail: { poNumber: head.poNumber, revision: head.revision + 1, via: 'undo-legacy-watch' } })
      } else {
        if (act.prevRevision === null) throw new AppError('VALIDATION', 'The earlier version is not known, so this cannot be undone.')
        const snap = bills.getRevision(billId, act.prevRevision)
        if (!snap) throw new AppError('NOT_FOUND', `Revision ${act.prevRevision} is no longer stored (only the newest 50 are kept).`)
        let parsedSnap: { bill?: unknown; rows?: unknown }
        try { parsedSnap = JSON.parse(snap.snapshotJson) as { bill?: unknown; rows?: unknown } } catch { throw new AppError('DB_ERROR', 'The earlier version is damaged.') }
        const before = deserializeBill(parsedSnap.bill, Array.isArray(parsedSnap.rows) ? parsedSnap.rows : [])
        if (!before.ok) throw new AppError('DB_ERROR', `The earlier version is damaged (${before.error}).`)
        const cur = storedBill(billId)
        if (!cur) throw new AppError('DB_ERROR', 'This bill\'s stored data is damaged.')
        // the bill keeps its identity; only the content comes from the earlier revision, saved as ANOTHER new revision
        const restored: Bill = { ...before.data, id: billId, branchId: cur.branchId, poSeq: cur.poSeq, poNumber: cur.poNumber, partyId: cur.partyId, createdAt: cur.createdAt, revision: head.revision + 1, updatedAt: at, deletedAt: null, syncState: cur.syncState }
        const s = serializeBill(restored)
        bills.updateBill(s.bill)
        bills.replaceRows(billId, s.rows)
        bills.insertRevision({ id: newId(), billId, revision: restored.revision, snapshotJson: JSON.stringify({ bill: s.bill, rows: s.rows }), savedAt: at, savedByBranch: cur.branchId })
        bills.pruneRevisions(billId)
        const tracked = repo.getWatchBill(billId)
        if (tracked) {
          const content = JSON.stringify(contentOfBill(restored))
          repo.upsertWatchBill({ ...tracked, sourceMtimeMs: act.prevSourceMtimeMs ?? 0, contentFp: contentFingerprintOf(contentOfBill(restored)), contentJson: content, appliedRevision: restored.revision, updatedAt: at })
        }
        opts.outbox?.({ billId, revision: restored.revision, created: false, branchId: cur.branchId })
        opts.audit?.({ entity: 'bill', entityId: billId, action: 'edit', detail: { poNumber: cur.poNumber, revision: restored.revision, via: 'undo-legacy-watch' } })
      }
      // the ignore marker: this exact file version is never applied again
      if (file) repo.upsertFile({ ...file, lastResult: 'ignored', seenAt: at })
      repo.markActivityUndone(activityId, at)
      activity({ kind: 'undo', file: act.fileName, billId, party: act.party, po: act.poNumber, detail: `Undid ${act.kind === 'imported' ? 'the import of' : 'the update of'} ${act.poNumber} (${act.fileName}).` }, at)
      return { kind: act.kind as 'imported' | 'updated', billId, revision: head.revision + 1 }
    })
  }


  // ---- Phase 163: Needs review + Activity ------------------------------------------------------------------------------------------

  const toItem = (r: ReviewRow): ReviewItem => ({
    id: r.id, fileName: r.fileName, party: r.party, billDate: r.billDate, total: r.total, why: r.why, reason: r.reason, createdAt: r.createdAt,
    candidates: r.candidateIds.map((id) => { const h = bills.getHead(id); return { billId: id, poNumber: h?.poNumber ?? '', deleted: !h || h.deletedAt !== null } })
  })

  function reviewLists(): ReviewLists {
    return { open: repo.openReviewsLight().map(toItem), ignored: repo.ignoredReviewsLight().map(toItem) }
  }

  function activityItems(): ActivityItem[] {
    return repo.listActivity().map((a) => ({
      id: a.id, at: a.at, kind: a.kind, fileName: a.fileName, billId: a.billId, party: a.party, poNumber: a.poNumber, detail: a.detail,
      undone: a.undoneAt !== null, canUndo: a.undoneAt === null && (a.kind === 'imported' || a.kind === 'updated') && a.billId !== null && a.revision !== null
    }))
  }

  /** The file as the engine saw it when it filed the review item (the stored text, so this works after the file changed or moved). */
  const fileOfReview = (r: ReviewRow): WatchFile => {
    const prev = repo.getFile(r.fileName)
    return { name: r.fileName, text: r.payloadText, size: prev && prev.mtimeMs === r.mtimeMs ? prev.size : Buffer.byteLength(r.payloadText, 'utf8'), mtimeMs: r.mtimeMs }
  }

  async function resolveReview(id: string, action: ReviewAction, billId?: string): Promise<ResolveResult> {
    guard()
    const row = repo.getReview(id)
    if (!row) throw new AppError('NOT_FOUND', 'That review item was not found.')
    const at = () => now().toISOString()

    if (action === 'reopen') {
      if (!repo.reopenReview(id)) throw new AppError('VALIDATION', 'Only an ignored item can be put back.')
      repo.transaction(() => { const t = at(); const f = repo.getFile(row.fileName); if (f && f.mtimeMs === row.mtimeMs) repo.upsertFile({ ...f, lastResult: 'review', seenAt: t }); activity({ kind: 'review_reopened', file: row.fileName, billId: null, party: row.party, po: '', detail: `Put ${row.fileName} back on the Needs review list.` }, t) })
      return { action, message: 'Put back on the Needs review list.', billId: null }
    }
    if (row.resolvedAt !== null) throw new AppError('VALIDATION', 'That item was already resolved.')

    if (action === 'ignore') {
      return repo.transaction((): ResolveResult => {
        const t = at()
        repo.resolveReview(id, 'ignored', t)
        const f = repo.getFile(row.fileName)
        if (f && f.mtimeMs === row.mtimeMs) repo.upsertFile({ ...f, lastResult: 'ignored', seenAt: t })
        activity({ kind: 'review_ignored', file: row.fileName, billId: null, party: row.party, po: '', detail: `Ignored ${row.fileName}. It can be put back from the list.` }, t)
        return { action, message: 'Ignored. You can put it back from the list.', billId: null }
      })
    }

    const parsed = parseLegacyFile(row.payloadText, Buffer.byteLength(row.payloadText, 'utf8'))
    if (!parsed.ok) throw new AppError('VALIDATION', `The saved copy of this file cannot be read: ${parsed.error}`)
    const lb = parsed.bill
    const f = fileOfReview(row)
    const content = contentOfLegacy(lb)
    const hash = contentFingerprintOf(content)

    if (action === 'import_new') {
      const info = await deps.backup.create('pre-import')
      let batchId: string | null = null
      const out = repo.transaction(() => {
        const o = writeNew(f, lb, content, hash, at(), () => { batchId = ensureBatch(); return batchId }, true)
        repo.resolveReview(id, 'imported_new', at())
        return o
      })
      deps.log?.info('legacy watch review: imported as new', { backup: info.file })
      return { action, message: out.detail, billId: out.billId }
    }

    // replace: the owner chose which bill gets the file's content; the bill's earlier version stays in its history (new revision).
    const target = billId ?? (row.candidateIds.length === 1 ? row.candidateIds[0]! : undefined)
    if (!target) throw new AppError('VALIDATION', 'Choose which bill to replace.')
    if (!row.candidateIds.includes(target)) throw new AppError('VALIDATION', 'That bill is not one of the candidates for this file.')
    const head = bills.getHead(target)
    if (!head) throw new AppError('NOT_FOUND', 'That bill no longer exists.')
    if (head.deletedAt !== null) throw new AppError('VALIDATION', 'That bill is in Recently deleted. Restore it first, or choose Import as new bill.')
    const info = await deps.backup.create('pre-import')
    const out = repo.transaction((): FileOutcome => {
      const t = at()
      const old = storedBill(target)
      if (!old) throw new AppError('DB_ERROR', 'This bill\'s stored data is damaged.')
      const conv = convertLegacyBill(lb, target, old.branchId, t).bill
      const next: Bill = { ...conv, branchId: old.branchId, poSeq: old.poSeq, poNumber: old.poNumber, partyId: old.partyId, createdAt: old.createdAt, revision: old.revision + 1, updatedAt: t, roundOff: old.roundOff, syncState: old.syncState }
      const issue = validateBillForSave(next)
      if (issue) throw new AppError('VALIDATION', `The file cannot be saved as this bill: ${issue.message}`)
      const a = serializeBill(next)
      const b = serializeBill(old)
      if (JSON.stringify(a.rows) === JSON.stringify(b.rows) && a.bill.partySnapshotJson === b.bill.partySnapshotJson && a.bill.billDate === b.bill.billDate) throw new AppError('VALIDATION', `${old.poNumber} already has exactly this content. Choose Ignore.`)
      const o = commitUpdate(f, lb, hash, content, old, next, a, t)
      repo.resolveReview(id, 'replaced', t)
      return o
    })
    deps.log?.info('legacy watch review: replaced a bill', { backup: info.file })
    return { action, message: out.detail, billId: out.billId }
  }

  return { applyBatch, undo, listActivity: (limit) => repo.listActivity(limit), activityItems, reviewLists, reviewCount: () => repo.countOpenReviews(), resolveReview }
}
