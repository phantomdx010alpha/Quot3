/**
 * Phase 184 - phone share, step 1: lay a `PrintModel` out as flat draw operations (pure: no DOM, no canvas, no Electron).
 * The text widths come from an injected `Measure`, so the same layout runs in the browser (canvas `measureText`) and in tests
 * (a fixed-width fake). All numbers and rows come from the shared print model (which gets its money text from `computeBill`);
 * nothing is recomputed here. Paper size comes from the model's `PaperDecision`; geometry from `printConstants.ts`.
 * Units are CSS px at scale 1 (the canvas multiplies by its device scale).
 */
import type { PrintCell, PrintColumn, PrintModel, PrintRow } from '../../shared/print/printModel'
import { A4_DENSITY_TIERS, LOGO_MAX_HEIGHT_MM, LOGO_MAX_WIDTH_PCT, PAGE_MARGIN_MM, PAPER_MM, PRINT_FONT_PT } from '../../shared/print/printConstants'
import { safeLogoSrc } from '../../shared/print/template/renderHtml'
import type { Runs } from '../../shared/types'

export const MM_PX = 96 / 25.4
const PT_PX = 96 / 72
/** Print is never themed: these mirror the `--print-*` tokens in `printCss.ts`. */
export const SHARE_COLORS = { ink: '#000000', red: '#c00000', hl: '#fff2a8', line: '#222222', soft: '#777777', headBg: '#ececec', paper: '#ffffff' } as const

export interface TextStyle { bold: boolean; sizePx: number }
/** Width in px of `text` drawn with `style` (no wrapping). */
export type Measure = (text: string, style: TextStyle) => number

export type DrawOp =
  | { op: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: string }
  | { op: 'text'; x: number; y: number; h: number; text: string; bold: boolean; sizePx: number; color: string }
  | { op: 'image'; x: number; y: number; w: number; h: number; src: string }

export interface LayoutRowSpan { group: 'head' | 'body' | 'foot' | 'tail'; top: number; bottom: number }
export interface ShareLayout {
  /** Printable width in px (page width minus both margins, as in print). */
  width: number
  /** Height of everything, px. */
  height: number
  ops: DrawOp[]
  rows: LayoutRowSpan[]
  /** Y positions (px) where each page after the first starts; empty = one page. */
  pageBreaks: number[]
  /** A4 density tier used (0 = normal). */
  tier: number
}

export interface LogoInfo { src: string; naturalW: number; naturalH: number }
export interface LayoutOptions {
  /** A loaded company logo (Professional only). Its `src` must already pass `safeLogoSrc`. */
  logo?: LogoInfo | null
  /** A4 density tier (Phase 40 rule); 0 = normal. */
  tier?: number
}

/** Printable width / page height available to content, px. */
export const contentWidth = (m: PrintModel): number => (PAPER_MM[m.paper.size].w - 2 * PAGE_MARGIN_MM[m.paper.size]) * MM_PX
export const contentPageHeight = (m: PrintModel): number => (PAPER_MM[m.paper.size].h - 2 * PAGE_MARGIN_MM[m.paper.size]) * MM_PX

interface Sizes { base: number; head: number; party: number; padY: number; padX: number }
function sizesFor(m: PrintModel, tier: number): Sizes {
  const pt = PRINT_FONT_PT[m.paper.size]
  const t = m.paper.size === 'A4' && tier > 0 ? A4_DENSITY_TIERS[Math.min(tier, A4_DENSITY_TIERS.length - 1)]! : null
  return { base: (t ? t.base : pt.base) * PT_PX, head: (t ? t.head : pt.head) * PT_PX, party: pt.party * PT_PX, padY: (t ? t.padY : 0.3) * MM_PX, padX: 1.2 * MM_PX }
}

interface Piece { text: string; bold: boolean; red: boolean; hl: boolean; w: number }
interface Line { pieces: Piece[]; width: number }

function runPieces(runs: Runs, baseBold: boolean, size: number, measure: Measure): { text: string; bold: boolean; red: boolean; hl: boolean }[] {
  const out: { text: string; bold: boolean; red: boolean; hl: boolean }[] = []
  for (const r of runs) {
    // Words keep their trailing spaces; a newline in a name is a space (the print table wraps by width only).
    const words = r.t.replace(/\r?\n/g, ' ').match(/\S+\s*|\s+/g) ?? []
    for (const w of words) out.push({ text: w, bold: baseBold || !!r.b || !!r.r, red: !!r.r, hl: !!r.hl })
  }
  void size; void measure
  return out
}

