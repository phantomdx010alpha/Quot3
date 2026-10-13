import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blankRow, row } from '../../__fixtures__/bills'
import { printFixture } from '../../__fixtures__/printBills'
import { createEmptyBill, deserializeBill, normalizeBill, serializeBill } from '../../billModel'
import { diffBills, describeDiff } from '../../diff/billDiff'
import { resolveFormat } from '../../format/registry'
import { buildGridView } from '../../gridModel'
import { simplePaperDecision } from '../../paper/paperTypes'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '../../print/printModel'
import { sameContent } from '../../sync/conflict'
import { billToRows } from '../../tsv/billTsv'
import type { Bill } from '../../types'
import { getBillOptions } from '../billOptions'

/** 3 x 33.33 = 99.99 exactly; the nearest rupee is 100. */
const bill = (roundOff?: 0 | 1): Bill => ({
  ...printFixture('legacy'),
  rows: [row('Pen', '3', '33.33'), blankRow()],
  ...(roundOff === undefined ? {} : { roundOff })
})
const lastCell = (rows: string[][]): string => {
  const r = rows[rows.length - 1] ?? []
  return [...r].reverse().find((c) => c !== '') ?? ''
}
const isRounded = (s: string): boolean => /^(\u20B9\s*)?100(\.00)?$/.test(s.trim())

describe('Phase 77 - the one options read reaches every caller', () => {
  it('flag 0 / absent: exact totals everywhere; flag 1: 100 everywhere (grid, TSV, print)', () => {
    for (const flag of [undefined, 0, 1] as const) {
      const b = bill(flag)
      const on = flag === 1
      const f = resolveFormat(b.formatId)
      const grid = buildGridView(f, b.rows, undefined, getBillOptions(b))
      const gridTotal = grid.footer[grid.footer.length - 1]
      const gridText = Object.values(gridTotal?.cells ?? {}).filter((c) => c !== '').pop() ?? ''
      const tsvText = lastCell(billToRows(b))
      const pm = buildPrintModel(b, 'rough', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A5'))
      const lastPrint = pm.footer[pm.footer.length - 1]
      const printText = Object.values(lastPrint?.cells ?? {}).map((c) => c.text).filter((c) => c !== '').pop() ?? ''
      for (const t of [gridText, tsvText, printText]) expect(isRounded(t)).toBe(on)
      if (!on) for (const t of [gridText, tsvText]) expect(t).toContain('99.99')
    }
  })
  it('no displayed round-off line: the footer row count is the same with the flag on and off', () => {
    const a = buildGridView(resolveFormat('non_gst'), bill(0).rows, undefined, getBillOptions(bill(0)))
    const b = buildGridView(resolveFormat('non_gst'), bill(1).rows, undefined, getBillOptions(bill(1)))
    expect(b.footer.length).toBe(a.footer.length)
  })
})

describe('Phase 77 - the flag is stored and survives', () => {
  it('serialize writes round_off and the totals cache uses it; deserialize reads it back', () => {
    const on = serializeBill(bill(1))
    expect(on.bill.roundOff).toBe(1)
    expect(JSON.parse(on.bill.totalsJson).grandTotal).toBe('100.00')
    const off = serializeBill(bill(0))
    expect(off.bill.roundOff).toBe(0)
    expect(JSON.parse(off.bill.totalsJson).grandTotal).toBe('99.99')
    const back = deserializeBill(on.bill, on.rows)
    expect(back.ok && back.data.roundOff).toBe(1)
    const back0 = deserializeBill(off.bill, off.rows)
    expect(back0.ok && getBillOptions(back0.data)).toEqual({})
  })
  it('an old snapshot without the field is read as 0', () => {
    const s = serializeBill(bill(0))
    const { roundOff: _drop, ...old } = s.bill
    const back = deserializeBill(old, s.rows)
    expect(back.ok && (back.data.roundOff ?? 0)).toBe(0)
  })
  it('normalizeBill keeps a valid flag, coerces junk to 0, leaves absent alone', () => {
    expect(normalizeBill(bill(1)).roundOff).toBe(1)
    expect(normalizeBill({ ...bill(), roundOff: 7 as never }).roundOff).toBe(0)
    expect('roundOff' in normalizeBill(bill())).toBe(false)
  })
  it('createEmptyBill follows the setting only when told to', () => {
    const o = { branchId: 'b', rowCount: 0, now: '2026-10-10T00:00:00.000Z', newId: () => 'x' }
    expect(createEmptyBill({ ...o, roundOff: true }).roundOff).toBe(1)
    expect(createEmptyBill({ ...o, roundOff: false }).roundOff).toBe(0)
    expect('roundOff' in createEmptyBill(o)).toBe(false)
  })
})

describe('Phase 77 - sameContent and diffBills include the flag', () => {
  it('sameContent: a different flag is a different content; an absent flag equals 0', () => {
    const a = serializeBill(bill(0)), b = serializeBill(bill(1))
    expect(sameContent(a, b)).toBe(false)
    expect(sameContent(a, { bill: { ...a.bill, roundOff: undefined }, rows: a.rows })).toBe(true)
  })
  it('diffBills reports Round off On / Off and describeDiff names it', () => {
    const d = diffBills(bill(0), bill(1))
    expect(d.identical).toBe(false)
    expect(d.bill).toEqual([{ field: 'roundOff', label: 'Round off', before: 'Off', after: 'On' }])
    expect(describeDiff(d)).toContain('round off')
    const same = bill() // one object: row ids are generated per call, so two bill() calls are never the same rows
    expect(diffBills(same, { ...same, roundOff: 0 }).identical).toBe(true)
  })
})

describe('Phase 77 - grep guard: only the one shared read decides the options', () => {
  const root = join(__dirname, '..', '..', '..')
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'node_modules') walk(p, out) } else if (/\.(ts|tsx)$/.test(n)) out.push(p)
    }
    return out
  }
  const files = walk(root).map((p) => ({ rel: relative(root, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }))

  it('the setting key / reader is used only by the allowed files', () => {
    const allowed = new Set(['shared/calc/billOptions.ts', 'main/index.ts', 'main/services/appSettingsService.ts'])
    const users = files.filter((f) => /ROUND_OFF_SETTING_KEY|readRoundOffSetting|'calc\.roundOff'/.test(f.src)).map((f) => f.rel)
    expect(users.filter((u) => !allowed.has(u))).toEqual([])
  })
  it('every computeBill caller in the five model files passes getBillOptions (or the options it was given)', () => {
    for (const rel of ['shared/gridModel.ts', 'shared/billModel.ts', 'shared/tsv/billTsv.ts', 'shared/print/printModel.ts']) {
      const src = files.find((f) => f.rel === rel)!.src
      const calls = src.split('\n').filter((l) => /computeBill\(/.test(l) && !/^\s*(\*|\/\/)/.test(l))
      expect(calls.length).toBeGreaterThan(0)
      for (const l of calls) expect(l, `${rel}: ${l.trim()}`).toMatch(/getBillOptions\(|, options\)/)
    }
  })
  it('no other non-test file calls computeBill outside the calc folder and those callers', () => {
    const ok = new Set(['shared/gridModel.ts', 'shared/billModel.ts', 'shared/tsv/billTsv.ts', 'shared/print/printModel.ts', 'shared/calc/billTotals.ts', 'shared/calc/billOptions.ts', 'shared/calc/rowCalc.ts'])
    const stray = files.filter((f) => /\bcomputeBill\(/.test(f.src) && !ok.has(f.rel)).map((f) => f.rel)
    expect(stray).toEqual([])
  })
})
