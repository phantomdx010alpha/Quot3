/**
 * Phase 33 - the print stylesheet (pure string builder). `--print-*` tokens are independent of the UI theme: nothing
 * here reads `tokens.css`. Same CSS serves preview, print, PDF and image.
 */
import type { Paper } from '../../types'
import { A4_DENSITY_TIERS, LOGO_MAX_HEIGHT_MM, LOGO_MAX_WIDTH_PCT, PAGE_MARGIN_MM, PAPER_MM, PRINT_FONT_FAMILY, PRINT_FONT_FILES, PRINT_FONT_PT } from '../printConstants'

export interface FontSource {
  /** Base URL the font files are served from (no trailing slash needed). */
  fontBaseUrl?: string
  /** Per-file override (e.g. the hashed URLs a bundler produced), keyed by file name. Wins over `fontBaseUrl`. */
  fontUrls?: Readonly<Record<string, string>>
}

export function fontFaceCss(src: FontSource): string {
  const base = (src.fontBaseUrl ?? '').replace(/\/+$/, '')
  return PRINT_FONT_FILES.map((f) => {
    const url = src.fontUrls?.[f.file] ?? `${base}/${f.file}`
    return `@font-face{font-family:'${PRINT_FONT_FAMILY}';font-style:normal;font-weight:${f.weight};font-display:block;src:url("${url}") format('woff2');unicode-range:${f.unicodeRange}}`
  }).join('\n')
}

export function pageCss(paper: Paper): string {
  const m = PAGE_MARGIN_MM[paper]
  return `@page{size:${paper} portrait;margin:${m}mm}`
}

/** Print tokens for one paper size. */
function tokensCss(paper: Paper): string {
  const pt = PRINT_FONT_PT[paper]
  const { w } = PAPER_MM[paper]
  const m = PAGE_MARGIN_MM[paper]
  return `:root{--print-font:'${PRINT_FONT_FAMILY}','Noto Sans','Segoe UI',Arial,sans-serif;--print-ink:#000;--print-red:#c00000;--print-hl:#fff2a8;--print-line:#222;--print-line-soft:#777;--print-head-bg:#ececec;--print-fs:${pt.base}pt;--print-fs-head:${pt.head}pt;--print-fs-party:${pt.party}pt;--print-pad-y:0.3mm;--print-pad-x:1.2mm;--print-sheet-w:${w - 2 * m}mm;--print-logo-h:${LOGO_MAX_HEIGHT_MM[paper]}mm;--print-logo-w:${LOGO_MAX_WIDTH_PCT}%}`
}

