// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Settings from '../../../pages/Settings'
import { BootstrapPanel } from '../BootstrapPanel'
import { useBackupStore } from '../../../stores/backupStore'
import { EMPTY_OVERVIEW } from '@shared/sync/manager'
import { DEFAULT_BEHAVIOUR } from '@shared/settings/appSettings'
import { useSettingsStore, type SettingsSection } from '../../../stores/settingsStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Phase 92 - a store selector that builds a fresh array/object makes React's external-store check loop forever. */
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p, out) } else if (/\.tsx?$/.test(n)) out.push(p)
  }
  return out
}

describe('Phase 92 - no store selector returns a fresh array/object', () => {
  const FRESH = /\.(filter|map|slice|sort|concat|flatMap)\(|Object\.(keys|values|entries|fromEntries)\(|\.\.\.|=>\s*\(?\s*\{|=>\s*\[|(\|\||\?\?)\s*(\[\]|\{\})/
  it('flags nothing in src/renderer', () => {
    const bad: string[] = []
    for (const f of walk(resolve(__dirname, '../../..'))) {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((l, i) => {
        const m = /use[A-Za-z]+Store(?:<[^>]*>)?\(\s*\(?(?:s|state)\)?\s*=>(.*)$/.exec(l)
        if (!m || /getState|setState/.test(l)) return
        const rest = m[1] ?? ''
        // The two selectors below are scalar-returning (a boolean / string|null), not fresh containers.
        if (FRESH.test(rest) && !/\.find\(|\? \?\? null|!== null|!!/.test(rest)) bad.push(`${f}:${i + 1}: ${l.trim()}`)
      })
    }
    expect(bad).toEqual([])
  })
})

function mockBridge(): void {
  const resolved = { ok: true, data: { ...EMPTY_OVERVIEW, items: [], list: [], backups: [], printers: [], branches: [] } }
  const settings = {
    company: { logo: '', name: 'Acme', phone: '1', address: 'x', logoDataUrl: '' },
    branch: { name: 'Main', prefix: 'Q3-', nextSeq: 5, nextPo: 'Q3-0005', otherPrefixes: [] },
    print: { rupeeOnTotal: true, silent: false, printer: '' },
    behaviour: { ...DEFAULT_BEHAVIOUR }, image: { scale: 4 }, nav: { smoothArrows: true },
    calc: { roundOff: true, percentPresets: '18, 5, 3' }, readOnly: false
  }
  const ns = new Proxy({}, { get: () => vi.fn(async () => resolved) })
  const appSettings = new Proxy({}, { get: (_t, k) => vi.fn(async () => ({ ok: true, data: k === 'printers' ? { printers: [] } : settings })) })
  ;(window as unknown as { quot3: unknown }).quot3 = new Proxy({}, { get: (_t, k) => (k === 'appSettings' ? appSettings : ns) })
}

describe('Phase 92 - Settings sections mount without a render-loop error', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

  it('BootstrapPanel with imported backups does not loop', async () => {
    mockBridge()
    useBackupStore.setState({
      load: async () => undefined,
      list: [
        { file: 'imported-a.db', kind: 'imported', readable: true, billCount: 3 },
        { file: 'auto-b.db', kind: 'auto', readable: true, billCount: 9 }
      ] as never
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(BootstrapPanel)) })
    expect(host.textContent).toContain('Use a (3 bills)')
    expect(host.textContent).not.toContain('auto-b')
    expect(err.mock.calls.map((c) => String(c[0]))).toEqual([])
    act(() => root.unmount())
  })

  const sections: SettingsSection[] = ['sync', 'company', 'branch', 'print', 'behaviour', 'appearance', 'shortcuts', 'audit', 'updates', 'fresh', 'about']
  for (const section of sections) {
    it(`Settings > ${section} logs no console error`, async () => {
      mockBridge()
      const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      useSettingsStore.setState({ section, status: 'idle', data: null, error: '', savedAt: 0, loadError: '' } as never)
      const host = document.createElement('div'); document.body.appendChild(host)
      const root = createRoot(host)
      await act(async () => { root.render(createElement(Settings)) })
      const depth = err.mock.calls.map((c) => String(c[0])).filter((m) => /Maximum update depth|getSnapshot should be cached/.test(m))
      expect(depth).toEqual([])
      act(() => root.unmount())
    })
  }
})
