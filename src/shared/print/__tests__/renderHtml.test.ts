import { describe, expect, it } from 'vitest'
import { printFixture } from '../../__fixtures__/printBills'
import { simplePaperDecision } from '../../paper/paperTypes'
import { PRINT_FONT_FILES } from '../printConstants'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS, PLACEHOLDER_COMPANY } from '../printModel'
import { SAMPLE_LOGO_WIDE } from '../../__fixtures__/printLogo'
import { escapeHtml, renderPrintHtml, runsHtml, safeLogoSrc } from '../template/renderHtml'

const html = (id: Parameters<typeof printFixture>[0], paper: 'A5' | 'A4' = 'A5', opts = {}): string =>
  renderPrintHtml(buildPrintModel(printFixture(id), 'rough', DEFAULT_PRINT_SETTINGS, simplePaperDecision(paper)), opts)

describe('Phase 33 - template renderer', () => {
  it('escapes text and renders runs as r / b / hl spans', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
    expect(runsHtml([{ t: 'a' }, { t: 'b', b: 1 }, { t: 'c', r: 1, b: 1 }, { t: 'd', hl: 1 }])).toBe('a<span class="b">b</span><span class="r b">c</span><span class="hl">d</span>')
    const h = html('styled')
    expect(h).toContain('<span class="r b">red bold</span>')
    expect(h).toContain('&amp; &lt;tag&gt; &quot;q&quot;')
    expect(h).not.toContain('<tag>')
  })
  it('A5 and A4 get their own @page size and small fixed margin', () => {
    expect(html('legacy', 'A5')).toContain('@page{size:A5 portrait;margin:6mm}')
    expect(html('legacy', 'A4')).toContain('@page{size:A4 portrait;margin:10mm}')
    expect(html('legacy', 'A4')).toContain('data-paper="A4"')
  })
  it('declares the bundled font (regular + bold, latin + latin-ext with the rupee range) from fontBaseUrl or per-file URLs', () => {
    const h = html('legacy', 'A5', { fontBaseUrl: 'file:///app/resources/fonts/' })
    for (const f of PRINT_FONT_FILES) expect(h).toContain(`file:///app/resources/fonts/${f.file}`)
    expect(h).toContain("font-family:'Quot3 Noto Sans'")
    expect(h).toContain('U+20AD-20C0') // covers U+20B9
    const over = html('legacy', 'A5', { fontUrls: { 'noto-sans-latin-400-normal.woff2': '/assets/x.woff2' } })
    expect(over).toContain('url("/assets/x.woff2")')
  })
  it('print tokens are --print-* and nothing references the UI theme tokens', () => {
    const h = html('legacy')
    expect(h).toContain('--print-font')
    expect(h).not.toMatch(/var\(--(?!print-)/)
  })
  it('Rough header: party name, phone, transport; no PO, address or company', () => {
    const h = html('legacy')
    expect(h).toContain('<h1 class="q3p-party">Ruby Traders</h1>')
    expect(h).toContain('98450 12345')
    expect(h).toContain('SRS Travels')
    expect(h).not.toContain('Market Road')
    expect(h).not.toContain('Q3-0007')
  })
  it('table: colgroup widths sum to 100, header repeats (thead), total label spans, rupee sign printed', () => {
    const h = html('legacy')
    const widths = [...h.matchAll(/<col style="width:([\d.]+)%">/g)].map((m) => Number(m[1]))
    expect(widths).toHaveLength(7)
    expect(Math.round(widths.reduce((a, b) => a + b, 0) * 100)).toBe(10000)
    expect(h).toContain('<thead>')
    expect(h).toContain('table-header-group')
    expect(h).toMatch(/<td class="q3p-lbl" colspan="4">Total<\/td>/)
    expect(h).toContain('₹17226.00')
  })
  it('adjustments: label rows span, adjustment rows are normal rows with their name', () => {
    const h = html('adjustment')
    expect(h).toContain('>Items total</td>')
    expect(h).toContain('<tr class="q3p-adj">')
    expect(h).toContain('>Discount</td>')
    expect(h).toContain('>Final total</td>')
  })
  it('long text wraps (never clips or nowrap on text cells)', () => {
    const h = html('longText')
    expect(h).toContain('overflow-wrap:anywhere')
    // Phase 35: only numeric cells (td.q3p-n) are nowrap; text cells and headers always wrap
    expect(h.match(/white-space:nowrap/g)?.length).toBe(1)
    expect(h).toContain('td.q3p-n{font-variant-numeric:tabular-nums;white-space:nowrap')
    expect(h).toContain('long item name long item name')
  })
  it('Professional header: company block, party details, PO number and date; Rough still has none of them', () => {
    const pro = renderPrintHtml(buildPrintModel(printFixture('legacy'), 'professional', { ...DEFAULT_PRINT_SETTINGS, company: { logo: '', name: 'Acme & Sons', phone: '99999 11111', address: '1 Main St' } }, simplePaperDecision('A5')))
    expect(pro).toContain('Acme &amp; Sons')
    expect(pro).toContain('99999 11111')
    expect(pro).toContain('1 Main St')
    expect(pro).toContain('<b>PO No:</b> Q3-0007')
    expect(pro).toContain('<b>Date:</b> 08 Oct 2026')
    expect(pro).toContain('12, Market Road, Bengaluru')
    expect(pro).toContain('SRS Travels')
    expect(pro).toContain('>Ruby Traders</h1>')
    expect(pro).not.toContain('<img')
    expect(html('legacy')).not.toContain('PO No')
  })
  it('Professional without Settings uses the placeholder company (until Phase 48)', () => {
    const pro = renderPrintHtml(buildPrintModel(printFixture('legacy'), 'professional', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A5')))
    expect(pro).toContain(PLACEHOLDER_COMPANY.name)
  })
  it('logo: aspect-preserving CSS caps (height per paper, width share); unsafe sources are dropped', () => {
    const mk = (logo: string, paper: 'A5' | 'A4' = 'A5') => renderPrintHtml(buildPrintModel(printFixture('legacy'), 'professional', { ...DEFAULT_PRINT_SETTINGS, company: { logo, name: 'X', phone: '', address: '' } }, simplePaperDecision(paper)))
    const a5 = mk(SAMPLE_LOGO_WIDE)
    expect(a5).toContain('<img class="q3p-logo" alt="" src="data:image/svg+xml;base64,')
    expect(a5).toContain('--print-logo-h:14mm')
    expect(mk(SAMPLE_LOGO_WIDE, 'A4')).toContain('--print-logo-h:20mm')
    expect(a5).toMatch(/\.q3p-logo\{[^}]*object-fit:contain/)
    expect(a5).toMatch(/\.q3p-logo\{[^}]*width:auto;height:auto/)
    expect(mk('https://evil.example/x.png')).not.toContain('<img')
    expect(mk('javascript:alert(1)')).not.toContain('<img')
    expect(mk('data:text/html;base64,AAAA')).not.toContain('<img')
    expect(mk('file:///C:/logo.png')).toContain('<img')
    expect(safeLogoSrc('')).toBe('')
  })
  it('Professional: missing party fields are left out; long company and party text wraps', () => {
    const b = printFixture('legacy'); b.party = { name: 'Solo', phone: '', address: '', transport: '' }
    const pro = renderPrintHtml(buildPrintModel(b, 'professional', { ...DEFAULT_PRINT_SETTINGS, company: { logo: '', name: 'N'.repeat(120), phone: '', address: '' } }, simplePaperDecision('A4')))
    expect(pro).not.toContain('Transport:')
    expect(pro).toContain('overflow-wrap:anywhere')
    expect(pro).toContain('>Solo</h1>')
  })
  it('snapshot: full Rough A5 document for the adjustment fixture', () => {
    expect(html('adjustment', 'A5', { fontBaseUrl: 'fonts' })).toMatchSnapshot()
  })
  it('Phase 35: totals are a separate non-repeating row group; header repeats; no hyphenation; long codes break anywhere', () => {
    const h = html('rows81', 'A4')
    expect(h).toContain('<tbody class="q3p-main">')
    expect(h).toContain('<tbody class="q3p-foot">')
    expect(h).not.toContain('<tfoot')
    expect(h.match(/<thead>/g)?.length).toBe(1)
    expect(h).toContain('thead{display:table-header-group}')
    expect(h).toContain('tbody.q3p-foot{break-inside:avoid')
    expect(h).toContain('hyphens:none')
    expect(h).toContain('overflow-wrap:anywhere')
    // every total row is inside the foot group, after every item row
    const foot = h.slice(h.indexOf('<tbody class="q3p-foot">'))
    expect(foot).toContain('>Total</td>')
    expect(h.slice(0, h.indexOf('<tbody class="q3p-foot">'))).not.toContain('>Total</td>')
  })
  it('Phase 35 fixtures exist: long names/header, 3-extra GST, 81 and 150 rows', () => {
    expect(printFixture('name60').rows[0]?.nameRuns.map((r) => r.t).join('')).toHaveLength(60)
    expect(printFixture('name120').rows[0]?.nameRuns.map((r) => r.t).join('')).toHaveLength(120)
    expect(printFixture('header40').extraCols[0]?.header).toHaveLength(40)
    expect(printFixture('gstExtra3').extraCols).toHaveLength(3)
    expect(printFixture('gstExtra3').formatId).toBe('gst')
    expect(printFixture('rows81').rows).toHaveLength(81)
    expect(printFixture('rows150').rows).toHaveLength(150)
  })
})

describe('Phase 73 - print is top-aligned (template diagnosis)', () => {
  it('the stylesheet never centres vertically: no vertical auto margins, flex/grid centring, or top offsets on body/sheet', async () => {
    const { printCss } = await import('../template/printCss')
    for (const paper of ['A5', 'A4'] as const) {
      const css = printCss(paper, { fontBaseUrl: 'file:///f' })
      const rule = (sel: string): string => css.split('\n').find((l) => l.startsWith(sel)) ?? ''
      const sheet = rule('.q3p-sheet{')
      expect(sheet).toContain('margin:0 auto') // horizontal centring only
      expect(sheet).not.toMatch(/margin-top|top:|transform|align-items|place-/)
      expect(rule('body{')).not.toMatch(/align-items|justify-content|place-|margin-top|padding-top|display:flex|display:grid|height:100/)
      expect(rule('html,body{')).toContain('margin:0;padding:0')
      expect(css).toMatch(/@page\{size:A[45] portrait;margin:[\d.]+mm\}/) // the only top gap is the @page margin
    }
  })
})
