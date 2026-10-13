import { randomUUID } from 'node:crypto'
import type { PartyRepo } from '../db/partyRepo'
import type { PartyImportRepo } from '../db/partyImportRepo'
import type { SheetReader } from '../import/excelSheetReader'
import {
  IMPORT_DETAIL_MAX, IMPORT_FIELDS, IMPORT_SAMPLE_ROWS, autoDetectMapping, detectHeaderRow, planImport, summarizePlan,
  type ColumnMapping, type ImportMode, type PartyImportPreview, type PartyImportReport, type PartyImportSummary, type PartyImportUndoResult
} from '../../shared/partyImport/partyImport'
import { normalizePartyName } from '../../shared/party/partyLite'
import { AppError } from '../ipc/envelope'

export interface PartyImportSource { filePath: string; sheet?: string; headerRow?: number }
export interface PreviewInput extends PartyImportSource { mapping?: ColumnMapping; mode?: ImportMode }
export interface CommitInput extends PartyImportSource { mapping: ColumnMapping; mode: ImportMode }

export interface PartyImportService {
  preview(input: PreviewInput): Promise<PartyImportPreview>
  commit(input: CommitInput): Promise<PartyImportReport>
  undo(importId: string): PartyImportUndoResult
  list(): PartyImportSummary[]
}

export interface PartyImportDeps { parties: PartyRepo; imports: PartyImportRepo; reader: SheetReader; branchId?: () => string | null }

interface BeforeValues { id: string; name: string; phone: string; address: string; transport: string; at: string }
const LIST_MAX = 20
const nullIfBlank = (s: string): string | null => (s === '' ? null : s)

