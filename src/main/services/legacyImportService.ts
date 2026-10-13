import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AuditInput } from '../../shared/audit'
import { serializeBill } from '../../shared/billModel'
import { validateBillForSave } from '../../shared/billSave'
import {
  MAX_FILES, MAX_FILE_BYTES, planLegacyImport, uuidFromText,
  type ClashChoice, type ImportPlan, type ImportReport, type LegacyFileInput
} from '../../shared/legacyImport'
import { normalizePartyName } from '../../shared/party/partyLite'
import type { BackupInfo } from '../../shared/backup/backupRules'
import type { BillRepo } from '../db/billRepo'
import type { BatchRow, LegacyImportRepo, UndoSummary } from '../db/legacyImportRepo'
import { getLocalBranch } from '../db/seed'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import type { SavedInfo } from './billService'

type SqliteHandle = Parameters<typeof getLocalBranch>[0]

/**
 * Phase 85 - the legacy-bill import service (LEGACY_IMPORT_SPEC sections 3-8, 10). Main process only; no IPC and no UI yet
 * (Phase 86 adds both: the renderer will only ever hold an opaque `sourceId`, the path is chosen in main).
 *
 *   readSource  folder / .json files -> file texts (tolerant, limits, never throws for a bad file)
 *   preview     plan against what this database already has; writes NOTHING
 *   commit      plan -> `pre-import` backup -> ONE transaction (parties, bills, rows, revision 1, tags, PO counter, audit) -> report file
 *   undo        the batch's untouched bills go to Recently deleted; importer-made parties with no other bills are removed
 *
 * On commit the imported bills are bulk-enqueued in the same transaction (Phase 88, `outboxMany`, skipped when `send` is false); `undo` calls the same `outbox` hook as a normal delete.
 */
export type LegacySource = { kind: 'folder'; path: string } | { kind: 'files'; paths: string[] }

export interface ReadProgress { done: number; total: number }

export interface LegacyPreview {
  sourceLabel: string
  poPrefix: string
  report: ImportReport
  /** False when there is nothing to import (everything skipped / errors). */
  canImport: boolean
}

export interface LegacyCommitResult {
  /** null when nothing needed importing (no backup, no batch row). */
  batchId: string | null
  sourceLabel: string
  poPrefix: string
  report: ImportReport
  backupFile: string | null
  reportFile: string | null
}

export interface LegacyImportService {
  readSource(source: LegacySource, run?: RunOptions): Promise<{ files: LegacyFileInput[]; label: string }>
  preview(source: LegacySource, choices?: Readonly<Record<string, ClashChoice>>, run?: RunOptions): Promise<LegacyPreview>
  commit(source: LegacySource, choices?: Readonly<Record<string, ClashChoice>>, run?: RunOptions, send?: boolean): Promise<LegacyCommitResult>
  listBatches(): BatchRow[]
  /** Phase 86: the old-app reference and batch of a bill (null for a bill made here). */
  billTag(billId: string): { legacyRef: string; importBatchId: string } | null
  undo(batchId: string): UndoSummary
}

export interface RunOptions {
  /** Cancel is honoured until the transaction starts. */
  signal?: AbortSignal
  onProgress?: (p: ReadProgress) => void
}

