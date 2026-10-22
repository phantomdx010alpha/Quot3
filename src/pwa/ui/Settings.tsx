import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { PhoneDb } from '../data/db'
import { getSetting, setSetting, type SettingDefaults } from '../data/settingsRepo'
import type { StorageEnv } from '../platform/storage'
import type { AppLock } from '../sync/appLock'
import type { PhoneSyncEngine } from '../sync/engine'
import { SettingsLock } from './SettingsLock'
import { SettingsStorage } from './SettingsStorage'
import { AboutPage } from './AboutPage'
import { SettingsSync } from './SettingsSync'
import { ThemePicker } from './ThemePicker'
import { SETTINGS_PAGES, isSettingsPage, type SettingsPageId } from './settingsPages'
import { themeLabel } from './themes'
import { checkCompany, checkLogoFile, type CompanyProfile } from './settingsModel'
import type { SyncAdmin, ThemeName } from './services'

type ShareDefaults = SettingDefaults['share.defaults']
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => (typeof r.result === 'string' ? resolve(r.result) : reject(new Error('The picture could not be read.')))
    r.onerror = () => reject(new Error('The picture could not be read.'))
    r.readAsDataURL(file)
  })
}

/** The phone Settings page (Phase 185): company profile for Professional output, branch and sync login, share defaults, storage and backup,
 *  app lock, theme, About. Company settings do NOT sync (Phase 173 finding), so this phone has its own. */
