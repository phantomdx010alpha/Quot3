import { txDone, type PhoneDb, type StoreName } from './db'

/** "Reset phone data" (Phase 185). Erases the bills, customers, drafts and the sync bookkeeping on THIS phone only.
 *  Kept on purpose: settings (company, share defaults, theme, the sign-in vault and the app-lock PIN) and the branch link
 *  INCLUDING `po_counter`, so a PO number this phone already issued is never issued again. The sync cursor is cleared,
 *  so a linked phone loads the notebook again from the server. Unsent changes are lost (the screen says so). One transaction: all or nothing. */
export const RESET_STORES = ['bills', 'bill_rows', 'bill_revisions', 'parties', 'drafts', 'sync_record_state', 'sync_outbox', 'sync_aside'] as const satisfies readonly StoreName[]

export async function resetPhoneData(db: PhoneDb): Promise<void> {
  db.assertWritable()
  const tx = db.idb.transaction([...RESET_STORES, 'meta'], 'readwrite')
  const done = txDone(tx)
  done.catch(() => undefined)
  try {
    for (const name of RESET_STORES) tx.objectStore(name).clear()
    tx.objectStore('meta').put({ key: 'server_seq', value: null })
  } catch (e) {
    try { tx.abort() } catch { /* already finished */ }
    await done.catch(() => undefined)
    throw e
  }
  await done
}
