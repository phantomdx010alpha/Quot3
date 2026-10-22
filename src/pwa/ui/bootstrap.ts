import { openPhoneDb, PhoneDbError, type PhoneDb } from '../data/db'
import { ensureMeta } from '../data/metaRepo'
import { getSetting } from '../data/settingsRepo'
import { createAppLock } from '../sync/appLock'
import { requestPersistence } from '../platform/storage'
import { createPhoneSyncRuntime } from '../sync/runtime'
import { acquireWriterLock, browserWriterEnv } from '../platform/writerLock'
import type { AppServices } from './services'
import { DEFAULT_THEME, isThemeName, type ThemeName } from './themes'
import { resolveLayout } from './layouts/layoutRegistry'
import { schedulePartyPrebuild } from './kit/partyPrebuild'

/** Opens the phone database for the real app: single-writer lock, database, first-run meta, persistence request, saved theme.
 *  Never throws: a failure becomes `services.error` and the Dashboard shows it. Only the browser calls this (tests build `AppServices` by hand). */
let booting: Promise<AppServices> | null = null
/** Start-up runs ONCE per page: a second call (React StrictMode runs effects twice in development) gets the same result. A second run would ask
 *  for the single-writer lock again, be refused because this very page already holds it, and leave the page read-only (Save buttons greyed). */
export function bootstrapServices(): Promise<AppServices> {
  booting ??= startServices()
  return booting
}

async function startServices(): Promise<AppServices> {
  try {
    const lock = await acquireWriterLock(browserWriterEnv())
    const db: PhoneDb = await openPhoneDb({ writer: lock })
    await ensureMeta(db, new Date())
    if (db.canWrite() && typeof navigator !== 'undefined') await requestPersistence(navigator)
    const savedTheme = await getSetting(db, 'theme.name')
    const theme: ThemeName = isThemeName(savedTheme) ? savedTheme : DEFAULT_THEME
    const layout = resolveLayout(await getSetting(db, 'ui.layout'))
    schedulePartyPrebuild(db, layout) // Phase 191 [A]: new layouts only (idle moment); classic does nothing
    const startLocked = await createAppLock(db).isEnabled().catch(() => false)
    // Phase 187b: the real sync. The runtime only starts workers in the writer tab (engine.start checks db.canWrite()).
    const version = typeof __QUOT3_APP_VERSION__ === 'string' ? __QUOT3_APP_VERSION__ : 'unknown'
    const runtime = createPhoneSyncRuntime({ db, appVer: version })
    void runtime.init()
    return {
      db, theme, layout, startLocked,
      engine: runtime.engine, syncEngine: runtime.engine,
      sync: { link: (i) => runtime.link(i), signOut: () => runtime.signOut() },
      onDataChanged: () => runtime.notifySaved()
    }
  } catch (e) {
    const msg = e instanceof PhoneDbError ? e.message : `Could not start: ${e instanceof Error ? e.message : String(e)}`
    return { db: null, error: msg, engine: null }
  }
}
