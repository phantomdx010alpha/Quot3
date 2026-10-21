import { openPhoneDb, PhoneDbError, type PhoneDb } from '../data/db'
import { ensureMeta } from '../data/metaRepo'
import { getSetting } from '../data/settingsRepo'
import { createAppLock } from '../sync/appLock'
import { requestPersistence } from '../platform/storage'
import { acquireWriterLock, browserWriterEnv } from '../platform/writerLock'
import type { AppServices, ThemeName } from './services'

/** Opens the phone database for the real app: single-writer lock, database, first-run meta, persistence request, saved theme.
 *  Never throws: a failure becomes `services.error` and the Dashboard shows it. Only the browser calls this (tests build `AppServices` by hand). */
export async function bootstrapServices(): Promise<AppServices> {
  try {
    const lock = await acquireWriterLock(browserWriterEnv())
    const db: PhoneDb = await openPhoneDb({ writer: lock })
    await ensureMeta(db, new Date())
    if (db.canWrite() && typeof navigator !== 'undefined') await requestPersistence(navigator)
    const theme: ThemeName = (await getSetting(db, 'theme.name')) === 'light' ? 'light' : 'navy-ember'
    const startLocked = await createAppLock(db).isEnabled().catch(() => false)
    return { db, theme, engine: null, sync: null, startLocked }
  } catch (e) {
    const msg = e instanceof PhoneDbError ? e.message : `Could not start: ${e instanceof Error ? e.message : String(e)}`
    return { db: null, error: msg, engine: null }
  }
}
