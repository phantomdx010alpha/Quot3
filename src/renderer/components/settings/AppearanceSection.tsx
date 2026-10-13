import { useEffect, useState } from 'react'
import { GRID_FONT_RANGE, ROW_HEIGHT_RANGE, validateUiPrefs } from '@shared/settings/uiPrefs'
import { Button, Input } from '../ui'
import { useUiPrefsStore } from '../../stores/uiPrefsStore'

const num = (s: string): number | null | undefined => (s.trim() === '' ? null : /^\d+$/.test(s.trim()) ? Number(s) : undefined)

/** Phase 49 - grid row height and font size, held inside the same safe ranges themes are clamped to. Empty = the theme decides. */
export function AppearanceSection(): React.JSX.Element {
  const { prefs, error } = useUiPrefsStore()
  const [row, setRow] = useState(prefs.rowHeight === null ? '' : String(prefs.rowHeight))
  const [font, setFont] = useState(prefs.gridFontSize === null ? '' : String(prefs.gridFontSize))
  const [saved, setSaved] = useState(false)
  useEffect(() => { setRow(prefs.rowHeight === null ? '' : String(prefs.rowHeight)); setFont(prefs.gridFontSize === null ? '' : String(prefs.gridFontSize)) }, [prefs.rowHeight, prefs.gridFontSize])
  const r = num(row), f = num(font)
  const check = validateUiPrefs({ rowHeight: r === undefined ? 'x' : r, gridFontSize: f === undefined ? 'x' : f })
  const msg = (k: string): { error: string } | Record<string, never> => (!check.ok && check.field === k ? { error: check.message } : {})
  return (
    <form className="q3-set__form" aria-label="Density and font size" onSubmit={(e) => { e.preventDefault(); if (check.ok) void useUiPrefsStore.getState().save(check.value).then(setSaved) }}>
      <Input label="Grid row height (px)" inputMode="numeric" value={row} autoFocus placeholder="Theme default" onChange={(e) => { setRow(e.target.value); setSaved(false) }} hint={`${ROW_HEIGHT_RANGE.min} to ${ROW_HEIGHT_RANGE.max}. Lower fits more rows on screen. Empty uses the theme's value.`} {...msg('rowHeight')} />
      <Input label="Grid font size (px)" inputMode="numeric" value={font} placeholder="Theme default" onChange={(e) => { setFont(e.target.value); setSaved(false) }} hint={`${GRID_FONT_RANGE.min} to ${GRID_FONT_RANGE.max}. Empty uses the theme's value.`} {...msg('gridFontSize')} />
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      {saved && error === '' && <p role="status" className="q3-set__saved">Applied.</p>}
      <div className="q3-set__row">
        <Button type="submit" variant="primary" disabled={!check.ok}>Apply</Button>
        <Button type="button" variant="ghost" onClick={() => { void useUiPrefsStore.getState().reset().then(setSaved) }}>Use theme defaults</Button>
      </div>
    </form>
  )
}
