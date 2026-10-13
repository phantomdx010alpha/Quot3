import { describe, expect, it, vi } from 'vitest'
import { A4_DENSITY_TIERS } from '../printConstants'
import { contentHeightPx, fitDensity } from '../printFlow'
import { densityCss } from '../template/printCss'

const FIT = contentHeightPx('A4') - 10
const OVER = contentHeightPx('A4') + 200

describe('Phase 40 - A4 density fit', () => {
  it('tier 0 when the normal style already fits (one measurement)', async () => {
    const m = vi.fn(async () => FIT)
    expect(await fitDensity(m)).toEqual({ tier: 0, fits: true })
    expect(m).toHaveBeenCalledTimes(1)
  })
  it('picks the FIRST (least dense) tier that fits', async () => {
    const m = vi.fn(async (t: number) => (t >= 2 ? FIT : OVER))
    expect(await fitDensity(m)).toEqual({ tier: 2, fits: true })
    expect(m).toHaveBeenCalledTimes(3)
  })
  it('nothing fits: the densest tier, fits false (the bill flows onto a second page)', async () => {
    expect(await fitDensity(async () => OVER)).toEqual({ tier: A4_DENSITY_TIERS.length - 1, fits: false })
  })
  it('tiers get strictly smaller and tier 0 is the normal 9 pt A4 style', () => {
    expect(A4_DENSITY_TIERS[0]!.base).toBe(9)
    for (let i = 1; i < A4_DENSITY_TIERS.length; i++) expect(A4_DENSITY_TIERS[i]!.base).toBeLessThan(A4_DENSITY_TIERS[i - 1]!.base)
  })
  it('densityCss: only tokens, only A4, nothing for tier 0', () => {
    expect(densityCss('A4', 0)).toBe('')
    expect(densityCss('A5', 3)).toBe('')
    expect(densityCss('A4', 2)).toBe(':root{--print-fs:7pt;--print-fs-head:6.5pt;--print-pad-y:0.2mm}')
    expect(densityCss('A4', 99)).toContain('5.5pt')
  })
})
