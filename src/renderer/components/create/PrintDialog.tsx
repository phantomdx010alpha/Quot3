import { useEffect, useMemo } from 'react'
import { buildPrintModel } from '@shared/print/printModel'
import { decisionSummary } from '@shared/print/printFlow'
import { sideLabel } from '@shared/hybrid/hybridOutput'
import { PAPER_MM } from '@shared/print/printConstants'
import { renderPrintHtml } from '@shared/print/template/renderHtml'
import { Button, Dialog } from '../ui'
import { PRINT_FONT_URLS } from '../../print/fontUrls'
import { closePrint, confirmPrint, handlePrintKey, savePdf } from '../../stores/printActions'
import { usePrintUiStore } from '../../stores/printUiStore'

const PX_PER_MM = 96 / 25.4
const PREVIEW_SCALE = 0.55

/**
 * Phase 37 - the print dialog: the paper decision with its reasons and warnings, a live preview of the page that will print,
 * and the keys (Enter prints the suggested size, 4 / 5 force A4 / A5, A = automatic, Y acknowledges the extra-columns
 * warning, Esc cancels). Mounted once in the app shell; opened by `openPrint`.
 */
export function PrintDialog(): React.JSX.Element | null {
  const s = usePrintUiStore()
  const d = s.info?.decision

  const preview = useMemo(() => {
    if (!s.bill || !s.info) return { html: '', error: '' }
    try {
      return { html: renderPrintHtml(buildPrintModel(s.bill, s.mode, s.info.settings, s.info.decision), { fontUrls: PRINT_FONT_URLS, density: s.info.density, ...(s.info.fit !== undefined && s.info.fit > 1 ? { fit: s.info.fit } : {}) }), error: '' }
    } catch (e) {
      return { html: '', error: e instanceof Error ? e.message : 'Could not draw the preview' }
    }
  }, [s.bill, s.mode, s.info])

  // Keys are taken at the window (capture) while the dialog is open: focus starts on the footer's Print button, outside any inner element.
  useEffect(() => {
    if (!s.open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLButtonElement && e.key === 'Enter' && !e.target.hasAttribute('data-autofocus')) return // Cancel handles its own Enter
      if (e.repeat) return
      if (handlePrintKey(e)) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [s.open])

  const title = `${s.mode === 'rough' ? 'Print Rough' : 'Print Professional'}${s.side ? ` (${sideLabel(s.side)} side)` : ''}${d ? ` - ${decisionSummary(d)}` : ''}`
  const paper = d?.size ?? 'A5'
  const w = Math.round(PAPER_MM[paper].w * PX_PER_MM * PREVIEW_SCALE)
  const h = Math.round(PAPER_MM[paper].h * PX_PER_MM * PREVIEW_SCALE)
  const needAck = d?.requiresAck === true && !s.acked

  return (
    <Dialog
      open={s.open}
      className="q3-dialog--print"
      title={title}
      onClose={closePrint}
      footer={
        <>
          <Button onClick={closePrint} shortcut="Esc">Cancel</Button>
          <Button onClick={() => { void savePdf() }} disabled={s.loading || s.printing || s.saving || !d} shortcut="S">
            {s.saving ? 'Saving...' : 'Save PDF'}
          </Button>
          <Button variant="primary" onClick={() => { void confirmPrint() }} disabled={s.loading || s.printing || s.saving || !d} shortcut="Enter" data-autofocus>
            {s.printing ? 'Printing...' : needAck ? 'Acknowledge first (Y)' : `Print ${d?.size ?? ''}`.trim()}
          </Button>
        </>
      }
    >
      <div className="q3-print">
        <div className="q3-print__info">
          {s.loading && !d ? <p>Checking the best paper size...</p> : null}
          {d ? (
            <>
              <p className="q3-print__size">
                <strong>{decisionSummary(d)}</strong>
                {d.suggested !== d.size ? <span> (rules suggest {d.suggested})</span> : null}
              </p>
              <ul className="q3-print__reasons">{d.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              {d.warnings.length > 0 ? (
                <div role="alert" className={`q3-print__warn${s.askAck && needAck ? ' q3-print__warn--ask' : ''}`}>
                  {d.warnings.map((w2) => <p key={w2}>{w2}</p>)}
                  {d.requiresAck ? <p>{s.acked ? 'Acknowledged.' : 'Press Y to acknowledge, then Enter to print.'}</p> : null}
                </div>
              ) : null}
              {s.measuring ? <p className="q3-print__measuring">Checking that the text fits...</p> : null}
              {s.info?.switchedByMeasure ? <p>The text did not fit A5, so A4 is used.</p> : null}
            </>
          ) : null}
          {s.error ? <p role="alert" className="q3-print__error">{s.error}</p> : null}
          <p className="q3-print__keys"><kbd>Enter</kbd> print · <kbd>4</kbd> A4 · <kbd>5</kbd> A5 · <kbd>A</kbd> automatic · <kbd>S</kbd> save PDF · <kbd>Esc</kbd> cancel</p>
        </div>
        <div className="q3-print__preview" style={{ width: `${w}px`, height: `${h}px` }}>
          {preview.error ? <p role="alert">{preview.error}</p> : null}
          {preview.html ? (
            <iframe
              title="Print preview" sandbox="" srcDoc={preview.html} tabIndex={-1}
              style={{ width: `${Math.round(PAPER_MM[paper].w * PX_PER_MM)}px`, height: `${Math.round(PAPER_MM[paper].h * PX_PER_MM)}px`, transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left', border: 0 }}
            />
          ) : null}
        </div>
      </div>
    </Dialog>
  )
}
