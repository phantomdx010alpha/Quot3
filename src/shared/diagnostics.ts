/**
 * Phase 61 - crash logging and diagnostics (pure). Everything that may end up in a log file or in the "Copy diagnostics" text
 * goes through `scrubText` first: no bill content is ever logged by the app, and anything that looks like a secret or a user
 * folder is masked as a second line of defence. No Electron, no Node, no DOM.
 */

export const ERROR_MESSAGE_MAX = 500
export const ERROR_STACK_MAX = 4000
export const ERROR_STACK_LINES = 14
/** At most this many renderer error reports are logged per run (a render loop must not fill the disk). */
export const RENDERER_REPORTS_MAX = 25
export const DIAGNOSTICS_LOG_LINES = 150

export type CrashKind =
  | 'main-exception'
  | 'main-rejection'
  | 'renderer-gone'
  | 'child-gone'
  | 'unclean-exit'

export type RendererReportKind = 'error' | 'rejection' | 'render'

export interface CrashRecord {
  at: string
  kind: CrashKind
  message: string
}

/** What the next launch shows: "Quot3 did not close properly last time". */
export interface CrashNotice {
  at: string
  kind: CrashKind
  message: string
  /** The version that was running when it happened (when known). */
  version: string
}

export interface ErrorInfo {
  name: string
  message: string
  stack: string
}

const LICENSE_KEY_G = /Q3-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}/g
const JWT_G = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
const LONG_SECRET_G = /\b[A-Za-z0-9+/_-]{48,}={0,2}/g

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Masks user folders, license keys and anything that looks like a token; never throws. */
export function scrubText(text: string, opts: { home?: string } = {}): string {
  let out = text
  if (opts.home && opts.home.length > 2) {
    const forward = opts.home.replace(/\\/g, '/')
    const variants = [...new Set([opts.home, forward, forward.replace(/\//g, '\\\\')])]
    for (const v of variants) out = out.replace(new RegExp(escapeRe(v), 'gi'), '~')
  }
  return out.replace(LICENSE_KEY_G, 'Q3-****').replace(JWT_G, '[token]').replace(LONG_SECRET_G, '[secret]')
}

/** A loggable description of anything that was thrown. */
export function describeError(err: unknown, opts: { home?: string } = {}): ErrorInfo {
  let name = 'Error'
  let message = ''
  let stack = ''
  if (err instanceof Error) {
    name = err.name || 'Error'
    message = err.message
    stack = err.stack ?? ''
  } else if (typeof err === 'string') {
    message = err
  } else {
    try { message = JSON.stringify(err) ?? String(err) } catch { message = 'Unserialisable value was thrown' }
  }
  // Keep only the stack frames (lines after the message), capped.
  const frames = stack.split('\n').filter((l) => /^\s+at\s/.test(l)).slice(0, ERROR_STACK_LINES).join('\n')
  const firstLine = message.split('\n')[0] ?? ''
  return {
    name: scrubText(name, opts).slice(0, 80),
    message: scrubText(firstLine, opts).slice(0, ERROR_MESSAGE_MAX),
    stack: scrubText(frames, opts).slice(0, ERROR_STACK_MAX)
  }
}

const KIND_TEXT: Record<CrashKind, string> = {
  'main-exception': 'An unexpected error stopped part of the app.',
  'main-rejection': 'An unexpected error happened in the background.',
  'renderer-gone': 'The window stopped working and was closed by the system.',
  'child-gone': 'A helper process of the app stopped.',
  'unclean-exit': 'The app was closed without saving its state (power cut, forced close or a crash).'
}

/** Friendly text for the launch banner. */
export function describeCrashNotice(n: CrashNotice): { title: string; body: string } {
  return {
    title: 'Quot3 did not close properly last time',
    body: `${KIND_TEXT[n.kind]} Bills you saved are safe. An unsaved bill, if there was one, is offered on the Dashboard under "Recover unsaved bill".`
  }
}

export interface DiagnosticsInput {
  now: Date
  app: { version: string; electron: string; chrome: string; node: string; dev: boolean }
  os: { platform: string; release: string; arch: string }
  db: { schemaVersion: number; writable: boolean; counts: Record<string, number> }
  sync: { activated: boolean; mode: string }
  lastCrash: CrashRecord | null
  logLines: string[]
}

/** The text "Copy diagnostics" puts on the clipboard. Counts only - never a bill, a customer or a key. */
export function buildDiagnosticsText(i: DiagnosticsInput, opts: { home?: string } = {}): string {
  const lines: string[] = []
  lines.push('Quot3 diagnostics')
  lines.push(`Created: ${i.now.toISOString()}`)
  lines.push('')
  lines.push(`App: ${i.app.version}${i.app.dev ? ' (development)' : ''}`)
  lines.push(`Electron: ${i.app.electron}   Chromium: ${i.app.chrome}   Node: ${i.app.node}`)
  lines.push(`System: ${i.os.platform} ${i.os.release} (${i.os.arch})`)
  lines.push('')
  lines.push(`Database: schema ${i.db.schemaVersion}, ${i.db.writable ? 'read-write' : 'READ-ONLY'}`)
  for (const [k, v] of Object.entries(i.db.counts)) lines.push(`  ${k}: ${v}`)
  lines.push(`Sync: ${i.sync.activated ? 'activated' : 'not activated'}, ${i.sync.mode}`)
  lines.push(`Last crash: ${i.lastCrash ? `${i.lastCrash.at} ${i.lastCrash.kind} - ${i.lastCrash.message}` : 'none recorded'}`)
  lines.push('')
  lines.push(`Recent log (last ${i.logLines.length} lines):`)
  for (const l of i.logLines) lines.push(l)
  return scrubText(lines.join('\n'), opts)
}

/** The last `n` non-empty lines of a log text. */
export function tailLines(text: string, n: number): string[] {
  const all = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  return all.slice(Math.max(0, all.length - n))
}

/**
 * Throttle for renderer reports: the same message is logged once, and no more than `RENDERER_REPORTS_MAX` per run.
 * Pure state machine so it can be tested; main keeps one per window.
 */
export function createReportGate(max: number = RENDERER_REPORTS_MAX): (key: string) => boolean {
  const seen = new Set<string>()
  return (key: string): boolean => {
    if (seen.size >= max || seen.has(key)) return false
    seen.add(key)
    return true
  }
}
