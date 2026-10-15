import { randomUUID } from 'node:crypto'
import type { AuditInput } from '../../shared/audit'
import type { BillRepo } from '../db/billRepo'
import type { PartyRepo } from '../db/partyRepo'
import { allocatePoNumber, peekNextPoNumber } from '../db/poCounter'
import { getLocalBranch } from '../db/seed'
import { AppError } from '../ipc/envelope'
import { deserializeBill, serializeBill } from '../../shared/billModel'
import { prepareBillForSave, validateBillForSave } from '../../shared/billSave'
import { defaultFormatId, resolveFormat } from '../../shared/format/registry'
import { findPartyByName, isNewParty, normalizePartyName } from '../../shared/party/partyLite'
type SqliteHandle = Parameters<typeof getLocalBranch>[0]
import type { Bill, BillRow, ExtraColDef, FooterExtras, TailRow, IsoDate, IsoDateTime, PartySnapshot } from '../../shared/types'

/** What the renderer may send. Everything the server owns (branch, PO, revision, timestamps, party link) is absent on purpose. */
export interface SaveBillInput {
  bill: {
    id: string
    party: PartySnapshot
    formatId: string
    extraCols: ExtraColDef[]
    paperOverride: 'A4' | 'A5' | null
    billDate: IsoDate
    rows: BillRow[]
    footerExtras?: FooterExtras
    tailRows?: TailRow[]
  }
  expectedRevision?: number
}

export interface SaveBillResult {
  id: string
  poNumber: string
  poSeq: number
  revision: number
  partyId: string | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** Phase 77: the flag stamped on this save. */
  roundOff: 0 | 1
}

export interface NewDefaults {
  formatId: string
  billDate: IsoDate
  branchId: string
  nextPoPreview: string
}

/** Everything the outbox (Phase 54) needs; called inside the save / delete transaction. `op` defaults to `upsert`. */
export interface SavedInfo {
  billId: string
  revision: number
  created: boolean
  branchId: string
  op?: 'upsert' | 'delete'
}

export interface BillService {
  newDefaults(): NewDefaults
  save(input: SaveBillInput): SaveBillResult
  /** Phase 28: a saved bill for editing (not trashed). */
  getForEdit(id: string): Bill
  /** Phase 42: soft-delete (move to trash). Unknown / already-deleted ids are reported in `missing`, never an error. */
  delete(ids: string[]): { deleted: string[]; missing: string[] }
}

