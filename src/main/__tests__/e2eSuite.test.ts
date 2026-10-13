import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pdfPageSize, pngSize, PAPER_PT, manyItems, adjustmentRow } from '../../../tests-e2e/helpers/bills'

/** Phase 66 - the e2e suite itself is not run here (needs a built app + a display); these checks keep its pieces honest. */
const root = resolve(__dirname, '..', '..', '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string>; devDependencies: Record<string, string> }

describe('Phase 66 e2e suite scaffolding', () => {
  it('has the seven flows the phase names (Phase 70 added an eighth), each as a *.e2e.ts file', () => {
    const files = readdirSync(join(root, 'tests-e2e')).filter((f) => f.endsWith('.e2e.ts')).sort()
    expect(files).toEqual([
      '01-create-history.e2e.ts', '02-format-switch.e2e.ts', '03-extra-col-mark.e2e.ts', '04-print-pdf.e2e.ts',
      '05-image-copy.e2e.ts', '06-trash-restore.e2e.ts', '07-backup-restore.e2e.ts', '08-create-fresh-header-align.e2e.ts'
    ])
  })
  it('pins @playwright/test exactly and wires the scripts (build first, xvfb variant, typecheck includes the suite)', () => {
    expect(pkg.devDependencies['@playwright/test']).toBe('1.63.0')
    expect(pkg.scripts['test:e2e']).toBe('electron-vite build && playwright test')
    expect(pkg.scripts['test:e2e:xvfb']).toContain('xvfb-run')
    expect(pkg.scripts['typecheck']).toContain('tsconfig.e2e.json')
  })
  it('the playwright config runs one worker, no retries, only *.e2e.ts, so vitest never picks the specs up', () => {
    const cfg = readFileSync(join(root, 'playwright.config.ts'), 'utf8')
    expect(cfg).toMatch(/workers: 1/)
    expect(cfg).toMatch(/retries: 0/)
    expect(cfg).toContain("testMatch: '**/*.e2e.ts'")
    expect(readFileSync(join(root, 'vitest.config.ts'), 'utf8')).not.toContain('tests-e2e')
  })
  it('a restore only skips the relaunch when QUOT3_E2E=1 (normal runs still relaunch)', () => {
    const src = readFileSync(join(root, 'src/main/import/electronBackupPorts.ts'), 'utf8')
    expect(src).toContain("process.env['QUOT3_E2E'] !== '1'")
    expect(src).toContain('app.relaunch()')
    expect(src).toContain('app.exit(0)')
  })
})

describe('Phase 66 spec helpers', () => {
  it('pdfPageSize reads the MediaBox (A5 and A4 in points)', () => {
    const d = mkdtempSync(join(tmpdir(), 'q3pdf-'))
    const a5 = join(d, 'a5.pdf'); const a4 = join(d, 'a4.pdf'); const none = join(d, 'none.pdf')
    writeFileSync(a5, '%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [0 0 419.53 595.28] >> endobj')
    writeFileSync(a4, '%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [ 0 0 595.28 841.89 ] >> endobj')
    writeFileSync(none, '%PDF-1.4\nnothing here')
    expect(pdfPageSize(a5)).toEqual(PAPER_PT.A5)
    expect(pdfPageSize(a4)).toEqual(PAPER_PT.A4)
    expect(pdfPageSize(none)).toBeNull()
  })
  it('pngSize reads the header and refuses other data', () => {
    const b = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b)
    b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(420, 16); b.writeUInt32BE(595, 20)
    expect(pngSize(b)).toEqual({ width: 420, height: 595 })
    expect(() => pngSize(Buffer.from('GIF89a'))).toThrow()
  })
  it('bill builders: manyItems numbers its rows; an adjustment has a name and an amount only', () => {
    const rows = manyItems(3)
    expect(rows.map((r) => r.idx)).toEqual([0, 1, 2])
    expect(new Set(rows.map((r) => r.id)).size).toBe(3)
    expect(adjustmentRow(0, 'Discount', '-50')).toMatchObject({ qty: null, rate: null, totalOverride: '-50' })
  })
})
