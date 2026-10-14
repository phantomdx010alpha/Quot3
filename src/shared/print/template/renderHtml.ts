/**
 * Phase 33 - the template renderer: `PrintModel` -> one self-contained HTML document (pure string building, no DOM).
 * The same HTML feeds the preview iframe, `webContents.print`, `printToPDF` and the image capture (MASTERPLAN s12).
 * Rough (Phase 33) and Professional (Phase 34) share one table engine; only the header block differs.
 */
import type { PrintCell, PrintColumn, PrintModel, PrintRow } from '../printModel'
import type { Runs } from '../../types'
import { printCss, type FontSource } from './printCss'

/** Fonts plus (Phase 40) the A4 density tier to render at (0 = the normal style). */
export type RenderOptions = FontSource & { density?: number; /** Phase 148: fit-to-page factor (>= 1; absent / 1 = the normal size). */ fit?: number }

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Styled runs -> spans (`b`, `r`, `hl` classes); an unstyled run is plain escaped text. */
export function runsHtml(runs: Runs): string {
  let out = ''
  for (const r of runs) {
    const cls = [r.r ? 'r' : '', r.b ? 'b' : '', r.hl ? 'hl' : ''].filter(Boolean).join(' ')
    const t = escapeHtml(r.t)
    out += cls ? `<span class="${cls}">${t}</span>` : t
  }
  return out
}

const alignCls = (a: PrintColumn['align']): string => (a === 'right' ? 'q3p-r' : a === 'center' ? 'q3p-c' : 'q3p-l')
const isNumeric = (a: PrintColumn['align']): boolean => a === 'right'

function cellHtml(col: PrintColumn, cell: PrintCell | undefined): string {
  const c = cell ?? { text: '' }
  const cls = [alignCls(col.align), isNumeric(col.align) ? 'q3p-n' : '', c.hl ? 'q3p-hl' : ''].filter(Boolean).join(' ')
  const inner = c.runs ? runsHtml(c.runs) : escapeHtml(c.text)
  return `<td class="${cls}">${inner}</td>`
}

function bodyRowHtml(cols: PrintColumn[], row: PrintRow): string {
  const cls = row.kind === 'adjustment' ? ' class="q3p-adj"' : row.kind === 'tail' ? ' class="q3p-tailrow"' : ''
  return `<tr${cls}>${cols.map((c) => cellHtml(c, row.cells[c.key])).join('')}</tr>`
}

/** A total row: the label spans every column before the first value column and is right-aligned. */
function totalRowHtml(cols: PrintColumn[], row: PrintRow): string {
  let first = cols.findIndex((c) => row.cells[c.key] !== undefined)
  if (first < 0) first = cols.length
  if (first === 0) first = 1
  const kindCls = row.kind === 'grandTotal' ? 'q3p-tot--grand' : row.kind === 'itemsTotal' ? 'q3p-tot--items' : row.kind === 'adjustmentsTotal' ? 'q3p-tot--adj' : ''
  let html = `<tr class="q3p-tot ${kindCls}"><td class="q3p-lbl" colspan="${first}">${escapeHtml(row.label ?? '')}</td>`
  for (let i = first; i < cols.length; i++) {
    const col = cols[i] as PrintColumn
    const cell = row.cells[col.key]
    html += cell ? cellHtml(col, cell) : '<td></td>'
  }
  return `${html}</tr>`
}

/** Only image sources that need no network and cannot carry script: data:image/*, file:, or a plain relative/absolute path. */
export function safeLogoSrc(src: string): string {
  const t = src.trim()
  if (t === '') return ''
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(t)) return t
  if (/^file:\/\//i.test(t)) return t
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return ''
  return t
}

