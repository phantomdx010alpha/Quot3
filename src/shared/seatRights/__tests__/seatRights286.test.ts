import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALL_SEAT_RIGHTS, NO_SEAT_RIGHTS, PRESETS, SEAT_RIGHT_FLAGS, SEAT_RIGHT_LABELS, SEAT_RIGHTS_HONEST_LIMIT, canDo, effectiveRights, missingSeatFlags, normalizeSeatFlags,
  presetOf, seatFlagsToStore, seatNeedsWords, seatRightsSummary
} from '../index'

describe('Phase 286 seatRights core (M25-4)', () => {
  it('has the eleven flags in the contract order, each with a label', () => {
    expect(SEAT_RIGHT_FLAGS).toHaveLength(11)
    expect(SEAT_RIGHT_FLAGS[0]).toBe('seeAddress')
    expect(SEAT_RIGHT_FLAGS[10]).toBe('editPayments')
    for (const f of SEAT_RIGHT_FLAGS) expect(SEAT_RIGHT_LABELS[f].length).toBeGreaterThan(3)
  })
  it('normalizes: only a real true counts, unknown keys drop, junk = all false', () => {
    const n = normalizeSeatFlags({ seeAddress: true, seeContact: 'true', seeSales: 1, shareBills: true, bogus: true })
    expect(n.seeAddress).toBe(true)
    expect(n.shareBills).toBe(true)
    expect(n.seeContact).toBe(false)
    expect(n.seeSales).toBe(false)
    expect(Object.keys(n)).toHaveLength(11)
    for (const junk of [null, undefined, 5, 'x', [], [true]]) expect(normalizeSeatFlags(junk)).toEqual(NO_SEAT_RIGHTS)
  })
  it('presets: Full all on, Staff = share + price list + edit customers, Viewer = look only', () => {
    expect(PRESETS.Full).toEqual(ALL_SEAT_RIGHTS)
    const on = (p: 'Staff' | 'Viewer') => SEAT_RIGHT_FLAGS.filter((f) => PRESETS[p][f])
    expect(on('Staff')).toEqual(['seePriceList', 'shareBills', 'editCustomers'])
    expect(on('Viewer')).toEqual(['seeAddress', 'seeContact', 'seePriceList', 'seeSales', 'seePayments'])
    expect(presetOf(PRESETS.Staff)).toBe('Staff')
    expect(presetOf({ ...PRESETS.Staff, deleteBills: true })).toBeNull()
  })
  it('seat 1 flags are forced all-true for storing', () => {
    expect(seatFlagsToStore(1, {})).toEqual(ALL_SEAT_RIGHTS)
    expect(seatFlagsToStore(2, { shareBills: true })).toEqual({ ...NO_SEAT_RIGHTS, shareBills: true })
  })
  describe('effectiveRights', () => {
    const base = { seatNo: 2, linked: true, granted: { ...NO_SEAT_RIGHTS, seeSales: true }, configured: true as boolean | null, serverKnows: 'yes' as const }
    it('seat 1 always has everything, whatever is cached', () => {
      expect(effectiveRights({ ...base, seatNo: 1, granted: {} })).toEqual(ALL_SEAT_RIGHTS)
      expect(effectiveRights({ ...base, seatNo: 1, serverKnows: 'no' })).toEqual(ALL_SEAT_RIGHTS)
    })
    it('not linked / no sync = everything', () => {
      expect(effectiveRights({ ...base, linked: false })).toEqual(ALL_SEAT_RIGHTS)
      expect(effectiveRights({ ...base, linked: false, seatNo: null })).toEqual(ALL_SEAT_RIGHTS)
    })
    it('a configured seat gets its row', () => {
      expect(effectiveRights(base)).toEqual({ ...NO_SEAT_RIGHTS, seeSales: true })
    })
    it('a seat the server never configured gets Staff', () => {
      expect(effectiveRights({ ...base, configured: false, granted: NO_SEAT_RIGHTS })).toEqual(PRESETS.Staff)
    })
    it('no answer yet (linked as another seat or unknown seat) = Staff', () => {
      expect(effectiveRights({ seatNo: 3, linked: true, granted: undefined, configured: null, serverKnows: 'unknown' })).toEqual(PRESETS.Staff)
      expect(effectiveRights({ seatNo: null, linked: true, granted: undefined, configured: null, serverKnows: 'unknown' })).toEqual(PRESETS.Staff)
      expect(effectiveRights({ ...base, configured: null })).toEqual(PRESETS.Staff)
    })
    it('an old server (no rights) = everything except editPayments', () => {
      const r = effectiveRights({ ...base, serverKnows: 'no', configured: null, granted: undefined })
      expect(r).toEqual({ ...ALL_SEAT_RIGHTS, editPayments: false })
    })
    it('unreadable granted data for a configured seat is all false, never throws', () => {
      expect(effectiveRights({ ...base, granted: 'junk' })).toEqual(NO_SEAT_RIGHTS)
    })
  })
  it('canDo / missingSeatFlags / needs wording', () => {
    expect(canDo(PRESETS.Staff, 'shareBills')).toBe(true)
    expect(canDo(PRESETS.Staff, 'deleteBills')).toBe(false)
    expect(missingSeatFlags(PRESETS.Staff, ['shareBills', 'deleteBills', 'seeSales'])).toEqual(['deleteBills', 'seeSales'])
    expect(seatNeedsWords(['deleteBills'])).toBe('needs "Delete bills"')
  })
  it('summary names the preset, "Staff (default)" for an unconfigured seat, or Custom', () => {
    expect(seatRightsSummary({ flags: NO_SEAT_RIGHTS, configured: false })).toBe('Staff (default)')
    expect(seatRightsSummary({ flags: PRESETS.Viewer, configured: true })).toBe('Viewer')
    expect(seatRightsSummary({ flags: { ...PRESETS.Viewer, seeSales: false }, configured: true })).toBe('Custom')
  })
  it('the honest limit never claims security', () => {
    expect(SEAT_RIGHTS_HONEST_LIMIT).not.toMatch(/secure|leak-proof|leakproof/i)
    expect(SEAT_RIGHTS_HONEST_LIMIT).toMatch(/in the app only/)
  })
  it('the eleven names are exactly the ones SQL file 23 uses (Phase 285 hand-over)', () => {
    const sql = readFileSync(resolve(__dirname, '../../../../supabase/sql/23_seat_rights.sql'), 'utf8')
    const norm = sql.slice(sql.indexOf('create or replace function public.qt_rights_norm'), sql.indexOf('create or replace function public.qt_rights_flags'))
    const named = [...norm.matchAll(/^\s+'(\w+)',/gm)].map((m) => m[1])
    expect(named).toEqual([...SEAT_RIGHT_FLAGS])
  })
})
