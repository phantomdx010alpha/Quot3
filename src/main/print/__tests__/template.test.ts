import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { printFixture } from '../../../shared/__fixtures__/printBills'
import { simplePaperDecision } from '../../../shared/paper/paperTypes'
import { PRINT_FONT_FILES } from '../../../shared/print/printConstants'
import { DEFAULT_PRINT_SETTINGS } from '../../../shared/print/printModel'
import { printFontBaseUrl, printFontsDir, renderBillHtml } from '../template'

const RES = resolve(__dirname, '../../../../resources')

describe('Phase 33 - main print template entry + bundled fonts', () => {
  it('every declared font file exists in resources/fonts and is a real woff2', () => {
    for (const f of PRINT_FONT_FILES) {
      const p = join(printFontsDir(RES), f.file)
      expect(existsSync(p), p).toBe(true)
      expect(readFileSync(p).subarray(0, 4).toString('latin1')).toBe('wOF2')
    }
  })
  it('the OFL licence ships with the fonts', () => {
    expect(readFileSync(join(RES, 'fonts', 'OFL-NotoSans.txt'), 'utf8')).toContain('SIL Open Font License')
  })
  it('renderBillHtml points @font-face at file:// URLs of the fonts dir', () => {
    const html = renderBillHtml(printFixture('legacy'), 'rough', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A5'), RES)
    expect(printFontBaseUrl(RES).startsWith('file://')).toBe(true)
    expect(html).toContain(`${printFontBaseUrl(RES)}/noto-sans-latin-ext-400-normal.woff2`)
  })
})
