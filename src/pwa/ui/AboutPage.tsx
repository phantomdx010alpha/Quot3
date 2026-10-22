import { useState, type ReactElement } from 'react'
import { APP_NAME, APP_TAGLINE, PUBLISHER_EMAIL, PUBLISHER_NAME, copyrightLine, publisherMailto } from '../../shared/appInfo'

/** About Quot3 (Phase 188b): icon, name, version, tagline, publisher and contact (same text as the Windows app's About), then what this phone supports. */
export function AboutPage(props: { version: string; rows: readonly { label: string; value: string }[]; now?: () => Date }): ReactElement {
  const [note, setNote] = useState<string | null>(null)
  const copyEmail = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(PUBLISHER_EMAIL); setNote('Email address copied.') } catch { setNote('Could not copy. Long-press the address to copy it.') }
  }
  const year = (props.now ? props.now() : new Date()).getFullYear()
  return (
    <section className="q3-about" aria-label="About Quot3">
      <img className="q3-about-icon" src="/icons/icon-192.png" alt="" width={96} height={96} />
      <h2 className="q3-about-name">{APP_NAME}</h2>
      <p className="q3-about-version" data-testid="about-version">Version {props.version}</p>
      <p className="q3-muted">{APP_TAGLINE}</p>
      <div className="q3-row"><span>Publisher</span><span data-testid="about-publisher">{PUBLISHER_NAME}</span></div>
      <div className="q3-row"><span>Email</span><span data-testid="about-email">{PUBLISHER_EMAIL}</span></div>
      <div className="q3-actions">
        <button type="button" className="q3-btn" onClick={() => void copyEmail()}>Copy email</button>
        <a className="q3-btn" href={publisherMailto()}>Write an email</a>
      </div>
      {note ? <p className="q3-note" role="status">{note}</p> : null}
      <h2 className="q3-h2">This phone</h2>
      {props.rows.map((r) => <div key={r.label} className="q3-row"><span>{r.label}</span><span>{r.value}</span></div>)}
      <p className="q3-muted">{copyrightLine(year)}</p>
    </section>
  )
}
