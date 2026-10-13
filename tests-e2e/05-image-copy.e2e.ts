import { test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { bridge, cleanup, expect, launch, type Launched } from './helpers/app'
import { billPayload, itemRow, manyItems, pngSize } from './helpers/bills'

/** Copy as image: the PNG really has the size the service reports, and the paper matches the paper rules. */
let L: Launched
test.beforeAll(async () => { L = await launch() })
test.afterAll(async () => { await L.close(); cleanup(L.home) })

type Img = { width: number; height: number; paper: 'A4' | 'A5'; debugFile?: string }
const copy = (rows: ReturnType<typeof manyItems>, mode: 'rough' | 'professional') =>
  bridge(L.page).call<Img>('image.copy', { bill: billPayload({ rows, poNumber: 'Q3-0001' }), mode })

test('a small bill copies as an A5-proportioned PNG whose pixels match the report', async () => {
  const r = await copy([itemRow(0, 'Pen', '9', '10'), itemRow(1, 'Book', '45.50', '2')], 'rough')
  expect(r.paper).toBe('A5')
  expect(r.width).toBeGreaterThan(300)
  expect(r.height).toBeGreaterThan(r.width) // portrait
  expect(r.debugFile).toBeTruthy()
  expect(pngSize(readFileSync(r.debugFile!))).toEqual({ width: r.width, height: r.height })
  expect(Math.abs(r.height / r.width - 595 / 420)).toBeLessThan(0.08) // A5 ratio, give or take the crop padding
})

test('a 41-row rough bill copies on A4 (taller and wider than the A5 image)', async () => {
  const small = await copy([itemRow(0, 'Pen', '9', '10')], 'rough')
  const big = await copy(manyItems(41), 'rough')
  expect(big.paper).toBe('A4')
  expect(big.width).toBeGreaterThan(small.width)
  expect(pngSize(readFileSync(big.debugFile!))).toEqual({ width: big.width, height: big.height })
})
