// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Create from '../../../pages/Create'
import { BottomBar } from '../BottomBar'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { usePartyIndexStore } from '../../../stores/partyIndexStore'
import { usePartyUiStore } from '../../../stores/partyUiStore'
import { useSaveUiStore } from '../../../stores/saveUiStore'
import { useRouter } from '../../../router/routerStore'
import { ROUTES } from '@shared/routes'
import { OUTPUT_ACTIONS } from '@shared/outputActions'
import { allShortcuts } from '@shared/shortcuts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const save = vi.fn()
const writeTsv = vi.fn()

function Shell({ page }: { page: 'create' | 'plain' }): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return page === 'create' ? createElement(Create) : createElement(BottomBar)
}
async function mount(page: 'create' | 'plain' = 'create'): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(Shell, { page })) })
}
const bar = (): HTMLElement => host.querySelector('.q3-bbar') as HTMLElement
const btn = (label: string): HTMLButtonElement => bar().querySelector(`button[aria-label^="${label}"]`) as HTMLButtonElement
function press(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { document.body.dispatchEvent(ev) })
  return ev
}

beforeEach(() => {
  useBillStore.setState({ billId: null })
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  usePartyUiStore.setState({ addressOpen: false })
  usePartyIndexStore.getState().setParties([])
  useSaveUiStore.setState({ saving: false, last: null })
  act(() => { useRouter.getState().navigate(ROUTES.create) })
  save.mockReset()
  save.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'x' } })
  ;(window as unknown as { quot3: unknown }).quot3 = {
    bills: { save, newDefaults: async () => ({ ok: false, error: { code: 'INTERNAL', message: 'x' } }) },
    parties: { list: async () => ({ ok: true, data: [] }) },
    clipboard: { writeTsv }
  }
  writeTsv.mockReset()
  writeTsv.mockResolvedValue({ ok: true, data: {} })
})
afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  delete (window as unknown as { quot3?: unknown }).quot3
})

describe('Phase 30: bottom action bar', () => {
  it('the Create page bar has every required button, each showing its shortcut', async () => {
    await mount()
    for (const label of ['Nothing to undo', 'Nothing to redo', 'Save bill', 'Print Rough', 'Print Professional', 'Copy image Rough', 'Copy image Professional', 'Copy bill as TSV']) {
      expect(btn(label), label).not.toBeNull()
    }
    // the key shown in each button's tooltip comes from primaryKeys(); here we prove each one exists in the registry
    const keys = allShortcuts()
    for (const o of OUTPUT_ACTIONS) {
      const k = keys.find((s) => s.action === o.id)
      expect(k, o.id).toBeTruthy()
    }
  })

  it('no button is a stub any more and all are out of the Tab order', async () => {
    await mount()
    expect(btn('Print Rough').getAttribute('aria-label')).toBe('Print Rough') // implemented in Phase 37
    expect(btn('Copy image Rough').getAttribute('aria-label')).toBe('Copy image Rough') // implemented in Phase 39
    expect(btn('Copy bill as TSV').getAttribute('aria-label')).toBe('Copy bill as TSV') // implemented in Phase 31
    for (const b of bar().querySelectorAll('button')) expect(b.tabIndex).toBe(-1)
  })

  it('Copy image on an empty bill says so instead of staying silent - Phase 39', async () => {
    await mount()
    act(() => { btn('Copy image Rough').click() })
    expect(useSaveUiStore.getState().last?.message).toMatch(/Nothing to copy/)
    expect(useSaveUiStore.getState().last?.tone).toBe('warn')
  })

  it('Print on an empty bill says so (no dialog) - Phase 37', async () => {
    await mount()
    act(() => { btn('Print Rough').click() })
    expect(useSaveUiStore.getState().last?.message).toBe('Nothing to print yet')
    expect(useSaveUiStore.getState().last?.tone).toBe('warn')
  })

  it('Ctrl+I and Ctrl+Shift+I are consumed and (empty bill) report there is nothing to copy - Phase 39', async () => {
    await mount()
    const cases: Array<[string, Partial<KeyboardEventInit>, string]> = [
      ['i', { ctrlKey: true }, 'Copy image Rough'],
      ['I', { ctrlKey: true, shiftKey: true }, 'Copy image Professional']
    ]
    for (const [k, m, label] of cases) {
      useSaveUiStore.setState({ last: null })
      const ev = press(k, m)
      expect(ev.defaultPrevented, label).toBe(true)
      expect(useSaveUiStore.getState().last?.message, label).toBe('Nothing to copy yet')
    }
  })

  it('Ctrl+P and Ctrl+Shift+P are consumed and (empty bill) report there is nothing to print', async () => {
    await mount()
    for (const [k, m] of [['p', { ctrlKey: true }], ['P', { ctrlKey: true, shiftKey: true }]] as const) {
      useSaveUiStore.setState({ last: null })
      expect(press(k, m).defaultPrevented, k).toBe(true)
      expect(useSaveUiStore.getState().last?.message, k).toBe('Nothing to print yet')
    }
  })

  it('Ctrl+Shift+F (not P) focuses the party name now', async () => {
    await mount()
    press('F', { ctrlKey: true, shiftKey: true })
    expect((document.activeElement as HTMLInputElement | null)?.getAttribute('aria-label') ?? document.activeElement?.className).toBeTruthy()
    expect(useSaveUiStore.getState().last).toBeNull()
  })

  it('the Save button runs the same save as Ctrl+S (validation: no party name -> no bridge call)', async () => {
    await mount()
    act(() => { btn('Save bill').click() })
    await act(async () => { await Promise.resolve() })
    expect(save).not.toHaveBeenCalled()
  })

  it('the bar on pages that do not ask for actions keeps only undo/redo/history/revert', async () => {
    await mount('plain')
    expect(btn('Nothing to undo')).not.toBeNull()
    expect(btn('Save bill')).toBeNull()
    expect(btn('Print Rough')).toBeNull()
  })
})

