/**
 * Phase 160 - legacy watch: settings keys, limits, the tolerant reader and the status shape (pure; no Electron / Node / DOM).
 * Everything is OFF by default (MILESTONE15_DESIGN 3.7). The folder path is private: it stays in settings and main;
 * the status carries only its last segment.
 */
import { z } from 'zod'

export const LEGACY_WATCH_KEYS = {
  enabled: 'legacyWatch.enabled',
  folder: 'legacyWatch.folder',
  intervalSeconds: 'legacyWatch.intervalSeconds'
} as const

/** Timed rescan: default 2 minutes [A]; 30 s .. 1 h. */
export const INTERVAL_RANGE = { min: 30, max: 3600, default: 120 } as const
export const FOLDER_MAX = 1024

/** Defaults merged into `SETTING_DEFAULTS` (watching is off, no folder chosen). */
export const LEGACY_WATCH_DEFAULTS: Readonly<Record<string, unknown>> = {
  [LEGACY_WATCH_KEYS.enabled]: false,
  [LEGACY_WATCH_KEYS.folder]: '',
  [LEGACY_WATCH_KEYS.intervalSeconds]: INTERVAL_RANGE.default
}

export const legacyWatchSettingsSchema = z
  .object({
    enabled: z.boolean(),
    folder: z.string().max(FOLDER_MAX),
    intervalSeconds: z.number().int().min(INTERVAL_RANGE.min).max(INTERVAL_RANGE.max)
  })
  .strict()
export type LegacyWatchSettings = z.infer<typeof legacyWatchSettingsSchema>

/** Tolerant read of the stored values: a missing / corrupt value is its default; an out-of-range interval is clamped. */
export function readLegacyWatchSettings(all: Record<string, unknown>): LegacyWatchSettings {
  const iv = all[LEGACY_WATCH_KEYS.intervalSeconds]
  const folder = all[LEGACY_WATCH_KEYS.folder]
  return {
    enabled: all[LEGACY_WATCH_KEYS.enabled] === true,
    folder: typeof folder === 'string' ? folder.trim().slice(0, FOLDER_MAX) : '',
    intervalSeconds: typeof iv === 'number' && Number.isFinite(iv) ? Math.min(INTERVAL_RANGE.max, Math.max(INTERVAL_RANGE.min, Math.round(iv))) : INTERVAL_RANGE.default
  }
}

/** off = disabled or no folder; paused = the owner paused it; watching = idle between scans; scanning; folder_missing = cannot read the folder. */
export type LegacyWatchState = 'off' | 'paused' | 'watching' | 'scanning' | 'folder_missing'

export interface LegacyWatchCounts { imported: number; updated: number; duplicate: number; older: number; review: number; error: number }

export interface LegacyWatchStatus {
  state: LegacyWatchState
  enabled: boolean
  paused: boolean
  /** Last segment of the chosen folder only (the full path stays on this PC's settings). */
  folderLabel: string
  intervalSeconds: number
  /** ISO time the last scan finished; null = none since start. */
  lastScanAt: string | null
  /** Files with a .json name seen in the last scan. */
  filesSeen: number
  /** What the last scan did (counts only). */
  lastCounts: LegacyWatchCounts
  /** Counts since the app started. */
  totals: LegacyWatchCounts
  /** Files skipped for now (still being written / not readable yet); retried on the next scan. */
  waiting: number
  /** Whether the normal sync is running, so new bills reach the other PCs. When false the import still works ("sync is off"). */
  syncOn: boolean
  /** A plain-words problem (folder missing, last scan failed) or null. Never contains file names or bill content. */
  message: string | null
}

export const emptyCounts = (): LegacyWatchCounts => ({ imported: 0, updated: 0, duplicate: 0, older: 0, review: 0, error: 0 })
