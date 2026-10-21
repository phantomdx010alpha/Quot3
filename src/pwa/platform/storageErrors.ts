/** Phase 186 - plain-words text for a browser storage failure (full disk, quota, storage cleared). Pure; the screens decide where to show it. */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const x = e as { name?: unknown; code?: unknown; message?: unknown }
  if (x.name === 'QuotaExceededError' || x.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true
  if (x.code === 22 || x.code === 1014) return true
  return typeof x.message === 'string' && /quota|storage is full|disk is full/i.test(x.message)
}

/** Message for a failed save. Quota gets its own advice (nothing was saved; export a backup, free space); anything else keeps the original text. */
export function describeSaveFailure(e: unknown): string {
  if (isQuotaError(e)) return 'This phone has no room left for Quot3. Nothing was saved. Free some space on the phone (or export a backup and clear old files), then save again.'
  return `Could not save: ${e instanceof Error ? e.message : String(e)}`
}

/** True when the browser says it is nearly out of room (default: 95 percent of the quota or more). Unknown figures are never "full". */
export function isStorageNearlyFull(usageBytes: number | null, quotaBytes: number | null, ratio = 0.95): boolean {
  if (usageBytes === null || quotaBytes === null || !(quotaBytes > 0)) return false
  return usageBytes / quotaBytes >= ratio
}
