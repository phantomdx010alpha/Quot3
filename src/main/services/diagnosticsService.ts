import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildDiagnosticsText, createReportGate, describeError, DIAGNOSTICS_LOG_LINES, tailLines,
  type CrashNotice, type DiagnosticsInput, type RendererReportKind
} from '../../shared/diagnostics'
import type { CrashState } from '../crash'
import type { Logger } from '../logger'

/**
 * Phase 61 - diagnostics: renderer error reports go to the rolling log (scrubbed, throttled), "Copy diagnostics" builds the
 * support text (versions, counts, the last log lines) and puts it on the clipboard, and the launch crash notice is read /
 * dismissed here. Nothing in this file touches a bill.
 */
export interface DiagnosticsService {
  /** A renderer error / unhandled rejection / render crash. Returns whether it was logged (false = throttled duplicate). */
  report(input: { kind: RendererReportKind; message: string; stack?: string }): { logged: boolean }
  text(): string
  copy(): { chars: number; lines: number }
  crashNotice(): CrashNotice | null
  dismissCrash(): void
}

export interface DiagnosticsDeps {
  logsDir: string
  home?: string
  log: Logger
  state: CrashState
  versions: DiagnosticsInput['app']
  os: DiagnosticsInput['os']
  db: () => { schemaVersion: number; writable: boolean; counts: Record<string, number> }
  sync: () => DiagnosticsInput['sync']
  writeClipboard: (text: string) => void
  now?: () => Date
}

export function createDiagnosticsService(deps: DiagnosticsDeps): DiagnosticsService {
  const now = deps.now ?? (() => new Date())
  const gate = createReportGate()

  const readLog = (): string[] => {
    try { return tailLines(readFileSync(join(deps.logsDir, 'quot3.log'), 'utf8'), DIAGNOSTICS_LOG_LINES) } catch { return [] }
  }
  const text = (): string => {
    let db: ReturnType<DiagnosticsDeps['db']>
    try { db = deps.db() } catch { db = { schemaVersion: 0, writable: false, counts: {} } }
    let sync: ReturnType<DiagnosticsDeps['sync']>
    try { sync = deps.sync() } catch { sync = { activated: false, mode: 'unknown' } }
    return buildDiagnosticsText(
      { now: now(), app: deps.versions, os: deps.os, db, sync, lastCrash: deps.state.lastCrash(), logLines: readLog() },
      { home: deps.home }
    )
  }

  return {
    text,
    report({ kind, message, stack }) {
      const err = new Error(message)
      err.stack = `${message}\n${stack ?? ''}`
      const e = describeError(err, { home: deps.home })
      if (!gate(`${kind}:${e.message}`)) return { logged: false }
      deps.log.error(`Renderer ${kind}`, { message: e.message, stack: e.stack })
      return { logged: true }
    },
    copy() {
      const t = text()
      deps.writeClipboard(t)
      return { chars: t.length, lines: t.split('\n').length }
    },
    crashNotice: () => deps.state.notice(),
    dismissCrash: () => deps.state.dismiss()
  }
}
