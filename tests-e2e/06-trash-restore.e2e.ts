import { test } from '@playwright/test'
import { allBills, bridge, cleanup, dialog, expect, go, launch, palette, saveBill, startBill, typeItem, type Launched } from './helpers/app'

/** Delete from History (keyboard), see it in Recently deleted, restore it: same PO number, revision + 1. */
let L: Launched
test.beforeAll(async () => { L = await launch() })
test.afterAll(async () => { await L.close(); cleanup(L.home) })

test('delete -> Recently deleted -> restore', async () => {
  const { page } = L
  await startBill(page, 'Trash Traders')
  await typeItem(page, 'Pen', '9', '10')
  await saveBill(page, 1)
  const [b] = await allBills(page)

  await page.keyboard.press('Escape')
  await go(page, 2)
  await palette(page, 'Focus the bills list')
  await page.keyboard.press('Delete')
  // a confirmation may be shown for a delete; accept it with Enter when it is
  if (await dialog(page).count()) await page.keyboard.press('Enter')
  await expect.poll(async () => (await allBills(page)).length).toBe(0)

  const trash = await bridge(page).call<{ id: string; poNumber: string }[]>('trash.list')
  expect(trash.map((t) => t.id)).toEqual([b!.id])

  // restore by keyboard: open Recently deleted, select the row, restore
  await page.keyboard.press('Control+Shift+d')
  await palette(page, 'Restore the selected deleted bill')
  await expect.poll(async () => (await allBills(page)).length).toBe(1)
  const back = (await allBills(page))[0]!
  expect(back.poNumber).toBe(b!.poNumber)
  expect(back.revision).toBe(b!.revision + 1)
  expect(await bridge(page).call<unknown[]>('trash.list')).toHaveLength(0)
})
