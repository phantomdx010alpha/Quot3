import { test } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { bridge, cleanup, expect, launch, type Launched } from './helpers/app'
import { billPayload, itemRow, manyItems, pdfPageSize, PAPER_PT } from './helpers/bills'

/** Print-to-PDF through the real print service: paper size, page count and the decision the paper rules make. */
let L: Launched
test.beforeAll(async () => { L = await launch() })
test.afterAll(async () => { await L.close(); cleanup(L.home) })

type Pdf = { saved: boolean; filePath: string | null; pages: number; decision: { size: 'A4' | 'A5'; pages: number } }
async function pdf(name: string, rows: ReturnType<typeof manyItems>, mode: 'rough' | 'professional', extra?: { cols: number }): Promise<Pdf> {
  const extraCols = Array.from({ length: extra?.cols ?? 0 }, (_, i) => ({ key: `x${i + 1}`, header: `Col ${i + 1}`, kind: 'units' as const }))
  return bridge(L.page).call<Pdf>('print.pdf', {
    bill: billPayload({ rows, extraCols, poNumber: 'Q3-0001' }), mode, ack: true, savePath: join(L.home, name)
  })
}

test('a small bill prints on one A5 page', async () => {
  const r = await pdf('small.pdf', [itemRow(0, 'Pen', '9', '10'), itemRow(1, 'Book', '45.50', '2')], 'rough')
  expect(r.saved).toBe(true)
  expect(r.decision).toMatchObject({ size: 'A5', pages: 1 })
  expect(r.pages).toBe(1)
  expect(existsSync(r.filePath!) && statSync(r.filePath!).size).toBeGreaterThan(1000)
  const sz = pdfPageSize(r.filePath!)!
  expect(Math.abs(sz.w - PAPER_PT.A5.w)).toBeLessThanOrEqual(2)
  expect(Math.abs(sz.h - PAPER_PT.A5.h)).toBeLessThanOrEqual(2)
})

test('rough: 41 rows no longer fit A5 (limit 40) and print on one A4 page', async () => {
  const r = await pdf('a4.pdf', manyItems(41), 'rough')
  expect(r.decision).toMatchObject({ size: 'A4', pages: 1 })
  expect(r.pages).toBe(1)
  const sz = pdfPageSize(r.filePath!)!
  expect(Math.abs(sz.w - PAPER_PT.A4.w)).toBeLessThanOrEqual(2)
  expect(Math.abs(sz.h - PAPER_PT.A4.h)).toBeLessThanOrEqual(2)
})

test('professional: 31 rows already move to A4 (limit 30)', async () => {
  const r = await pdf('pro31.pdf', manyItems(31), 'professional')
  expect(r.decision.size).toBe('A4')
})

test('three extra columns on a Non-GST bill force A4 (limit 2)', async () => {
  const r = await pdf('cols.pdf', manyItems(3), 'rough', { cols: 3 })
  expect(r.decision.size).toBe('A4')
})

test('more than the A4 limit (81 rough rows) runs to two A4 pages', async () => {
  const r = await pdf('two.pdf', manyItems(81), 'rough')
  expect(r.decision).toMatchObject({ size: 'A4', pages: 2 })
  expect(r.pages).toBe(2)
})
