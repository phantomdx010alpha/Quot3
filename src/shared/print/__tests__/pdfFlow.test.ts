import { describe, expect, it } from 'vitest'
import { countPdfPages, isPdfPath, PDF_OPTIONS, pdfFileName, printDialogKey } from '../printFlow'

const b = (poNumber: string, name: string, billDate = '2026-10-09'): Parameters<typeof pdfFileName>[0] => ({ poNumber, party: { name }, billDate })

describe('Phase 38 - pdfFileName', () => {
  it('PO number wins, then the party name, then "Quotation"; the date is appended', () => {
    expect(pdfFileName(b('Q3-0042', 'Ruby Traders'))).toBe('Q3-0042-2026-10-09.pdf')
    expect(pdfFileName(b('', 'Ruby Traders'))).toBe('Ruby Traders-2026-10-09.pdf')
    expect(pdfFileName(b('', '   '))).toBe('Quotation-2026-10-09.pdf')
  })
  it('Windows-illegal characters and controls become dashes, whitespace collapses, trailing dots go', () => {
    const out = pdfFileName(b('', 'A/B: "C"?*<D>|E\\F'))
    expect(out).toBe('A-B- -C----D--E-F-2026-10-09.pdf')
    expect(pdfFileName(b('', 'Sri   Lakshmi\t Cloth...'))).toBe('Sri Lakshmi Cloth-2026-10-09.pdf')
    expect(pdfFileName(b('', 'a\u0001b'))).toBe('a-b-2026-10-09.pdf')
  })
  it('never yields a path separator or a reserved device name', () => {
    for (const n of ['../../etc/passwd', 'C:\\Windows\\x', 'a/b']) expect(pdfFileName(b('', n))).not.toMatch(/[\\/:]/)
    expect(pdfFileName(b('', 'CON'))).toBe('_CON-2026-10-09.pdf')
    expect(pdfFileName(b('', 'nul'))).toBe('_nul-2026-10-09.pdf')
    expect(pdfFileName(b('', '...'))).toBe('Quotation-2026-10-09.pdf')
  })
  it('caps a very long stem (by characters, never splitting an emoji) and tolerates a bad date', () => {
    const long = pdfFileName(b('', 'x'.repeat(300)))
    expect(long).toBe(`${'x'.repeat(60)}-2026-10-09.pdf`)
    const emoji = pdfFileName(b('', '😀'.repeat(100)))
    expect(Array.from(emoji.replace(/-2026-10-09\.pdf$/, '')).length).toBe(60)
    expect(pdfFileName(b('Q3-1', 'x', 'garbage'))).toBe('Q3-1.pdf')
  })
})

describe('Phase 38 - isPdfPath / countPdfPages / options / dialog key', () => {
  it('isPdfPath is case-insensitive and needs a stem', () => {
    expect(isPdfPath('C:\\a\\b.pdf')).toBe(true)
    expect(isPdfPath('/x/Y.PDF')).toBe(true)
    expect(isPdfPath('x.pdf.txt')).toBe(false)
    expect(isPdfPath('.pdf')).toBe(false)
    expect(isPdfPath('')).toBe(false)
  })
  it('countPdfPages counts /Type /Page objects but not /Pages', () => {
    const pdf = '%PDF-1.4\n1 0 obj\n<</Type /Pages /Count 2>>\nendobj\n2 0 obj\n<</Type /Page /Parent 1 0 R>>\nendobj\n3 0 obj\n<</Type/Page/Parent 1 0 R>>\nendobj\n'
    expect(countPdfPages(new TextEncoder().encode(pdf))).toBe(2)
    expect(countPdfPages(new Uint8Array())).toBe(0)
  })
  it('countPdfPages copes with a large buffer', () => {
    const big = new Uint8Array(300_000).fill(65)
    expect(countPdfPages(big)).toBe(0)
  })
  it('PDF options keep the template page size, backgrounds, and no browser header/footer', () => {
    expect(PDF_OPTIONS).toEqual({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false })
  })
  it('S = save PDF in the dialog (no modifiers), whether or not an acknowledgement is pending', () => {
    expect(printDialogKey({ key: 's' }, { requiresAck: false, acked: false })).toBe('pdf')
    expect(printDialogKey({ key: 'S' }, { requiresAck: true, acked: false })).toBe('pdf')
    expect(printDialogKey({ key: 's', ctrlKey: true }, { requiresAck: false, acked: false })).toBeNull()
  })
})