/** Phase 47 - import parties from the owner's Excel. Preview and commit both re-read the file in main. */
export function createPartyImportService(
  { parties, imports, reader, branchId }: PartyImportDeps,
  opts: { writable?: boolean; now?: () => Date; newId?: () => string } = {}
): PartyImportService {
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomUUID
  const guard = (): void => {
    if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
  }
  const audit = (action: string, id: string, detail: Record<string, unknown>): void => {
    imports.audit({ at: now().toISOString(), branchId: branchId?.() ?? null, entity: 'party_import', entityId: id, action, detailJson: JSON.stringify(detail) })
  }

  async function load(src: PartyImportSource) {
    const data = await reader.read(src.filePath, src.sheet)
    const headerRow = src.headerRow !== undefined ? Math.min(Math.max(1, Math.floor(src.headerRow)), Math.max(1, data.rows.length)) : detectHeaderRow(data.rows)
    const headers = data.rows[headerRow - 1] ?? []
    const body = data.rows.slice(headerRow)
    return { data, headerRow, headers, body }
  }
  const checkMapping = (m: ColumnMapping, width: number): void => {
    if (m.name === null) throw new AppError('VALIDATION', 'Choose which column holds the party name')
    const used = IMPORT_FIELDS.map((f) => m[f]).filter((c): c is number => c !== null)
    if (used.some((c) => !Number.isInteger(c) || c < 0 || c >= Math.max(width, 1))) throw new AppError('VALIDATION', 'A chosen column does not exist in this sheet')
    if (new Set(used).size !== used.length) throw new AppError('VALIDATION', 'Each column can be used for one field only')
  }

  return {
    async preview(input) {
      const { data, headerRow, headers, body } = await load(input)
      const mapping = input.mapping ?? autoDetectMapping(headers)
      if (input.mapping) checkMapping(mapping, headers.length)
      const plan = mapping.name === null ? [] : planImport({ rows: body, firstRowNumber: headerRow + 1, mapping, existing: parties.list(), mode: input.mode ?? 'skip' })
      return {
        fileName: data.fileName, sheets: data.sheets, sheet: data.sheet, headerRow, headers, mapping,
        sample: body.slice(0, IMPORT_SAMPLE_ROWS), totalRows: body.length, summary: summarizePlan(plan),
        rows: plan.filter((r) => r.status !== 'blank').slice(0, IMPORT_SAMPLE_ROWS)
      }
    },

    async commit(input) {
      guard()
      const { data, headerRow, headers, body } = await load(input)
      checkMapping(input.mapping, headers.length)
      const at = now().toISOString()
      const importId = newId()
      return parties.transaction(() => {
        const plan = planImport({ rows: body, firstRowNumber: headerRow + 1, mapping: input.mapping, existing: parties.list(), mode: input.mode })
        const before: BeforeValues[] = []
        let created = 0
        let updated = 0
        for (const r of plan) {
          if (r.status === 'new') {
            // a party created by a manual save in the meantime is not possible inside this transaction; guard the unique-name rule anyway
            if (parties.findByNorm(normalizePartyName(r.name))) continue
            imports.insertParty({ id: newId(), name: r.name, nameNorm: normalizePartyName(r.name), phone: nullIfBlank(r.phone), address: nullIfBlank(r.address), transport: nullIfBlank(r.transport), importId, at })
            created++
          } else if (r.status === 'update' && r.targetId) {
            const cur = parties.get(r.targetId)
            if (!cur) continue
            before.push({ id: cur.id, name: cur.name, phone: cur.phone, address: cur.address, transport: cur.transport, at })
            const has = (f: 'name' | 'phone' | 'address' | 'transport'): boolean => r.changes?.includes(f) ?? false
            const name = has('name') ? r.name : cur.name
            parties.update({
              id: cur.id, name, nameNorm: normalizePartyName(name),
              phone: nullIfBlank(has('phone') ? r.phone : cur.phone), address: nullIfBlank(has('address') ? r.address : cur.address),
              transport: nullIfBlank(has('transport') ? r.transport : cur.transport), at
            })
            updated++
          }
        }
        const s = summarizePlan(plan)
        const skipped = s.duplicate + s.repeated
        imports.insertBatch({ id: importId, at, fileName: data.fileName, created, updated, skipped, invalid: s.invalid, beforeJson: JSON.stringify(before) })
        audit('import', importId, { file: data.fileName, created, updated, skipped, invalid: s.invalid })
        return { importId, created, updated, skipped, invalid: s.invalid, details: plan.filter((r) => r.status !== 'blank').slice(0, IMPORT_DETAIL_MAX) }
      })
    },

    undo(importId) {
      guard()
      return parties.transaction(() => {
        const batch = imports.getBatch(importId)
        if (!batch || batch.undoneAt) throw new AppError('NOT_FOUND', 'That import was not found or was already undone')
        const at = now().toISOString()
        let removed = 0
        let restored = 0
        let kept = 0
        for (const p of imports.importedParties(importId)) {
          if (p.deletedAt) continue
          if (p.updatedAt !== batch.at) { kept++; continue } // edited since the import: leave the owner's work alone
          if (imports.softDeleteParty(p.id, at)) removed++
        }
        let before: BeforeValues[] = []
        try { before = JSON.parse(batch.beforeJson) as BeforeValues[] } catch { before = [] }
        for (const b of before) {
          const cur = parties.get(b.id)
          if (!cur) { kept++; continue }
          if (imports.updatedAtOf(b.id) !== batch.at) { kept++; continue } // edited again after the import
          const other = parties.findByNormExcept(normalizePartyName(b.name), b.id)
          if (other) { kept++; continue }
          parties.update({ id: b.id, name: b.name, nameNorm: normalizePartyName(b.name), phone: nullIfBlank(b.phone), address: nullIfBlank(b.address), transport: nullIfBlank(b.transport), at })
          restored++
        }
        imports.markUndone(importId, at)
        audit('undo', importId, { removed, restored, kept })
        return { removed, restored, kept }
      })
    },

    list() {
      return imports.listBatches(LIST_MAX).map((b) => ({ id: b.id, at: b.at, fileName: b.fileName, created: b.created, updated: b.updated, skipped: b.skipped, invalid: b.invalid, undone: b.undoneAt !== null }))
    }
  }
}
