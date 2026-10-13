import { useState } from 'react'
import type { Quot3Bridge } from '@shared/ipc'
import { TOKEN_NAMES } from '@shared/theme/tokens'
import { themePreview } from '@shared/theme/preview'
import { Badge, Button } from '../ui'
import { useTheme } from '../../theme/ThemeProvider'

/** Reads the live value of every whitelisted token from the page (what the export turns into a starter file). */
export function readComputedTokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const name of TOKEN_NAMES) {
    const v = cs.getPropertyValue(name).trim()
    if (v !== '') out[name] = v
  }
  return out
}

/** Phase 103: four-dot preview (page, panel, accent, text) so a theme can be judged before it is chosen. Decorative; the name carries the meaning. */
function ThemeSwatch({ theme }: { theme: Parameters<typeof themePreview>[0] }): React.JSX.Element {
  const p = themePreview(theme)
  return (
    <span className="q3-theme__swatch" aria-hidden="true" style={{ background: p['--surface-base'], borderColor: p['--text-primary'] }}>
      <i style={{ background: p['--surface-raised'] }} />
      <i style={{ background: p['--surface-grid'] }} />
      <i style={{ background: p['--accent'] }} />
      <i style={{ background: p['--text-primary'] }} />
    </span>
  )
}

/** Phase 49 - themes manager: list (built-ins + drop-in files), apply live, reload, open the folder, export a starter file. */
export function ThemesSection(): React.JSX.Element {
  const { themes, errors, activeId, setActive, reload } = useTheme()
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState('')
  const bridge = (): Quot3Bridge['themes'] | undefined => (window as unknown as { quot3?: Quot3Bridge }).quot3?.themes

  const openFolder = async (): Promise<void> => {
    setProblem(''); setNote('')
    const r = await bridge()?.openFolder()
    if (!r) setProblem('Not available (no connection to the app).')
    else if (!r.ok) setProblem(r.error.message)
  }
  const doReload = async (): Promise<void> => { setProblem(''); await reload(); setNote('Themes reloaded.') }
  const exportStarter = async (): Promise<void> => {
    setProblem(''); setNote('')
    const r = await bridge()?.exportStarter(activeId, readComputedTokens())
    if (!r) { setProblem('Not available (no connection to the app).'); return }
    if (!r.ok) { setProblem(r.error.message); return }
    await reload()
    setNote(`Saved ${r.data.file} in the themes folder. Edit it, then choose Reload themes.`)
  }

  return (
    <div className="q3-set__form q3-set__themes" aria-label="Themes">
      <p className="q3-set__muted">Pick a theme and it applies at once (the dots preview its page, panel, grid, accent and text colours). Drop your own theme files (.json) into the themes folder, then choose Reload themes.</p>
      <ul className="q3-theme__list" role="radiogroup" aria-label="Themes">
        {themes.map((t) => (
          <li key={t.id}>
            <button type="button" role="radio" aria-checked={t.id === activeId} className={`q3-theme__item${t.id === activeId ? ' q3-theme__item--on' : ''}`} onClick={() => { void setActive(t.id) }}>
              <ThemeSwatch theme={t} />
              <span className="q3-theme__name">{t.name}</span>
              <Badge>{t.builtin ? 'Built-in' : 'Custom'}</Badge>
              {t.id === activeId && <span className="q3-theme__active">In use</span>}
            </button>
          </li>
        ))}
      </ul>
      {errors.length > 0 && (
        <div role="alert" className="q3-theme__errors">
          <p className="q3-set__error">{errors.length === 1 ? '1 theme file was skipped:' : `${errors.length} theme files were skipped:`}</p>
          <ul>{errors.map((e) => <li key={`${e.file}:${e.message}`} className="q3-set__error"><strong>{e.file}</strong>: {e.message}</li>)}</ul>
        </div>
      )}
      {problem !== '' && <p role="alert" className="q3-set__error">{problem}</p>}
      {note !== '' && <p role="status" className="q3-set__saved">{note}</p>}
      <div className="q3-set__row">
        <Button variant="ghost" onClick={() => { void openFolder() }}>Open themes folder</Button>
        <Button variant="ghost" onClick={() => { void doReload() }}>Reload themes</Button>
        <Button variant="ghost" onClick={() => { void exportStarter() }}>Export current theme as a starter file</Button>
      </div>
    </div>
  )
}
