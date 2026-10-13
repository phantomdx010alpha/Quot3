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
  return (
    <div className="q3-set__two">
      <form className="q3-set__form" onSubmit={(e) => { e.preventDefault(); void st().saveCompany({ name, phone, address }) }} aria-label="Company details">
        <Input label="Company name" value={name} maxLength={400} autoFocus onChange={(e) => setName(e.target.value)} />
        <Input label="Phone" value={phone} maxLength={200} onChange={(e) => setPhone(e.target.value)} />
        <label className="q3-field">
          <span className="q3-field__label">Address</span>
          <textarea className="q3-set__textarea" value={address} rows={3} onChange={(e) => setAddress(e.target.value)} aria-label="Address" />
        </label>
        <div className="q3-set__logo">
          <div className="q3-set__logobox" aria-label="Logo preview">
            {c.logoDataUrl ? <img src={c.logoDataUrl} alt="Company logo" className="q3-set__logoimg" /> : <span className="q3-set__muted">No logo</span>}
          </div>
          <div className="q3-set__row">
            <Button onClick={() => { void st().chooseLogo() }} disabled={saving}>{c.logo ? 'Change logo' : 'Add logo'}</Button>
            {c.logo && <Button variant="ghost" onClick={() => { void st().removeLogo() }} disabled={saving}>Remove logo</Button>}
          </div>
          <p className="q3-set__muted">PNG or JPEG, up to {LOGO_MAX_BYTES / 1024} KB and {LOGO_MAX_SIDE_PX} px on each side. It prints at a limited height with its shape kept.</p>
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
