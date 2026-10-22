import { Plus, ShareNetwork } from '@phosphor-icons/react'
import { useEffect, useState, type ReactElement } from 'react'
import { getBill } from '../../../data/billsRepo'
import { findRecoverable } from '../../editor/editorIo'
import { Button } from '../../kit/Button'
import { loadShareDefaults, shareBillNow } from './guidedShare'
import { requestContinueDraft } from './guidedStep'
import type { ScreenProps } from '../types'

const billsWord = (n: number): string => `${n} ${n === 1 ? 'bill' : 'bills'}`

/** Guided Home (Phase 193): one huge "New bill", "Continue draft" (the existing draft recovery, offered only when there is a saved draft of a new bill),
 *  and today's bills, each with a visible Share button. New bill opens a CLEAN bill (A31). Reads what App.tsx loaded. */
export function GuidedHome(props: ScreenProps): ReactElement {
  const { db } = props
  const d = props.dashboard
  const [hasDraft, setHasDraft] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!db) return undefined
    let off = false
    void findRecoverable(db, undefined).then((x) => { if (!off) setHasDraft(x !== undefined) }, () => undefined)
    return () => { off = true }
  }, [db])

  const shareRow = async (id: string): Promise<void> => {
    if (!db) return
    setBusyId(id); setNote(null); setError(null)
    try {
      const bill = await getBill(db, id)
      const def = await loadShareDefaults(db)
      setNote(await shareBillNow(db, bill, def.style, def.kind))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  if (d?.error) return <p className="q3-note q3-note-warn" role="alert">{d.error}</p>
  const view = d?.view ?? null
  if (!view) return <p className="q3-muted" role="status">Loading</p>
  const todays = view.recent.filter((b) => b.billDate === view.today.date)

  return (
    <div className="q3x-tidy-page">
      <button type="button" className="q3x-guided-new" onClick={() => props.onNavigate('create')}>
        <Plus size={28} weight="bold" aria-hidden="true" /><span>New bill</span>
      </button>
      {hasDraft ? <Button label="Continue draft" onClick={() => { requestContinueDraft(); props.onNavigate('create') }} /> : null}
      <section aria-label="Today">
        <h2 className="q3x-tidy-h2 q3x-tidy-day"><span>Today</span><span>{billsWord(view.today.count)} {'·'} {view.today.total}</span></h2>
        {todays.length === 0 ? <p className="q3-muted">No bills yet today.</p> : (
          <ul className="q3x-tidy-list">
            {todays.map((b) => (
              <li key={b.id} className="q3x-guided-bill">
                <button type="button" className="q3x-tidy-row" onClick={() => props.onNavigate('billview', b.id)}>
                  <span className="q3x-tidy-row-main">
                    <span className="q3x-tidy-row-title">{b.partyName || 'No name'}</span>
                    <span className="q3x-tidy-sub">{b.poNumber}</span>
                  </span>
                  <span className="q3x-amount">{b.total}</span>
                </button>
                <Button label={busyId === b.id ? 'Preparing' : 'Share'} disabled={busyId !== null} icon={<ShareNetwork size={20} aria-hidden="true" />} onClick={() => { void shareRow(b.id) }} />
              </li>
            ))}
          </ul>
        )}
        {note ? <p className="q3x-tidy-sub" role="status">{note}</p> : null}
        {error ? <p className="q3x-tidy-note" role="alert">{error}</p> : null}
      </section>
    </div>
  )
}
