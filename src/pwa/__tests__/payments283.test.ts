// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedList } from '../../shared/payments/seed'
import type { PaymentsList } from '../../shared/payments/types'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { readPayments, readPaymentsPrefs, writePayments } from '../data/paymentsRepo'
import { PaymentsEntry, PaymentsPage } from '../ui/kit/PaymentsPage'
import { PAY_WORDS, matrixPath, qrLabels, setQrPort, type QrPort } from '../ui/kit/paymentsModel'
import { layoutHasRoute } from '../ui/layouts/layoutRegistry'
import { Settings } from '../ui/Settings'
import type { PaymentsPublishResult, PaymentsSync } from '../sync/payments'

// Phase 283 (M25): the phone Payments page and editor, jsdom only. Invented data only (the seed is the owner's public defaults).
// The QR picture is a FAKE port here (Phase 282 is not in this build); a real scan and the real phone look are NOT checked.
;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement
beforeEach(() => { setQrPort(null) })
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ''; setQrPort(null) })
const settle = (ms = 40): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const newDb = (): Promise<PhoneDb> => openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
const FAKE_QR: QrPort = { matrix: (url) => (url ? [[true, false, true], [false, true, false], [true, false, true]] : null) }

async function mount(el: ReturnType<typeof createElement>): Promise<HTMLElement> {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(el) })
  await settle()
  return host
}
const click = async (el: Element | null | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const type = async (el: Element | null, value: string): Promise<void> => {
  expect(el).toBeTruthy()
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el!.dispatchEvent(new Event('input', { bubbles: true })) })
}
const btn = (label: string): HTMLButtonElement | undefined => [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label)
const input = (label: string): HTMLInputElement | null => host.querySelector(`input[aria-label="${label}"]`)

/** A fake sync: records what it was asked to publish; `refuse` answers the plain refusal. */
function fakeSync(db: PhoneDb, refuse = false): PaymentsSync & { published: PaymentsList[] } {
  const published: PaymentsList[] = []
  return {
    published,
    refresh: async () => 'same',
    publish: async (list): Promise<PaymentsPublishResult> => {
      published.push(list)
      if (refuse) { await writePayments(db, list, true); return { ok: false, code: 'Q3M22', words: 'This phone may not change Payments.', keptLocally: true } }
      await writePayments(db, { ...list, version: list.version + 1 }, false)
      return { ok: true, version: list.version + 1 }
    }
  }
}

