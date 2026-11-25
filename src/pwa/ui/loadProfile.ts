import { getAllRecords, type PhoneDb } from '../data/db'
import { getMeta } from '../data/metaRepo'
import { readPayments } from '../data/paymentsRepo'
import { readCachedPerms, rightsFor } from '../data/priceRights'
import { listBillHeads } from '../data/billsRepo'
import { getSeatRightsSnapshot, readCachedSeatRights, type SeatRightsSnapshot } from '../data/seatRights'
import { getSetting } from '../data/settingsRepo'
import { readStorageHealth, type StorageEnv } from '../platform/storage'
import { effectiveCompany } from '../sync/companyProfile'
import type { EngineStatus } from '../sync/engine'
import { readSelfCheck } from '../sync/selfCheck'
import type { ProfileInput } from './profileModel'

/** The slice of the sync engine the Profile page reads (the same shape the Dashboard uses). */
export interface ProfileEngine { status(): Promise<EngineStatus> }

const live = (r: { deletedAt?: string | null }): boolean => r.deletedAt === null || r.deletedAt === undefined

/** Phase 295: reads what the phone already holds and returns the model input. READ ONLY (safe in a read-only tab). Every part is
 *  read on its own, so one damaged row only turns that part into \"Not set up\"; nothing here throws. No network. */
export async function loadProfileInput(
  db: PhoneDb, o: { version: string; engine?: ProfileEngine | null; storageEnv?: StorageEnv; rights?: SeatRightsSnapshot }
): Promise<ProfileInput> {
  const rights = o.rights ?? getSeatRightsSnapshot()
  const meta = await getMeta(db).catch(() => null)
  const linked = meta !== null && meta.org_id !== null
  const [cachedSeat, cachedPerms, bills, parties, priceRows, selfCheck, company, master, payments, storage] = await Promise.all([
    readCachedSeatRights(db).catch(() => null),
    readCachedPerms(db).catch(() => null),
    listBillHeads(db).then((h) => h.length).catch(() => null),
    getAllRecords<{ deletedAt?: string | null; mergedInto?: string | null }>(db, 'parties').then((r) => r.filter((p) => live(p) && !p.mergedInto).length).catch(() => null),
    getAllRecords<{ deletedAt?: string | null }>(db, 'price_rows').then((r) => r.filter(live).length).catch(() => null),
    readSelfCheck(db),
    effectiveCompany(db).catch(() => null),
    getSetting(db, 'company.master').catch(() => null),
    readPayments(db),
    readStorageHealth(o.storageEnv ?? (typeof navigator !== 'undefined' ? (navigator as unknown as StorageEnv) : {})).catch(() => null)
  ])
  let engine: ProfileInput['engine'] = null
  if (o.engine) {
    try {
      const s = await o.engine.status()
      engine = { lastSuccessAt: s.pull.lastSuccessAt ?? s.push.lastSuccessAt ?? null, pending: s.outbox.pending, failed: s.outbox.failed }
    } catch { engine = null }
  }
  const masterName = master && master.name.trim() !== ''
  const def = payments.list.accounts.find((a) => a.id === payments.list.defaultId)
  return {
    version: o.version,
    meta: { branchName: meta?.branch_name ?? null, poPrefix: meta?.po_prefix ?? null, linked, lastExportAt: meta?.last_export_at ?? null },
    seat: { seatNo: cachedSeat?.seatNo ?? cachedPerms?.seatNo ?? null, flags: rights.flags, source: rights.source, checkedAt: rights.checkedAt },
    priceFlags: linked ? rightsFor(linked, cachedPerms) : null,
    counts: bills === null || parties === null || priceRows === null ? null : { bills, customers: parties, priceRows },
    storage,
    selfCheck,
    engine,
    company: company ? { name: company.name, hasPhone: company.phone.trim() !== '', hasAddress: company.address.trim() !== '', hasLogo: Boolean(company.logoDataUrl), fromCompanyDefault: Boolean(masterName) } : null,
    companyDefaultVersion: master ? master.version : null,
    payments: { stored: payments.stored, count: payments.list.accounts.length, defaultName: def?.name ?? '', version: payments.list.version, unpublished: payments.unpublished },
    writable: db.canWrite()
  }
}