/** Greedy word wrap of styled words into `maxW`. A word wider than the line is broken by characters (never clipped). */
function wrap(words: { text: string; bold: boolean; red: boolean; hl: boolean }[], maxW: number, size: number, measure: Measure): Line[] {
  const lines: Line[] = []
  let cur: Line = { pieces: [], width: 0 }
  const push = (): void => { if (cur.pieces.length > 0) lines.push(cur); cur = { pieces: [], width: 0 } }
  const w = (t: string, bold: boolean): number => measure(t, { bold, sizePx: size })
  for (const word of words) {
    const trimmed = word.text.replace(/\s+$/, '')
    const full = w(word.text, word.bold)
    const need = w(trimmed, word.bold)
    if (cur.width + need <= maxW + 0.01) { cur.pieces.push({ ...word, w: full }); cur.width += full; continue }
    if (cur.pieces.length > 0) push()
    if (need <= maxW + 0.01) { cur.pieces.push({ ...word, w: full }); cur.width = full; continue }
    // Break a long word by characters.
    let chunk = ''
    for (const ch of Array.from(trimmed)) {
      if (chunk !== '' && w(chunk + ch, word.bold) > maxW) { cur.pieces.push({ ...word, text: chunk, w: w(chunk, word.bold) }); cur.width = w(chunk, word.bold); push(); chunk = ch } else chunk += ch
    }
    if (chunk !== '') { cur.pieces.push({ ...word, text: chunk, w: w(chunk, word.bold) }); cur.width = w(chunk, word.bold) }
  }
  push()
  return lines.length > 0 ? lines : [{ pieces: [], width: 0 }]
}

const LH = 1.15
/** Y offset of a text box top: ops carry the box top; the canvas draws with an 'alphabetic' baseline at top + size * ASCENT. */
export const ASCENT = 0.92

class Builder {
  ops: DrawOp[] = []
  constructor(readonly measure: Measure) {}

  /** Draw wrapped styled text; returns its height. `align` places each line inside [x, x + maxW]. */
  block(words: ReturnType<typeof runPieces>, x: number, y: number, maxW: number, size: number, align: 'left' | 'right' | 'center', nowrap = false): number {
    const lines = nowrap ? [this.single(words, size)] : wrap(words, maxW, size, this.measure)
    const lh = size * LH
    lines.forEach((ln, i) => {
      const trailing = ln.pieces.length > 0 ? ln.pieces[ln.pieces.length - 1]! : null
      const trimW = trailing ? ln.width - (trailing.w - this.measure(trailing.text.replace(/\s+$/, ''), { bold: trailing.bold, sizePx: size })) : 0
      let px = align === 'right' ? x + maxW - trimW : align === 'center' ? x + (maxW - trimW) / 2 : x
      const top = y + i * lh
      for (const p of ln.pieces) {
        const shown = p.text.replace(/\s+$/, '')
        if (p.hl && shown !== '') this.ops.push({ op: 'rect', x: px, y: top, w: this.measure(shown, { bold: p.bold, sizePx: size }), h: lh, fill: SHARE_COLORS.hl })
        if (shown !== '') this.ops.push({ op: 'text', x: px, y: top, h: lh, text: shown, bold: p.bold, sizePx: size, color: p.red ? SHARE_COLORS.red : SHARE_COLORS.ink })
        px += p.w
      }
    })
    return lines.length * lh
  }

  private single(words: ReturnType<typeof runPieces>, size: number): Line {
    const pieces = words.map((p) => ({ ...p, w: this.measure(p.text, { bold: p.bold, sizePx: size }) }))
    return { pieces, width: pieces.reduce((a, p) => a + p.w, 0) }
  }

  height(words: ReturnType<typeof runPieces>, maxW: number, size: number, nowrap = false): number {
    const n = nowrap ? 1 : wrap(words, maxW, size, this.measure).length
    return n * size * LH
  }
}

const plain = (text: string, bold = false): ReturnType<typeof runPieces> => runPieces([{ t: text, ...(bold ? { b: 1 as const } : {}) }], bold, 0, () => 0)
const labelled = (label: string, value: string): ReturnType<typeof runPieces> => [...plain(`${label} `, true), ...plain(value)]

