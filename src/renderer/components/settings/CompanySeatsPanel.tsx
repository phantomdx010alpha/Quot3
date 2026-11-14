import { useEffect, useState } from 'react'
import { canShowCode, capMessage, capReached, confirmReady, confirmWords, lastSeenWords, resetButtonWords, seatActions, seatStatusWords } from '@shared/master/seatsView'
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
  const max = st.company?.maxSeats ?? 15
  const full = st.status === 'ready' && capReached(st.seats.length, max)
  const copy = async (code: string): Promise<void> => {
    try { await navigator.clipboard.writeText(code); setNote('Code copied.') } catch { setNote('Could not copy. Select the code and press Ctrl+C.') }
  }
  return (
    <div className="q3-set__form" aria-label="Seat list">
      {st.status === 'loading' && st.seats.length === 0 && <p className="q3-set__muted" role="status">Loading seats.</p>}
      {st.error !== '' && <p role="alert" className="q3-set__error">{st.error}</p>}
      {st.newCode && (
        <div className="q3-set__form" aria-label="New seat code">
          <p role="status">{`Seat ${st.newCode.no} (${st.newCode.label}) is ready. Give this code to the person.`}</p>
          <code data-testid="new-seat-code" style={{ userSelect: 'text', fontSize: '1.1em' }}>{st.newCode.code}</code>
          <div className="q3-set__row">
            <Button variant="primary" onClick={() => { void copy(st.newCode!.code) }}>Copy code</Button>
            <Button variant="ghost" onClick={() => { setNote(''); st.dismissNewCode() }}>Done</Button>
          </div>
        </div>
      )}
      {st.done !== '' && <p role="status" className="q3-set__saved" data-testid="seat-done">{st.done}</p>}
      {note !== '' && <p role="status" className="q3-set__saved">{note}</p>}
      {st.seats.length > 0 && (
        <table className="q3-set__table" aria-label="Company seats">
          <thead><tr><th>Seat</th><th>Name</th><th>Status</th><th>Last seen</th><th>Code</th><th>Actions</th></tr></thead>
          <tbody>
            {st.seats.map((s) => (
              <tr key={s.no} data-seat={s.no}>
                <td>{s.no}</td>
                <td>{s.label}{s.legacy && <span className="q3-badge" data-testid={`legacy-${s.no}`}> existing login</span>}</td>
                <td>{seatStatusWords(s)}</td>
                <td>{lastSeenWords(s.lastSeenAt)}</td>
                <td>
                  {canShowCode(s) && s.no !== 1 ? (
                    st.shown[s.no]
                      ? <><code data-testid={`code-${s.no}`} style={{ userSelect: 'text' }}>{s.code}</code> <Button variant="ghost" onClick={() => { void copy(s.code!) }}>Copy</Button> <Button variant="ghost" onClick={() => st.toggleShow(s.no)}>Hide code</Button></>
                      : <>{s.codeHint ?? ''} <Button variant="ghost" onClick={() => st.toggleShow(s.no)}>Show code</Button></>
                  ) : (s.codeHint ?? '')}
                </td>
                <td>
                  <div className="q3-set__row">
                    {(() => {
                      const a = seatActions(s)
                      return <>
                        {a.rename && <Button variant="ghost" disabled={st.busy} onClick={() => st.ask('rename', s.no)}>Rename</Button>}
                        {a.rights && <Button variant="ghost" onClick={() => st.openRights(st.rightsFor === s.no ? null : s.no)}>{st.rightsFor === s.no ? 'Close rights' : 'Price List rights'}</Button>}
                        {a.regen && <Button variant="ghost" disabled={st.busy} onClick={() => st.ask('regen', s.no)}>New code</Button>}
                        {a.reset && <Button variant="ghost" disabled={st.busy} onClick={() => st.ask('reset', s.no)}>{resetButtonWords(s)}</Button>}
                        {a.delete && <Button variant="ghost" disabled={st.busy} onClick={() => st.ask('delete', s.no)}>Delete</Button>}
                      </>
                    })()}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <form className="q3-set__row" aria-label="Add seat" onSubmit={(e) => { e.preventDefault(); void st.add() }}>
        <Input label="New seat name" value={st.addLabel} autoComplete="off" disabled={st.busy || full} onChange={(e) => st.setAddLabel(e.target.value)} />
        <Button type="submit" variant="primary" disabled={st.busy || full || st.status !== 'ready'}>{st.busy ? 'Adding...' : 'Add seat'}</Button>
      </form>
      {full && <p className="q3-set__muted">{capMessage(max)}</p>}
    </div>
  )
}
