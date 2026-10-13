import { useEffect, useState } from 'react'
import { APP_NAME, APP_TAGLINE, PUBLISHER_EMAIL, PUBLISHER_NAME, copyrightLine, formatVersion } from '@shared/appInfo'
import type { Quot3Bridge } from '@shared/ipc'
import { Button } from '../ui'
import iconUrl from '../../../../resources/icons/icon-256.png?url'

/** Phase 63 - Settings > About: icon, name, version, publisher. The version comes from main (`app:getInfo`), never hard-coded. */
type PubApi = Quot3Bridge['publisher']
const pubApi = (): PubApi | undefined => (window as unknown as { quot3?: { publisher?: PubApi } }).quot3?.publisher

export function AboutSection(): React.JSX.Element {
  const [version, setVersion] = useState<string>('')
  const [msg, setMsg] = useState('')
  // Phase 90: both actions run in main (it owns the clipboard and the mail link); the page sends no text and no address.
  const contact = async (kind: 'copyEmail' | 'openMail'): Promise<void> => {
    try {
      const r = await pubApi()?.[kind]()
      setMsg(!r ? 'Not available right now.' : r.ok ? (kind === 'copyEmail' ? 'Email address copied.' : 'Opening your mail app.') : r.error.message)
    } catch { setMsg('Something went wrong. Try again.') }
  }
  useEffect(() => {
    const api = (window as unknown as { quot3?: { app?: { getInfo?: () => Promise<{ ok: boolean; data?: { version?: string } }> } } }).quot3?.app
    void api?.getInfo?.().then((r) => { if (r.ok && r.data?.version) setVersion(r.data.version) }).catch(() => undefined)
  }, [])
  return (
    <div className="q3-about" aria-label="About">
      <img className="q3-about__icon" src={iconUrl} alt="" width={96} height={96} />
      <div className="q3-about__text">
        <h2 className="q3-about__name">{APP_NAME}</h2>
        <p className="q3-about__version" data-testid="about-version">{formatVersion(version)}</p>
        <p className="q3-set__muted">{APP_TAGLINE}</p>
        <p className="q3-set__muted" data-testid="about-publisher">Publisher: {PUBLISHER_NAME}</p>
        <p className="q3-set__muted" data-testid="about-email">{PUBLISHER_EMAIL}</p>
        <div className="q3-set__row">
          <Button onClick={() => { void contact('copyEmail') }}>Copy email</Button>
          <Button onClick={() => { void contact('openMail') }}>Write an email</Button>
        </div>
        {msg && <p role="status" className="q3-set__muted">{msg}</p>}
        <p className="q3-set__muted">{copyrightLine(new Date().getFullYear())}</p>
      </div>
    </div>
  )
}