const BASE = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:var(--print-ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* Phase 73: top-aligned. Nothing here centres vertically; the page's top gap is the @page margin ONLY. */
body{display:block;height:auto;min-height:0;font-family:var(--print-font);font-size:var(--print-fs);line-height:1.15;hyphens:none;-webkit-hyphens:none;overflow-wrap:anywhere}
.q3p-sheet{position:static;width:var(--print-sheet-w);margin:0 auto;padding:0}
.q3p-head{margin:0 0 1.5mm 0;break-after:avoid}
.q3p-party{margin:0;font-size:var(--print-fs-party);font-weight:700;line-height:1.2;overflow-wrap:anywhere;word-break:break-word}
.q3p-sub{margin:.5mm 0 0 0;display:flex;flex-wrap:wrap;gap:0 5mm;font-size:var(--print-fs)}
.q3p-sub span{overflow-wrap:anywhere;word-break:break-word}
.q3p-sub b{font-weight:700}
table.q3p-table{width:100%;table-layout:fixed;border-collapse:collapse;border:.35mm solid var(--print-line)}
.q3p-pro{display:flex;justify-content:space-between;align-items:flex-start;gap:4mm;padding-bottom:1.5mm;border-bottom:.35mm solid var(--print-line)}
.q3p-co{display:flex;align-items:flex-start;gap:2.5mm;min-width:0;flex:1 1 auto}
.q3p-logo{display:block;max-height:var(--print-logo-h);max-width:var(--print-logo-w);width:auto;height:auto;object-fit:contain;flex:0 0 auto}
.q3p-co-text{min-width:0}
.q3p-co-name{margin:0;font-size:var(--print-fs-party);font-weight:700;line-height:1.15;overflow-wrap:anywhere;word-break:break-word}
.q3p-co-line{margin:.3mm 0 0 0;overflow-wrap:anywhere;word-break:break-word}
.q3p-meta{flex:0 1 auto;max-width:42%;text-align:right;overflow-wrap:anywhere}
.q3p-meta p{margin:0 0 .4mm 0}
.q3p-meta b{font-weight:700}
.q3p-to{margin:1.5mm 0 0 0}
.q3p-to-label{margin:0;font-size:var(--print-fs-head);font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.q3p-to .q3p-party{margin-top:.3mm}
.q3p-to .q3p-line{margin:.3mm 0 0 0;overflow-wrap:anywhere;word-break:break-word}
.q3p-table th,.q3p-table td{border:.2mm solid var(--print-line-soft);padding:var(--print-pad-y) var(--print-pad-x);vertical-align:top;overflow-wrap:anywhere;word-break:break-word;white-space:normal;hyphens:none;min-width:0}
.q3p-table thead{display:table-header-group}
.q3p-table th{background:var(--print-head-bg);font-size:var(--print-fs-head);font-weight:700;border-color:var(--print-line)}
.q3p-table tr{break-inside:avoid;page-break-inside:avoid}
/* Phase 35: the totals live in their own row group (NOT a tfoot - that would repeat on every page). The group never splits, and the last item row will not be left alone at the bottom of a page while the totals start the next one. */
.q3p-table tbody.q3p-foot{break-inside:avoid;page-break-inside:avoid}
.q3p-table tbody.q3p-foot tr{break-before:avoid;page-break-before:avoid}
.q3p-table tbody.q3p-main tr:last-child{break-after:avoid;page-break-after:avoid}
.q3p-table thead tr{break-after:avoid;page-break-after:avoid}
.q3p-l{text-align:left}.q3p-r{text-align:right}.q3p-c{text-align:center}
.q3p-table td.q3p-n{font-variant-numeric:tabular-nums;white-space:nowrap;overflow-wrap:normal;word-break:normal}
.q3p-lbl{text-align:right;font-weight:700}
.q3p-tot td{border-top:.2mm solid var(--print-line-soft)}
.q3p-tot--grand td{font-weight:700;border-top:.35mm solid var(--print-line);border-bottom:.35mm solid var(--print-line)}
.q3p-tot--items td,.q3p-tot--adj td{font-weight:700}
.q3p-adj td{background:transparent}
.q3p-hl{background:var(--print-hl)}
.b{font-weight:700}.r{color:var(--print-red)}.hl{background:var(--print-hl)}
`

/** Phase 40: the density override for an A4 tier (tier 0 / other papers: none). Only tokens change, never the layout rules. */
export function densityCss(paper: Paper, tier: number): string {
  if (paper !== 'A4' || tier <= 0) return ''
  const t = A4_DENSITY_TIERS[Math.min(tier, A4_DENSITY_TIERS.length - 1)]!
  return `:root{--print-fs:${t.base}pt;--print-fs-head:${t.head}pt;--print-pad-y:${t.padY}mm}`
}

/**
 * Phase 148: the fit-to-page override. `scale` multiplies the type sizes and the cell padding (one factor, so row height scales with it).
 * Only for the normal style (an A4 density tier > 0 is already a squeeze, never enlarge it). `scale <= 1` / undefined = '' = byte-identical to before.
 */
export function fitCss(paper: Paper, scale: number | undefined, density = 0): string {
  if (scale === undefined || !Number.isFinite(scale) || scale <= 1 || density > 0) return ''
  const pt = PRINT_FONT_PT[paper]
  const f = (n: number): string => String(Math.round(n * scale * 1000) / 1000)
  return `:root{--print-fs:${f(pt.base)}pt;--print-fs-head:${f(pt.head)}pt;--print-fs-party:${f(pt.party)}pt;--print-pad-y:${f(0.3)}mm}`
}

export function printCss(paper: Paper, src: FontSource, density = 0, fit?: number): string {
  return [fontFaceCss(src), pageCss(paper), tokensCss(paper), densityCss(paper, density), fitCss(paper, fit, density), BASE.trim()].filter(Boolean).join('\n')
}
