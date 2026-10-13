import { describe, expect, it, afterEach } from 'vitest'
import { defaultFormatId, getFormat, hasFormat, listFormats, registerFormat, resolveFormat, unregisterFormat, validateFormat } from '../registry'
import { computeBill } from '../../calc/billTotals'
import { row } from '../../__fixtures__/bills'
import { GST, NON_GST } from '../../__fixtures__/formats'
import type { FormatDef } from '../../types'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const keys = (f: FormatDef) => f.columns.map((c) => c.key)

describe('built-in formats', () => {
  it('GST columns: slNo,name,qty,rate,total,gstRate,gstAmt,amount', () => {
    expect(keys(getFormat('gst'))).toEqual(['slNo', 'name', 'qty', 'rate', 'total', 'gstRate', 'gstAmt', 'amount'])
  })
  it('non-GST columns: slNo,name,qty,rate,total', () => {
    expect(keys(getFormat('non_gst'))).toEqual(['slNo', 'name', 'qty', 'rate', 'total'])
  })
  it('non_gst is the default (Alt+2); gst is Alt+1; exactly one default', () => {
    expect(defaultFormatId()).toBe('non_gst')
    expect(getFormat('non_gst').shortcut).toBe('Alt+2')
    expect(getFormat('gst').shortcut).toBe('Alt+1')
    expect(listFormats().filter((f) => f.isDefault)).toHaveLength(1)
  })
  it('A5 extra-column limits and footers come from data', () => {
    expect(getFormat('non_gst')).toMatchObject({ a5ExtraColLimit: 2, footer: 'total' })
    expect(getFormat('gst')).toMatchObject({ a5ExtraColLimit: 0, footer: 'total_gst_amount' })
  })
  it('total is derived + overridable; gstAmt/amount derived', () => {
    const c = (f: string, k: string) => getFormat(f).columns.find((x) => x.key === k)!
    expect(c('gst', 'total')).toMatchObject({ kind: 'derived', overridable: true })
    expect(c('gst', 'gstAmt').kind).toBe('derived')
    expect(c('non_gst', 'total')).toMatchObject({ kind: 'derived', overridable: true })
  })
  it('print widths total ≤ 100 and all formats validate', () => {
    for (const f of listFormats()) { expect(() => validateFormat(f)).not.toThrow() }
  })
  it('registry entries are frozen (no accidental mutation)', () => {
    const f = getFormat('gst')
    expect(Object.isFrozen(f)).toBe(true)
    expect(Object.isFrozen(f.columns)).toBe(true)
    expect(() => { (f.columns as unknown as unknown[]).push(1) }).toThrow()
  })
  it('stub fixtures used by Phase 6 tests agree with the registry (keys, labels, kinds, align, footer, A5 limit)', () => {
    const shape = (f: FormatDef) => ({ ...f, columns: f.columns.map((c) => [c.key, c.label, c.kind, c.align]) })
    for (const [stub, id] of [[NON_GST, 'non_gst'], [GST, 'gst']] as const) {
      const reg = getFormat(id)
      expect(shape({ ...stub, columns: stub.columns })).toEqual(shape({ ...reg, columns: [...reg.columns] }))
    }
  })
})

describe('registerFormat — a third format with ZERO other code changes', () => {
  const dummy: FormatDef = {
    id: 'dummy_qty_only', label: 'Dummy', a5ExtraColLimit: 1, footer: 'total',
    columns: [
      { key: 'slNo', label: '#', kind: 'auto', editable: false, widthPx: 40, printWidthPct: 8, align: 'center' },
      { key: 'name', label: 'Thing', kind: 'richtext', editable: true, widthPx: 300, printWidthPct: 46, align: 'left' },
      { key: 'qty', label: 'Qty', kind: 'num', editable: true, widthPx: 80, printWidthPct: 14, align: 'right' },
      { key: 'rate', label: 'Price', kind: 'num', editable: true, widthPx: 80, printWidthPct: 14, align: 'right' },
      { key: 'total', label: 'Line', kind: 'derived', editable: true, overridable: true, widthPx: 100, printWidthPct: 18, align: 'right' }
    ]
  }
  afterEach(() => { unregisterFormat(dummy.id) })

  it('registers, lists, and drives computeBill unchanged', () => {
    registerFormat(dummy)
    expect(hasFormat('dummy_qty_only')).toBe(true)
    expect(listFormats().map((f) => f.id)).toContain('dummy_qty_only')
    const rows = [row('a', '2', '10.50'), row('b', '3', '4')]
    const t = computeBill(getFormat('dummy_qty_only'), rows)
    expect(t.itemsTotal).toBe('33.00')
    expect(t.grandTotal).toBe('33.00')
    // identical to a built-in with the same footer behaviour
    expect(t.grandTotal).toBe(computeBill(getFormat('non_gst'), rows).grandTotal)
  })
  it('rejects duplicates, second default, shortcut clash, bad shapes, and built-in removal', () => {
    registerFormat(dummy)
    expect(() => registerFormat(dummy)).toThrow(/already registered/)
    expect(() => registerFormat({ ...dummy, id: 'd2', isDefault: true })).toThrow(/default/)
    expect(() => registerFormat({ ...dummy, id: 'd3', shortcut: 'Alt+1' })).toThrow(/Shortcut/)
    expect(() => registerFormat({ ...dummy, id: 'Bad Id' })).toThrow(/snake_case/)
    expect(() => registerFormat({ ...dummy, id: 'd4', columns: [] })).toThrow(/needs columns/)
    expect(() => registerFormat({ ...dummy, id: 'd5', columns: dummy.columns.filter((c) => c.key !== 'name') })).toThrow(/"name"/)
    expect(() => registerFormat({ ...dummy, id: 'd6', columns: [...dummy.columns, dummy.columns[0]!] })).toThrow(/repeats/)
    expect(() => unregisterFormat('gst')).toThrow(/Built-in/)
  })
  it('getFormat throws on unknown id; resolveFormat falls back to default', () => {
    expect(() => getFormat('nope')).toThrow(/Unknown format/)
    expect(resolveFormat('nope').id).toBe('non_gst')
    expect(resolveFormat(null).id).toBe('non_gst')
    expect(resolveFormat('gst').id).toBe('gst')
  })
})

describe('Golden Rule: no format-name branching in src/', () => {
  const root = join(__dirname, '..', '..', '..') // src
  const files: string[] = []
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === 'migrations') continue
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(n)) files.push(p)
    }
  }
  walk(root)
  it('finds no `=== \'gst\'`-style comparisons against format ids', () => {
    const re = /(===?|!==?)\s*['"](gst|non_gst)['"]|['"](gst|non_gst)['"]\s*(===?|!==?)|case\s+['"](gst|non_gst)['"]/
    const offenders = files.filter((f) => !f.includes('__tests__') && re.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
