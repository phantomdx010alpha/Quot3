import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createReportGate, describeError, scrubText, type CrashKind, type CrashNotice, type CrashRecord } from '../shared/diagnostics'
import type { Logger } from './logger'

/**
 * Phase 61 - crash bookkeeping and the global error handlers of the main process.
 *
 * Three small JSON files live in the logs folder (never any bill content):
 *  - `session.json`     written at start with `clean: false`, flipped to `clean: true` on a normal quit. Finding `clean: false` at
 *                       the next start = the app did not close properly (crash, power cut, forced close).
 *  - `last-crash.json`  the last error the handlers recorded (kind, time, one scrubbed line).
 *  - `crash-notice.json` the message the next launch shows; it stays until the owner dismisses it.
 */
export interface CrashState {
  /** Looks at the previous run, starts this one, and returns the notice to show (a new one, or one not yet dismissed); `fresh` = made just now. */
  begin(): { notice: CrashNotice | null; fresh: boolean }
  /** Normal quit. */
  end(): void
  record(r: CrashRecord): void
  lastCrash(): CrashRecord | null
  notice(): CrashNotice | null
  dismiss(): void
}

interface SessionFile { startedAt: string; pid: number; version: string; clean: boolean }

function readJson<T>(file: string): T | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as T } catch { return null }
}

function writeJson(file: string, value: unknown): void {
  try {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(value), 'utf8')
    renameSync(tmp, file)
  } catch { /* bookkeeping must never crash the app */ }
}

export function createCrashState(opts: { dir: string; version: string; pid?: number; now?: () => Date }): CrashState {
  const now = opts.now ?? (() => new Date())
  const sessionFile = join(opts.dir, 'session.json')
  const crashFile = join(opts.dir, 'last-crash.json')
  const noticeFile = join(opts.dir, 'crash-notice.json')
  let startedAt = ''

  const lastCrash = (): CrashRecord | null => {
    const r = readJson<CrashRecord>(crashFile)
    return r && typeof r.at === 'string' && typeof r.kind === 'string' ? r : null
  }
  const notice = (): CrashNotice | null => {
    const n = readJson<CrashNotice>(noticeFile)
    return n && typeof n.at === 'string' && typeof n.kind === 'string' ? n : null
  }

  return {
    lastCrash,
    notice,
    begin() {
      try { mkdirSync(opts.dir, { recursive: true }) } catch { /* ignore */ }
      const prev = readJson<SessionFile>(sessionFile)
      let fresh = false
      if (prev && prev.clean === false) {
        fresh = true
        const crash = lastCrash()
        const n: CrashNotice = crash && crash.at >= prev.startedAt
          ? { at: crash.at, kind: crash.kind, message: crash.message, version: prev.version }
          : { at: prev.startedAt, kind: 'unclean-exit', message: '', version: prev.version }
        writeJson(noticeFile, n)
      }
      startedAt = now().toISOString()
      writeJson(sessionFile, { startedAt, pid: opts.pid ?? process.pid, version: opts.version, clean: false } satisfies SessionFile)
      return { notice: notice(), fresh }
    },
    end() {
      writeJson(sessionFile, { startedAt, pid: opts.pid ?? process.pid, version: opts.version, clean: true } satisfies SessionFile)
    },
    record(r) { writeJson(crashFile, r) },
    dismiss() { try { if (existsSync(noticeFile)) rmSync(noticeFile) } catch { /* ignore */ } }
  }
}

/** The little of `process` / `app` the handlers use, so a test can drive them with plain emitters. */
export interface Emitter {
  on(event: string, listener: (...args: unknown[]) => void): unknown
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface CrashHandlerDeps {
  proc: Emitter
  app: Emitter
  log: Logger
  state: CrashState
  home?: string
  now?: () => Date
}

/**
 * Registers `uncaughtException`, `unhandledRejection`, `render-process-gone` and `child-process-gone`. Each one writes a scrubbed
 * log line (name, one message line, a few stack frames - no bill content), records the crash and returns; nothing here throws.
 * An uncaught exception does not stop the app (Electron's default dialog would); the log and the diagnostics hold the details.
 * Returns a function that removes the listeners.
 */
export function installCrashHandlers(deps: CrashHandlerDeps): () => void {
  const now = deps.now ?? (() => new Date())
  const gate = createReportGate(50)
  const file = (kind: CrashKind, message: string, meta: Record<string, unknown>, level: 'error' | 'warn' = 'error'): void => {
    try {
      if (gate(`${kind}:${message}`)) deps.log[level](`Crash handler: ${kind}`, { message, ...meta })
      deps.state.record({ at: now().toISOString(), kind, message: message.slice(0, 300) })
    } catch { /* never throw from a crash handler */ }
  }

  const onException = (err: unknown, origin: unknown): void => {
    const e = describeError(err, { home: deps.home })
    file('main-exception', `${e.name}: ${e.message}`, { origin: String(origin), stack: e.stack })
  }
  const onRejection = (reason: unknown): void => {
    const e = describeError(reason, { home: deps.home })
    file('main-rejection', `${e.name}: ${e.message}`, { stack: e.stack })
  }
  const onRendererGone = (_event: unknown, _wc: unknown, details: unknown): void => {
    const d = (details ?? {}) as { reason?: string; exitCode?: number }
    if (d.reason === 'clean-exit') return
    file('renderer-gone', `Window process gone: ${scrubText(String(d.reason ?? 'unknown'))}`, { exitCode: d.exitCode ?? null })
  }
  const onChildGone = (_event: unknown, details: unknown): void => {
    const d = (details ?? {}) as { type?: string; reason?: string; name?: string }
    if (d.reason === 'clean-exit') return
    file('child-gone', `${scrubText(String(d.type ?? 'child'))} process gone: ${scrubText(String(d.reason ?? 'unknown'))}`, { name: d.name ?? null }, 'warn')
  }

  deps.proc.on('uncaughtException', onException)
  deps.proc.on('unhandledRejection', onRejection)
  deps.app.on('render-process-gone', onRendererGone as (...a: unknown[]) => void)
  deps.app.on('child-process-gone', onChildGone as (...a: unknown[]) => void)
  return () => {
    deps.proc.removeListener('uncaughtException', onException)
    deps.proc.removeListener('unhandledRejection', onRejection)
    deps.app.removeListener('render-process-gone', onRendererGone as (...a: unknown[]) => void)
    deps.app.removeListener('child-process-gone', onChildGone as (...a: unknown[]) => void)
  }
}