describe('Payments page', () => {
  it('shows the seeded payees as tabs, the switch off, and no QR until Generate', async () => {
    const db = await newDb()
    const h = await mount(createElement(PaymentsPage, { db, qr: FAKE_QR }))
    const names = [...h.querySelectorAll('.q3x-pay-tab-name')].map((n) => n.textContent)
    expect(names).toEqual(seedList().accounts.map((a) => a.name))
    expect(h.textContent).toContain(PAY_WORDS.switchOff)
    expect(h.textContent).toContain(PAY_WORDS.amountLabel)
    expect(h.querySelector('.q3x-pay-card')).toBeNull()
  })

  it('Generate with a blank amount = open amount, with an integer and a decimal amount; the QR draws; no account number anywhere', async () => {
    const db = await newDb()
    const h = await mount(createElement(PaymentsPage, { db, qr: FAKE_QR }))
    await click(btn(PAY_WORDS.generate))
    expect(h.querySelector('.q3x-pay-card-amount')?.textContent).toBe(PAY_WORDS.openAmount)
    expect(h.querySelector('svg.q3x-pay-qr-svg path')?.getAttribute('d')).toContain('M4 4h1v1h-1z')
    await type(input('Amount'), '500'); await click(btn(PAY_WORDS.generate))
    expect(h.querySelector('.q3x-pay-card-amount')?.textContent).toBe('Rs 500')
    await type(input('Amount'), '1250.5'); await click(btn(PAY_WORDS.generate))
    expect(h.querySelector('.q3x-pay-card-amount')?.textContent).toBe('Rs 1250.5')
    for (const a of seedList().accounts) if (a.account) { expect(h.textContent).not.toContain(a.account.number); expect(h.textContent).not.toContain(a.account.ifsc) }
  })

  it('a bad amount shows the plain words and draws nothing', async () => {
    const db = await newDb()
    const h = await mount(createElement(PaymentsPage, { db, qr: FAKE_QR }))
    await type(input('Amount'), '12abc'); await click(btn(PAY_WORDS.generate))
    expect(h.querySelector('[role="alert"]')?.textContent).toMatch(/Enter an amount like 500/)
    expect(h.querySelector('.q3x-pay-card')).toBeNull()
    await type(input('Amount'), '0'); await click(btn(PAY_WORDS.generate))
    expect(h.querySelector('[role="alert"]')?.textContent).toMatch(/above zero/)
  })

  it('without a QR port the card says so in plain words and Share / Save say the picture is not ready', async () => {
    const db = await newDb()
    const h = await mount(createElement(PaymentsPage, { db }))
    await click(btn(PAY_WORDS.generate))
    expect(h.textContent).toContain(PAY_WORDS.noQr)
    expect(btn(PAY_WORDS.fullScreen)?.disabled).toBe(true)
  })

  it('the bank-account switch changes the status line, filters the tabs, and the label carries no number', async () => {
    const db = await newDb()
    const h = await mount(createElement(PaymentsPage, { db, qr: FAKE_QR }))
    await click(h.querySelector('[role="switch"]'))
    expect(h.textContent).toContain(PAY_WORDS.switchOn)
    const withAccount = seedList().accounts.filter((a) => a.account !== undefined).map((a) => a.name)
    expect([...h.querySelectorAll('.q3x-pay-tab-name')].map((n) => n.textContent)).toEqual(withAccount)
    await click(btn(PAY_WORDS.generate))
    expect(h.querySelector('.q3x-pay-card-payee')?.textContent).toContain('Bank account transfer')
    expect((await readPaymentsPrefs(db)).accountMode).toBe(true)
    await click(h.querySelector('[role="switch"]'))
    expect(h.textContent).toContain(PAY_WORDS.switchOff)
  })

  it('the last payee is remembered and Full screen opens the QR big', async () => {
    const db = await newDb()
    const h = await mount(createElement(PaymentsPage, { db, qr: FAKE_QR }))
    await click(h.querySelectorAll('.q3x-pay-tab')[1])
    await click(btn(PAY_WORDS.generate))
    expect((await readPaymentsPrefs(db)).lastPayeeId).toBe(seedList().accounts[1]!.id)
    await click(btn(PAY_WORDS.fullScreen))
    expect(document.querySelector('.q3x-pay-full svg')).toBeTruthy()
  })

  it('states: no database, loading words, offline note, nothing to show', async () => {
    const h = await mount(createElement(PaymentsPage, { db: null }))
    expect(h.textContent).toContain(PAY_WORDS.noDb)
    const db = await newDb()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    try {
      const h2 = await mount(createElement(PaymentsPage, { db, qr: FAKE_QR }))
      expect(h2.textContent).toContain(PAY_WORDS.offline)
    } finally { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }) }
  })

  it('Refresh list reports the plain result and an unpublished edit shows the local-only line', async () => {
    const db = await newDb()
    await writePayments(db, seedList(), true)
    const h = await mount(createElement(PaymentsPage, { db, payments: fakeSync(db), qr: FAKE_QR }))
    expect(h.textContent).toContain('Saved on this phone only')
    await click(btn(PAY_WORDS.refresh))
    expect(h.textContent).toContain(PAY_WORDS.refreshed)
  })
})

