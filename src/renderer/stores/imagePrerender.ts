import { billHasContent } from '@shared/tsv/billTsv'
import type { Quot3Bridge } from '@shared/ipc'
import type { PrintMode } from '@shared/types'
import { useBillStore } from './billStore'
import { printPayload } from './printActions'

/**
 * Phase 71 - idle pre-render for copy-as-image. After edits settle (no change for `IMAGE_PRERENDER_IDLE_MS`) the open bill is
 * sent to main (`image:prerender`), which renders the PNG into its content-hash cache; the next Ctrl+I / Ctrl+Shift+I on an
 * unchanged bill is then just a clipboard write. Best effort only: never announces anything, never blocks typing (it runs
 * from an idle callback and the IPC is async), and a failure or a busy main simply means the next copy renders as before.
 */
export const IMAGE_PRERENDER_IDLE_MS = 1500

type Api = Pick<Quot3Bridge, 'image'>
const bridge = (): Api | undefined => (window as unknown as { quot3?: Api }).quot3

/** The mode the owner used last (Ctrl+I rough by default); only that one is pre-rendered, so an edit pause costs one render, not two. */
let mode: PrintMode = 'rough'
export const setPrerenderMode = (m: PrintMode): void => { mode = m }
export const getPrerenderMode = (): PrintMode => mode

let lastSent = ''
export const resetPrerenderMemo = (): void => { lastSent = '' }

/** Send the open bill now when it has content and differs from what was last sent. Resolves true when a request was made. */
export async function prerenderNow(): Promise<boolean> {
  const api = bridge()?.image
  const s = useBillStore.getState()
  if (!api?.prerender || s.billId === null) return false
  const bill = s.toBill()
  if (!billHasContent(bill)) return false
  const payload = { ...printPayload(bill, mode, undefined), mode }
  const memo = `${mode}|${JSON.stringify(payload)}`
  if (memo === lastSent) return false
  lastSent = memo
  try { await api.prerender(payload) } catch { lastSent = '' }
  return true
}

const idle = (fn: () => void): void => {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(fn, { timeout: 1000 })
  else setTimeout(fn, 0)
}

/** Watch the bill store; returns the stop function. Mounted by the Create page. */
export function startImagePrerender(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsub = useBillStore.subscribe((s, p) => {
    if (s.rows === p.rows && s.party === p.party && s.formatId === p.formatId && s.extraCols === p.extraCols && s.billDate === p.billDate && s.billId === p.billId) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; idle(() => { void prerenderNow() }) }, IMAGE_PRERENDER_IDLE_MS)
  })
  return () => { unsub(); if (timer) clearTimeout(timer) }
}
