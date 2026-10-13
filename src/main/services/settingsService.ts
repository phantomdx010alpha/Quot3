import type { SettingsRepo } from '../db/settingsRepo'
import { SETTING_DEFAULTS, SETTING_KEY_RE, SETTING_VALUE_MAX_BYTES } from '../../shared/settings'
import { AppError } from '../ipc/envelope'

export interface SettingsService {
  get(key: string): unknown
  set(key: string, value: unknown): void
  /** Defaults overlaid with stored values. */
  getAll(): Record<string, unknown>
}

function assertKey(key: string): void {
  if (!SETTING_KEY_RE.test(key)) throw new AppError('VALIDATION', 'Invalid setting key')
}

/** Key/value settings in the `settings` table (values are JSON). Unset keys fall back to SETTING_DEFAULTS. */
export function createSettingsService(repo: SettingsRepo, opts: { writable?: boolean; now?: () => Date } = {}): SettingsService {
  const now = opts.now ?? (() => new Date())
  const parse = (raw: string): unknown => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined // corrupt row: behave as unset
    }
  }

  return {
    get(key) {
      assertKey(key)
      const raw = repo.getRaw(key)
      const v = raw === undefined ? undefined : parse(raw)
      return v === undefined ? SETTING_DEFAULTS[key] : v
    },
    set(key, value) {
      assertKey(key)
      if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
      const json = JSON.stringify(value)
      if (json === undefined) throw new AppError('VALIDATION', 'Setting value is not JSON-serialisable')
      if (Buffer.byteLength(json, 'utf8') > SETTING_VALUE_MAX_BYTES) throw new AppError('VALIDATION', 'Setting value too large')
      repo.setRaw(key, json, now().toISOString())
    },
    getAll() {
      const out: Record<string, unknown> = { ...SETTING_DEFAULTS }
      for (const r of repo.allRaw()) {
        const v = parse(r.value)
        if (v !== undefined) out[r.key] = v
      }
      return out
    }
  }
}