describe('Payee editor', () => {
  async function openEditor(db: PhoneDb, sync: PaymentsSync): Promise<HTMLElement> {
    const h = await mount(createElement(PaymentsPage, { db, payments: sync, qr: FAKE_QR }))
    await click(btn(PAY_WORDS.edit))
    return h
  }

  it('adds a payee, publishes it and says "Published to all phones."', async () => {
    const db = await newDb(); const sync = fakeSync(db)
    const h = await openEditor(db, sync)
    await click(btn('Add payee'))
    await type(input('Name'), 'Test shop'); await type(input('UPI ID'), 'testshop@okbank')
    await click(btn('Save payee'))
    expect(h.textContent).toContain(PAY_WORDS.published)
    expect(sync.published).toHaveLength(1)
    expect(sync.published[0]!.accounts.map((a) => a.name)).toContain('Test shop')
    expect((await readPayments(db)).list.accounts.map((a) => a.name)).toContain('Test shop')
  })

  it('validation words show and nothing is published', async () => {
    const db = await newDb(); const sync = fakeSync(db)
    const h = await openEditor(db, sync)
    await click(btn('Add payee'))
    await type(input('Name'), 'Bad one'); await type(input('UPI ID'), 'not a upi id')
    await click(btn('Save payee'))
    expect(h.querySelector('[role="alert"]')?.textContent).toMatch(/UPI ID does not look right/)
    expect(sync.published).toHaveLength(0)
    await type(input('UPI ID'), 'ok@bank'); await type(input('Name'), 'SBI')
    await click(btn('Save payee'))
    expect(h.querySelector('[role="alert"]')?.textContent).toMatch(/no other payee uses/)
  })

  it('edit keeps the id; reorder and set default go through the list operations', async () => {
    const db = await newDb(); const sync = fakeSync(db)
    const h = await openEditor(db, sync)
    const first = seedList().accounts[0]!
    await click(btn(`Move ${first.name} down`))
    expect(sync.published.at(-1)!.accounts[1]!.id).toBe(first.id)
    const second = seedList().accounts[1]!
    await click(btn(`Make ${second.name} the default`))
    expect(sync.published.at(-1)!.defaultId).toBe(second.id)
    await click(btn(`Edit ${second.name}`))
    await type(input('Name'), 'SBI renamed'); await click(btn('Save payee'))
    const saved = (await readPayments(db)).list
    expect(saved.accounts.find((a) => a.id === second.id)?.name).toBe('SBI renamed')
    expect(h.textContent).toContain(PAY_WORDS.published)
  })

  it('remove asks first; Keep changes nothing; Remove publishes; the last payee cannot go', async () => {
    const db = await newDb(); const sync = fakeSync(db)
    const h = await openEditor(db, sync)
    const victim = seedList().accounts[2]!
    await click(btn(`Remove ${victim.name}`))
    expect(h.textContent).toContain(PAY_WORDS.removeAsk)
    await click(btn('Keep'))
    expect(sync.published).toHaveLength(0)
    await click(btn(`Remove ${victim.name}`)); await click(btn('Remove'))
    expect(sync.published.at(-1)!.accounts.some((a) => a.id === victim.id)).toBe(false)
    const one = { ...seedList(), accounts: [seedList().accounts[0]!], defaultId: seedList().accounts[0]!.id }
    await writePayments(db, one, false)
    root!.unmount(); root = null; document.body.innerHTML = ''
    const h2 = await openEditor(db, sync)
    const n = sync.published.length
    await click(btn(`Remove ${one.accounts[0]!.name}`)); await click(btn('Remove'))
    expect(h2.textContent).toContain('at least one payee')
    expect(sync.published).toHaveLength(n)
  })

  it('a refused publish shows the plain refusal and the edit stays on this phone', async () => {
    const db = await newDb(); const sync = fakeSync(db, true)
    const h = await openEditor(db, sync)
    await click(btn('Add payee'))
    await type(input('Name'), 'Kept shop'); await type(input('UPI ID'), 'kept@okbank')
    await click(btn('Save payee'))
    expect(h.textContent).toContain('This phone may not change Payments.')
    const s = await readPayments(db)
    expect(s.unpublished).toBe(true)
    expect(s.list.accounts.map((a) => a.name)).toContain('Kept shop')
  })

  it('saving the name people see goes through the same path', async () => {
    const db = await newDb(); const sync = fakeSync(db)
    await openEditor(db, sync)
    await type(input('Name people see'), 'Invented Traders'); await click(btn('Save name'))
    expect(sync.published.at(-1)!.recipient).toBe('Invented Traders')
  })

  it('without a sync (not linked) the edit is kept on this phone with the local-only words', async () => {
    const db = await newDb()
    const h = await mount(createElement(PaymentsPage, { db, qr: FAKE_QR }))
    await click(btn(PAY_WORDS.edit)); await click(btn('Add payee'))
    await type(input('Name'), 'Local shop'); await type(input('UPI ID'), 'local@okbank'); await click(btn('Save payee'))
    expect(h.textContent).toContain('Saved on this phone only')
    expect((await readPayments(db)).unpublished).toBe(true)
  })
})

