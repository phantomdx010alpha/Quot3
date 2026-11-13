import { useEffect, useState } from 'react'
import { listFormats } from '@shared/format/registry'
import { formatHasRate } from '@shared/pricelist/billing'
import { MAX_SUGGESTIONS_RANGE } from '@shared/pricelist/settings'
import type { Quot3Bridge } from '@shared/ipc'
import type { PriceTier } from '@shared/pricelist/types'
import { Select } from '../ui'
import { usePriceStripStore } from '../../stores/priceStripStore'

const MODES = [{ value: 'auto', label: 'Auto: fill the Rate when sure' }, { value: 'suggest', label: 'Suggest: only show the match' }, { value: 'off', label: 'Off: billing ignores the Price List' }] as const
const STRICT = [{ value: 'strict', label: 'Strict (fewest fills)' }, { value: 'normal', label: 'Normal' }, { value: 'loose', label: 'Loose (more fills)' }] as const

/** Phase 240 (M23) - Settings > Price List > Billing. Formats come from the registry (a new format appears here by itself); tiers are the user's own. */
export function PriceBillingSettings(): React.JSX.Element {
  const s = usePriceStripStore((x) => x.settings)
  const [tiers, setTiers] = useState<PriceTier[]>([])
  useEffect(() => {
    void usePriceStripStore.getState().load(true)
    const api = (window as unknown as { quot3?: Partial<Pick<Quot3Bridge, 'pricelist'>> }).quot3?.pricelist
    void api?.tree().then((r) => { if (r.ok) setTiers(r.data.tiers) }).catch(() => undefined)
  }, [])
  const st = usePriceStripStore.getState
  const formats = listFormats().filter((f) => formatHasRate(f))
  const tierOptions = [{ value: '', label: 'No price level (never fills)' }, ...tiers.map((t) => ({ value: t.key, label: t.label }))]
  return (
    <div className="q3-set__panel" role="group" aria-label="Billing with the Price List">
      <h2 className="q3-page__title">Billing</h2>
      <label className="q3-set__check">
        <input type="checkbox" checked={s.enabled} onChange={(e) => st().saveSettings({ enabled: e.target.checked })} />
        <span>Use the Price List (off hides it from billing completely)</span>
      </label>
      <Select label="While billing" value={s.mode} disabled={!s.enabled} options={MODES} onChange={(e) => st().setMode(e.target.value as 'off' | 'suggest' | 'auto')} />
      <p className="q3-set__muted">The Rate fills only when you leave an item name you typed, the Rate is empty and you never typed in it, and one price-list item clearly matches. One Ctrl+Z removes just that rate.</p>
      {formats.map((f) => (
        <Select key={f.id} label={`Price level for ${f.label} bills`} value={s.formatTier[f.id] ?? ''} disabled={!s.enabled} options={tierOptions}
          onChange={(e) => st().saveSettings({ formatTier: { ...s.formatTier, [f.id]: e.target.value === '' ? null : e.target.value } })} />
      ))}
      <Select label="How sure before filling" value={s.strictness} disabled={!s.enabled} options={STRICT} onChange={(e) => st().saveSettings({ strictness: e.target.value as 'strict' | 'normal' | 'loose' })} />
      <Select label="Matches shown in the strip" value={String(s.maxSuggestions)} disabled={!s.enabled}
        options={Array.from({ length: MAX_SUGGESTIONS_RANGE.max - MAX_SUGGESTIONS_RANGE.min + 1 }, (_, i) => ({ value: String(i + MAX_SUGGESTIONS_RANGE.min), label: String(i + MAX_SUGGESTIONS_RANGE.min) }))}
        onChange={(e) => st().saveSettings({ maxSuggestions: Number(e.target.value) })} />
      <label className="q3-set__check">
        <input type="checkbox" checked={s.markAutoFilled} disabled={!s.enabled} onChange={(e) => st().saveSettings({ markAutoFilled: e.target.checked })} />
        <span>Mark rates that were filled from the Price List</span>
      </label>
    </div>
  )
}
