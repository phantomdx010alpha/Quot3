import { test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { allBills, bridge, cleanup, expect, launch, newHome, saveBill, startBill, typeItem } from './helpers/app'

/**
 * Backup now (Ctrl+Alt+B) -> change the data -> restore the backup -> the app restarts (QUOT3_E2E keeps main from relaunching, the
 * test starts the second run itself) -> the first state is back and a pre-restore backup exists.
 */
test('backup, change, restore: the restored database is the backed-up one', async () => {
  const home = newHome()
  let first = await launch(home)
  try {
    await startBill(first.page, 'Before Backup')
    await typeItem(first.page, 'Pen', '9', '10')
    await saveBill(first.page, 1)
    await first.page.keyboard.press('Escape')

    await first.page.keyboard.press('Control+Alt+b')
    await expect.poll(async () => (await bridge(first.page).call<{ file: string }[]>('backup.list')).length).toBeGreaterThan(0)
    const backups = await bridge(first.page).call<{ file: string; kind: string; billCount: number; readable: boolean }[]>('backup.list')
    const mine = backups.find((b) => b.billCount === 1 && b.readable)!
    expect(mine).toBeTruthy()
    expect(existsSync(join(first.dataDir, 'backups', mine.file))).toBe(true)

    // a second bill, after the backup
    await startBill(first.page, 'After Backup')
    await typeItem(first.page, 'Book', '45', '2')
    await saveBill(first.page, 2)
    await first.page.keyboard.press('Escape')

    // restore: refused without the typed word, accepted with it; the app exits
    await expect(bridge(first.page).call('backup.restore', mine.file, 'nope')).rejects.toThrow()
    const closed = first.app.waitForEvent('close')
    const res = await bridge(first.page).call<{ restarting: true; preRestore: string }>('backup.restore', mine.file, 'RESTORE')
    expect(res.restarting).toBe(true)
    await closed

    // second launch applies the staged restore
    first = await launch(home)
    const bills = await allBills(first.page)
    expect(bills.map((b) => b.partyName)).toEqual(['Before Backup'])
    const after = await bridge(first.page).call<{ file: string; kind: string }[]>('backup.list')
    expect(after.some((b) => b.file === res.preRestore || b.kind === 'pre-restore')).toBe(true) // the "after" state was kept as a safety copy
  } finally {
    await first.close()
    cleanup(home)
  }
})
