import { test } from '@playwright/test'
import { allBills, cleanup, expect, launch, loadBill, saveBill, startBill, typeItem, type Launched } from './helpers/app'

/** Switching the bill format (Alt+1 GST / Alt+2 Non-GST) never loses or resets what was entered. */
let L: Launched
test.beforeAll(async () => { L = await launch() })
test.afterAll(async () => { await L.close(); cleanup(L.home) })

test('format switch is lossless in both directions and the saved bill keeps every value', async () => {
  const { page } = L
  await startBill(page, 'Switch Traders')
  await typeItem(page, 'Pen', '9', '10')
  await typeItem(page, 'Book', '45.50', '2')

  const fmt = page.getByRole('group', { name: 'Bill format' })
  await page.keyboard.press('Alt+1')
  await expect(fmt.locator('[aria-pressed=true]')).toHaveCount(1)
  const gstLabel = await fmt.locator('[aria-pressed=true]').innerText()
  // GST columns appear
  await expect(page.locator('[role=gridcell][data-col=gstRate]').first()).toBeVisible()
  // type a GST % into row 1 (mouse click: the one non-keyboard step, to land on a column the Tab path does not name)
  await page.locator('[role=gridcell][data-col=gstRate]').first().click()
  await page.keyboard.type('18')

  await page.keyboard.press('Alt+2')
  const nonGstLabel = await fmt.locator('[aria-pressed=true]').innerText()
  expect(nonGstLabel).not.toBe(gstLabel)
  await expect(page.locator('[role=gridcell][data-col=gstRate]')).toHaveCount(0)
  // the visible values survived the round trip
  await expect(page.locator('[role=gridcell][data-col=name]').filter({ hasText: 'Pen' })).toHaveCount(1)

  await saveBill(page, 1)
  const b = await loadBill(page, (await allBills(page))[0]!.id)
  expect(b.formatId).toBe('non_gst')
  expect(b.rows[0]!.gstRate).toBe('18') // hidden while Non-GST, not lost
  expect(b.rows.slice(0, 2).map((r) => [r.rate, r.qty])).toEqual([['9', '10'], ['45.50', '2']])
})
