import { useSyncExternalStore } from 'react'
import { EFFECT_OVERRIDE_SLOTS } from '@shared/theme/effects'
import { Button } from '../ui'
import { useTheme } from '../../theme/ThemeProvider'
import { getSceneSnapshot, saveScenesEnabled, subscribeScene } from '../../theme/scenes/sceneState'
import { getEffectsPrefs, resetEffectsPrefs, saveEffectOverride, saveEffectsEnabled, savePauseUnfocused, subscribeEffectsPrefs } from '../../theme/effects'

/** Phase 168: Settings > Themes > Visual effects. Master switch, per-effect on/off and intensity (saved as settings, applied over the theme's own values), pause when not focused, reset. Chrome only; never the grid or print. */
export function EffectsSection(): React.JSX.Element {
  const prefs = useSyncExternalStore(subscribeEffectsPrefs, getEffectsPrefs, getEffectsPrefs)
  const sc = useSyncExternalStore(subscribeScene, getSceneSnapshot, getSceneSnapshot)
  const { themes, activeId } = useTheme()
  const active = themes.find((t) => t.id === activeId)
  const used = active?.v2?.effects
  return (
    <fieldset className="q3-set__form q3-fx" aria-label="Visual effects">
      <legend>Visual effects</legend>
      <label className="q3-set__check">
        <input type="checkbox" checked={prefs.enabled} onChange={(e) => saveEffectsEnabled(e.target.checked)} /> Visual effects (animations from the theme). Turn off for the plain look. Shortcut: Ctrl+Alt+E.
      </label>
      <p className="q3-set__muted">Effects only touch the menus, buttons and side rail. The bill grid and printing never animate. They also switch off by themselves if Windows is set to reduce motion.</p>
      <label className="q3-set__check">
        <input type="checkbox" checked={prefs.pauseUnfocused} onChange={(e) => savePauseUnfocused(e.target.checked)} /> Pause effects when the window is not focused
      </label>
      <label className="q3-set__check">
        <input type="checkbox" checked={sc.scenesEnabled} disabled={!prefs.enabled} onChange={(e) => saveScenesEnabled(e.target.checked)} /> 3D backgrounds (moving backgrounds some themes ask for)
      </label>
      <p className="q3-set__muted">{active?.v2?.background ? (sc.failedKey !== '' && sc.failedKey === sc.sceneKey ? 'This theme asked for a 3D background, but it could not run on this PC, so the plain look is shown.' : 'The current theme has a 3D background. It is never shown behind the bill grid.') : 'The current theme has no 3D background.'}</p>
      <ul className="q3-fx__list">
        {EFFECT_OVERRIDE_SLOTS.map(({ slot, label, hint }) => {
          const o = prefs.overrides[slot]
          const themeHas = !!used?.[slot]
          const on = o?.enabled !== false
          const themeIntensity = (used?.[slot] as { intensity?: number } | undefined)?.intensity
          const shown = o?.intensity ?? themeIntensity ?? 0.5
          return (
            <li key={slot} className="q3-fx__item">
              <label className="q3-set__check">
                <input type="checkbox" aria-label={label} checked={on} disabled={!prefs.enabled} onChange={(e) => saveEffectOverride(slot, { enabled: e.target.checked })} /> {label}
              </label>
              <label className="q3-fx__range">
                <span>Strength</span>
                <input type="range" aria-label={`${label} strength`} min={0} max={1} step={0.05} value={shown} disabled={!prefs.enabled || !on} onChange={(e) => saveEffectOverride(slot, { intensity: Number(e.target.value) })} />
                <span aria-hidden="true">{Math.round(shown * 100)}%</span>
              </label>
              <span className="q3-set__muted">{hint}{themeHas ? '' : ' The current theme does not use this one.'}</span>
            </li>
          )
        })}
      </ul>
      <div className="q3-set__row">
        <Button variant="ghost" onClick={resetEffectsPrefs}>Reset effects to the theme's own settings</Button>
      </div>
    </fieldset>
  )
}
