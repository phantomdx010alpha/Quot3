import { useEffect, useState } from 'react'
import { AUTOSAVE_SECONDS_RANGE, LEFT_UNLOCK_RANGE, TRASH_RETENTION_RANGE, validateBehaviour } from '@shared/settings/appSettings'
import { validatePercentPresets } from '@shared/calc/percentPresets'
import { Button, Input } from '../ui'
import { useSettingsStore } from '../../stores/settingsStore'

const num = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s))

/** Trash retention, left-arrow unlock presses and the draft autosave delay. */
export function BehaviourSection(): React.JSX.Element {
  const data = useSettingsStore((s) => s.data)!
  const { saving, error } = useSettingsStore()
  const b = data.behaviour
  const [trash, setTrash] = useState(String(b.trashRetentionDays))
  const [left, setLeft] = useState(String(b.leftUnlockPresses))
  const [auto, setAuto] = useState(String(b.autosaveSeconds))
  useEffect(() => { setTrash(String(b.trashRetentionDays)); setLeft(String(b.leftUnlockPresses)); setAuto(String(b.autosaveSeconds)) }, [b.trashRetentionDays, b.leftUnlockPresses, b.autosaveSeconds])
  const [pct, setPct] = useState(data.calc.percentPresets)
  useEffect(() => { setPct(data.calc.percentPresets) }, [data.calc.percentPresets])
  const pctCheck = validatePercentPresets(pct)
  const check = validateBehaviour({ trashRetentionDays: num(trash), leftUnlockPresses: num(left), autosaveSeconds: num(auto) })
  const msg = (f: string): { error: string } | Record<string, never> => (!check.ok && check.field === f ? { error: check.message } : {})
  return (
    <form className="q3-set__form" onSubmit={(e) => {
      e.preventDefault()
      if (!check.ok || !pctCheck.ok) return
      void (async () => {
        const st = useSettingsStore.getState()
        if (await st.saveBehaviour(check.value) && pctCheck.text !== data.calc.percentPresets) await st.savePercentPresets(pctCheck.text)
      })()
    }} aria-label="Behaviour">
      <label className="q3-set__check">
        <input type="checkbox" checked={data.nav.smoothArrows} disabled={saving || data.readOnly} onChange={(e) => { void useSettingsStore.getState().saveNav(e.target.checked) }} /> Smooth arrow keys (Left / Right move straight to the neighbouring cell; F2 edits letter by letter)
      </label>
      <label className="q3-set__check">
        <input type="checkbox" checked={data.calc.roundOff} disabled={saving || data.readOnly} onChange={(e) => { void useSettingsStore.getState().saveCalc(e.target.checked) }} /> Round off the grand total to the nearest rupee (no extra line is shown; applies to bills saved from now on)
      </label>
      <Input label="Keep deleted bills for (days)" inputMode="numeric" value={trash} autoFocus onChange={(e) => setTrash(e.target.value)} hint={`${TRASH_RETENTION_RANGE.min} to ${TRASH_RETENTION_RANGE.max}. Older ones are removed when the app starts.`} {...msg('trashRetentionDays')} />
      <Input label="Left-arrow presses to move back in a cell" inputMode="numeric" value={left} onChange={(e) => setLeft(e.target.value)} hint={`${LEFT_UNLOCK_RANGE.min} to ${LEFT_UNLOCK_RANGE.max}. Only used when Smooth arrow keys is off. Applies to the grid straight away.`} {...msg('leftUnlockPresses')} />
      <Input label="Save the unsaved bill automatically after (seconds)" inputMode="numeric" value={auto} onChange={(e) => setAuto(e.target.value)} hint={`${AUTOSAVE_SECONDS_RANGE.min} to ${AUTOSAVE_SECONDS_RANGE.max}.`} {...msg('autosaveSeconds')} />
      <Input label="Percent presets for the calculator" value={pct} onChange={(e) => setPct(e.target.value)} hint="Comma list, each more than 0 and at most 1000, up to 8 (for example 18, 5, 3). Blank = default." {...(!pctCheck.ok ? { error: pctCheck.message } : {})} />
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      <div className="q3-set__row"><Button type="submit" variant="primary" disabled={saving || !check.ok || !pctCheck.ok || data.readOnly}>Save behaviour</Button></div>
    </form>
  )
}
