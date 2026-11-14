import { useEffect, useState } from 'react'
import { canShowCode, capMessage, capReached, confirmReady, confirmWords, lastSeenWords, resetButtonWords, seatActions, seatStatusWords } from '@shared/master/seatsView'
import { SEATS_MAX } from '@shared/master/schemas'
import { Button, Input } from '../ui'
import { useMasterSeatsStore } from '../../stores/masterSeatsStore'
import { PriceRightsSettings } from './PriceRightsSettings'

/**
 * Phase 265 - the seat list for seat 1 (API_CONTRACTS.md M24-K): table, "Add seat", the new code shown once with a Copy button, and
 * "Show code" for seats that have one. Phase 266 adds per-seat Rename, Reset, New code, Delete (typed confirmations) and an inline Price List rights editor (reuses PriceRightsSettings). Only drawn for a linked seat 1.
 */
export function CompanySeatsPanel(): React.JSX.Element {
  const st = useMasterSeatsStore()
  const [note, setNote] = useState('')
  useEffect(() => { void useMasterSeatsStore.getState().load(); return () => useMasterSeatsStore.getState().clear() }, [])
  const max = st.company?.maxSeats ?? SEATS_MAX
  const full = st.status === 'ready' && capReached(st.seats.length, max)
  const copy = async (code: string): Promise<void> => {
    try { await navigator.clipboard.writeText(code); setNote('Code copied.') } catch { setNote('Could not copy. Select the code and press Ctrl+C.') }
  }
  return (
    <div className="q3-seatlist" aria-label="Seat list">
      {st.status === 'loading' && st.seats.length === 0 && <p className="q3-set__muted" role="status">Loading seats.</p>}
      {st.error !== '' && <p role="alert" className="q3-set__error">{st.error}</p>}
      {st.newCode && (
        <div className="q3-seatnew" aria-label="New seat code">
          <p role="status">{`Seat ${st.newCode.no} (${st.newCode.label}) is ready. Give this code to the person.`}</p>
          <code className="q3-seatnew__code" data-testid="new-seat-code">{st.newCode.code}</code>
          <div className="q3-set__row">
            <Button variant="primary" onClick={() => { void copy(st.newCode!.code) }}>Copy code</Button>
            <Button variant="ghost" onClick={() => { setNote(''); st.dismissNewCode() }}>Done</Button>
          </div>
        </div>
      )}
      {st.done !== '' && <p role="status" className="q3-set__saved" data-testid="seat-done">{st.done}</p>}
      {note !== '' && <p role="status" className="q3-set__saved">{note}</p>}
      {st.seats.length > 0 && (
        <ul className="q3-seats" aria-label="Company seats">
          {st.seats.map((s) => {
            const a = seatActions(s)
            const showCode = canShowCode(s) && s.no !== 1
            return (
              <li key={s.no} className={`q3-seat${s.status === 'active' ? '' : ' q3-seat--off'}`} data-seat={s.no}>
                <div className="q3-seat__head">
                  <span className="q3-seat__no" aria-label={`Seat ${s.no}`}>{s.no}</span>
                  <div className="q3-seat__who">
                    <strong className="q3-seat__name">{s.label}</strong>
                    <span className="q3-seat__meta">{seatStatusWords(s)} · Last seen {lastSeenWords(s.lastSeenAt)}</span>
                  </div>
                  {s.no === 1 && <span className="q3-badge q3-badge--accent">This PC</span>}
                  {s.legacy && <span className="q3-badge" data-testid={`legacy-${s.no}`}>Existing login</span>}
                </div>
                {s.status === 'active' && s.no !== 1 && (
                  <div className="q3-seat__code">
                    <span className="q3-seat__label">Code</span>
                    {showCode ? (
                      st.shown[s.no]
                        ? <><code data-testid={`code-${s.no}`}>{s.code}</code><Button variant="ghost" onClick={() => { void copy(s.code!) }}>Copy</Button><Button variant="ghost" onClick={() => st.toggleShow(s.no)}>Hide</Button></>
                        : <><code>{s.codeHint ?? ''}</code><Button variant="ghost" onClick={() => st.toggleShow(s.no)}>Show code</Button></>
                    ) : <span className="q3-seat__meta">{s.legacy ? 'No code yet. Use Reset to make one.' : (s.codeHint ?? '')}</span>}
                  </div>
                )}
                <div className="q3-seat__actions">
                  {a.rename && <Button variant="ghost" disabled={st.busy} onClick={() => st.ask('rename', s.no)}>Rename</Button>}
                  {a.rights && <Button variant="ghost" onClick={() => st.openRights(st.rightsFor === s.no ? null : s.no)}>{st.rightsFor === s.no ? 'Close rights' : 'Price List rights'}</Button>}
                  {a.regen && <Button variant="ghost" disabled={st.busy} onClick={() => st.ask('regen', s.no)}>New code</Button>}
                  {a.reset && <Button variant="ghost" disabled={st.busy} onClick={() => st.ask('reset', s.no)}>{resetButtonWords(s)}</Button>}
                  {a.delete && <Button variant="ghost" disabled={st.busy} onClick={() => st.ask('delete', s.no)}>Delete</Button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {st.pending && (() => {
        const seat = st.seats.find((x) => x.no === st.pending!.no)
        if (!seat) return null
        const kind = st.pending.kind
        return (
          <form className="q3-set__form" aria-label="Confirm seat action" data-testid="seat-confirm" onSubmit={(e) => { e.preventDefault(); void st.confirm() }}>
            {kind === 'rename'
              ? <Input label="Seat name" value={st.renameLabel} autoComplete="off" disabled={st.busy} onChange={(e) => st.setRenameLabel(e.target.value)} />
              : <p role="status">{confirmWords(kind, seat)}</p>}
            {kind === 'delete' && <Input label="Type DELETE" value={st.typed} autoComplete="off" spellCheck={false} disabled={st.busy} onChange={(e) => st.setTyped(e.target.value)} />}
            <div className="q3-set__row">
              <Button type="submit" variant="primary" disabled={st.busy || !confirmReady(kind, st.typed)}>{st.busy ? 'Working...' : kind === 'rename' ? 'Save name' : kind === 'delete' ? 'Delete seat' : kind === 'regen' ? 'Make new code' : 'Reset seat'}</Button>
              <Button type="button" variant="ghost" disabled={st.busy} onClick={() => st.cancel()}>Cancel</Button>
            </div>
          </form>
        )
      })()}
      {st.rightsFor !== null && <PriceRightsSettings onlySeat={st.rightsFor} />}
      <form className="q3-seatadd" aria-label="Add seat" onSubmit={(e) => { e.preventDefault(); void st.add() }}>
        <Input label="New seat name" value={st.addLabel} autoComplete="off" disabled={st.busy || full} onChange={(e) => st.setAddLabel(e.target.value)} />
        <Button type="submit" variant="primary" disabled={st.busy || full || st.status !== 'ready'}>{st.busy ? 'Adding...' : 'Add seat'}</Button>
      </form>
      {full && <p className="q3-set__muted">{capMessage(max)}</p>}
    </div>
  )
}
