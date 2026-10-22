import type { ReactElement } from 'react'
import { PHONE_THEMES, type ThemeName } from './themes'

/** Settings > Themes (Phase 188b): the Windows app's built-in themes as tappable cards with a three-colour swatch. The choice applies at once and is remembered. */
export function ThemePicker(props: { theme: ThemeName; onTheme: (t: ThemeName) => void }): ReactElement {
  return (
    <section className="q3-set" aria-label="Themes">
      <h2 className="q3-h2">Themes</h2>
      <p className="q3-muted">The same built-in themes as the Windows app. The choice is kept on this phone.</p>
      <div className="q3-themes" role="group" aria-label="Theme">
        {PHONE_THEMES.map((t) => (
          <button key={t.id} type="button" className="q3-theme" aria-pressed={props.theme === t.id} aria-label={t.name} onClick={() => props.onTheme(t.id)}>
            <span className="q3-swatch" aria-hidden="true">
              {t.swatch.map((c) => <span key={c} style={{ background: c }} />)}
            </span>
            <span className="q3-theme-name">{t.name}</span>
            <span className="q3-muted q3-theme-mode">{t.mode === 'dark' ? 'Dark' : 'Light'}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
