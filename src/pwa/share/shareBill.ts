/**
 * Phase 184 - phone share, step 5: bill -> shareable file. Everything numeric comes from the shared print model (`buildPrintModel`, which uses
 * `computeBill`), the paper size from `decideForBill` / `decidePaper` (thresholds only in `paperConstants.ts`), formats only through the registry.
 * Professional adds the company block and PO number; Rough does not (the model decides). Sharing never changes the bill.
 */
import '../../shared/format'
import { decideForBill } from '../../shared/print/printFlow'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS, type CompanyBlock, type PrintModel } from '../../shared/print/printModel'
import type { Bill, PrintMode } from '../../shared/types'
import { browserCanvas, canvasMeasure, ensureShareFonts, renderLayoutImage, ShareError, type CanvasFactory } from './image'
import { layoutFitted, shareSafeLogo, type LogoInfo, type ShareLayout } from './layout'
import { renderLayoutPdf } from './pdf'
import { shareFileName } from './shareSheet'

export type ShareKind = 'image' | 'pdf'
export type ShareStyle = PrintMode
export interface ShareChoice { style: ShareStyle; kind: ShareKind }
/** The phone's own company profile (company settings do NOT sync: Phase 173 Q10). */
export interface PhoneCompany { name: string; phone: string; address: string; logoDataUrl: string | null }

export interface ShareEnvDeps {
  canvas: CanvasFactory
  /** Loads fonts; resolves false when they could not load. */
  fonts: () => Promise<boolean>
  /** Loads a logo (data URL) and returns its natural size and the drawable; null when it cannot load. */
  loadLogo: (src: string) => Promise<{ naturalW: number; naturalH: number; image: unknown } | null>
}

export function browserShareDeps(): ShareEnvDeps {
  return {
    canvas: browserCanvas,
    fonts: () => ensureShareFonts(),
    loadLogo: (src) => new Promise((res) => {
      const img = new Image()
      img.onload = () => res({ naturalW: img.naturalWidth, naturalH: img.naturalHeight, image: img })
      img.onerror = () => res(null)
      img.src = src
    })
  }
}

export interface PreparedShare { model: PrintModel; layout: ShareLayout; images: Map<string, unknown>; fontsOk: boolean }

/** The model for a bill: same settings the desktop defaults give (rupee on the total), the phone's company block. [A] */
export function modelFor(bill: Bill, style: ShareStyle, company: PhoneCompany | null): PrintModel {
  const block: CompanyBlock | null = company && company.name.trim() !== '' ? { name: company.name, phone: company.phone, address: company.address, logo: company.logoDataUrl ?? '' } : null
  const decision = decideForBill(bill, style)
  return buildPrintModel(bill, style, { ...DEFAULT_PRINT_SETTINGS, company: block }, decision)
}

export async function prepareShare(bill: Bill, style: ShareStyle, company: PhoneCompany | null, deps: ShareEnvDeps): Promise<PreparedShare> {
  const model = modelFor(bill, style, company)
  const fontsOk = await deps.fonts()
  const probe = deps.canvas(8, 8).getContext('2d')
  if (!probe) throw new ShareError('NO_CANVAS', 'This browser cannot draw the picture.')
  const images = new Map<string, unknown>()
  let logo: LogoInfo | null = null
  if (model.header.kind === 'professional') {
    const src = shareSafeLogo(model.header.company.logo)
    // Only an embedded picture may be drawn (no network on the phone share path).
    if (src !== '' && src.startsWith('data:image/')) {
      const loaded = await deps.loadLogo(src)
      if (loaded) { images.set(src, loaded.image); logo = { src, naturalW: loaded.naturalW, naturalH: loaded.naturalH } }
    }
  }
  const layout = layoutFitted(model, canvasMeasure(probe), { logo })
  return { model, layout, images, fontsOk }
}

export interface ShareFileData { bytes: Uint8Array; mime: string; fileName: string; pages: number; paper: 'A5' | 'A4' }

export async function makeShareFile(bill: Bill, choice: ShareChoice, company: PhoneCompany | null, deps: ShareEnvDeps): Promise<ShareFileData> {
  const p = await prepareShare(bill, choice.style, company, deps)
  const paper = p.model.paper.size
  if (choice.kind === 'image') {
    const img = await renderLayoutImage(p.layout, deps.canvas, p.images)
    return { bytes: img.bytes, mime: 'image/png', fileName: shareFileName(bill.poNumber, bill.party.name, 'png'), pages: 1, paper }
  }
  const pdf = await renderLayoutPdf(p.layout, paper, deps.canvas, p.images, bill.poNumber || 'Quotation')
  return { bytes: pdf.bytes, mime: 'application/pdf', fileName: shareFileName(bill.poNumber, bill.party.name, 'pdf'), pages: pdf.pages, paper }
}
