import { useMemo, useState } from 'react'
import { SAMPLE_LOGO_WIDE } from '@shared/__fixtures__/printLogo'
import { PRINT_FIXTURE_IDS, printFixture, type PrintFixtureId } from '@shared/__fixtures__/printBills'
import { simplePaperDecision } from '@shared/paper/paperTypes'
import { PAPER_MM } from '@shared/print/printConstants'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '@shared/print/printModel'
import { renderPrintHtml } from '@shared/print/template/renderHtml'
import type { Paper, PrintMode } from '@shared/types'
import { PRINT_FONT_URLS } from '../../print/fontUrls'

/** Px per mm at 96 dpi - the preview frame is drawn at the paper's real CSS size. */
const PX_PER_MM = 96 / 25.4

/**
 * /dev/print-preview (Phase 33, dev only): the Rough or Professional template for a fixture bill on A5 or A4, in an iframe at true paper
 * size. The same `buildPrintModel` + `renderPrintHtml` pair print, PDF and image will use. Phase 34 added the Professional header (sample company data here; real data from Settings in Phase 48).
 */
export default function PrintPreviewDev(): React.JSX.Element {
  const [fixture, setFixture] = useState<PrintFixtureId>('legacy')
  const [paper, setPaper] = useState<Paper>('A5')
  const [mode, setMode] = useState<PrintMode>('rough')
  const [logo, setLogo] = useState(true)

  const { html, error, model } = useMemo(() => {
    try {
      const m = buildPrintModel(printFixture(fixture), mode, { ...DEFAULT_PRINT_SETTINGS, company: { logo: logo ? SAMPLE_LOGO_WIDE : '', name: 'Sample Company Pvt Ltd', phone: '98765 43210', address: '12 Sample Street, Sample City 560001' } }, simplePaperDecision(paper))
      return { model: m, html: renderPrintHtml(m, { fontUrls: PRINT_FONT_URLS }), error: '' }
    } catch (e) {
      return { model: null, html: '', error: e instanceof Error ? e.message : String(e) }
    }
  }, [fixture, paper, mode, logo])

  const { w, h } = PAPER_MM[paper]
  return (
    <div className="q3-gdev">
      <div className="q3-gdev__bar">
        <h1>Print preview (dev)</h1>
        <label>
          Fixture{' '}
          <select value={fixture} onChange={(e) => setFixture(e.target.value as PrintFixtureId)}>
            {PRINT_FIXTURE_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label>
          Paper{' '}
          <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
            <option value="A5">A5</option>
            <option value="A4">A4</option>
          </select>
        </label>
        <label>
          Mode{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as PrintMode)}>
            <option value="rough">Rough</option>
            <option value="professional">Professional</option>
          </select>
        </label>
        <label><input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} /> Sample logo</label>
        <span>{mode === 'rough' ? 'Rough' : 'Professional (placeholder company)'} template - {model ? `${model.rowCount} rows, ${model.columns.length} columns` : ''}</span>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="q3-pprev">
        <iframe
          className="q3-pprev__frame"
          title="Print preview"
          sandbox=""
          srcDoc={html}
          style={{ width: `${Math.round(w * PX_PER_MM)}px`, height: `${Math.round(h * PX_PER_MM)}px` }}
        />
      </div>
    </div>
  )
}
