// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiSection } from '../AiSection'
import { useAiAdminStore } from '../../../stores/aiAdminStore'
import { useAiPanelStore } from '../../../stores/aiPanelStore'
import { SETTINGS_SECTIONS } from '../../../stores/settingsStore'
import type { AiAdminState, AiIndexState } from '@shared/ai/aiAdmin'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root
let values: Record<string, unknown>
let progress: AiIndexState
let vectors: number
let calls: string[]
let statusState: 'ready' | 'notInstalled' | 'error'
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data })
const admin = (): AiAdminState => ({
  status: { state: statusState, modelId: 'multilingual-e5-small', dim: 384, loaded: true, embedded: 7, lastEmbedMs: 9, ...(statusState === 'notInstalled' ? { reason: 'The AI model files are not installed.' } : statusState === 'error' ? { reason: 'the model could not be loaded: x' } : {}) },
  progress: { state: progress, total: 10, done: 4, pending: 6 }, vectors, ...(statusState !== 'notInstalled' ? { modelBytes: 5 * 1024 * 1024 } : {})
})
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const show = async (): Promise<void> => { await act(async () => { root.render(createElement(AiSection)) }); await flush(); await flush() }
const btn = (t: string): HTMLButtonElement => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(t))!
const click = async (el: Element): Promise<void> => { await act(async () => { (el as HTMLElement).click() }); await flush() }
const box = (text: string): HTMLInputElement => [...document.body.querySelectorAll('label')].find((l) => l.textContent?.includes(text))!.querySelector('input')!
const text = (): string => document.body.textContent ?? ''

beforeEach(() => {
  values = {}; progress = 'running'; vectors = 12; calls = []; statusState = 'ready'
  ;(window as unknown as { quot3: unknown }).quot3 = {
    settings: {
      getAll: () => ok({ ...values }),
      get: (k: string) => ok({ value: values[k] ?? null }),
      set: (k: string, v: unknown) => { values[k] = v; calls.push(`set ${k}=${String(v)}`); return ok({}) }
    },
    ai: {
      admin: () => ok(admin()),
      pause: () => { calls.push('pause'); progress = 'paused'; return ok(admin()) },
      resume: () => { calls.push('resume'); progress = 'running'; return ok(admin()) },
      rebuild: () => { calls.push('rebuild'); vectors = 0; return ok(admin()) },
      deleteData: () => { calls.push('delete'); const n = vectors; vectors = 0; return ok({ ok: true, removed: n }) }
    }
  }
  useAiAdminStore.setState({ settings: { enabled: false, billingPanel: false, itemSuggestions: false, sentenceSearch: false }, admin: null, status: 'idle', error: '', note: '', busy: false })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('Settings > AI', () => {
  it('is a settings section', () => { expect(SETTINGS_SECTIONS.some((s) => s.id === 'ai')).toBe(true) })

  it('off state (default): says Off, the privacy line shows, every other control is disabled', async () => {
    await show()
    expect(text()).toContain('Runs on this PC. Nothing leaves it.')
    expect(text()).toContain('Status: Off.')
    expect(box('master switch').checked).toBe(false)
    for (const t of ['Show past purchases', 'Suggest item merges', 'Understand plain sentences']) expect(box(t).disabled).toBe(true)
    expect(btn('Pause').disabled).toBe(true)
    expect(btn('Rebuild index').disabled).toBe(true)
    expect(text()).toContain('Indexing is off.')
  })

  it('the master switch saves ai.enabled and enables the rest', async () => {
    await show()
    await click(box('master switch'))
    expect(calls).toContain('set ai.enabled=true')
    expect(box('Show past purchases').disabled).toBe(false)
    expect(text()).toContain('Status: Ready.')
    expect(text()).toContain('Indexing: 4 of 10 item names.')
  })

  it('each of the three feature switches saves its own key', async () => {
    values['ai.enabled'] = true
    await show()
    await click(box('Show past purchases')); await click(box('Suggest item merges')); await click(box('Understand plain sentences'))
    expect(calls).toEqual(expect.arrayContaining(['set ai.billingPanel=true', 'set ai.itemSuggestions=true', 'set ai.sentenceSearch=true']))
  })

  it('turning the master off hides the billing panel at once (the panel store is re-read)', async () => {
    values['ai.enabled'] = true; values['ai.billingPanel'] = true
    useAiPanelStore.setState({ enabled: true, billingPanel: true })
    await show()
    await click(box('master switch'))
    expect(values['ai.enabled']).toBe(false)
    expect(useAiPanelStore.getState().enabled).toBe(false)
    expect(text()).toContain('Status: Off.')
  })

  it('Pause then Resume call the controls and flip the buttons', async () => {
    values['ai.enabled'] = true
    await show()
    expect(btn('Pause').disabled).toBe(false); expect(btn('Resume').disabled).toBe(true)
    await click(btn('Pause'))
    expect(calls).toContain('pause')
    expect(text()).toContain('Paused: 4 of 10')
    expect(btn('Resume').disabled).toBe(false)
    await click(btn('Resume'))
    expect(calls).toContain('resume')
  })

  it('Rebuild index calls rebuild', async () => {
    values['ai.enabled'] = true
    await show()
    await click(btn('Rebuild index'))
    expect(calls).toContain('rebuild')
    expect(text()).toContain('vectors 0')
  })

  it('Delete AI data asks first; Cancel deletes nothing, Delete drops the cache', async () => {
    values['ai.enabled'] = true
    await show()
    await click(btn('Delete AI data'))
    expect(text()).toContain('Delete AI data?')
    expect(calls).not.toContain('delete')
    await click(btn('Cancel'))
    expect(calls).not.toContain('delete')
    await click(btn('Delete AI data'))
    await click([...document.body.querySelectorAll('button')].filter((b) => b.textContent === 'Delete')[0]!)
    expect(calls).toContain('delete')
    expect(vectors).toBe(0)
    expect(text()).toContain('AI data deleted.')
    expect(btn('Delete AI data').disabled).toBe(true)
  })

  it('shows the plain reason when the model is not installed or failed', async () => {
    values['ai.enabled'] = true; statusState = 'notInstalled'
    await show()
    expect(text()).toContain('Not installed. The AI model files are not installed.')
    expect(text()).toContain('unknown size')
    act(() => root.unmount()); root = createRoot(host)
    statusState = 'error'
    await show()
    expect(text()).toContain('the model could not be loaded: x')
  })

  it('the support line shows model id, dimension, vector count and last embed time', async () => {
    values['ai.enabled'] = true
    await show()
    expect(text()).toContain('AI: on, ready, model multilingual-e5-small, dim 384, vectors 12, last embed 9 ms')
  })

  it('without the bridge it shows a plain message and does not throw', async () => {
    delete (window as unknown as { quot3?: unknown }).quot3
    await show()
    expect(text()).toContain('AI is not available in this window.')
  })
})
