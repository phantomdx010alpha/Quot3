// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../../components/grid/BillGrid'
import { renderProbe } from '../../components/grid/renderProbe'
import { useBillStore } from '../../stores/billStore'
import { bigGridBill } from '@shared/__fixtures__/gridBills'
import { summarize } from '@shared/perf/stats'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
afterEach(() => { act(() => root.unmount()); host.remove() })

function mount(): void {
  act(() => { useBillStore.getState().loadBill(bigGridBill(80)) })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => { root.render(createElement(BillGrid)) })
}
function measure(steps: Array<() => void>): { logic: ReturnType<typeof summarize>; grids: number; rows: number; cells: number } {
  const t: number[] = []
  renderProbe.reset(); renderProbe.enabled = true
  for (const s of steps) { const t0 = performance.now(); act(() => { s() }); t.push(performance.now() - t0) }
  renderProbe.enabled = false
  const out = { logic: summarize(t), grids: renderProbe.grids, rows: renderProbe.rows.length, cells: renderProbe.cells.length }
  renderProbe.reset()
  return out
}
const fmt = (n: string, m: ReturnType<typeof measure>, samples: number): string =>
  `PERF127 ${n}: n=${samples} p50=${m.logic.p50.toFixed(2)} p95=${m.logic.p95.toFixed(2)} max=${m.logic.max.toFixed(2)} grid=${m.grids} rows=${m.rows} cells=${m.cells}`

describe('Phase 127 - 80-row bill: move and delete rows (jsdom logic path, NOT paint)', { timeout: 120_000 }, () => {
  it('moves rows down 40 times and back up 40 times; the grid shell never re-renders and rows stay far below 80 per move', () => {
    mount()
    const ids = (): string[] => useBillStore.getState().view.bodyIds as string[]
    const steps: Array<() => void> = []
    for (let i = 0; i < 40; i++) steps.push(() => { useBillStore.getState().moveRow(ids()[i]!, 'down') })
    for (let i = 40; i > 0; i--) steps.push(() => { useBillStore.getState().moveRow(ids()[i]!, 'up') })
    const m = measure(steps)
    console.log(fmt('moveRow', m, steps.length))
    expect(m.logic.n).toBe(80)
    expect(m.grids).toBeLessThanOrEqual(steps.length)
    expect(m.rows).toBeLessThan(steps.length * 80)
  })
  it('deletes 30 rows one by one from the top', () => {
    mount()
    const steps: Array<() => void> = []
    for (let i = 0; i < 30; i++) steps.push(() => { useBillStore.getState().deleteRows([useBillStore.getState().view.bodyIds[0]!]) })
    const m = measure(steps)
    console.log(fmt('deleteRows', m, steps.length))
    expect(m.logic.n).toBe(30)
    expect(m.grids).toBeLessThanOrEqual(steps.length)
  })
})