/** The layout of a whole model at one density tier. */
export function layoutPrintModel(m: PrintModel, measure: Measure, opts: LayoutOptions = {}): ShareLayout {
  const tier = m.paper.size === 'A4' ? Math.max(0, Math.floor(opts.tier ?? 0)) : 0
  const S = sizesFor(m, tier)
  const W = contentWidth(m)
  const b = new Builder(measure)
  let y = 0

  // ---- header block ----
  const gap = 1.5 * MM_PX
  if (m.header.kind === 'rough') {
    const h = m.header
    if (h.docTitle) {
      y += b.block(plain(h.docTitle, true), 0, y, W, S.party, 'left')
      if (h.party.name) y += 0.5 * MM_PX + b.block(labelled('From branch:', h.party.name), 0, y + 0.5 * MM_PX, W, S.base, 'left')
    } else {
      if (h.party.name) y += b.block(plain(h.party.name, true), 0, y, W, S.party, 'left')
      const subs: string[] = []
      if (h.party.phone) subs.push(`Phone: ${h.party.phone}`)
      if (h.party.transport) subs.push(`Transport: ${h.party.transport}`)
      if (subs.length > 0) {
        let sx = 0
        y += 0.5 * MM_PX
        let lineH = 0
        for (const s of subs) {
          const [lab, ...rest] = [s.slice(0, s.indexOf(':') + 1), s.slice(s.indexOf(':') + 2)]
          const words = labelled(lab ?? '', rest.join(''))
          const wTot = words.reduce((a, p) => a + measure(p.text, { bold: p.bold, sizePx: S.base }), 0)
          if (sx > 0 && sx + wTot > W) { y += lineH; sx = 0; lineH = 0 }
          const hgt = b.block(words, sx, y, Math.max(W - sx, 1), S.base, 'left')
          lineH = Math.max(lineH, hgt)
          sx += wTot + 5 * MM_PX
        }
        y += lineH
      }
    }
    if (y > 0) y += gap
  } else {
    const h = m.header
    const logo = opts.logo ?? null
    const metaLines: ReturnType<typeof runPieces>[] = []
    if (h.poNumber) metaLines.push(labelled('PO No:', h.poNumber))
    if (h.billDate) metaLines.push(labelled('Date:', h.billDate))
    const metaW = metaLines.length > 0 ? W * 0.42 : 0
    const colGap = 4 * MM_PX
    const coW = W - metaW - (metaW > 0 ? colGap : 0)
    // Company (left): optional logo, then name + phone + address.
    let logoW = 0, logoH = 0
    if (logo && logo.naturalW > 0 && logo.naturalH > 0) {
      const maxH = LOGO_MAX_HEIGHT_MM[m.paper.size] * MM_PX, maxW = (W * LOGO_MAX_WIDTH_PCT) / 100
      const k = Math.min(maxH / logo.naturalH, maxW / logo.naturalW, 1e9)
      logoW = logo.naturalW * k; logoH = logo.naturalH * k
    }
    const textX = logoW > 0 ? logoW + 2.5 * MM_PX : 0
    const textW = Math.max(coW - textX, 20)
    let cy = 0
    cy += b.block(plain(h.company.name, true), textX, cy, textW, S.party, 'left')
    if (h.company.phone) cy += 0.3 * MM_PX + b.block(labelled('Phone:', h.company.phone), textX, cy + 0.3 * MM_PX, textW, S.base, 'left')
    if (h.company.address) cy += 0.3 * MM_PX + b.block(plain(h.company.address), textX, cy + 0.3 * MM_PX, textW, S.base, 'left')
    if (logoW > 0 && logo) b.ops.push({ op: 'image', x: 0, y: 0, w: logoW, h: logoH, src: logo.src })
    let my = 0
    for (const ml of metaLines) my += 0.4 * MM_PX + b.block(ml, W - metaW, my, metaW, S.base, 'right')
    y = Math.max(cy, logoH, my) + gap
    b.ops.push({ op: 'line', x1: 0, y1: y, x2: W, y2: y, width: 0.35 * MM_PX, color: SHARE_COLORS.line })
    y += gap
    // "Quotation for" block.
    const p = h.party
    const label = h.docTitle ? `${h.docTitle} from` : 'Quotation for'
    const lines: ReturnType<typeof runPieces>[] = []
    if (p.address) lines.push(plain(p.address))
    if (p.phone) lines.push(labelled('Phone:', p.phone))
    if (p.transport) lines.push(labelled('Transport:', p.transport))
    if (p.name || lines.length > 0) {
      y += b.block(plain(label.toUpperCase(), true), 0, y, W, S.head, 'left')
      if (p.name) y += 0.3 * MM_PX + b.block(plain(p.name, true), 0, y + 0.3 * MM_PX, W, S.party, 'left')
      for (const l of lines) y += 0.3 * MM_PX + b.block(l, 0, y + 0.3 * MM_PX, W, S.base, 'left')
      y += gap
    }
  }

  // ---- table ----
  const cols = m.columns
  const xs: number[] = [0]
  let acc = 0
  for (const c of cols) { acc += (c.share / 10000) * W; xs.push(acc) }
  xs[xs.length - 1] = W
  const spans: LayoutRowSpan[] = []
  const tableTop = y

  const cellOf = (col: PrintColumn, cell: PrintCell | undefined): { words: ReturnType<typeof runPieces>; nowrap: boolean } => {
    const c = cell ?? { text: '' }
    const nowrap = col.align === 'right'
    return { words: c.runs ? runPieces(c.runs, false, 0, measure) : plain(c.text), nowrap }
  }

  /** Draws one row's cells; returns its height. `labelSpan`: total rows with a label spanning the columns before the first value. */
  const drawRow = (cells: { col: number; span: number; words: ReturnType<typeof runPieces>; align: PrintColumn['align']; nowrap: boolean; size: number; bold: boolean; hl: boolean }[], top: number, bg: string | null): number => {
    let h = 0
    for (const c of cells) {
      const w = (xs[c.col + c.span] ?? W) - (xs[c.col] ?? 0) - 2 * S.padX
      h = Math.max(h, b.height(c.words, Math.max(w, 1), c.size, c.nowrap))
    }
    h += 2 * S.padY
    const full = cells.reduce((a, c) => a + c.span, 0)
    void full
    if (bg) b.ops.push({ op: 'rect', x: 0, y: top, w: W, h, fill: bg })
    for (const c of cells) {
      const x0 = xs[c.col] ?? 0, x1 = xs[c.col + c.span] ?? W
      if (c.hl) b.ops.push({ op: 'rect', x: x0, y: top, w: x1 - x0, h, fill: SHARE_COLORS.hl })
      const words = c.bold ? c.words.map((p) => ({ ...p, bold: true })) : c.words
      b.block(words, x0 + S.padX, top + S.padY, Math.max(x1 - x0 - 2 * S.padX, 1), c.size, c.align, c.nowrap)
    }
    return h
  }
  const hline = (yy: number, width: number, color: string): void => { b.ops.push({ op: 'line', x1: 0, y1: yy, x2: W, y2: yy, width, color }) }
  const vlines = (top: number, bottom: number, color: string): void => { for (const x of xs) b.ops.push({ op: 'line', x1: x, y1: top, x2: x, y2: bottom, width: 0.2 * MM_PX, color }) }

  // Header row.
  const headH = drawRow(cols.map((c, i) => ({ col: i, span: 1, words: plain(c.label, true), align: c.align, nowrap: false, size: S.head, bold: true, hl: false })), y, SHARE_COLORS.headBg)
  spans.push({ group: 'head', top: y, bottom: y + headH })
  vlines(y, y + headH, SHARE_COLORS.line); hline(y + headH, 0.2 * MM_PX, SHARE_COLORS.line)
  y += headH

  const bodyRow = (r: PrintRow, group: 'body' | 'tail'): void => {
    const cells = cols.map((c, i) => {
      const cell = r.cells[c.key]
      const { words, nowrap } = cellOf(c, cell)
      return { col: i, span: 1, words, align: c.align, nowrap, size: S.base, bold: false, hl: cell?.hl === 1 }
    })
    const h = drawRow(cells, y, null)
    vlines(y, y + h, SHARE_COLORS.soft); hline(y + h, 0.2 * MM_PX, SHARE_COLORS.soft)
    spans.push({ group, top: y, bottom: y + h })
    y += h
  }
  const totalRow = (r: PrintRow): void => {
    let first = cols.findIndex((c) => r.cells[c.key] !== undefined)
    if (first < 0) first = cols.length
    if (first === 0) first = 1
    const cells: Parameters<typeof drawRow>[0] = [{ col: 0, span: first, words: plain(r.label ?? '', true), align: 'right', nowrap: false, size: S.base, bold: true, hl: false }]
    for (let i = first; i < cols.length; i++) {
      const c = cols[i] as PrintColumn
      const cell = r.cells[c.key]
      if (cell) cells.push({ col: i, span: 1, words: plain(cell.text), align: c.align, nowrap: c.align === 'right', size: S.base, bold: r.kind === 'grandTotal' || r.kind === 'itemsTotal' || r.kind === 'adjustmentsTotal', hl: false })
    }
    const top = y
    const h = drawRow(cells, top, null)
    vlines(top, top + h, SHARE_COLORS.soft)
    if (r.kind === 'grandTotal') { hline(top, 0.35 * MM_PX, SHARE_COLORS.line); hline(top + h, 0.35 * MM_PX, SHARE_COLORS.line) } else hline(top + h, 0.2 * MM_PX, SHARE_COLORS.soft)
    spans.push({ group: 'foot', top, bottom: top + h })
    y += h
  }

  for (const r of m.body) bodyRow(r, 'body')
  for (const r of m.footer) { if (r.label !== undefined) totalRow(r); else bodyRow(r, 'body') }
  for (const r of m.tail) bodyRow(r, 'tail')

  // Table outline.
  const outer = 0.35 * MM_PX
  b.ops.push({ op: 'line', x1: 0, y1: tableTop, x2: W, y2: tableTop, width: outer, color: SHARE_COLORS.line })
  b.ops.push({ op: 'line', x1: 0, y1: tableTop, x2: 0, y2: y, width: outer, color: SHARE_COLORS.line })
  b.ops.push({ op: 'line', x1: W, y1: tableTop, x2: W, y2: y, width: outer, color: SHARE_COLORS.line })
  b.ops.push({ op: 'line', x1: 0, y1: y, x2: W, y2: y, width: outer, color: SHARE_COLORS.line })

  const out: ShareLayout = { width: W, height: y, ops: b.ops, rows: spans, pageBreaks: [], tier }
  out.pageBreaks = computePageBreaks(out, contentPageHeight(m))
  return out
}

