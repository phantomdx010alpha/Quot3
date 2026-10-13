// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../../../pages/Settings'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useBehaviourStore } from '../../../stores/behaviourStore'
import { ACTIONS } from '@shared/shortcuts'
import { DEFAULT_BEHAVIOUR, type AppSettingsState } from '@shared/settings/appSettings'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let state: AppSettingsState
let api: Record<string, ReturnType<typeof vi.fn>>

const base = (): AppSettingsState => ({
  company: { logo: '', name: 'Acme Traders', phone: '98765', address: '1 Road', logoDataUrl: '' },
  branch: { name: 'Main', prefix: 'Q3-', nextSeq: 5, nextPo: 'Q3-0005', otherPrefixes: ['MUM-'] },
  print: { rupeeOnTotal: true, silent: false, printer: '' },
  behaviour: { ...DEFAULT_BEHAVIOUR },
  image: { scale: 4 },
  nav: { smoothArrows: true },
  calc: { roundOff: true, percentPresets: '18, 5, 3' },
  readOnly: false
})
const okState = () => ({ ok: true as const, data: state })

beforeEach(() => {
  state = base()
  api = {
    get: vi.fn(async () => okState()),
    saveCompany: vi.fn(async (i: { name: string; phone: string; address: string }) => { state = { ...state, company: { ...state.company, ...i } }; return okState() }),
    chooseLogo: vi.fn(async () => ({ ok: true as const, data: { cancelled: true, state } })),
    removeLogo: vi.fn(async () => okState()),
    savePrefix: vi.fn(async (p: string) => { state = { ...state, branch: { ...state.branch!, prefix: p.toUpperCase(), nextPo: p.toUpperCase() + '0005' } }; return okState() }),
    savePrint: vi.fn(async () => okState()),
    saveImage: vi.fn(async (i: { scale: number }) => { state = { ...state, image: i }; return okState() }),
    saveNav: vi.fn(async (n: { smoothArrows: boolean }) => { state = { ...state, nav: n }; return okState() }),
    saveCalc: vi.fn(async (c: { roundOff?: boolean; percentPresets?: string }) => { state = { ...state, calc: { ...state.calc, ...c } }; return okState() }),
    saveBehaviour: vi.fn(async (b: AppSettingsState['behaviour']) => { state = { ...state, behaviour: b }; return okState() }),
    printers: vi.fn(async () => ({ ok: true as const, data: { printers: ['HP LaserJet'] } }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { appSettings: api }
  useSettingsStore.setState({ section: 'company', status: 'idle', data: null, error: '', savedAt: 0, loadError: '' })
  useBehaviourStore.setState({ ...DEFAULT_BEHAVIOUR, smoothArrows: true, roundOff: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3 })

const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
async function show(): Promise<void> { await act(async () => { root.render(createElement(Settings)) }); await flush() }
const q = <T extends Element>(sel: string): T => host.querySelector<T>(sel)!
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const click = async (el: Element): Promise<void> => { await act(async () => { (el as HTMLElement).click() }); await flush() }
const submit = async (form: Element): Promise<void> => { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush() }
const field = (label: string): HTMLInputElement => [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.parentElement!.querySelector('input')!
const tab = (id: string): HTMLButtonElement => q<HTMLButtonElement>(`[data-section="${id}"]`)

describe('Settings page', () => {
  it('lists the fourteen sections, loads the saved company and starts on Company', async () => {
    await show()
    expect([...host.querySelectorAll('[role=tab]')].map((t) => t.textContent)).toEqual(['Company', 'Branch and PO prefix', 'Print defaults', 'Behaviour', 'Themes', 'Density and font size', 'Keyboard shortcuts', 'Dashboard tiles', 'Backup and restore', 'Start fresh', 'Sync and license', 'Activity log', 'Updates', 'About Quot3'])
    expect(tab('company').getAttribute('aria-selected')).toBe('true')
    expect(field('Company name').value).toBe('Acme Traders')
    expect(host.textContent).toContain('Import parties')
  })

  it('company: the Professional preview follows the typed name, and Save sends the three fields', async () => {
    await show()
    const frame = q<HTMLIFrameElement>('iframe')
    expect(frame.getAttribute('srcdoc')).toContain('Acme Traders')
    await typeInto(field('Company name'), 'Zenith Exports')
    expect(q<HTMLIFrameElement>('iframe').getAttribute('srcdoc')).toContain('Zenith Exports')
    expect(q<HTMLIFrameElement>('iframe').getAttribute('srcdoc')).not.toContain('Acme Traders')
    await submit(q('form[aria-label="Company details"]'))
    expect(api['saveCompany']).toHaveBeenCalledWith({ name: 'Zenith Exports', phone: '98765', address: '1 Road' })
    expect(host.querySelector('[role=status]')?.textContent).toBe('Saved.')
  })

  it('a refused save shows its reason and no Saved line; Add logo opens the picker and a cancel changes nothing', async () => {
    api['saveCompany']!.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION', message: 'Enter your company name.' } })
    await show()
    await typeInto(field('Company name'), '')
    await submit(q('form[aria-label="Company details"]'))
    expect(q('[role=alert]').textContent).toBe('Enter your company name.')
    expect(host.querySelector('[role=status]')).toBeNull()
    const add = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add logo')!
    await click(add)
    expect(api['chooseLogo']).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role=status]')).toBeNull()
  })

  it('with a logo: preview image and Remove logo', async () => {
    state = { ...state, company: { ...state.company, logo: 'company-logo.png', logoDataUrl: 'data:image/png;base64,AAAA' } }
    await show()
    expect(q<HTMLImageElement>('img.q3-set__logoimg').getAttribute('src')).toBe('data:image/png;base64,AAAA')
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Remove logo')!)
    expect(api['removeLogo']).toHaveBeenCalledTimes(1)
  })

  it('Up / Down in the section list change the section; palette actions exist for each section', async () => {
    await show()
    await act(async () => { tab('company').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(useSettingsStore.getState().section).toBe('branch')
    await act(async () => { tab('branch').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    await act(async () => { tab('print').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(useSettingsStore.getState().section).toBe('behaviour')
    await act(async () => { tab('behaviour').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    expect(useSettingsStore.getState().section).toBe('print')
    for (const id of ['settings.company', 'settings.branch', 'settings.print', 'settings.behaviour', 'settings.themes', 'settings.appearance', 'settings.shortcuts', 'settings.backup', 'settings.sync', 'settings.audit']) expect(ACTIONS.some((a) => a.id === id)).toBe(true)
  })

  it('branch: live next-PO preview, invalid and clashing prefixes block Save, a valid one is sent', async () => {
    await show()
    await click(tab('branch'))
    expect(host.querySelector('.q3-set__preview-po')?.textContent).toContain('Q3-0005')
    const save = (): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save prefix')!
    expect(save().disabled).toBe(true)
    await typeInto(field('PO prefix'), 'mum-')
    expect(host.textContent).toContain('Another branch already uses MUM-.')
    expect(save().disabled).toBe(true)
    await typeInto(field('PO prefix'), 'a b')
    expect(save().disabled).toBe(true)
    await typeInto(field('PO prefix'), 'pune/')
    expect(host.querySelector('.q3-set__preview-po')?.textContent).toContain('PUNE/0005')
    expect(host.querySelector('.q3-set__preview-po')?.textContent).toContain('now Q3-0005')
    expect(save().disabled).toBe(false)
    await submit(q('form[aria-label="Branch and PO prefix"]'))
    expect(api['savePrefix']).toHaveBeenCalledWith('pune/')
  })

  it('Phase 72: Image quality select on the Print tab shows the saved scale (4x) and saves the chosen one', async () => {
    await show()
    await click(tab('print'))
    const sel = q('select[aria-label="Image quality"]') as HTMLSelectElement
    expect(sel.value).toBe('4')
    expect([...sel.options].map((o) => o.value)).toEqual(['2', '3', '4', '5'])
    await act(async () => { sel.value = '5'; sel.dispatchEvent(new Event('change', { bubbles: true })) })
    await submit(q('form[aria-label="Image quality"]'))
    expect(api['saveImage']).toHaveBeenCalledWith({ scale: 5 })
  })

  it('print: lists printers, sends the three values, and shows the silent-needs-printer refusal', async () => {
    api['savePrint']!.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION', message: 'Silent printing needs a printer name. Choose a printer or turn silent printing off.' } })
    await show()
    await click(tab('print'))
    expect(host.querySelectorAll('#q3-printers option').length).toBe(1)
    const silent = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')][0]!
    await click(silent)
    await submit(q('form[aria-label="Print defaults"]'))
    expect(api['savePrint']).toHaveBeenCalledWith({ rupeeOnTotal: true, silent: true, printer: '' })
    expect(q('[role=alert]').textContent).toContain('Silent printing needs a printer')
    await typeInto(field('Printer name'), 'HP LaserJet')
    await submit(q('form[aria-label="Print defaults"]'))
    expect(api['savePrint']).toHaveBeenLastCalledWith({ rupeeOnTotal: true, silent: true, printer: 'HP LaserJet' })
  })

  it('behaviour: out-of-range numbers block Save with the field message; a valid save updates the live behaviour store', async () => {
    await show()
    await click(tab('behaviour'))
    const save = (): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save behaviour')!
    expect(save().disabled).toBe(false)
    await typeInto(field('Keep deleted bills'), '400')
    expect(save().disabled).toBe(true)
    expect(host.textContent).toContain('enter a whole number from 1 to 365')
    await typeInto(field('Keep deleted bills'), '14')
    await typeInto(field('Left-arrow presses'), '1')
    await typeInto(field('Save the unsaved bill'), '8')
    await submit(q('form[aria-label="Behaviour"]'))
    expect(api['saveBehaviour']).toHaveBeenCalledWith({ trashRetentionDays: 14, leftUnlockPresses: 1, autosaveSeconds: 8 })
    expect(useBehaviourStore.getState()).toMatchObject({ trashRetentionDays: 14, leftUnlockPresses: 1, autosaveSeconds: 8 })
  })

  it('a failing bridge shows an alert, no crash; read-only disables Save', async () => {
    api['get']!.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN', message: 'boom' } })
    await show()
    expect(q('[role=alert]').textContent).toBe('boom')
    act(() => root.unmount())
    root = createRoot(host)
    state = { ...base(), readOnly: true }
    useSettingsStore.setState({ status: 'idle', data: null })
    await show()
    expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Save company details')!.disabled).toBe(true)
  })

  it('Phase 75: Behaviour shows Smooth arrow keys ticked by default; unticking saves nav and the grid store follows', async () => {
    await show()
    await click(tab('behaviour'))
    const box = q<HTMLInputElement>('form[aria-label="Behaviour"] input[type=checkbox]')
    expect(box.checked).toBe(true)
    await click(box)
    expect(api['saveNav']).toHaveBeenCalledWith({ smoothArrows: false })
    expect(useBehaviourStore.getState().smoothArrows).toBe(false)
  })

  it('Phase 77: Behaviour shows Round off ticked by default; unticking saves calc and the behaviour store follows', async () => {
    await show()
    await click(tab('behaviour'))
    const box = q<HTMLInputElement>('form[aria-label="Behaviour"] label:nth-of-type(2) input[type=checkbox]')
    expect(box.checked).toBe(true)
    await click(box)
    expect(api['saveCalc']).toHaveBeenCalledWith({ roundOff: false })
    expect(useBehaviourStore.getState().roundOff).toBe(false)
  })
})
