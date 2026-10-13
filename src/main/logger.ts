import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(msg: string, meta?: unknown): void
  info(msg: string, meta?: unknown): void
  warn(msg: string, meta?: unknown): void
  error(msg: string, meta?: unknown): void
}

export interface LoggerOptions {
  dir: string
  /** Rotate when the active file would exceed this many bytes. */
  maxBytes?: number
  /** Number of rotated files kept (quot3.log.1 … quot3.log.N). */
  maxFiles?: number
  now?: () => Date
  /** Also mirror to console (dev). */
  echo?: boolean
}

export const LOG_MAX_BYTES = 1_000_000
export const LOG_MAX_FILES = 5

function formatMeta(meta: unknown): string {
  if (meta === undefined) return ''
  if (meta instanceof Error) return ` ${meta.name}: ${meta.message}`
  try {
    return ` ${JSON.stringify(meta)}`
  } catch {
    return ' [unserialisable]'
  }
}

/**
 * Size-rotating file logger. Callers must never pass bill content, party details,
 * licence keys or passphrases (SECURITY_MODEL.md).
 */
export function createLogger(opts: LoggerOptions): Logger {
  const maxBytes = opts.maxBytes ?? LOG_MAX_BYTES
  const maxFiles = opts.maxFiles ?? LOG_MAX_FILES
  const now = opts.now ?? (() => new Date())
  const active = join(opts.dir, 'quot3.log')

  function rotate(): void {
    const oldest = `${active}.${maxFiles}`
    if (existsSync(oldest)) rmSync(oldest)
    for (let i = maxFiles - 1; i >= 1; i--) {
      const from = `${active}.${i}`
      if (existsSync(from)) renameSync(from, `${active}.${i + 1}`)
    }
    if (existsSync(active)) renameSync(active, `${active}.1`)
  }

  function write(level: LogLevel, msg: string, meta?: unknown): void {
    const line = `${now().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}${formatMeta(meta)}\n`
    try {
      const size = existsSync(active) ? statSync(active).size : 0
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) rotate()
      appendFileSync(active, line, 'utf8')
    } catch {
      // Logging must never crash the app.
    }
    if (opts.echo) {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      fn(line.trimEnd())
    }
  }

  return {
    debug: (m, x) => write('debug', m, x),
    info: (m, x) => write('info', m, x),
    warn: (m, x) => write('warn', m, x),
    error: (m, x) => write('error', m, x)
  }
}
