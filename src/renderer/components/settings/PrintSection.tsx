import { useEffect, useState } from 'react'
import { IMAGE_SCALE_RANGE } from '@shared/print/imageFlow'
import { Button, Input } from '../ui'
import { useSettingsStore } from '../../stores/settingsStore'

/** Printer, silent printing and the rupee sign on the final total. Paper size is chosen by the paper rules (A5 unless the rules say A4). */
export function PrintSection(): React.JSX.Element {
  const data = useSettingsStore((s) => s.data)!
  const { saving, error, printers } = useSettingsStore()
  const p = data.print
  const [printer, setPrinter] = useState(p.printer)
  const [silent, setSilent] = useState(p.silent)
  const [rupee, setRupee] = useState(p.rupeeOnTotal)
  useEffect(() => { setPrinter(p.printer); setSilent(p.silent); setRupee(p.rupeeOnTotal) }, [p.printer, p.silent, p.rupeeOnTotal])
  useEffect(() => { void useSettingsStore.getState().loadPrinters() }, [])
  const [method, setMethod] = useState('viewer')
  useEffect(() => { void window.quot3.settings.get('print.method').then((r) => { if (r.ok && typeof r.data.value === 'string') setMethod(r.data.value) }) }, [])
  const changeMethod = (v: string): void => { setMethod(v); void window.quot3.settings.set('print.method', v) }
  return (
    <form className="q3-set__form" onSubmit={(e) => { e.preventDefault(); void useSettingsStore.getState().savePrint({ rupeeOnTotal: rupee, silent, printer }) }} aria-label="Print defaults">
      <p className="q3-set__muted">Default paper: A5. The paper rules switch a bill to A4 when it needs it; margins are fixed by the print template.</p>
      <label className="q3-set__check" style={{ display: 'block' }}>
        Print method{' '}
        <select value={method} disabled={data.readOnly} onChange={(e) => changeMethod(e.target.value)} aria-label="Print method">
          <option value="viewer">Print through the PDF viewer (opens it and prints; recommended)</option>
          <option value="direct">Print straight to the printer</option>
          <option value="browser">Older browser print</option>
        </select>
      </label>
      <Input label="Printer name" value={printer} list="q3-printers" maxLength={300} autoFocus onChange={(e) => setPrinter(e.target.value)} hint="Leave empty to choose in the system print dialog each time." />
      <datalist id="q3-printers">{printers.map((n) => <option key={n} value={n} />)}</datalist>
      <label className="q3-set__check"><input type="checkbox" checked={silent} onChange={(e) => setSilent(e.target.checked)} /> Print without the system dialog (needs a printer name)</label>
      <label className="q3-set__check"><input type="checkbox" checked={rupee} onChange={(e) => setRupee(e.target.checked)} /> Show the rupee sign on the final total</label>
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      <div className="q3-set__row"><Button type="submit" variant="primary" disabled={saving || data.readOnly}>Save print defaults</Button></div>
    </form>
  )
}

/** Phase 72 - copy-as-image sharpness. A bigger number = a sharper (and larger) picture; a very long bill falls back to a lower step on its own. */
const QUALITY_LABELS: Record<number, string> = { 2: '2x - small file', 3: '3x - good', 4: '4x - HD (default)', 5: '5x - maximum' }
export function ImageQualitySection(): React.JSX.Element {
  const data = useSettingsStore((s) => s.data)!
  const { saving, error } = useSettingsStore()
  const [scale, setScale] = useState(data.image.scale)
  useEffect(() => { setScale(data.image.scale) }, [data.image.scale])
  const options: number[] = []
  for (let s = IMAGE_SCALE_RANGE.min; s <= IMAGE_SCALE_RANGE.max; s++) options.push(s)
  return (
    <form className="q3-set__form" onSubmit={(e) => { e.preventDefault(); void useSettingsStore.getState().saveImage(scale) }} aria-label="Image quality">
      <label className="q3-set__field">
        <span>Image quality (copy as image)</span>
        <select value={scale} onChange={(e) => setScale(Number(e.target.value))} aria-label="Image quality">
          {options.map((s) => <option key={s} value={s}>{QUALITY_LABELS[s]}</option>)}
        </select>
        <span className="q3-set__muted">Higher is sharper when zoomed in on WhatsApp. Applies to the next copy.</span>
      </label>
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      <div className="q3-set__row"><Button type="submit" variant="primary" disabled={saving || data.readOnly}>Save image quality</Button></div>
    </form>
  )
}
