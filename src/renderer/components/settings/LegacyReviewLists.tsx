import { useEffect, useState } from 'react'
import { activityKindText, whyText, type ReviewItem } from '@shared/legacyWatch/reviewTypes'
import { Button } from '../ui'
import { useLegacyWatchStore } from '../../stores/legacyWatchStore'

/** ISO time in the owner's local time; the raw text when it cannot be read. */
const stamp = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString() }

function ReviewRow({ item, ignored }: { item: ReviewItem; ignored: boolean }): React.JSX.Element {
  const busy = useLegacyWatchStore((s) => s.busy)
  const st = useLegacyWatchStore.getState()
  const live = item.candidates.filter((c) => !c.deleted)
  const [pick, setPick] = useState('')
  const target = pick !== '' ? pick : live.length === 1 ? live[0]!.billId : ''
  return (
    <li className="q3-lw__item" data-testid="lw-review-item">
      <p><strong>{item.party || 'Unknown party'}</strong> | {item.billDate || 'no date'} | Total {item.total || 'unknown'}</p>
      <p className="q3-set__muted">{item.fileName}</p>
      <p>{whyText(item.why, item.reason)}</p>
      <p className="q3-set__muted">{item.candidates.length === 0 ? 'No matching bill in Quot3.' : `In Quot3: ${item.candidates.map((c) => `${c.poNumber || 'a bill'}${c.deleted ? ' (in Recently deleted)' : ''}`).join(', ')}`}</p>
      {ignored ? (
        <div className="q3-set__row"><Button type="button" disabled={busy} onClick={() => { void st.resolveReview(item.id, 'reopen') }}>Put back on the list</Button></div>
      ) : (
        <div className="q3-set__row">
          <Button type="button" variant="primary" disabled={busy} onClick={() => { void st.resolveReview(item.id, 'import_new') }}>Import as new bill</Button>
          {live.length > 1 && (
            <select aria-label="Bill to replace" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a bill</option>
              {live.map((c) => <option key={c.billId} value={c.billId}>{c.poNumber || c.billId}</option>)}
            </select>
          )}
          <Button type="button" disabled={busy || live.length === 0 || target === ''} onClick={() => { void st.resolveReview(item.id, 'replace', target) }}>Replace existing bill with this</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => { void st.resolveReview(item.id, 'ignore') }}>Ignore</Button>
        </div>
      )}
    </li>
  )
}

/** Phase 163 - Needs review: uncertain legacy files with the owner's three choices; recently ignored ones can be put back. Nothing is deleted. */
export function ReviewList(): React.JSX.Element {
  const review = useLegacyWatchStore((s) => s.review)
  useEffect(() => { void useLegacyWatchStore.getState().loadReview() }, [])
  return (
    <section className="q3-lw__list" aria-label="Needs review">
      <h2 className="q3-page__title">Needs review{review.open.length > 0 ? ` (${review.open.length})` : ''}</h2>
      {review.open.length === 0 ? <p className="q3-set__muted" data-testid="lw-review-empty">Nothing is waiting for you.</p> : (
        <ul className="q3-lw__items">{review.open.map((r) => <ReviewRow key={r.id} item={r} ignored={false} />)}</ul>
      )}
      {review.ignored.length > 0 && (
        <details>
          <summary>Recently ignored ({review.ignored.length})</summary>
          <ul className="q3-lw__items">{review.ignored.map((r) => <ReviewRow key={r.id} item={r} ignored />)}</ul>
        </details>
      )}
    </section>
  )
}

/** Phase 163 - Activity: the last 200 automatic events; an import or update can be undone (the bill goes to Recently deleted / gets its earlier version back). */
export function ActivityList(): React.JSX.Element {
  const activity = useLegacyWatchStore((s) => s.activity)
  const busy = useLegacyWatchStore((s) => s.busy)
  useEffect(() => { void useLegacyWatchStore.getState().loadActivity() }, [])
  return (
    <section className="q3-lw__list" aria-label="Activity">
      <h2 className="q3-page__title">Activity</h2>
      {activity.length === 0 ? <p className="q3-set__muted" data-testid="lw-activity-empty">No automatic activity yet.</p> : (
        <ul className="q3-lw__items">
          {activity.map((a) => (
            <li key={a.id} className="q3-lw__item" data-testid="lw-activity-item">
              <p><strong>{activityKindText(a.kind)}</strong>{a.poNumber ? ` ${a.poNumber}` : ''}{a.undone ? ' (undone)' : ''} <span className="q3-set__muted">{stamp(a.at)}</span></p>
              <p className="q3-set__muted">{a.detail}</p>
              {a.canUndo && <div className="q3-set__row"><Button type="button" disabled={busy} onClick={() => { void useLegacyWatchStore.getState().undoActivity(a.id) }}>Undo</Button></div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
