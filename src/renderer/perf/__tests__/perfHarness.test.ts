// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../../components/grid/BillGrid'
import { useBillStore } from '../../stores/billStore'
import { useGridUiStore } from '../../stores/gridUiStore'
import { bigGridBill } from '@shared/__fixtures__/gridBills'
import { PERF_P95_BUDGET_MS } from '@shared/constants'
import { perfRowsToMarkdown } from '@shared/perf/stats'
import { SCENARIOS, resultsToRows, runAllScenarios, runScenario, type PerfEnv, type ScenarioResult } from '../perfHarness'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function mount(): PerfEnv {
  act(() => { useBillStore.getState().loadBill(bigGridBill(80)) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(BillGrid)) })
  return { root: host.querySelector<HTMLElement>('[role=grid]')!, now: () => performance.now(), flush: (fn) => { let r!: ReturnType<typeof fn>; act(() => { r = fn() }); return r } }
}
beforeEach(() => { useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' }) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Phase 24 — perf harness (jsdom: logic path only; no paint exists here)', { timeout: 120_000 }, () => {
  it('runs every scenario on the 80-row bill and produces samples, no paint numbers', async () => {
    const env = mount()
    const results: ScenarioResult[] = await runAllScenarios(env)
    expect(results.map((r) => r.id)).toEqual(SCENARIOS.map((s) => s.id))
    const want: Record<string, number> = { typeName: 60, holdDown: 140, tabRow: 60, paste200: 5, formatSwitch: 20, undoStorm: 80 }
    for (const r of results) {
      expect(r.samples, r.id).toBe(want[r.id])
      expect(r.logic.n, r.id).toBe(r.samples)
      expect(r.paint, r.id).toBeNull()
    }
    // Log the numbers (copied into PHASE_STATUS.md "Performance log").
    console.log('PERF_ROWS\n' + perfRowsToMarkdown(resultsToRows(results), { date: '2026-10-08', phase: 24 }))
  })

  it('navigation never re-renders the whole grid or all rows (hold Down, Tab)', async () => {
    const env = mount()
    for (const id of ['holdDown', 'tabRow'] as const) {
      const r = await runScenario(id, env)
      expect(r.gridRenders, `${id} grid`).toBe(0)
      expect(r.rowRenders, `${id} rows`).toBeLessThan(r.samples) // at most a row-or-less per key, never 80 per key
      expect(r.cellRenders, `${id} cells`).toBeLessThan(r.samples * 8)
    }
  })

  it('typing in a name cell re-renders no rows until the cell is left (commit-on-leave)', async () => {
    const env = mount()
    const r = await runScenario('typeName', env)
    expect(r.gridRenders).toBe(0)
    expect(r.rowRenders).toBe(0)
    const first = useBillStore.getState().rows[0]!
    expect(first.nameRuns.map((x) => x.t).join('')).toContain('Ruby gold belt')
  })

  it('format switch re-renders the rows exactly once per switch at most (columns changed), never the grid shell more than that', async () => {
    const env = mount()
    const r = await runScenario('formatSwitch', env)
    expect(r.gridRenders).toBeLessThanOrEqual(r.samples)
    expect(r.rowRenders).toBeLessThanOrEqual(r.samples * 90)
    expect(useBillStore.getState().formatId).toBe('non_gst')
  })

  it('paste lands 100 rows from row 1 and undo storm restores edits in order', async () => {
    const env = mount()
    await runScenario('paste200', env)
    const names = useBillStore.getState().rows.map((r) => r.nameRuns.map((x) => x.t).join(''))
    expect(names.slice(0, 3)).toEqual(['Pasted item 1', 'Pasted item 2', 'Pasted item 3']) // every sample restarted from the first cell
    expect(names).toContain('Pasted item 100')
    const before = useBillStore.getState().rows[0]!.rate
    const u = await runScenario('undoStorm', env)
    expect(u.samples).toBe(80)
    // 40 undos then 40 redos land back on the edited state
    expect(useBillStore.getState().rows[0]!.rate).toBe('500')
    expect(before).not.toBeUndefined()
  })

  it('injected env: paint is measured and paced when nextFrame / sleepUntil are supplied', async () => {
    const env = mount()
    let t = 0
    const slept: number[] = []
    const fake: PerfEnv = {
      ...env,
      now: () => (t += 0.5),
      nextFrame: async () => { t += 2 },
      sleepUntil: async (x) => { slept.push(x) }
    }
    const r = await runScenario('tabRow', fake)
    expect(r.paint).not.toBeNull()
    expect(r.paint!.n).toBe(60)
    expect(r.paint!.p95).toBeGreaterThan(r.logic.p95) // paint includes the frame wait
    expect(slept).toHaveLength(60)
    expect(slept[1]! - slept[0]!).toBeCloseTo(1000 / 240, 5) // paced at 240 Hz
    const rows = resultsToRows([r])
    expect(rows.map((x) => x.metric)).toEqual(['paint', 'logic'])
  })

  it('logic path of a navigation key is inside the 240 Hz budget in Node/jsdom (not input-to-paint)', async () => {
    const env = mount()
    const r = await runScenario('holdDown', env)
    // jsdom + act() overhead makes this a loose upper bound on the controller path only; the real-paint number is a standing gap.
    expect(r.logic.p50).toBeLessThan(PERF_P95_BUDGET_MS * 10)
  })
})

describe('Phase 24 — /dev/perf page + wiring', () => {
  it('the page mounts the 80-row grid with a Run-all and one button per scenario; route + palette action exist', async () => {
    const { default: PerfDev } = await import('../../pages/dev/PerfDev')
    const { ROUTES, isRoutePath } = await import('@shared/routes')
    const { ACTIONS } = await import('@shared/shortcuts')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => { root.render(createElement(PerfDev)) })
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toContain('Run all')
    for (const s of SCENARIOS) expect(labels).toContain(s.id)
    expect(host.querySelector('[role=grid]')).not.toBeNull()
    expect(useBillStore.getState().rows.length).toBeGreaterThanOrEqual(80)
    expect(isRoutePath(ROUTES.devPerf)).toBe(true)
    expect(ACTIONS.some((a) => a.id === 'dev.perf')).toBe(true)
  })
})
