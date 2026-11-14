import { useEffect, useState } from 'react'
import { Button } from '../ui'
import { ALL_RIGHTS, PERM_FLAGS, PERM_LABELS, rightsStatusView, type PermFlag, type PermFlags } from '@shared/pricelist/perms'
import { usePriceRightsStore } from '../../stores/priceRightsStore'

const seatName = (seatNo: number, branchName: string | null): string => (branchName ? `Seat ${seatNo} (${branchName})` : `Seat ${seatNo}`)

/**
 * Phase 242 (M23) - Settings > Price List > Who can edit. Shown to seat 1 only, and only while shared sync is on (rights are not used otherwise).
 * One row per seat, five checkboxes with plain words; seat 1 always keeps every right. The server enforces it; this only edits the table.
 */
export function PriceRightsSettings(): React.JSX.Element | null {
  const info = usePriceRightsStore((s) => s.info)
  const seats = usePriceRightsStore((s) => s.seats)
  const error = usePriceRightsStore((s) => s.error)
  const busy = usePriceRightsStore((s) => s.busy)
  const savedSeat = usePriceRightsStore((s) => s.savedSeat)
  const [draft, setDraft] = useState<Record<number, PermFlags>>({})
  const show = info !== null && info.syncActive && info.isSeat1
  const when = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString() }
  useEffect(() => {
    void usePriceRightsStore.getState().load(false).then(() => { if (usePriceRightsStore.getState().info?.isSeat1) void usePriceRightsStore.getState().loadSeats() })
    return () => usePriceRightsStore.getState().reset()
  }, [])
  // Phase 255: the Rights status is shown to EVERY seat while shared sync is on (not only seat 1), so "granted but cannot edit" can be seen on the seat itself.
  if (info === null || !info.syncActive) return null
  const sv = rightsStatusView(info, when)
  const statusBlock = (
    <div className="q3-set__panel" role="group" aria-label="Rights of this seat" data-testid="plr-status">
      <h2 className="q3-page__title">Rights of this seat</h2>
      <p data-testid="plr-seat">{sv.seat}</p>
      <p data-testid="plr-rights">{sv.rights}</p>
      <p className="q3-set__muted" data-testid="plr-checked">{sv.checked}</p>
      {sv.error !== '' && <p role="alert" className="q3-set__error" data-testid="plr-lasterror">The last check failed: {sv.error} The last known rights stay.</p>}
      <Button type="button" disabled={busy} onClick={() => { void usePriceRightsStore.getState().load(true) }}>Check again</Button>
    </div>
  )
  if (!show) return statusBlock
  const flagsOf = (seatNo: number, saved: PermFlags): PermFlags => draft[seatNo] ?? saved
  const toggle = (seatNo: number, saved: PermFlags, f: PermFlag, on: boolean): void => setDraft((d) => ({ ...d, [seatNo]: { ...flagsOf(seatNo, saved), [f]: on } }))
  return (
    <>
    {statusBlock}
    <div className="q3-set__panel" role="group" aria-label="Who can edit the Price List">
      <h2 className="q3-page__title">Who can edit</h2>
      <p className="q3-set__muted">Every seat can look at the Price List, search it and use it while billing. Choose what each other seat may also change. Seat 1 (this PC) can always do everything. A change a seat is not allowed to make is not accepted, even if that PC is offline when you change this.</p>
      {seats.length === 0 && !busy && error === '' && <p className="q3-set__muted" data-testid="plr-none">No other seats yet.</p>}
      <div className="q3-plseat">
        {seats.map((r) => {
          const own = r.seatNo === 1
          const f = own ? ALL_RIGHTS : flagsOf(r.seatNo, r.flags)
          const changed = !own && PERM_FLAGS.some((k) => f[k] !== r.flags[k])
          return (
            <div key={r.seatNo} className="q3-plseat__row" role="group" aria-label={seatName(r.seatNo, r.branchName)} data-testid={`plr-seat-${r.seatNo}`}>
              <span className="q3-plseat__who">{seatName(r.seatNo, r.branchName)}</span>
              <div className="q3-plseat__flags">
                {PERM_FLAGS.map((k) => (
                  <label key={k} className="q3-set__check">
                    <input type="checkbox" checked={f[k]} disabled={own || busy} onChange={(e) => toggle(r.seatNo, r.flags, k, e.target.checked)} />
                    <span>{PERM_LABELS[k]}</span>
                  </label>
                ))}
              </div>
              {own ? <span className="q3-set__muted">Always everything</span> : (
                <Button type="button" variant="primary" disabled={busy || !changed} onClick={() => { void usePriceRightsStore.getState().saveSeat(r.seatNo, f).then(() => { if (!usePriceRightsStore.getState().error) setDraft((d) => { const n = { ...d }; delete n[r.seatNo]; return n }) }) }}>Save</Button>
              )}
              {savedSeat === r.seatNo && <span role="status" className="q3-set__saved">Saved.</span>}
            </div>
          )
        })}
      </div>
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
    </div>
    </>
  )
}
