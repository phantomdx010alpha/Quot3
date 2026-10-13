import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Phase 66 - launch the BUILT app (out/main/index.js) against a private, empty data folder. */

export interface Launched {
  app: ElectronApplication
  page: Page
  /** The temp folder that holds this run's data (HOME on Linux / macOS, LOCALAPPDATA on Windows). */
  home: string
  /** The app's data directory (`~/.quot3` or `%LOCALAPPDATA%\Quot3`). */
  dataDir: string
  close(): Promise<void>
}

const ROOT = resolve(__dirname, '..', '..')

export function newHome(): string {
  return mkdtempSync(join(tmpdir(), 'quot3-e2e-'))
}
export function dataDirOf(home: string): string {
  return process.platform === 'win32' ? join(home, 'Quot3') : join(home, '.quot3')
}

/** Start the app. Pass `home` to reopen the same data folder (restart / restore tests). */
export async function launch(home: string = newHome()): Promise<Launched> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  env['QUOT3_E2E'] = '1'
  env['QUOT3_IMAGE_DEBUG'] = '1' // image:copy then reports the temp PNG path, so the spec can read the real pixels
  env['HOME'] = home
  env['LOCALAPPDATA'] = home
  env['USERPROFILE'] = home
  delete env['ELECTRON_RENDERER_URL'] // never the dev server: the suite tests the built files
  const app = await electron.launch({
    args: [ROOT, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env,
    timeout: 60_000
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof (window as unknown as { quot3?: unknown }).quot3 === 'object', null, { timeout: 30_000 })
  return {
    app, page, home, dataDir: dataDirOf(home),
    async close() { await app.close().catch(() => undefined) }
  }
}

export function cleanup(home: string): void {
  try { rmSync(home, { recursive: true, force: true }) } catch { /* the OS temp cleaner gets it */ }
}

/** Keyboard-only navigation helpers (every one of these is a real shortcut). */
export async function go(page: Page, n: 0 | 1 | 2 | 3 | 4): Promise<void> {
  await page.keyboard.press(`Control+${n}`)
}
/** Ctrl+K, type the action name, Enter - the palette path every action has. */
export async function palette(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Control+k')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
export function dialog(page: Page) { return page.locator('[role=dialog]') }

import type { BillListItem } from '../../src/shared/history/historyList'
import type { Bill } from '../../src/shared/types'
export async function allBills(page: Page): Promise<BillListItem[]> {
  return (await bridge(page).call<{ items: BillListItem[] }>('history.listBills', {})).items
}
export async function loadBill(page: Page, id: string): Promise<Bill> {
  return bridge(page).call<Bill>('bills.getForEdit', id)
}
/** Dashboard -> Create -> party name -> first grid cell, all by keyboard. Leaves the caret in row 1 Item Name. */
export async function startBill(page: Page, party: string): Promise<void> {
  await go(page, 1)
  await page.keyboard.press('Control+n') // a fresh bill, even when a saved one was last on this page
  await page.keyboard.press('Control+Shift+F')
  await expect(page.locator('[data-party-field="name"]')).toBeFocused()
  await page.keyboard.type(party)
  await page.keyboard.press('Tab') // phone
  await page.keyboard.press('Tab') // transport
  await page.keyboard.press('Tab') // grid, row 1 Item Name
}
/** Ctrl+S and wait until the bill is in the database. */
export async function saveBill(page: Page, expectCount: number): Promise<void> {
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await allBills(page)).length).toBe(expectCount)
}

export type Bridge = {
  call<T = unknown>(path: string, ...args: unknown[]): Promise<T>
}
/** Calls `window.quot3.<ns>.<method>(...args)` in the renderer and returns the Result's data (throws with the error text when `ok` is false). */
export function bridge(page: Page): Bridge {
  return {
    async call<T>(path: string, ...args: unknown[]): Promise<T> {
      const res = await page.evaluate(async ([p, a]) => {
        const parts = (p as string).split('.')
        let o: unknown = (window as unknown as { quot3: unknown }).quot3
        for (const part of parts.slice(0, -1)) o = (o as Record<string, unknown>)[part]
        const fn = (o as Record<string, (...x: unknown[]) => Promise<unknown>>)[parts[parts.length - 1]!]!
        return await fn.apply(o, a as unknown[])
      }, [path, args] as const)
      const r = res as { ok: boolean; data?: T; error?: { message?: string; code?: string } }
      if (!r.ok) throw new Error(`${path} failed: ${r.error?.code ?? ''} ${r.error?.message ?? ''}`)
      return r.data as T
    }
  }
}

/** Type a row of the Create grid with the keyboard: Item Name, Tab, Quantity, Tab, Rate, then Tab twice (past the derived Amount) to the next row. */
export async function typeItem(page: Page, name: string, rate: string, qty: string): Promise<void> {
  await page.keyboard.type(name)
  await page.keyboard.press('Tab')
  await page.keyboard.type(qty)
  await page.keyboard.press('Tab')
  await page.keyboard.type(rate)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
}
/** An adjustment row: a name and an Amount only (Rate and Quantity left empty). */
export async function typeAdjustment(page: Page, name: string, amount: string): Promise<void> {
  await page.keyboard.type(name)
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.type(amount)
  await page.keyboard.press('Tab')
}

export { expect }