/**
 * Where each page after the first starts. Rows never split; the totals group stays together; no break is placed inside the header row.
 * (Deviation from print: the table header is not repeated on later pages of a phone PDF.)
 */
export function computePageBreaks(l: Pick<ShareLayout, 'height' | 'rows'>, pageH: number): number[] {
  if (!(pageH > 0) || l.height <= pageH + 0.5) return []
  const breaks: number[] = []
  let start = 0
  const footTop = l.rows.find((r) => r.group === 'foot')?.top ?? Infinity
  const footBottom = l.rows.filter((r) => r.group === 'foot').reduce((a, r) => Math.max(a, r.bottom), 0)
  for (const r of l.rows) {
    if (r.group === 'head') continue
    const isFoot = r.group === 'foot'
    // The totals block moves as one unit: judge its first row by the bottom of the whole block.
    const bottom = isFoot && r.top === footTop ? footBottom : r.bottom
    if (isFoot && r.top !== footTop) continue
    if (bottom - start > pageH + 0.5) {
      const at = r.top > start ? r.top : r.bottom
      breaks.push(at)
      start = at
    }
  }
  return breaks
}

/** A4 density: the first tier (0..max) whose single page fits, as the desktop does for a bill the paper rules put on one A4 page. */
export function layoutFitted(m: PrintModel, measure: Measure, opts: Omit<LayoutOptions, 'tier'> = {}): ShareLayout {
  const tiers = m.paper.size === 'A4' && m.paper.pages === 1 ? A4_DENSITY_TIERS.length : 1
  const pageH = contentPageHeight(m)
  let last: ShareLayout | null = null
  for (let t = 0; t < tiers; t++) {
    last = layoutPrintModel(m, measure, { ...opts, tier: t })
    if (last.height <= pageH + 0.5) return last
  }
  return last as ShareLayout
}

/** Every text string a layout draws, in order (tests and accessibility labels). */
export function layoutTexts(l: ShareLayout): string[] {
  return l.ops.filter((o): o is Extract<DrawOp, { op: 'text' }> => o.op === 'text').map((o) => o.text)
}

/** Only logo sources that need no network and carry no script may be drawn. */
export const shareSafeLogo = (src: string): string => safeLogoSrc(src)