export function Settings(props: {
  db: PhoneDb | null; version: string; theme: ThemeName; onTheme: (t: ThemeName) => void
  /** Which sub page to show; absent = the home list. `onOpenPage` is how a home row opens one (the app pushes a route, so Back returns to the list). */
  page?: string; onOpenPage?: (id: SettingsPageId) => void; aboutRows?: readonly { label: string; value: string }[]
  sync?: SyncAdmin | null; engine?: PhoneSyncEngine | null; now?: () => Date; appLock?: AppLock; storageEnv?: StorageEnv; download?: (blob: Blob, name: string) => void; onChanged?: () => void
}): ReactElement {
  const { db } = props
  const [company, setCompany] = useState<CompanyProfile | null>(null)
  const [errors, setErrors] = useState<Partial<Record<'name' | 'phone' | 'address', string>>>({})
  const [companyNote, setCompanyNote] = useState<string | null>(null)
  const [share, setShare] = useState<ShareDefaults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const logoInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!db) return undefined
    let off = false
    void Promise.all([getSetting(db, 'company.profile'), getSetting(db, 'share.defaults')]).then(
      ([c, s]) => { if (!off) { setCompany(c); setShare(s) } },
      (e: unknown) => { if (!off) setError(msg(e)) }
    )
    return () => { off = true }
  }, [db])

  const page: SettingsPageId | null = isSettingsPage(props.page) ? props.page : null
  const themeRow = <ThemePicker theme={props.theme} onTheme={props.onTheme} />
  const about = <AboutPage version={props.version} rows={props.aboutRows ?? []} now={props.now} />
  const home = (
    <ul className="q3-menu" aria-label="Settings">
      {SETTINGS_PAGES.map((p) => (
        <li key={p.id}>
          <button type="button" className="q3-menu-item" onClick={() => props.onOpenPage?.(p.id)}>
            <span className="q3-menu-text">
              <span className="q3-menu-label">{p.label}</span>
              <span className="q3-menu-hint">{p.id === 'appearance' ? themeLabel(props.theme) : p.hint}</span>
            </span>
            <span className="q3-menu-chev" aria-hidden="true">›</span>
          </button>
        </li>
      ))}
    </ul>
  )
  if (page === 'appearance') return <div className="q3-settings">{themeRow}</div>
  if (page === 'about') return <div className="q3-settings">{about}</div>
  if (!db) return <div className="q3-placeholder">{page === null ? home : null}<p className="q3-note q3-note-warn" role="alert">Your data could not be opened, so the other settings are unavailable.</p></div>
  if (error) return <p className="q3-note q3-note-warn" role="alert">{error}</p>
  if (!company || !share) return <p className="q3-muted" role="status">Loading</p>
  const canWrite = db.canWrite()

  const editCompany = (k: 'name' | 'phone' | 'address') => (e: { target: { value: string } }): void => { setCompany({ ...company, [k]: e.target.value }); setCompanyNote(null) }
  const saveCompany = async (): Promise<void> => {
    const c = checkCompany(company)
    if (!c.ok) { setErrors(c.errors); return }
    setErrors({})
    try { await setSetting(db, 'company.profile', c.value); setCompany(c.value); setCompanyNote('Saved. Professional bills use this block.') } catch (e) { setCompanyNote(msg(e)) }
  }
  const pickLogo = async (file: File | undefined): Promise<void> => {
    if (!file) return
    const bad = checkLogoFile(file)
    if (bad) { setCompanyNote(bad); return }
    try { setCompany({ ...company, logoDataUrl: await readAsDataUrl(file) }); setCompanyNote('Logo chosen. Tap Save company.') } catch (e) { setCompanyNote(msg(e)) }
  }
  const pickShare = (next: ShareDefaults): void => {
    setShare(next)
    if (canWrite) void setSetting(db, 'share.defaults', next).catch(() => undefined)
  }

  return (
    <div className="q3-settings">
      {page === null ? home : null}

      {page === 'company' ? (
      <section className="q3-set" aria-label="Company">
        <h2 className="q3-h2">Company (for Professional bills)</h2>
        <p className="q3-muted">This is kept on this phone only. It does not sync with your computers.</p>
        <label className="q3-field"><span className="q3-muted">Company name</span>
          <input className="q3-input" aria-label="Company name" autoComplete="off" value={company.name} onChange={editCompany('name')} />
          {errors.name ? <span className="q3-note q3-note-warn" role="alert">{errors.name}</span> : null}
        </label>
        <label className="q3-field"><span className="q3-muted">Phone</span>
          <input className="q3-input" aria-label="Company phone" type="tel" inputMode="tel" autoComplete="off" value={company.phone} onChange={editCompany('phone')} />
          {errors.phone ? <span className="q3-note q3-note-warn" role="alert">{errors.phone}</span> : null}
        </label>
        <label className="q3-field"><span className="q3-muted">Address</span>
          <input className="q3-input" aria-label="Company address" autoComplete="off" value={company.address} onChange={editCompany('address')} />
          {errors.address ? <span className="q3-note q3-note-warn" role="alert">{errors.address}</span> : null}
        </label>
        <div className="q3-row"><span>Logo</span><span>{company.logoDataUrl ? 'chosen' : 'none'}</span></div>
        {company.logoDataUrl ? <img className="q3-logo" alt="Company logo" src={company.logoDataUrl} /> : null}
        <div className="q3-actions">
          <button type="button" className="q3-btn" disabled={!canWrite} onClick={() => logoInput.current?.click()}>Choose logo</button>
          {company.logoDataUrl ? <button type="button" className="q3-btn" onClick={() => { setCompany({ ...company, logoDataUrl: null }); setCompanyNote('Logo removed. Tap Save company.') }}>Remove logo</button> : null}
          <input ref={logoInput} type="file" aria-label="Logo file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <button type="button" className="q3-btn q3-btn-primary" disabled={!canWrite} onClick={() => void saveCompany()}>Save company</button>
        {companyNote ? <p className="q3-note" role="status">{companyNote}</p> : null}
      </section>
      ) : null}

      {page === 'sync' ? <SettingsSync db={db} sync={props.sync} engine={props.engine} onChanged={props.onChanged} /> : null}

      {page === 'share' ? (
      <section className="q3-set" aria-label="Share defaults">
        <h2 className="q3-h2">Share defaults</h2>
        <div className="q3-chips" role="group" aria-label="Bill style">
          <button type="button" className="q3-chip" aria-pressed={share.style === 'rough'} onClick={() => pickShare({ ...share, style: 'rough' })}>Rough</button>
          <button type="button" className="q3-chip" aria-pressed={share.style === 'professional'} onClick={() => pickShare({ ...share, style: 'professional' })}>Professional</button>
        </div>
        <div className="q3-chips" role="group" aria-label="File type">
          <button type="button" className="q3-chip" aria-pressed={share.kind === 'image'} onClick={() => pickShare({ ...share, kind: 'image' })}>Image</button>
          <button type="button" className="q3-chip" aria-pressed={share.kind === 'pdf'} onClick={() => pickShare({ ...share, kind: 'pdf' })}>PDF</button>
        </div>
      </section>
      ) : null}

      {page === 'storage' ? <SettingsStorage db={db} version={props.version} now={props.now} storageEnv={props.storageEnv} download={props.download} onChanged={props.onChanged} /> : null}
      {page === 'lock' ? <SettingsLock db={db} appLock={props.appLock} /> : null}
    </div>
  )
}
