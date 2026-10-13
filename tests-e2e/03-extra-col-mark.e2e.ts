import { test } from '@playwright/test'
import { allBills, cleanup, dialog, expect, launch, loadBill, saveBill, startBill, typeItem, type Launched } from './helpers/app'

/** Extra column + Mark (Ctrl+M) + Units summary (Ctrl+U) / Marked calculations (Ctrl+Shift+M). */
let L: Launched
test.beforeAll(async () => { L = await launch() })
test.afterAll(async () => { await L.close(); cleanup(L.home) })

test('add an extra column, type units, mark a cell, read both summaries, save keeps the mark', async () => {
  const { page } = L
  await startBill(page, 'Units Traders')
  await typeItem(page, 'Tomato', '10', '1')
  await typeItem(page, 'Onion', '10', '1')

  // back to row 1 Item Name by clicking its cell (mouse), then add the column with Ctrl+Alt+=
  await page.locator('[role=gridcell][data-col=name]').first().click()
  await page.keyboard.press('Control+Alt+=')
  const extra = page.getByRole('columnheader').filter({ hasText: 'Col 1' })
  await expect(extra).toHaveCount(1)

  // Item Name -> Rate -> Quantity -> Amount -> Col 1
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab')
  await page.keyboard.type('(125-5)')
  await page.keyboard.press('Tab') // row 2 Item Name
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab')
  await page.keyboard.type('tomato-7')
  await page.keyboard.press('Control+m')

  await page.keyboard.press('Control+u')
  await expect(dialog(page)).toContainText('Units summary')
  await expect(dialog(page).locator('pre')).toContainText('120') // (125-5)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)

  await page.keyboard.press('Control+Shift+m')
  await expect(dialog(page)).toContainText('Marked calculations')
  await expect(dialog(page).locator('pre')).not.toContainText('No marked cells')
  await page.keyboard.press('Escape')

  await saveBill(page, 1)
  const b = await loadBill(page, (await allBills(page))[0]!.id)
  expect(b.extraCols).toHaveLength(1)
  const k = b.extraCols[0]!.key
  expect(b.rows[0]!.extras[k]?.text).toBe('(125-5)')
  expect(b.rows[1]!.extras[k]).toMatchObject({ text: 'tomato-7', marked: true })
})
