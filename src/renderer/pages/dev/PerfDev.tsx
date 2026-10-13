import { useCallback, useEffect, useRef, useState } from 'react'
import { bigGridBill } from '@shared/__fixtures__/gridBills'
import { PERF_KEY_HZ, PERF_P95_BUDGET_MS } from '@shared/constants'
import { meetsBudget, perfRowsToMarkdown } from '@shared/perf/stats'
import { BillGrid } from '../../components/grid'
import { useBillStore } from '../../stores/billStore'
import { SCENARIOS, resultsToRows, runAllScenarios, runScenario, type PerfEnv, type ScenarioId, type ScenarioResult } from '../../perf/perfHarness'

const f = (x: number): string => x.toFixed(2)

/** Resolve after the next paint: rAF fires before paint, the MessageChannel macrotask fires after it. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => { ch.port1.close(); resolve() }
      ch.port2.postMessage(0)
    })
  })
}
function sleepUntil(t: number): Promise<void> {
  const wait = t - performance.now()
  return wait <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, wait))
}

/** /dev/perf — Phase 24 grid performance harness: real grid, 80-row bill, synthetic keys at 240 Hz, keydown→paint timings. Dev only. */
export default function PerfDev(): React.JSX.Element {
  const loadBill = useBillStore((s) => s.loadBill)
  const [results, setResults] = useState<ScenarioResult[]>([])
  const [running, setRunning] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const gridHost = useRef<HTMLDivElement>(null)

  useEffect(() => { loadBill(bigGridBill(80)) }, [loadBill])

  const env = useCallback((): PerfEnv | null => {
    const root = gridHost.current?.querySelector<HTMLElement>('[role=grid]')
    return root ? { root, now: () => performance.now(), flush: (fn) => fn(), nextFrame, sleepUntil } : null
  }, [])

  const run = useCallback(async (only?: ScenarioId) => {
    const e = env()
    if (!e || running) return
    setRunning(only ?? 'all')
    loadBill(bigGridBill(80))
    await nextFrame()
    try {
      const out = only ? [await runScenario(only, e)] : await runAllScenarios(e)
      setResults((prev) => (only ? [...prev.filter((r) => r.id !== only), ...out] : out))
    } finally {
      setRunning('')
    }
  }, [env, running, loadBill])

  const markdown = perfRowsToMarkdown(resultsToRows(results), { date: new Date().toISOString().slice(0, 10), phase: 24 })
  const copy = (): void => { void navigator.clipboard?.writeText(markdown).then(() => setCopied(true)) }

  return (
    <div className="q3-gdev">
      <div className="q3-gdev__bar">
        <h1>Grid perf (dev)</h1>
        <span>Keys paced at {PERF_KEY_HZ} Hz · gate: p95 keydown→paint ≤ {PERF_P95_BUDGET_MS} ms on 80 rows. Leave the window focused and idle while it runs.</span>
        <button type="button" onClick={() => void run()} disabled={!!running}>{running ? `Running ${running}…` : 'Run all'}</button>
        {SCENARIOS.map((s) => (
          <button key={s.id} type="button" onClick={() => void run(s.id)} disabled={!!running} title={s.label}>{s.id}</button>
        ))}
        <button type="button" onClick={copy} disabled={results.length === 0}>{copied ? 'Copied' : 'Copy as PHASE_STATUS rows'}</button>
      </div>
      <div className="q3-gdev__grid" ref={gridHost}>
        <BillGrid />
      </div>
      <table className="q3-perf" aria-label="Perf results">
        <thead>
          <tr><th>Scenario</th><th>n</th><th>metric</th><th>p50 ms</th><th>p95 ms</th><th>max ms</th><th>gate</th><th>renders</th></tr>
        </thead>
        <tbody>
          {results.flatMap((r) => {
            const rows = [...(r.paint ? [{ m: 'paint', s: r.paint }] : []), { m: 'logic', s: r.logic }]
            return rows.map((x) => (
              <tr key={`${r.id}-${x.m}`}>
                <td title={r.label}>{r.id}</td><td>{x.s.n}</td><td>{x.m}</td><td>{f(x.s.p50)}</td><td>{f(x.s.p95)}</td><td>{f(x.s.max)}</td>
                <td>{x.m === 'paint' || !r.paint ? (meetsBudget(x.s) ? 'pass' : 'FAIL') : '—'}</td>
                <td>{x.m === (r.paint ? 'paint' : 'logic') ? r.notes : ''}</td>
              </tr>
            ))
          })}
        </tbody>
      </table>
    </div>
  )
}
