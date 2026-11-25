import { useEffect } from 'react'
import { Button } from '../ui'
import {
  PHONE_RIGHTS_APPLY_NOTE, PHONE_RIGHTS_ONLY_NOTE, PRESET_NAMES, SEAT_RIGHTS_HONEST_LIMIT, SEAT_RIGHT_FLAGS, SEAT_RIGHT_LABELS, SEAT_RIGHT_OFF_EFFECT, currentSettingLine, lastSavedLine, presetOf
} from '@shared/seatRights'
import { useSeatRightsStore } from '../../stores/seatRightsStore'

const when = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString() }

/**
 * Phase 287 (M25) - the "Phone rights" block of ONE seat (never seat 1), opened from Settings > Company seats next to the Price List rights.
 * Eleven toggles in plain words, the three presets, Save, the last saved line, and the honest limit. Everything is a native control, so Tab / Space / Enter work.
 */
export function PhoneRightsSettings({ seatNo }: { seatNo: number }): React.JSX.Element {
  const status = useSeatRightsStore((s) => s.status)
  const error = useSeatRightsStore((s) => s.error)
  const busy = useSeatRightsStore((s) => s.busy)
  const savedSeat = useSeatRightsStore((s) => s.savedSeat)
  const rows = useSeatRightsStore((s) => s.rows)
  const draft = useSeatRightsStore((s) => s.draft)
  useEffect(() => { if (useSeatRightsStore.getState().status === 'idle') void useSeatRightsStore.getState().load() }, [])
  const st = useSeatRightsStore.getState()
  const row = rows.find((r) => r.seatNo === seatNo)
  const flags = draft[seatNo] ?? st.flagsOf(seatNo)
  const heading = `Phone rights for seat ${seatNo}`
  return (
    <div className="q3-set__panel q3-phonerights" role="group" aria-label={heading} data-testid={`phr-${seatNo}`}>
      <h2 className="q3-page__title">{heading}</h2>
      <p className="q3-set__muted">{PHONE_RIGHTS_ONLY_NOTE}</p>
      {status === 'loading' && row === undefined && <p className="q3-set__muted" role="status">Loading phone rights.</p>}
      {error !== '' && <p role="alert" className="q3-set__error" data-testid="phr-error">{error}</p>}
      {status === 'unavailable' && <p className="q3-set__muted" data-testid="phr-unavailable">Until then every phone keeps everything, except changing the Payments list, which stays with seat 1.</p>}
      {row !== undefined && (
        <>
          <p data-testid="phr-now">{currentSettingLine({ flags: row.flags, configured: row.configured })}</p>
          <div className="q3-set__row" role="group" aria-label="Presets">
            {PRESET_NAMES.map((p) => (
              <Button key={p} type="button" variant="ghost" disabled={busy} aria-pressed={presetOf(flags) === p} data-testid={`phr-preset-${p}`} onClick={() => useSeatRightsStore.getState().applyPreset(seatNo, p)}>{p}</Button>
            ))}
          </div>
          <div className="q3-plseat__flags q3-phonerights__flags">
            {SEAT_RIGHT_FLAGS.map((k) => (
              <label key={k} className="q3-set__check">
                <input type="checkbox" checked={flags[k]} disabled={busy} aria-describedby={`phr-${seatNo}-${k}-help`} data-testid={`phr-${seatNo}-${k}`} onChange={(e) => useSeatRightsStore.getState().setFlag(seatNo, k, e.target.checked)} />
                <span>{SEAT_RIGHT_LABELS[k]}</span>
                <span id={`phr-${seatNo}-${k}-help`} className="q3-set__muted q3-phonerights__help">{`Off: ${SEAT_RIGHT_OFF_EFFECT[k]}`}</span>
              </label>
            ))}
          </div>
          <div className="q3-set__row">
            <Button type="button" variant="primary" disabled={busy || !st.isChanged(seatNo)} data-testid="phr-save" onClick={() => { void useSeatRightsStore.getState().save(seatNo) }}>{busy ? 'Saving...' : 'Save'}</Button>
            {savedSeat === seatNo && <span role="status" className="q3-set__saved">Saved.</span>}
          </div>
          <p className="q3-set__muted" data-testid="phr-last">{lastSavedLine(row, when)}</p>
        </>
      )}
      <p className="q3-set__muted">{PHONE_RIGHTS_APPLY_NOTE}</p>
      <p className="q3-set__muted" data-testid="phr-limit">{SEAT_RIGHTS_HONEST_LIMIT}</p>
    </div>
  )
}
