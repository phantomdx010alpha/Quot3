import { useEffect, useState } from 'react'
import { AUTOSAVE_SECONDS_RANGE, LEFT_UNLOCK_RANGE, TRASH_RETENTION_RANGE, validateBehaviour } from '@shared/settings/appSettings'
import { validatePercentPresets } from '@shared/calc/percentPresets'
import { HISTORY_DAYS_KEY, HISTORY_DAYS_RANGE, normalizeHistoryDays } from '@shared/history/historyList'
import { AUTO_RED_BOLD_KEYS, DEFAULT_AUTO_RED_BOLD, parsePhraseList, readAutoRedBold, type AutoRedBoldConfig } from '@shared/richtext/autoRedBold'
import { Button, Input } from '../ui'
import { useBehaviourStore } from '../../stores/behaviourStore'
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
  // Phase 157: how many days of bills History lists by default (0 = all). Saved as soon as the box is left, like the print fit settings.
  const [histDays, setHistDays] = useState(String(HISTORY_DAYS_RANGE.default))
  useEffect(() => { void window.quot3.settings.get(HISTORY_DAYS_KEY).then((r) => { if (r.ok) setHistDays(String(normalizeHistoryDays(r.data.value))) }) }, [])
  const saveHistDays = (): void => {
    const n = normalizeHistoryDays(histDays.trim() === '' ? Number.NaN : Number(histDays))
    setHistDays(String(n))
    void window.quot3.settings.set(HISTORY_DAYS_KEY, n)
  }
  // Phase 233 (M23): auto red + bold phrases. Each control saves as soon as it changes (the phrase box when it is left) and updates the grid's live copy.
  const [arb, setArb] = useState<AutoRedBoldConfig>(DEFAULT_AUTO_RED_BOLD)
  const [arbText, setArbText] = useState(DEFAULT_AUTO_RED_BOLD.phrases.join(', '))
  useEffect(() => { void window.quot3.settings.getAll().then((r) => { if (r.ok) { const c = readAutoRedBold(r.data); setArb(c); setArbText(c.phrases.join(', ')) } }) }, [])
  const saveArb = (next: AutoRedBoldConfig): void => {
    setArb(next)
    useBehaviourStore.getState().applyAutoRedBold(next)
    void window.quot3.settings.set(AUTO_RED_BOLD_KEYS.enabled, next.enabled)
    void window.quot3.settings.set(AUTO_RED_BOLD_KEYS.phrases, next.phrases)
    void window.quot3.settings.set(AUTO_RED_BOLD_KEYS.when, next.when)
  }
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
      <Input label="History shows bills of the last (days)" inputMode="numeric" value={histDays} disabled={data.readOnly} onChange={(e) => setHistDays(e.target.value)} onBlur={saveHistDays} hint={`${HISTORY_DAYS_RANGE.min} to ${HISTORY_DAYS_RANGE.max}. 0 shows every bill. Older bills stay hidden until you search or set a From / To date. Saved when you leave the box.`} />
      <Input label="Left-arrow presses to move back in a cell" inputMode="numeric" value={left} onChange={(e) => setLeft(e.target.value)} hint={`${LEFT_UNLOCK_RANGE.min} to ${LEFT_UNLOCK_RANGE.max}. Only used when Smooth arrow keys is off. Applies to the grid straight away.`} {...msg('leftUnlockPresses')} />
      <Input label="Save the unsaved bill automatically after (seconds)" inputMode="numeric" value={auto} onChange={(e) => setAuto(e.target.value)} hint={`${AUTOSAVE_SECONDS_RANGE.min} to ${AUTOSAVE_SECONDS_RANGE.max}.`} {...msg('autosaveSeconds')} />
      <label className="q3-set__check">
        <input type="checkbox" checked={arb.enabled} disabled={data.readOnly} onChange={(e) => saveArb({ ...arb, enabled: e.target.checked })} /> Turn the words below red and bold by themselves in item names (typed or pasted; saved bills are not changed)
      </label>
      <Input label="Words that turn red and bold" value={arbText} disabled={data.readOnly || !arb.enabled} onChange={(e) => setArbText(e.target.value)} onBlur={() => { const phrases = parsePhraseList(arbText); setArbText(phrases.join(', ')); saveArb({ ...arb, phrases }) }} hint="Comma list, for example by hand, imported. Whole words only, capital or small letters, up to 20. Saved when you leave the box." />
      <label className="q3-set__check">
        <input type="checkbox" checked={arb.when === 'word'} disabled={data.readOnly || !arb.enabled} onChange={(e) => saveArb({ ...arb, when: e.target.checked ? 'word' : 'leave' })} /> Apply as soon as the word is finished (off = only when you leave the cell)
      </label>
      <Input label="Percent presets for the calculator" value={pct} onChange={(e) => setPct(e.target.value)} hint="Comma list, each more than 0 and at most 1000, up to 8 (for example 18, 5, 3). Blank = default." {...(!pctCheck.ok ? { error: pctCheck.message } : {})} />
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      <div className="q3-set__row"><Button type="submit" variant="primary" disabled={saving || !check.ok || !pctCheck.ok || data.readOnly}>Save behaviour</Button></div>
    </form>
  )
}
