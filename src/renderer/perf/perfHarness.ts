import { PERF_KEY_HZ } from '@shared/constants'
import { QUOT3_GRID_MIME } from '@shared/tsv/gridClip'
import { summarize, type PerfRow, type PerfSummary } from '@shared/perf/stats'
import { switchFormat } from '../stores/formatActions'
import { useBillStore } from '../stores/billStore'
import { insertTextAtSelection } from '../components/grid/gridDom'
import { renderProbe } from '../components/grid/renderProbe'

/**
 * Phase 24 — grid performance harness (dev only; route `/dev/perf`, also run headlessly by Vitest in jsdom).
 *
 * It drives the REAL grid controller with synthetic events and times each one:
 *  - `logic`  = event dispatch → DOM updated. The controller applies effects with `flushSync`, so this is the whole
 *               JS/React path of one keystroke, measured with `now()` (performance.now in the browser).
 *  - `paint`  = event → next frame painted. Only measured when `env.nextFrame` is supplied (a real browser); jsdom has
 *               no paint, so there only `logic` exists and the real-paint number stays a standing gap.
 * Events are paced at PERF_KEY_HZ (240 Hz ≈ 4.17 ms) when `env.sleepUntil` is supplied. Paint waits are not awaited
 * inline, so pacing is not distorted by the display's refresh rate (a 60 Hz display still paints once per 16.7 ms: a
 * keystroke that lands mid-frame is measured up to that frame, which is what the user would see).
 */

export type ScenarioId = 'typeName' | 'holdDown' | 'tabRow' | 'paste200' | 'formatSwitch' | 'undoStorm'

export interface PerfEnv {
  /** The `[role=grid]` element (focusable root of the grid controller). */
  root: HTMLElement
  now: () => number
  /** Wrap a mutation so React commits it before returning (`act` in tests, identity in the browser — the controller already uses flushSync). */
  flush: <T>(fn: () => T) => T
  /** Resolve after the next paint (rAF + a macrotask). Absent in jsdom. */
  nextFrame?: () => Promise<void>
  /** Resolve at (or just after) the given `now()` time. Absent = no pacing (run as fast as possible). */
  sleepUntil?: (t: number) => Promise<void>
}

export interface ScenarioResult {
  id: ScenarioId
  label: string
  samples: number
  logic: PerfSummary
  paint: PerfSummary | null
  /** Render counts from `renderProbe` across the measured steps (the "no whole-grid re-render" proof). */
  gridRenders: number
  rowRenders: number
  cellRenders: number
  /** `long-animation-frame` entries seen during the run (browser only; null when unsupported). */
  longFrames: { count: number; maxMs: number } | null
  notes: string
}

export const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'typeName', label: 'Type 60 characters in a name cell' },
  { id: 'holdDown', label: 'Hold Down (70) then Up (70) across the 80-row bill' },
  { id: 'tabRow', label: 'Tab across rows (60 Tabs)' },
  { id: 'paste200', label: 'Paste 200 cells (100 rows × 2 columns), 5×' },
  { id: 'formatSwitch', label: 'Format switch Non-GST ⇄ GST, 20×' },
  { id: 'undoStorm', label: 'Undo storm: 40 × Ctrl+Z then 40 × Ctrl+Y' }
]

type Step = () => void

function target(env: PerfEnv): HTMLElement {
  const ae = typeof document === 'undefined' ? null : document.activeElement
  return ae && env.root.contains(ae) ? (ae as HTMLElement) : env.root
}
function key(env: PerfEnv, k: string, init: KeyboardEventInit = {}): void {
  target(env).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
}
function activeSpan(env: PerfEnv): HTMLElement | null {
  return env.root.querySelector<HTMLElement>('.q3-gc[data-active] .q3-gc__text')
}
/** Un-timed: land on the first name cell of the first body row. */
function toTop(env: PerfEnv): void {
  env.flush(() => {
    env.root.focus()
    for (let i = 0; i < 160; i++) key(env, 'ArrowUp')
    for (let i = 0; i < 8; i++) key(env, 'ArrowLeft')
  })
}

interface Plan { steps: Step[]; setup?: () => void; teardown?: () => void; /** Un-timed work run before every step (e.g. return to the start cell). */ beforeEach?: () => void }

