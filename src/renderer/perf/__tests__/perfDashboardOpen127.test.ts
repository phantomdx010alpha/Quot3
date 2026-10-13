// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import Dashboard from '../../pages/Dashboard'
import { summarize } from '@shared/perf/stats'
import { DEFAULT_DASH_TILES } from '@shared/dashboard/live'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Phase 127 - Dashboard open (jsdom logic path, NOT paint)', { timeout: 60_000 }, () => {
  it('first render with all six tiles on, live calls pending forever, stays quick (tiles never block the open)', async () => {
    const never = new Promise(() => {})
    const stats = { today: { date: '2026-10-11', count: 0, total: '0' }, month: { month: '2026-10', count: 0, total: '0' }, week: [], recent: [], topCustomers: [], lastBackup: null, syncStatus: 'off' }
    ;(window as unknown as { quot3: unknown }).quot3 = {
      app: { getInfo: vi.fn(async () => ({ ok: true, data: { devMode: false } })) },
      dashboard: { stats: vi.fn(async () => ({ ok: true, data: stats })), getTiles: vi.fn(async () => ({ ok: true, data: DEFAULT_DASH_TILES })), weather: () => never, rates: () => never, metals: () => never },
      drafts: { list: vi.fn(async () => ({ ok: true, data: [] })) }
    }
    const t: number[] = []
    for (let i = 0; i < 15; i++) {
      const host = document.createElement('div'); document.body.appendChild(host)
      const root = createRoot(host)
      const t0 = performance.now()
      await act(async () => { root.render(createElement(Dashboard)) })
      t.push(performance.now() - t0)
      expect(host.querySelectorAll('[data-tile]')).toHaveLength(6)
      act(() => root.unmount()); host.remove()
    }
    const s = summarize(t.slice(1))
    console.log(`PERF127 dashboardOpen: n=${s.n} p50=${s.p50.toFixed(1)} p95=${s.p95.toFixed(1)} max=${s.max.toFixed(1)}`)
    expect(s.p95).toBeLessThan(500)
  })
})