describe('Phase 31: TSV copy from the bar and the key', () => {
  const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
  const fill = (): void => {
    act(() => {
      const s = useBillStore.getState()
      s.setPartyField('name', 'Ruby Traders')
      s.setCellText(s.rows[0]!.id, 'name', 'Silk')
      s.setCellText(s.rows[0]!.id, 'qty', '2')
      s.setCellText(s.rows[0]!.id, 'rate', '100')
    })
  }

  it('Ctrl+Shift+T copies the whole bill (text + html), is consumed and shows a success toast', async () => {
    await mount(); fill()
    const ev = press('T', { ctrlKey: true, shiftKey: true })
    await flush()
    expect(ev.defaultPrevented).toBe(true)
    expect(writeTsv).toHaveBeenCalledTimes(1)
    const arg = writeTsv.mock.calls[0]![0] as { text: string; html: string }
    expect(arg.text.startsWith('Ruby Traders\r\n')).toBe(true)
    expect(arg.text).toContain('1\tSilk\t100\t2\t200.00')
    expect(arg.html.startsWith('<table>')).toBe(true)
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'ok' })
  })

  it('the bar button does the same, and copying does not change the bill (no undo entry, stays clean/dirty as it was)', async () => {
    await mount(); fill()
    const before = JSON.stringify(useBillStore.getState().rows)
    const undoBefore = useBillStore.getState().undoLabel
    act(() => { btn('Copy bill as TSV').click() })
    await flush()
    expect(writeTsv).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(useBillStore.getState().rows)).toBe(before)
    expect(useBillStore.getState().undoLabel).toBe(undoBefore)
  })

  it('an empty bill copies nothing and says so', async () => {
    await mount()
    press('T', { ctrlKey: true, shiftKey: true })
    await flush()
    expect(writeTsv).not.toHaveBeenCalled()
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'warn', message: 'Nothing to copy yet' })
  })

  it('a failing clipboard write reports the error', async () => {
    await mount(); fill()
    writeTsv.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'clipboard locked' } })
    press('T', { ctrlKey: true, shiftKey: true })
    await flush()
    expect(useSaveUiStore.getState().last).toMatchObject({ tone: 'danger' })
    expect(useSaveUiStore.getState().last?.message).toContain('clipboard locked')
  })

  it('a thrown bridge error is reported and does not block the next copy', async () => {
    await mount(); fill()
    writeTsv.mockRejectedValueOnce(new Error('boom'))
    press('T', { ctrlKey: true, shiftKey: true }); await flush()
    expect(useSaveUiStore.getState().last?.tone).toBe('danger')
    press('T', { ctrlKey: true, shiftKey: true }); await flush()
    expect(useSaveUiStore.getState().last?.tone).toBe('ok')
  })

  it('no bridge: a clear message, nothing thrown', async () => {
    await mount(); fill()
    delete (window as unknown as { quot3?: unknown }).quot3
    press('T', { ctrlKey: true, shiftKey: true }); await flush()
    expect(useSaveUiStore.getState().last?.tone).toBe('danger')
  })
})