export interface LegacyImportDeps {
  sqlite: SqliteHandle
  repo: LegacyImportRepo
  bills: BillRepo
  /** The `pre-import` safety backup, taken before anything is written. */
  backup: { create(kind: 'pre-import'): Promise<BackupInfo> }
  /** `%LOCALAPPDATA%\Quot3\logs`: the report is saved there as `import-<timestamp>.json`. Absent = no report file. */
  logsDir?: string
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface LegacyImportOpts {
  writable?: boolean
  now?: () => Date
  newId?: () => string
  audit?: (a: AuditInput) => void
  /** Called for each bill soft-deleted by `undo`, inside its transaction (the same hook shape `billService.delete` uses). */
  outbox?: (info: SavedInfo) => void
  /** Phase 88: bulk enqueue of the imported bills, called inside the import transaction (no-op while sync is off). */
  outboxMany?: (changes: { billId: string; revision: number; op: 'upsert' }[]) => void
}

const CHUNK = 64
const BOM = 0xfeff

const cancelled = (): AppError => new AppError('VALIDATION', 'The import was cancelled. Nothing was changed.')

export function createLegacyImportService(deps: LegacyImportDeps, opts: LegacyImportOpts = {}): LegacyImportService {
  const { sqlite, repo, bills } = deps
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomUUID
  const guard = (): void => {
    if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
  }
  const throwIfAborted = (run?: RunOptions): void => { if (run?.signal?.aborted) throw cancelled() }

  async function readSource(source: LegacySource, run?: RunOptions): Promise<{ files: LegacyFileInput[]; label: string }> {
    let names: Array<{ name: string; path: string }>
    let label: string
    if (source.kind === 'folder') {
      let entries
      try { entries = await readdir(source.path, { withFileTypes: true }) } catch { throw new AppError('IO_ERROR', 'That folder could not be opened.') }
      names = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json')).map((e) => ({ name: e.name, path: join(source.path, e.name) }))
      label = basename(source.path) || 'folder'
    } else {
      const seen = new Set<string>()
      names = []
      for (const p of source.paths) {
        if (!p.toLowerCase().endsWith('.json') || seen.has(p)) continue
        seen.add(p)
        names.push({ name: basename(p), path: p })
      }
      label = `${names.length} file${names.length === 1 ? '' : 's'}`
    }
    if (names.length > MAX_FILES) {
      throw new AppError('VALIDATION', `That folder has ${names.length} .json files; the limit is ${MAX_FILES}. Split it into smaller folders.`)
    }
    names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    const files: LegacyFileInput[] = []
    for (let i = 0; i < names.length; i += CHUNK) {
      throwIfAborted(run)
      const part = await Promise.all(
        names.slice(i, i + CHUNK).map(async ({ name, path }): Promise<LegacyFileInput> => {
          try {
            const size = (await stat(path)).size
            // Over the size limit: not read at all; the planner turns `bytes` into an error row for that file.
            if (size > MAX_FILE_BYTES) return { name, text: '', bytes: size }
            let text = await readFile(path, 'utf8')
            if (text.charCodeAt(0) === BOM) text = text.slice(1)
            return { name, text, bytes: size }
          } catch {
            return { name, text: '', bytes: 0 } // unreadable: an error row ("not valid JSON"), never a crash
          }
        })
      )
      files.push(...part)
      run?.onProgress?.({ done: Math.min(i + CHUNK, names.length), total: names.length })
    }
    return { files, label }
  }

  /**
   * The plan, minus any bill the normal save rules would refuse (no usable row): those become error rows so the transaction
   * can never fail on validation half-way. Parties no remaining bill needs are dropped from the plan.
   */
  function buildPlan(files: readonly LegacyFileInput[], choices: Readonly<Record<string, ClashChoice>> | undefined, at: string): { plan: ImportPlan; poPrefix: string; branchId: string } {
    const branch = getLocalBranch(sqlite)
    const plan = planLegacyImport({
      files, poPrefix: branch.poPrefix, branchId: branch.id, existing: repo.existingState(branch.id), now: at,
      ...(choices ? { choices } : {})
    })
    const keep = plan.bills.filter((b) => {
      const issue = validateBillForSave(b.bill)
      if (!issue) return true
      plan.report.errors.push({ file: b.file, error: issue.message })
      return false
    })
    if (keep.length !== plan.bills.length) {
      plan.bills = keep
      plan.report.created = keep.length
      const needed = new Map<string, number>()
      for (const b of keep) if (b.bill.partyId) needed.set(b.bill.partyId, (needed.get(b.bill.partyId) ?? 0) + 1)
      plan.newParties = plan.newParties.filter((p) => needed.has(p.id)).map((p) => ({ ...p, billCount: needed.get(p.id) ?? 0 }))
      plan.report.newParties = plan.newParties.length
    }
    return { plan, poPrefix: branch.poPrefix, branchId: branch.id }
  }

  const stamp = (d: Date): string => d.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')

  function writeReportFile(batchId: string, at: Date, label: string, poPrefix: string, report: ImportReport): string | null {
    if (!deps.logsDir) return null
    try {
      mkdirSync(deps.logsDir, { recursive: true })
      const file = `import-${stamp(at)}.json`
      writeFileSync(join(deps.logsDir, file), JSON.stringify({ batchId, at: at.toISOString(), sourceLabel: label, poPrefix, report }, null, 2), 'utf8')
      return file
    } catch (err) {
      deps.log?.warn('import report file not written', { err })
      return null
    }
  }

  return {
    readSource,

    async preview(source, choices, run) {
      const { files, label } = await readSource(source, run)
      throwIfAborted(run)
      const { plan, poPrefix } = buildPlan(files, choices, now().toISOString())
      return { sourceLabel: label, poPrefix, report: plan.report, canImport: plan.bills.length > 0 }
    },

    async commit(source, choices, run, send = true) {
      guard()
      const { files, label } = await readSource(source, run)
      throwIfAborted(run)
      const first = buildPlan(files, choices, now().toISOString())
      if (first.plan.bills.length === 0) {
        return { batchId: null, sourceLabel: label, poPrefix: first.poPrefix, report: first.plan.report, backupFile: null, reportFile: null }
      }

      // Safety first: a pre-import backup of the live database. If this fails nothing has been written.
      const backup = await deps.backup.create('pre-import')
      throwIfAborted(run)

      const at = now()
      const atIso = at.toISOString()
      const batchId = newId()
      let result: { plan: ImportPlan; poPrefix: string; branchId: string } | null
      try {
        result = repo.transaction(() => {
          // Re-plan inside the write lock with fresh knowledge of the database (a sync pull may have landed since the preview).
          const { plan, poPrefix, branchId } = buildPlan(files, choices, atIso)
          if (plan.bills.length === 0) return null

          const partyIds = plan.newParties.map((p) => p.id)
          repo.insertBatch({
            id: batchId, at: atIso, sourceLabel: label, branchId, poPrefix, filesFound: plan.report.filesFound, created: plan.bills.length,
            skipped: plan.report.skipped.length, errors: plan.report.errors.length, newParties: plan.newParties.length,
            poFirst: plan.report.poFirst, poLast: plan.report.poLast, nextSeqAfter: plan.report.nextSeqAfter, partyIds
          })
          for (const p of plan.newParties) {
            repo.upsertParty(
              {
                id: p.id, name: p.name, nameNorm: normalizePartyName(p.name),
                phone: p.phone === '' ? null : p.phone, address: p.address === '' ? null : p.address, transport: p.transport === '' ? null : p.transport
              },
              atIso
            )
          }
          for (const b of plan.bills) {
            const { bill: record, rows } = serializeBill(b.bill)
            bills.insertBill(record)
            bills.replaceRows(record.id, rows)
            bills.insertRevision({
              id: uuidFromText(`${record.id}|rev|${record.revision}`), billId: record.id, revision: record.revision,
              snapshotJson: JSON.stringify({ bill: record, rows }), savedAt: atIso, savedByBranch: branchId
            })
            repo.tagBill(record.id, { legacyRef: b.legacyRef, batchId, fingerprint: b.fingerprint })
            opts.audit?.({
              entity: 'bill', entityId: record.id, action: 'import',
              detail: { poNumber: record.poNumber, legacyRef: b.legacyRef, batchId, partyName: b.bill.party.name, rows: rows.length }
            })
          }
          // Phase 88: the whole batch joins the outbox in this same transaction (all or nothing), unless the owner switched sending off.
          if (send) opts.outboxMany?.(plan.bills.map((b) => ({ billId: b.bill.id, revision: 1, op: 'upsert' as const })))
          repo.bumpCounter(branchId, plan.report.nextSeqAfter)
          opts.audit?.({
            entity: 'import_batch', entityId: batchId, action: 'import',
            detail: { created: plan.bills.length, skipped: plan.report.skipped.length, errors: plan.report.errors.length, newParties: plan.newParties.length, source: label }
          })
          return { plan, poPrefix, branchId }
        })
      } catch (err) {
        if (err instanceof AppError) throw err
        deps.log?.error('legacy import rolled back', { err })
        throw new AppError('DB_ERROR', `The import failed and was rolled back; nothing was changed. (${err instanceof Error ? err.message : 'unknown error'})`)
      }
      if (!result) {
        const again = buildPlan(files, choices, atIso)
        return { batchId: null, sourceLabel: label, poPrefix: again.poPrefix, report: again.plan.report, backupFile: backup.file, reportFile: null }
      }

      const reportFile = writeReportFile(batchId, at, label, result.poPrefix, result.plan.report)
      if (reportFile) repo.setReportFile(batchId, reportFile)
      deps.log?.info('legacy import done', { batchId, created: result.plan.bills.length, backup: backup.file })
      return { batchId, sourceLabel: label, poPrefix: result.poPrefix, report: result.plan.report, backupFile: backup.file, reportFile }
    },

    listBatches: () => repo.listBatches(),
    billTag: (billId) => repo.billTag(billId),

    undo(batchId) {
      guard()
      const batch = repo.getBatch(batchId)
      if (!batch) throw new AppError('NOT_FOUND', 'That import was not found.')
      if (batch.undoneAt !== null) throw new AppError('VALIDATION', 'That import has already been undone.')
      const at = now().toISOString()
      return repo.transaction((): UndoSummary => {
        const summary: UndoSummary = { deleted: 0, keptEdited: [], alreadyDeleted: 0, partiesRemoved: 0 }
        for (const b of repo.batchBills(batchId)) {
          if (b.deletedAt !== null) { summary.alreadyDeleted++; continue }
          // Only bills nobody has touched since the import (revision still 1); an edited bill is kept and listed.
          if (b.revision !== 1) { summary.keptEdited.push({ id: b.id, poNumber: b.poNumber }); continue }
          if (!bills.softDelete(b.id, at)) continue
          summary.deleted++
          opts.outbox?.({ billId: b.id, revision: b.revision + 1, created: false, branchId: b.branchId, op: 'delete' })
          opts.audit?.({ entity: 'bill', entityId: b.id, action: 'delete', detail: { poNumber: b.poNumber, revision: b.revision + 1, via: 'undo-import', batchId } })
        }
        // Parties the batch created that no live bill uses any more. The PO counter is never lowered.
        for (const pid of batch.partyIds) if (repo.dropPartyIfUnused(pid, at)) summary.partiesRemoved++
        repo.markUndone(batchId, at, summary)
        opts.audit?.({ entity: 'import_batch', entityId: batchId, action: 'undo', detail: { ...summary } })
        return summary
      })
    }
  }
}