const localDate = (d: Date): IsoDate => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function createBillService(
  deps: { sqlite: SqliteHandle; bills: BillRepo; parties: PartyRepo },
  opts: {
    writable?: boolean; now?: () => Date; newId?: () => string; outbox?: (info: SavedInfo) => void; audit?: (a: AuditInput) => void
    /** Phase 137: the id of a customer this save creates (`partyRecordId(orgId, nameNorm)` once the shared notebook is on; random until then). */
    newPartyId?: (nameNorm: string) => string
    /** Phase 137: told (inside the save transaction) that a customer was created, so the sync outbox can queue its record. */
    partyCreated?: (partyId: string) => void
    /** Phase 77: the `calc.roundOff` setting at the moment of the save (read in main by the composition root). Absent = off. */
    roundOff?: () => boolean
    /** Phase 133: true when the bill is set aside because it needs a newer app (`sync_aside`); save and delete are then refused. */
    isAside?: (billId: string) => boolean
  } = {}
): BillService {
  const { sqlite, bills, parties } = deps
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomUUID
  const guard = (): void => {
    if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
  }
  const asideGuard = (id: string): void => {
    if (opts.isAside?.(id) === true) throw new AppError('RECORD_ASIDE', 'This bill was changed by a newer version of Quot3. Update the app to edit it.')
  }

  return {
    newDefaults() {
      const branch = getLocalBranch(sqlite)
      return { formatId: defaultFormatId(), billDate: localDate(now()), branchId: branch.id, nextPoPreview: peekNextPoNumber(sqlite, branch.id) }
    },

    getForEdit(id) {
      const head = bills.getHead(id)
      if (!head || head.deletedAt !== null) throw new AppError('NOT_FOUND', 'Bill not found')
      const parsed = deserializeBill(bills.getRecord(id), bills.getRows(id))
      if (!parsed.ok) throw new AppError('DB_ERROR', `This bill's stored data is damaged (${parsed.error})`)
      return parsed.data
    },

    delete(ids) {
      guard()
      for (const id of ids) asideGuard(id)
      const at = now().toISOString()
      const unique = [...new Set(ids)]
      return bills.transaction(() => {
        const deleted: string[] = []
        const missing: string[] = []
        for (const id of unique) {
          const head = bills.getHead(id)
          if (!head || head.deletedAt !== null || !bills.softDelete(id, at)) { missing.push(id); continue }
          deleted.push(id)
          opts.outbox?.({ billId: id, revision: head.revision + 1, created: false, branchId: head.branchId, op: 'delete' })
          opts.audit?.({ entity: 'bill', entityId: id, action: 'delete', detail: { poNumber: head.poNumber, revision: head.revision + 1 } })
        }
        return { deleted, missing }
      })
    },

    save(input) {
      guard()
      asideGuard(input.bill.id)
      const branch = getLocalBranch(sqlite)
      const at = now().toISOString()
      const b = input.bill

      // Server-owned fields are filled in below; the client's values for them never reach the database.
      const draft: Bill = {
        id: b.id, branchId: branch.id, poSeq: 0, poNumber: '', partyId: null,
        party: b.party, formatId: b.formatId, extraCols: b.extraCols, paperOverride: b.paperOverride, billDate: b.billDate,
        rows: b.rows, revision: 1, createdAt: at, updatedAt: at, deletedAt: null, syncState: 'local_only',
        // Phase 77: the flag is the setting at save time (old bills keep 0 until they are re-saved); the client's value never counts.
        roundOff: opts.roundOff?.() === true ? 1 : 0,
        // Phase 79: free cells come from the client; `prepareBillForSave` (normalizeBill) cleans them and trims the tail rows.
        ...(b.footerExtras ? { footerExtras: b.footerExtras } : {}),
        ...(b.tailRows ? { tailRows: b.tailRows } : {})
      }
      const prepared = prepareBillForSave(draft)
      const issue = validateBillForSave(prepared)
      if (issue) throw new AppError('VALIDATION', issue.message)

      return bills.transaction((): SaveBillResult => {
        const head = bills.getHead(prepared.id)
        let poSeq: number
        let poNumber: string
        let revision: number
        let createdAt: string
        if (head) {
          if (head.deletedAt !== null) throw new AppError('NOT_FOUND', 'This bill is in the trash')
          if (input.expectedRevision !== undefined && input.expectedRevision !== head.revision) {
            throw new AppError('CONFLICT_REVISION', 'This bill was changed since you opened it')
          }
          poSeq = head.poSeq
          poNumber = head.poNumber
          revision = head.revision + 1
          createdAt = head.createdAt
        } else {
          const po = allocatePoNumber(sqlite, branch.id)
          poSeq = po.seq
          poNumber = po.poNumber
          revision = 1
          createdAt = at
        }

        // Party: a name nobody has saved yet becomes a party exactly once; a known name is only linked (never modified).
        const existing = parties.list()
        let partyId: string | null
        if (resolveFormat(prepared.formatId).partyMode === 'branch') {
          // Phase 149: a Stock transfer's "party" is a branch name; no party record is created or linked for it.
          partyId = null
        } else if (isNewParty(prepared.party.name, existing)) {
          partyId = opts.newPartyId ? opts.newPartyId(normalizePartyName(prepared.party.name)) : newId()
          const p = prepared.party
          parties.insert(
            {
              id: partyId, name: p.name, nameNorm: normalizePartyName(p.name),
              phone: p.phone === '' ? null : p.phone, address: p.address === '' ? null : p.address, transport: p.transport === '' ? null : p.transport, at
            },
            'auto'
          )
          opts.partyCreated?.(partyId)
        } else {
          const found = findPartyByName(existing, prepared.party.name) as { id: string; phone: string; address: string; transport: string }
          partyId = found.id
          // 0.1.11: phone / transport / address typed or changed on the bill also update the customer (never the name; a blank never wipes
          // a saved value). No versioning: the customer row just carries the newest values.
          const p = prepared.party
          const pick = (typed: string, saved: string): string => (typed.trim() !== '' ? typed.trim() : saved)
          const phone = pick(p.phone, found.phone)
          const address = pick(p.address, found.address)
          const transport = pick(p.transport, found.transport)
          if (phone !== found.phone || address !== found.address || transport !== found.transport) {
            parties.setFields(found.id, { phone: phone === '' ? null : phone, address: address === '' ? null : address, transport: transport === '' ? null : transport }, at)
            opts.partyCreated?.(found.id) // hands the changed customer to the same sync hook a new one uses
          }
        }

        const final: Bill = { ...prepared, branchId: head ? head.branchId : branch.id, poSeq, poNumber, partyId, revision, createdAt, updatedAt: at }
        const { bill: record, rows } = serializeBill(final)
        if (head) bills.updateBill(record)
        else bills.insertBill(record)
        bills.replaceRows(record.id, rows)
        bills.insertRevision({
          id: newId(), billId: record.id, revision, snapshotJson: JSON.stringify({ bill: record, rows }), savedAt: at, savedByBranch: branch.id
        })
        bills.pruneRevisions(record.id)
        opts.outbox?.({ billId: record.id, revision, created: !head, branchId: record.branchId })
        opts.audit?.({ entity: 'bill', entityId: record.id, action: head ? 'edit' : 'create', detail: { poNumber, revision, partyName: prepared.party.name, rows: rows.length } })
        return { id: record.id, poNumber, poSeq, revision, partyId, createdAt, updatedAt: at, roundOff: final.roundOff === 1 ? 1 : 0 }
      })
    }
  }
}
