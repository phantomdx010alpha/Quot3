import { useEffect, useMemo, useState } from 'react'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '@shared/print/printModel'
import { renderPrintHtml } from '@shared/print/template/renderHtml'
import { printFixture } from '@shared/__fixtures__/printBills'
import { simplePaperDecision } from '@shared/paper/paperTypes'
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE_PX } from '@shared/settings/appSettings'
import { Button, Input } from '../ui'
import { PRINT_FONT_URLS } from '../../print/fontUrls'
import { useSettingsStore } from '../../stores/settingsStore'

/** Company name / phone / address and the logo. The preview is the real Professional template with the typed values. */
export function CompanySection(): React.JSX.Element {
  const data = useSettingsStore((s) => s.data)!
  const { saving, error } = useSettingsStore()
  const c = data.company
  const [name, setName] = useState(c.name)
  const [phone, setPhone] = useState(c.phone)
  const [address, setAddress] = useState(c.address)
  useEffect(() => { setName(c.name); setPhone(c.phone); setAddress(c.address) }, [c.name, c.phone, c.address])

  const html = useMemo(() => {
    const company = { logo: c.logoDataUrl, name: name.trim() === '' ? 'Your Company Name' : name, phone: phone || 'Company phone', address: address || 'Company address, City' }
    const m = buildPrintModel(printFixture('legacy'), 'professional', { ...DEFAULT_PRINT_SETTINGS, company }, simplePaperDecision('A5'))
    return renderPrintHtml(m, { fontUrls: PRINT_FONT_URLS })
  }, [name, phone, address, c.logoDataUrl])

  const st = useSettingsStore.getState
  // Phase 270 (M24): linked to the master. Seat 1 edits the company default; another seat sees it and may override a field on this PC.
  const m = data.companyMaster
  const isSeat = m !== undefined && m.linked && !m.isAdmin && m.default !== null
  const isAdminLinked = m !== undefined && m.linked && m.isAdmin
  const differs = (field: 'name' | 'phone' | 'address' | 'logo', text: string): React.JSX.Element | null =>
    isSeat && m !== undefined && m.overrides[field] ? (
      <div className="q3-set__row">
        <span className="q3-set__muted">{text !== '' ? `This PC differs. Company default: ${text}` : 'This PC differs from the company default.'}</span>
        <Button variant="ghost" onClick={() => { void st().companyUseDefault(field) }} disabled={saving}>Use company default</Button>
      </div>
    ) : null
  return (
    <div className="q3-set__two">
      <form className="q3-set__form" onSubmit={(e) => { e.preventDefault(); void st().saveCompany({ name, phone, address }) }} aria-label="Company details">
        {isAdminLinked && <p className="q3-set__muted">These details are the company default: every other device receives them. Each device may still change a field for itself.</p>}
        {isSeat && <p className="q3-set__muted">The name, phone, address and logo come from the company. Changing a field here changes it on this PC only.</p>}
        {m !== undefined && m.notice !== '' && <p role="status" className="q3-set__muted">{m.notice}</p>}
        <Input label="Company name" value={name} maxLength={400} autoFocus onChange={(e) => setName(e.target.value)} />
        {differs('name', m?.default?.name ?? '')}
        <Input label="Phone" value={phone} maxLength={200} onChange={(e) => setPhone(e.target.value)} />
        {differs('phone', m?.default?.phone ?? '')}
        <label className="q3-field">
          <span className="q3-field__label">Address</span>
          <textarea className="q3-set__textarea" value={address} rows={3} onChange={(e) => setAddress(e.target.value)} aria-label="Address" />
        </label>
        {differs('address', m?.default?.address ?? '')}
        <div className="q3-set__logo">
          <div className="q3-set__logobox" aria-label="Logo preview">
            {c.logoDataUrl ? <img src={c.logoDataUrl} alt="Company logo" className="q3-set__logoimg" /> : <span className="q3-set__muted">No logo</span>}
          </div>
          <div className="q3-set__row">
            <Button onClick={() => { void st().chooseLogo() }} disabled={saving}>{c.logo ? 'Change logo' : 'Add logo'}</Button>
            {c.logo && <Button variant="ghost" onClick={() => { void st().removeLogo() }} disabled={saving}>Remove logo</Button>}
          </div>
          {differs('logo', '')}
          <p className="q3-set__muted">PNG or JPEG, up to {LOGO_MAX_BYTES / 1024} KB and {LOGO_MAX_SIDE_PX} px on each side. It prints at a limited height with its shape kept.{isAdminLinked ? ' A logo shared with the other devices is made into a PNG of at most 150 KB.' : ''}</p>
        </div>
        {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
        <div className="q3-set__row"><Button type="submit" variant="primary" disabled={saving || data.readOnly}>Save company details</Button></div>
      </form>
      <div className="q3-set__preview" aria-label="Professional header preview">
        <p className="q3-set__muted">Professional print preview (updates as you type)</p>
        <iframe title="Professional print preview" className="q3-set__frame" sandbox="" srcDoc={html} />
      </div>
    </div>
  )
}