function roughHead(h: Extract<PrintModel['header'], { kind: 'rough' }>): string {
  const { name, phone, transport } = h.party
  const subs: string[] = []
  if (phone) subs.push(`<span><b>Phone:</b> ${escapeHtml(phone)}</span>`)
  if (transport) subs.push(`<span><b>Transport:</b> ${escapeHtml(transport)}</span>`)
  if (h.docTitle) {
    // Phase 149: a stock transfer: the title, then the branch the stock comes from.
    const from = name ? `<p class="q3p-sub"><span><b>From branch:</b> ${escapeHtml(name)}</span></p>` : ''
    return `<header class="q3p-head"><h1 class="q3p-party">${escapeHtml(h.docTitle)}</h1>${from}</header>`
  }
  const party = name ? `<h1 class="q3p-party">${escapeHtml(name)}</h1>` : ''
  const sub = subs.length ? `<p class="q3p-sub">${subs.join('')}</p>` : ''
  return party || sub ? `<header class="q3p-head">${party}${sub}</header>` : ''
}

function proHead(h: Extract<PrintModel['header'], { kind: 'professional' }>): string {
  const c = h.company
  const logo = safeLogoSrc(c.logo)
  const lines = [c.phone ? `<p class="q3p-co-line"><b>Phone:</b> ${escapeHtml(c.phone)}</p>` : '', c.address ? `<p class="q3p-co-line">${escapeHtml(c.address)}</p>` : ''].join('')
  const company =
    `<div class="q3p-co">${logo ? `<img class="q3p-logo" alt="" src="${escapeHtml(logo)}">` : ''}` +
    `<div class="q3p-co-text"><h2 class="q3p-co-name">${escapeHtml(c.name)}</h2>${lines}</div></div>`
  const meta = `<div class="q3p-meta">${h.poNumber ? `<p><b>PO No:</b> ${escapeHtml(h.poNumber)}</p>` : ''}${h.billDate ? `<p><b>Date:</b> ${escapeHtml(h.billDate)}</p>` : ''}</div>`
  const p = h.party
  const plines = [
    p.address ? `<p class="q3p-line">${escapeHtml(p.address)}</p>` : '',
    p.phone ? `<p class="q3p-line"><b>Phone:</b> ${escapeHtml(p.phone)}</p>` : '',
    p.transport ? `<p class="q3p-line"><b>Transport:</b> ${escapeHtml(p.transport)}</p>` : ''
  ].join('')
  const label = h.docTitle ? `${h.docTitle} from` : 'Quotation for' // Phase 149
  const to = p.name || plines ? `<section class="q3p-to"><p class="q3p-to-label">${escapeHtml(label)}</p>${p.name ? `<h1 class="q3p-party">${escapeHtml(p.name)}</h1>` : ''}${plines}</section>` : ''
  return `<header class="q3p-head"><div class="q3p-pro">${company}${meta}</div>${to}</header>`
}

function headHtml(m: PrintModel): string {
  return m.header.kind === 'rough' ? roughHead(m.header) : proHead(m.header)
}

/** The full HTML document for a model. */
export function renderPrintHtml(m: PrintModel, opts: RenderOptions = {}): string {
  const head = headHtml(m)
  const colgroup = `<colgroup>${m.columns.map((c) => `<col style="width:${(c.share / 100).toFixed(2)}%">`).join('')}</colgroup>`
  const thead = `<thead><tr>${m.columns.map((c) => `<th class="${alignCls(c.align)}">${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`
  const rows = m.body.map((r) => bodyRowHtml(m.columns, r)).join('')
  const foot = m.footer.map((r) => (r.label !== undefined ? totalRowHtml(m.columns, r) : bodyRowHtml(m.columns, r))).join('')
  const tail = (m.tail ?? []).map((r) => bodyRowHtml(m.columns, r)).join('')
  const tailGroup = tail === '' ? '' : `<tbody class="q3p-tail">${tail}</tbody>`
  const title = m.header.docTitle || m.header.party.name || 'Quotation'
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>${printCss(m.paper.size, opts, opts.density ?? 0, opts.fit)}</style></head>` +
    `<body class="q3p q3p--${m.mode} q3p--${m.paper.size}" data-paper="${m.paper.size}" data-mode="${m.mode}"><main class="q3p-sheet">` +
    `${head}<table class="q3p-table">${colgroup}${thead}<tbody class="q3p-main">${rows}</tbody><tbody class="q3p-foot">${foot}</tbody>${tailGroup}</table></main></body></html>`
  )
}
