import { beforeEach, describe, expect, it } from 'vitest'
import { useBillStore } from '../billStore'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'
import { diffBills } from '@shared/diff/billDiff'
import { normalizeBill } from '@shared/billModel'

const st = () => useBillStore.getState()
const name = (i: number) => st().rows[i]!.nameRuns.map((r) => r.t).join('')
const ruby = (i: number) => st().rows[i]!.extras['ruby']?.text ?? ''
const bodyId = (i: number) => st().view.bodyIds[i] as string

beforeEach(() => { st().loadBill(legacyGridBill()) })

describe('Phase 123 - billStore.moveRow', () => {
  it('moves the item down, extras stay on their positions, ONE undo restores, redo re-applies', () => {
    const n = [name(0), name(1), name(2)]
    const rubies = [ruby(0), ruby(1), ruby(2)]
    const ids = [bodyId(0), bodyId(1)]
    const to = st().moveRow(bodyId(0), 'down')
    expect(to).toBe(1)
    expect([name(0), name(1), name(2)]).toEqual([n[1], n[0], n[2]])
    expect([ruby(0), ruby(1), ruby(2)]).toEqual(rubies)
    expect([bodyId(0), bodyId(1)]).toEqual(ids)
    expect(st().dirty).toBe(true)
    expect(st().undoLabel).toBe('Moved row to 2')
    st().undo()
    expect([name(0), name(1), name(2)]).toEqual(n)
    expect(st().dirty).toBe(false)
    st().redo()
    expect(name(1)).toBe(n[0])
  })
  it('first row up and an unknown id do nothing and record no history entry', () => {
    expect(st().moveRow(bodyId(0), 'up')).toBeNull()
    expect(st().moveRow('nope', 'down')).toBeNull()
    expect(st().canUndo).toBe(false)
    expect(st().dirty).toBe(false)
  })
  it('bottom then top returns to the start; totals follow the new order without changing the grand total', () => {
    const grand = st().view.footer
    const n0 = name(0)
    st().moveRow(bodyId(0), 'bottom')
    expect(name(0)).not.toBe(n0)
    expect(st().view.footer).toEqual(grand)
    const last = st().rows.findIndex((r, i) => i > 0 && name(i) === n0)
    st().moveRow(bodyId(last), 'top')
    expect(name(0)).toBe(n0)
  })
  it('the move survives toBill -> normalizeBill (snapshot round trip) and the diff reports the rows as changed', () => {
    const before = st().toBill()
    st().moveRow(bodyId(1), 'down')
    const after = st().toBill()
    const again = normalizeBill(JSON.parse(JSON.stringify(after)))
    expect(again.rows.map((r) => r.nameRuns.map((x) => x.t).join(''))).toEqual(after.rows.map((r) => r.nameRuns.map((x) => x.t).join('')))
    const d = diffBills(before, after)
    expect(d.identical).toBe(false)
    expect(d.rows.length).toBeGreaterThanOrEqual(2)
  })
})