function planFor(id: ScenarioId, env: PerfEnv): Plan {
  switch (id) {
    case 'typeName': {
      const steps: Step[] = []
      const text = 'Ruby gold belt roll with a long description to type 0123456789'.slice(0, 60)
      for (const ch of text) {
        steps.push(() => {
          const span = activeSpan(env)
          const ke = new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })
          target(env).dispatchEvent(ke)
          if (ke.defaultPrevented) return // a browser fires no beforeinput / insertion after a prevented keydown
          const bi = new InputEvent('beforeinput', { data: ch, inputType: 'insertText', bubbles: true, cancelable: true })
          ;(span ?? target(env)).dispatchEvent(bi)
          if (span && !bi.defaultPrevented) insertTextAtSelection(span, ch) // what the browser does natively after beforeinput
        })
      }
      return { steps, setup: () => toTop(env), teardown: () => env.flush(() => key(env, 'Tab')) }
    }
    case 'holdDown': {
      const steps: Step[] = []
      for (let i = 0; i < 70; i++) steps.push(() => key(env, 'ArrowDown', { repeat: i > 0 }))
      for (let i = 0; i < 70; i++) steps.push(() => key(env, 'ArrowUp', { repeat: i > 0 }))
      return { steps, setup: () => toTop(env) }
    }
    case 'tabRow': {
      const steps: Step[] = []
      for (let i = 0; i < 60; i++) steps.push(() => key(env, 'Tab'))
      return { steps, setup: () => toTop(env) }
    }
    case 'paste200': {
      const tsv = Array.from({ length: 100 }, (_, i) => `Pasted item ${i + 1}\t${(i % 90) + 10}`).join('\r\n') + '\r\n'
      const steps: Step[] = Array.from({ length: 5 }, () => () => {
        const store: Record<string, string> = { 'text/plain': tsv }
        const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
        ev.clipboardData = { getData: (t: string) => (t === QUOT3_GRID_MIME ? '' : store[t] ?? ''), setData: (t: string, v: string) => { store[t] = v } }
        ;(activeSpan(env) ?? target(env)).dispatchEvent(ev)
      })
      // A paste leaves the active cell at the end of the block, so each sample starts again from the first cell.
      return { steps, setup: () => toTop(env), beforeEach: () => toTop(env) }
    }
    case 'formatSwitch': {
      const steps: Step[] = []
      for (let i = 0; i < 20; i++) steps.push(() => { switchFormat(i % 2 === 0 ? 'gst' : 'non_gst') })
      return { steps, setup: () => toTop(env), teardown: () => env.flush(() => { switchFormat('non_gst') }) }
    }
    case 'undoStorm': {
      const steps: Step[] = []
      for (let i = 0; i < 40; i++) steps.push(() => key(env, 'z', { ctrlKey: true }))
      for (let i = 0; i < 40; i++) steps.push(() => key(env, 'y', { ctrlKey: true }))
      const setup = (): void => {
        toTop(env)
        env.flush(() => {
          const s = useBillStore.getState()
          for (let i = 0; i < 40; i++) {
            const row = s.rows[i]
            if (!row) break
            useBillStore.getState().breakCoalesce()
            useBillStore.getState().setCellText(row.id, 'rate', String(500 + i))
          }
        })
      }
      return { steps, setup }
    }
  }
}

function observeLongFrames(): { stop: () => { count: number; maxMs: number } | null } {
  const PO = typeof PerformanceObserver === 'undefined' ? null : PerformanceObserver
  if (!PO || !(PO.supportedEntryTypes ?? []).includes('long-animation-frame')) return { stop: () => null }
  let count = 0
  let maxMs = 0
  const po = new PO((list) => { for (const e of list.getEntries()) { count++; maxMs = Math.max(maxMs, e.duration) } })
  po.observe({ type: 'long-animation-frame', buffered: false } as PerformanceObserverInit)
  return { stop: () => { po.takeRecords().forEach((e) => { count++; maxMs = Math.max(maxMs, e.duration) }); po.disconnect(); return { count, maxMs } } }
}

export async function runScenario(id: ScenarioId, env: PerfEnv): Promise<ScenarioResult> {
  const label = SCENARIOS.find((s) => s.id === id)?.label ?? id
  const plan = planFor(id, env)
  plan.setup?.()
  const period = 1000 / PERF_KEY_HZ
  const logic: number[] = []
  const paint: number[] = []
  const pending: Promise<void>[] = []
  const loaf = observeLongFrames()
  renderProbe.reset()
  renderProbe.enabled = true
  const start = env.now()
  try {
    for (let i = 0; i < plan.steps.length; i++) {
      plan.beforeEach?.()
      if (env.sleepUntil) await env.sleepUntil(start + i * period)
      const t0 = env.now()
      env.flush(plan.steps[i] as Step)
      logic.push(env.now() - t0)
      if (env.nextFrame) pending.push(env.nextFrame().then(() => { paint.push(env.now() - t0) }))
    }
    await Promise.all(pending)
  } finally {
    renderProbe.enabled = false
  }
  const counts = { grids: renderProbe.grids, rows: renderProbe.rows.length, cells: renderProbe.cells.length }
  renderProbe.reset()
  plan.teardown?.()
  const longFrames = loaf.stop()
  return {
    id,
    label,
    samples: logic.length,
    logic: summarize(logic),
    paint: env.nextFrame ? summarize(paint) : null,
    gridRenders: counts.grids,
    rowRenders: counts.rows,
    cellRenders: counts.cells,
    longFrames,
    notes: `grid=${counts.grids} rows=${counts.rows} cells=${counts.cells}` + (longFrames ? ` loaf=${longFrames.count}(max ${longFrames.maxMs.toFixed(1)}ms)` : '')
  }
}

export async function runAllScenarios(env: PerfEnv, only?: readonly ScenarioId[]): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = []
  for (const s of SCENARIOS) {
    if (only && !only.includes(s.id)) continue
    out.push(await runScenario(s.id, env))
  }
  return out
}

/** Flatten results into table rows (paint row first when measured, then logic). */
export function resultsToRows(results: readonly ScenarioResult[]): PerfRow[] {
  const rows: PerfRow[] = []
  for (const r of results) {
    if (r.paint) rows.push({ scenario: r.id, metric: 'paint', summary: r.paint, notes: r.notes })
    rows.push({ scenario: r.id, metric: 'logic', summary: r.logic, notes: r.paint ? undefined : r.notes })
  }
  return rows
}
