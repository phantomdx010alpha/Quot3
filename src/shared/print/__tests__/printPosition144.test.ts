import { describe, expect, it } from 'vitest'
import { buildElectronPrintOptions, parsePrintMarginType, printDebugLine, printPageSize, printPageSizeMicrons } from '../printFlow'
import { PAGE_MARGIN_MM, PAPER_MM } from '../printConstants'
import { pageCss, printCss } from '../template/printCss'

/** Phase 144 - the pure half: the exact options handed to Electron's print call, the debug line, and the "no top offset except the page margin" CSS guard. */
describe('Phase 144 - print options (pure)', () => {
  it('pageSize is an explicit width/height in microns (A4 210x297 mm, A5 148x210 mm)', () => {
    expect(printPageSizeMicrons('A4')).toEqual({ width: 210000, height: 297000 })
    expect(printPageSizeMicrons('A5')).toEqual({ width: 148000, height: 210000 })
    for (const p of ['A4', 'A5'] as const) expect(printPageSizeMicrons(p)).toEqual({ width: PAPER_MM[p].w * 1000, height: PAPER_MM[p].h * 1000 })
  })
  it('the exact options passed to webContents.print (default margin type none, portrait, backgrounds on)', () => {
    expect(buildElectronPrintOptions({ paper: 'A4', silent: false, deviceName: '' })).toEqual({
      silent: false, printBackground: true, deviceName: '', pageSize: { width: 210000, height: 297000 }, margins: { marginType: 'none' }, landscape: false
    })
    expect(buildElectronPrintOptions({ paper: 'A5', silent: true, deviceName: 'HP', marginType: 'printableArea' })).toMatchObject({ silent: true, deviceName: 'HP', pageSize: { width: 148000, height: 210000 }, margins: { marginType: 'printableArea' } })
  })
  it('no scale / pagesPerSheet / header-footer style option is ever passed (nothing can shrink or re-paginate the page)', () => {
    const keys = Object.keys(buildElectronPrintOptions({ paper: 'A4', silent: false, deviceName: '' })).sort()
    expect(keys).toEqual(['deviceName', 'landscape', 'margins', 'pageSize', 'printBackground', 'silent'])
  })
  it('margin type env value: only the three known values, anything else falls back to none', () => {
    expect(parsePrintMarginType('default')).toBe('default')
    expect(parsePrintMarginType('printableArea')).toBe('printableArea')
    expect(parsePrintMarginType('custom')).toBe('none')
    expect(parsePrintMarginType(undefined)).toBe('none')
  })
  it('the string pageSize used by Save PDF and the microns used by Print describe the same sheet', () => {
    expect(printPageSize('A4')).toBe('A4')
    expect(pageCss('A4')).toBe(`@page{size:A4 portrait;margin:${PAGE_MARGIN_MM.A4}mm}`)
  })
  it('debug line carries geometry and device only (no bill content)', () => {
    const l = printDebugLine({ action: 'print', paper: 'A4', pageSize: printPageSizeMicrons('A4'), marginType: 'none', windowWidthPx: 718, contentBottomPx: 900, deviceName: '' })
    expect(l).toContain('paper=A4')
    expect(l).toContain('"width":210000')
    expect(l).toContain('@page{size:A4 portrait;margin:10mm}')
    expect(l).toContain('device=(default/dialog)')
  })
  it('REGRESSION: the only top offset in the template is the @page margin (no vertical centring, no body/sheet margin-top, no padding-top, no 100vh/flex centring)', () => {
    for (const paper of ['A4', 'A5'] as const) {
      const css = printCss(paper, { fontBaseUrl: 'x' })
      const body = /\nbody\{([^}]*)\}/.exec(css)![1]!
      const sheet = /\.q3p-sheet\{([^}]*)\}/.exec(css)![1]!
      for (const rule of [body, sheet]) {
        expect(rule).not.toMatch(/margin-top|padding-top|top:|transform|vh|align-items|justify-content|place-|flex|grid/)
      }
      expect(sheet).toMatch(/margin:0 auto/) // horizontal centring only
      expect(body).toMatch(/display:block/)
      expect(css).toContain(`@page{size:${paper} portrait;margin:${PAGE_MARGIN_MM[paper]}mm}`)
      expect(css).not.toMatch(/html,body\{[^}]*(height:\s*100|min-height:\s*100)/)
    }
  })
})
