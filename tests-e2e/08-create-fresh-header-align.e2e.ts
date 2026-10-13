import { test } from '@playwright/test'
import { allBills, cleanup, expect, go, launch, saveBill, startBill, typeItem, type Launched } from './helpers/app'

/**
 * Phase 70 - (1) after a Save, opening Create again gives a blank bill; (2) every header divider sits on the same x as the
 * body column border below it (|dx| <= 0.5 px), before and after scrolling the grid sideways.
 * Needs a display (see playwright.config.ts); in a headless sandbox this is a STANDING GAP, not a pass.
 */
let L: Launched
test.beforeAll(async () => { L = await launch() })
test.afterAll(async () => { await L.close(); cleanup(L.home) })

/** Right edge (x) of each header cell and of the same-column cell in the first body row. */
async function edges(page: Launched['page']): Promise<Array<{ col: string; header: number; body: number }>> {
  return page.evaluate(() => {
    const out: Array<{ col: string; header: number; body: number }> = []
    const grid = document.querySelector('.q3-grid')!
    const body = grid.querySelector('.q3-gr')!
    for (const h of Array.from(grid.querySelectorAll<HTMLElement>('.q3-gh__cell'))) {
      const col = h.dataset.col!
      const b = body.querySelector<HTMLElement>(`.q3-gc[data-col="${col}"]`)
      if (b) out.push({ col, header: h.getBoundingClientRect().right, body: b.getBoundingClientRect().right })
    }
    return out
  })
}

test('header dividers align with body borders, also after a sideways scroll', async () => {
  const { page } = L
  await startBill(page, 'Align Traders')
  await typeItem(page, 'Pen', '9', '10')
  for (const e of await edges(page)) expect(Math.abs(e.header - e.body), `column ${e.col}`).toBeLessThanOrEqual(0.5)
  await page.evaluate(() => { const g = document.querySelector('.q3-grid')!; g.scrollLeft = g.scrollWidth })
  for (const e of await edges(page)) expect(Math.abs(e.header - e.body), `column ${e.col} (scrolled)`).toBeLessThanOrEqual(0.5)
})

test('after Save, Create is blank; an unsaved bill resumes; the New button starts fresh', async () => {
  const { page } = L
  await startBill(page, 'Fresh Traders')
  await typeItem(page, 'Book', '5', '2')
  await saveBill(page, (await allBills(page)).length + 1)
  await go(page, 0)
  await go(page, 1)
  await expect(page.locator('[data-party-field="name"]')).toHaveValue('')
  // unsaved work resumes
  await page.keyboard.press('Control+Shift+F')
  await page.keyboard.type('Half Done')
  await go(page, 0)
  await go(page, 1)
  await expect(page.locator('[data-party-field="name"]')).toHaveValue('Half Done')
  // the visible New button asks first (dirty), Discard gives a blank bill
  await page.locator('button[aria-label="New bill"]').click()
  await page.keyboard.press('d')
  await expect(page.locator('[data-party-field="name"]')).toHaveValue('')
})
