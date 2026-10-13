import { test } from '@playwright/test'
import { allBills, bridge, cleanup, dialog, expect, go, launch, loadBill, palette, saveBill, startBill, typeAdjustment, typeItem, type Launched } from './helpers/app'

/**
 * Dashboard -> Create -> a keyboard-only bill with an adjustment -> save -> History -> reopen -> edit -> Esc prompt.
 * Mouse is not used anywhere in this file.
 */
let L: Launched
test.beforeAll(async () => { L = await launch() })
test.afterAll(async () => { await L.close(); cleanup(L.home) })

test('keyboard-only bill with an adjustment, saved, found in History, reopened, edited and guarded by Esc', async () => {
  const { page } = L

  // Dashboard is the landing screen
  await expect(page.locator('[data-testid=dash-stats]')).toBeVisible()

  // Create: party, then three items and one adjustment typed with Tab only
  await startBill(page, 'E2E Traders')
  await typeItem(page, 'Pen', '9', '10') // 90
  await typeItem(page, 'Book', '45.50', '2') // 91
  await typeItem(page, 'Ruler', '12', '5') // 60
  await typeAdjustment(page, 'Discount', '-50')

  // save with Ctrl+S: one bill, grand total 90 + 91 + 60 - 50
  await saveBill(page, 1)
  const [row] = await allBills(page)
  expect(row!.partyName).toBe('E2E Traders')
  expect(row!.grandTotal).toBe('191.00')
  expect(row!.revision).toBe(1)
  const saved = await loadBill(page, row!.id)
  expect(saved.rows.filter((r) => r.qty !== null).map((r) => r.nameRuns.map((n) => n.t).join(''))).toEqual(['Pen', 'Book', 'Ruler'])
  expect(saved.rows.find((r) => r.totalOverride === '-50')?.nameRuns[0]?.t).toBe('Discount')

  // a clean bill leaves silently
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  // History: the bill is listed; open it with the keyboard
  await go(page, 2)
  await palette(page, 'Focus the bills list')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-party-field="name"]')).toHaveValue('E2E Traders')
  await expect(page.locator('[data-testid=po-preview]')).toContainText(row!.poNumber)

  // edit: Esc asks, Discard changes nothing in the database
  await page.keyboard.press('Control+Shift+F')
  await page.keyboard.press('End')
  await page.keyboard.type(' Ltd')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toContainText('Save changes?')
  await page.keyboard.press('d')
  await expect(dialog(page)).toHaveCount(0)
  expect((await allBills(page))[0]!.partyName).toBe('E2E Traders')
  expect((await allBills(page))[0]!.revision).toBe(1)

  // edit again: Esc, Save -> same PO number, revision 2, new party name
  await go(page, 2)
  await palette(page, 'Focus the bills list')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+Shift+F')
  await page.keyboard.press('End')
  await page.keyboard.type(' Ltd')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toContainText('Save changes?')
  await page.keyboard.press('s')
  await expect.poll(async () => (await allBills(page))[0]!.revision).toBe(2)
  const after = (await allBills(page))[0]!
  expect(after.poNumber).toBe(row!.poNumber)
  expect(after.partyName).toBe('E2E Traders Ltd')
  expect((await bridge(page).call<unknown[]>('revisions.list', { billId: row!.id })).length).toBe(2)
})
