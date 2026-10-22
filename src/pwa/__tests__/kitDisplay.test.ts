import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { itemDetail, moneyText, plainNumber } from '../ui/kit/display'
import { ItemLine } from '../ui/kit/ItemLine'
import { TotalsBlock } from '../ui/kit/TotalsBlock'

// Phase 190 - Indian money for the new layouts, display only.
describe('moneyText', () => {
  it('groups in the Indian way with 2 decimals, never the raw calc string', () => {
    expect(moneyText('12988.00')).toBe('12,988.00')
    expect(moneyText('1250.5')).toBe('1,250.50')
    expect(moneyText('107500')).toBe('1,07,500.00')
    expect(moneyText('0')).toBe('0.00')
    expect(moneyText('-5')).toBe('-5.00')
    expect(moneyText('-1250.5')).toBe('-1,250.50')
  })
  it('the rupee sign only when asked (the final total)', () => {
    expect(moneyText('107500', { symbol: true })).toBe('\u20b91,07,500.00')
    expect(moneyText('107500')).not.toContain('\u20b9')
  })
  it('empty and odd input comes back unchanged, never NaN', () => {
    expect(moneyText('')).toBe('')
    expect(moneyText('abc')).toBe('abc')
    expect(moneyText('12.')).toBe('12.')
    expect(moneyText('1,250.00')).toBe('1,250.00')
    expect(moneyText(undefined as unknown as string)).toBe('')
    expect(moneyText('NaN')).toBe('NaN')
  })
  it('uses no number arithmetic and no toFixed (rule 4.3)', () => {
    const src = readFileSync(resolve(__dirname, '..', 'ui', 'kit', 'display.ts'), 'utf8')
    expect(src).not.toMatch(/toFixed|parseFloat|parseInt|\bNumber\(|\bMath\./)
  })
})

describe('plainNumber and itemDetail', () => {
  it('groups the whole part, keeps the fraction as typed', () => {
    expect(plainNumber('382')).toBe('382')
    expect(plainNumber('1250.5')).toBe('1,250.5')
    expect(plainNumber('1234567')).toBe('12,34,567')
    expect(plainNumber('100000')).toBe('1,00,000')
    expect(plainNumber('-1000')).toBe('-1,000')
    expect(plainNumber('x')).toBe('x')
  })
  it('builds "382 x Rs34 · +18% GST"', () => {
    expect(itemDetail({ qty: '382', rate: '34', gstPct: '18' })).toBe('382 x Rs34 \u00b7 +18% GST')
    expect(itemDetail({ qty: '382', rate: '34' })).toBe('382 x Rs34')
    expect(itemDetail({ qty: '2', rate: '1250.5' })).toBe('2 x Rs1,250.5')
  })
  it('leaves out empty parts, zero GST, and marks a typed price in plain words', () => {
    for (const g of ['', '0', '0.00', '00']) expect(itemDetail({ qty: '1', rate: '5', gstPct: g })).toBe('1 x Rs5')
    expect(itemDetail({})).toBe('')
    expect(itemDetail({ qty: '3', rate: '10', priceSetByUser: true })).toBe('3 x Rs10 \u00b7 Set price yourself')
    expect(itemDetail({ rate: '10' })).toBe('Rs10')
    expect(itemDetail({ qty: '3' })).toBe('3')
  })
})

describe('ItemLine and TotalsBlock markup', () => {
  it('shows the amount in Indian grouping and the full name, never the raw string', () => {
    const long = 'Stainless steel seamless pipe 2 inch schedule 40 with threaded ends and a very long description that must wrap'
    const html = renderToStaticMarkup(createElement(ItemLine, { name: long, amount: '12988.00', qty: '382', rate: '34', gstPct: '18' }))
    expect(html).toContain(long)
    expect(html).toContain('12,988.00')
    expect(html).not.toContain('12988.00')
    expect(html).toContain('382 x Rs34')
    expect(html).not.toMatch(/\.\.\.|\u2026/)
  })
  it('totals: rows in order, the rupee sign only on the grand total', () => {
    const html = renderToStaticMarkup(createElement(TotalsBlock, { rows: [{ label: 'Before GST', amount: '10000' }, { label: 'GST', amount: '1800.00' }], total: '11800' }))
    expect(html.indexOf('Before GST')).toBeLessThan(html.indexOf('GST</dt>'))
    expect(html).toContain('10,000.00')
    expect(html).toContain('1,800.00')
    expect(html).toContain('\u20b911,800.00')
    expect((html.match(/\u20b9/g) ?? []).length).toBe(1)
  })
})