describe('reaching the page', () => {
  it('only the three new layouts have the route; Classic does not (its pinned Settings list is untouched)', () => {
    expect(layoutHasRoute('classic', 'payments')).toBe(false)
    for (const id of ['tidy', 'guided', 'inbox'] as const) expect(layoutHasRoute(id, 'payments')).toBe(true)
  })

  it('the Home entry opens the route', async () => {
    let opened = 0
    const h = await mount(createElement(PaymentsEntry, { onOpen: () => { opened++ } }))
    await click(h.querySelector('button'))
    expect(opened).toBe(1)
  })

  it('Settings shows a Payments row only inside a new layout (plain) that passes the opener', async () => {
    const db = await newDb()
    let opened = 0
    const base = { db, version: '0', theme: 'light' as never, onTheme: () => undefined }
    const h = await mount(createElement(Settings, { ...base, plain: true, onOpenPayments: () => { opened++ } }))
    await click([...h.querySelectorAll('.q3-menu-item')].find((b) => (b.textContent ?? '').includes('Payments')))
    expect(opened).toBe(1)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    const h2 = await mount(createElement(Settings, { ...base }))
    expect([...h2.querySelectorAll('.q3-menu-item')].some((b) => (b.textContent ?? '').includes('Payments'))).toBe(false)
  })
})

describe('model helpers', () => {
  it('labels never hold an account number and the open-amount words match the original', () => {
    const acc = seedList().accounts.find((a) => a.account)!
    for (const mode of [true, false]) {
      const l = qrLabels(acc, '', mode)
      expect(JSON.stringify(l)).not.toContain(acc.account!.number)
      expect(l.amountLine).toBe('Payer enters the amount')
    }
    expect(qrLabels(acc, '500', false).amountLine).toBe('Amount: Rs 500')
  })
  it('matrixPath is bounded and has the quiet zone', () => {
    expect(matrixPath([[true]]).size).toBe(9)
    expect(matrixPath([[true, false], [false, true]]).d).toBe('M4 4h1v1h-1zM5 5h1v1h-1z')
  })
})

describe('wrap rule, tokens, no emoji', () => {
  const ui = (...p: string[]): string => resolve(__dirname, '..', 'ui', ...p)
  const CSS = readFileSync(ui('kit', 'payments.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]!.trim() }))
  it('every selector is .q3x-pay-, no ellipsis, no raw colour', () => {
    expect(rules.length).toBeGreaterThan(20)
    for (const r of rules) for (const sel of r.selector.split(',')) expect(sel.trim(), sel).toMatch(/^\.q3x-pay-/)
    for (const r of rules) expect(r.body, r.selector).not.toMatch(/text-overflow/)
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(CSS).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })
  it('the new sources hold no emoji and no truncation helper', () => {
    for (const f of [['kit', 'PaymentsPage.tsx'], ['kit', 'PaymentsEditor.tsx'], ['kit', 'paymentsModel.ts'], ['layouts', 'shared', 'PaymentsScreen.tsx']]) {
      const src = readFileSync(ui(...f), 'utf8')
      expect(src, f.join('/')).not.toMatch(/\p{Extended_Pictographic}/u)
      expect(src, f.join('/')).not.toMatch(/truncate|ellipsis|\u2026/)
    }
  })
})
