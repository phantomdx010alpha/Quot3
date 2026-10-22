import { Plus, Trash } from '@phosphor-icons/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { loadPartyDirectory, type PartyDirectory } from '../../../data/partySearch'
import { getBill } from '../../../data/billsRepo'
import type { Draft } from '../../../data/draftsRepo'
import type { Bill } from '../../../../shared/types'
import { RichName } from '../../RichName'
import { runsOf } from '../../editor/editorRuns'
import {
  addItemRow, applyParty, buildEditorView, checkSave, editableFormats, isDirty, readNumberText, setFormat, setItemField, setPartyField, type EditorState
} from '../../editor/editorModel'
import { autosave, discardDraft, findRecoverable, openEditor, recoverDraft, saveEditorBill } from '../../editor/editorIo'
import type { ShareKind, ShareStyle } from '../../../share/shareBill'
import { Button } from '../../kit/Button'
import { changeBillDate } from '../../kit/dateField'
import { DateField } from '../../kit/DateField'
import { ItemLine } from '../../kit/ItemLine'
import { removeRowWithUndo, restoreRemoval } from '../../kit/rowUndo'
import { SegmentedControl } from '../../kit/SegmentedControl'
import { moneyText } from '../../kit/display'
import { SnackbarHost, useSnackbar } from '../../kit/Snackbar'
import { TotalsBlock } from '../../kit/TotalsBlock'
import { tidyTotals } from '../tidy/tidyTotals'
import { EMPTY_QUICK, isBlankRow, quickAddIssue, type QuickFields } from './guidedQuickAdd'
import { hasCompanyName, loadShareDefaults, shareBillNow } from './guidedShare'
import { GUIDED_STEPS, setGuidedBackHandler, stepBack, takeContinueDraft, type GuidedStepId } from './guidedStep'
import type { EditorProps } from '../types'

const STEP_NAMES: Record<GuidedStepId, string> = { party: 'Party', items: 'Items', review: 'Review' }

/** A text box that grows while typing, so a long name is always fully visible. Enter moves on (`onEnter`). */
function GrowText(props: { value: string; label: string; field: string; enter: 'next' | 'done'; onValue: (v: string) => void; onEnter?: () => void; onFocus?: () => void; onBlur?: () => void }): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !el.scrollHeight) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [props.value])
  return (
    <textarea
      ref={ref} className="q3x-input q3x-grow" rows={1} aria-label={props.label} placeholder={props.label} data-f={props.field} enterKeyHint={props.enter} autoComplete="off"
      value={props.value} onFocus={props.onFocus} onBlur={props.onBlur}
      onChange={(e) => props.onValue(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); props.onEnter?.() } }}
    />
  )
}

/** A number box that keeps what was typed and gives only a clean decimal string. */
function Num(props: { value: string; label: string; field: string; enter: 'next' | 'done'; onValue: (v: string) => void; onEnter: () => void }): ReactElement {
  return (
    <input
      className="q3x-input q3x-num" inputMode="decimal" enterKeyHint={props.enter} aria-label={props.label} placeholder={props.label} data-f={props.field}
      value={props.value}
      onChange={(e) => props.onValue(readNumberText(e.target.value, false).text)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); props.onEnter() } }}
    />
  )
}

/** Guided editor (Phase 193): the SAME `editorModel` / `editorIo` / `EditorApi`, guard, drafts, clean new bill (A31) and name rule as classic, as three steps:
 *  Party, Items (a quick-add bar above the keyboard; added lines above it, tap one to change it, Undo on removal) and Review (total, Rough / Professional,
 *  Share image, Share PDF). Back steps back first (`interceptBack`), then the normal unsaved guard runs. Saving happens on Review; after it the
 *  bill is final here (Back / Done leave to the bill view). */
export function GuidedEditor(props: EditorProps): ReactElement {
  const { db, id, onDirtyChange } = props
  const [state, setState] = useState<EditorState | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [recover, setRecover] = useState<Draft | null>(null)
  const [dir, setDir] = useState<PartyDirectory | null>(null)
  const [step, setStep] = useState<GuidedStepId>('party')
  const [quick, setQuick] = useState<QuickFields>(EMPTY_QUICK)
  const [editId, setEditId] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [saved, setSaved] = useState<{ id: string; poNumber: string; bill: Bill } | null>(null)
  const [style, setStyle] = useState<ShareStyle>('professional')
  const [kind, setKind] = useState<ShareKind>('image')
  const [noCompany, setNoCompany] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareNote, setShareNote] = useState<string | null>(null)
  const snack = useSnackbar()
  const root = useRef<HTMLDivElement>(null)
  const stateRef = useRef<EditorState | null>(null)
  stateRef.current = state
  const stepRef = useRef(step)
  stepRef.current = step
  const savedRef = useRef(saved)
  savedRef.current = saved
  const nowFn = props.now

  // Open: a NEW bill is always clean (A31); a saved draft is only offered, unless Home's "Continue draft" asked for it.
  useEffect(() => {
    if (!db) return undefined
    let cancelled = false
    const wantDraft = id === undefined && takeContinueDraft()
    void (async () => {
      const r = await openEditor(db, id, nowFn ? nowFn() : new Date())
      if (cancelled) return
      if (r.kind === 'ready') {
        setState(r.state)
        const d = await findRecoverable(db, id)
        if (!cancelled && d) {
          if (wantDraft) { const s = await recoverDraft(db, d); if (!cancelled) setState(s) } else setRecover(d)
        }
      } else setBlocked(r.kind === 'read-only' ? r.reason : r.message)
      const directory = await loadPartyDirectory(db)
      if (!cancelled) setDir(directory)
      const def = await loadShareDefaults(db)
      if (!cancelled) { setStyle(def.style); setKind(def.kind) }
    })().catch((e: unknown) => { if (!cancelled) setBlocked(`Could not open the bill: ${e instanceof Error ? e.message : String(e)}`) })
    return () => { cancelled = true }
  }, [db, id, nowFn])

  const dirty = state ? isDirty(state) : false
  useEffect(() => { onDirtyChange?.(dirty && saved === null) }, [dirty, saved, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  // Autosave the open bill (debounced, off the typing path). A bill with nothing typed has no draft; a saved bill needs none.
  useEffect(() => {
    if (!db || !state || !dirty || recover || saved) return undefined
    const t = setTimeout(() => { void autosave(db, state, nowFn).catch(() => undefined) }, 800)
    return () => clearTimeout(t)
  }, [db, state, dirty, recover, saved, nowFn])

  const update = useCallback((f: (s: EditorState) => EditorState) => { setMessage(null); setState((s) => (s ? f(s) : s)) }, [])

  useEffect(() => {
    if (!focusKey) return
    const el = root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-f="${focusKey}"]`)
    if (el) { el.focus(); setFocusKey(null) }
  }, [focusKey, step, state])

  /** Saves the bill. `leave` = the guard prompt's Save (the App moves on itself, `onSaved` is silenced there); otherwise the Review step stays to share. */
  const doSave = useCallback(async (leave: boolean): Promise<boolean> => {
    const s = stateRef.current
    if (!db || !s) return false
    const issue = checkSave(s)
    if (issue) {
      setMessage(issue.message)
      if (issue.code === 'PARTY_NAME_REQUIRED') { setStep('party'); setFocusKey('party:name') }
      return false
    }
    setSaving(true)
    const r = await saveEditorBill(db, s, props.onChanged)
    setSaving(false)
    if (!r.ok) { setMessage(r.message); return false }
    onDirtyChange?.(false)
    if (leave) { props.onSaved(r.id); return true }
    try {
      const bill = await getBill(db, r.id)
      setSaved({ id: r.id, poNumber: r.poNumber, bill })
      setNoCompany(style === 'professional' && !(await hasCompanyName(db)))
    } catch { props.onSaved(r.id) }
    return true
  }, [db, onDirtyChange, props, style])

  useEffect(() => {
    if (!props.apiRef) return undefined
    const ref = props.apiRef
    ref.current = {
      save: async () => (stateRef.current && isDirty(stateRef.current) && savedRef.current === null ? doSave(true) : true),
      discard: async () => { if (db && stateRef.current) await discardDraft(db, stateRef.current.bill.id) }
    }
    return () => { ref.current = null }
  }, [props.apiRef, doSave, db])

  // Back order: a step back is consumed here; the first step is not (the unsaved guard runs then).
  useEffect(() => {
    setGuidedBackHandler(() => {
      const to = stepBack(stepRef.current, savedRef.current !== null)
      if (to === null) return false
      if (to === 'leave') { if (savedRef.current) props.onSaved(savedRef.current.id) } else setStep(to)
      return true
    })
    return () => setGuidedBackHandler(null)
  }, [props])

  const view = useMemo(() => (state ? buildEditorView(state) : null), [state])
  const totals = useMemo(() => (state ? tidyTotals(state.bill) : null), [state])
  const formats = useMemo(() => editableFormats(), [])
  const suggestions = useMemo(() => (state && dir && suggestOpen ? dir.search(state.bill.party.name) : []), [state, dir, suggestOpen])

  if (blocked) return <p className="q3-note q3-note-warn" role="alert">{blocked}</p>
  if (!db) return <p className="q3-muted">The phone database is not available.</p>
  if (!state || !view || !totals) return <p className="q3-muted">Opening the bill...</p>

  const lines = view.items.filter((r) => !isBlankRow(r))
  const isNewName = dir ? dir.isNew(state.bill.party.name) : false
  const stepNo = GUIDED_STEPS.indexOf(step) + 1

  const goReview = (): void => {
    const issue = checkSave(state)
    if (issue) {
      setMessage(issue.message)
      if (issue.code === 'PARTY_NAME_REQUIRED') { setStep('party'); setFocusKey('party:name') }
      return
    }
    setMessage(null); setStep('review')
  }

  const writeRow = (s0: EditorState, rid: string, q: QuickFields): EditorState => {
    let s = setItemField(s0, rid, 'name', q.name)
    s = setItemField(s, rid, 'qty', q.qty)
    s = setItemField(s, rid, 'rate', q.rate)
    if (view.hasGst) s = setItemField(s, rid, 'gstRate', q.gst)
    return s
  }
  const addLine = (): void => {
    const issue = quickAddIssue(quick)
    if (issue) { setMessage(issue); setFocusKey('q:name'); return }
    setMessage(null)
    if (editId) {
      setState(writeRow(state, editId, quick)); setEditId(null)
    } else {
      let s = state
      let rid = view.items.find(isBlankRow)?.id
      if (!rid) { const a = addItemRow(s); s = a.state; rid = a.id }
      setState(writeRow(s, rid, quick))
    }
    setQuick(EMPTY_QUICK); setFocusKey('q:name')
  }
  const pickLine = (rid: string): void => {
    const r = view.items.find((x) => x.id === rid)
    if (!r) return
    setEditId(rid); setQuick({ name: r.name, qty: r.qty, rate: r.rate, gst: r.gstRate }); setMessage(null); setFocusKey('q:name')
  }
  const cancelEdit = (): void => { setEditId(null); setQuick(EMPTY_QUICK) }
  const removeLine = (rid: string): void => {
    const r = removeRowWithUndo(state, rid)
    setMessage(null); setState(r.state); setEditId(null); setQuick(EMPTY_QUICK)
    const removal = r.removal
    if (removal) snack.show('Row removed', () => update((s) => restoreRemoval(s, removal)))
  }
  const q = (patch: Partial<QuickFields>): void => setQuick((x) => ({ ...x, ...patch }))
  const share = async (k: ShareKind): Promise<void> => {
    if (!saved) return
    setKind(k); setSharing(true); setShareNote(null)
    try { setShareNote(await shareBillNow(db, saved.bill, style, k)) } catch (e) { setShareNote(e instanceof Error ? e.message : String(e)) } finally { setSharing(false) }
  }

  return (
    <div className="q3x-tidy-page q3x-tidy-editor" ref={root}>
      {recover ? (
        <section className="q3x-tidy-card" role="status" aria-label="Unsaved bill from last time">
          <p className="q3x-tidy-text">You have an unsaved bill from last time.</p>
          <div className="q3x-tidy-actions">
            <Button label="Recover" variant="primary" onClick={() => { void recoverDraft(db, recover).then((s) => { setState(s); setRecover(null) }) }} />
            <Button label="Discard" onClick={() => { void discardDraft(db, recover.id).then(() => setRecover(null)) }} />
          </div>
        </section>
      ) : null}

      <p className="q3x-guided-steps" aria-label={`Step ${stepNo} of 3`}>
        <span className="q3x-guided-stepname">{STEP_NAMES[step]}</span>
        <span className="q3x-tidy-sub">Step {stepNo} of 3</span>
      </p>

      {step === 'party' ? (
        <section className="q3x-tidy-party-block" aria-label="Party">
          <div className="q3x-tidy-partyname">
            <GrowText
              value={state.bill.party.name} label="Party name" field="party:name" enter="next"
              onValue={(v) => { update((s) => setPartyField(s, 'name', v)); setSuggestOpen(true) }}
              onEnter={() => { setSuggestOpen(false); setStep('items'); setFocusKey('q:name') }}
              onFocus={() => setSuggestOpen(true)} onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
            />
            {suggestions.length > 0 ? (
              <ul className="q3x-tidy-suggest" role="listbox" aria-label="Customers">
                {suggestions.map((p) => (
                  <li key={p.id} role="option" aria-selected="false">
                    <button type="button" className="q3x-tidy-row" onMouseDown={(e) => e.preventDefault()} onClick={() => { update((s) => applyParty(s, p)); setSuggestOpen(false) }}>
                      <span className="q3x-tidy-row-title">{p.name}</span><span className="q3x-tidy-sub">{p.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {isNewName ? <p className="q3x-tidy-sub">New customer: it is added when you save.</p> : null}
          <SegmentedControl ariaLabel="Bill format" value={state.bill.formatId} onChange={(f) => update((s) => setFormat(s, f))} options={formats.map((f) => ({ id: f.id, label: f.label }))} />
          <DateField label="Bill date" value={state.bill.billDate} onChange={(d) => update((s) => changeBillDate(s, d))} />
          <input className="q3x-input" inputMode="tel" aria-label="Phone" placeholder="Phone (optional)" value={state.bill.party.phone} onChange={(e) => update((s) => setPartyField(s, 'phone', e.target.value))} />
          <input className="q3x-input" aria-label="Transport" placeholder="Transport (optional)" value={state.bill.party.transport} onChange={(e) => update((s) => setPartyField(s, 'transport', e.target.value))} />
          <textarea className="q3x-input q3x-grow" rows={2} aria-label="Address" placeholder="Address (optional)" value={state.bill.party.address} onChange={(e) => update((s) => setPartyField(s, 'address', e.target.value))} />
          {message ? <p className="q3x-tidy-note" role="alert">{message}</p> : null}
          <Button label="Next: items" variant="primary" onClick={() => { setSuggestOpen(false); setStep('items'); setFocusKey('q:name') }} />
        </section>
      ) : null}

      {step === 'items' ? (
        <>
          <p className="q3x-tidy-sub">{state.bill.party.name.trim() || 'No party name yet'}</p>
          {lines.length === 0 ? <p className="q3-muted">No items yet. Type the first one below.</p> : (
            <ol className="q3x-tidy-list" aria-label="Items">
              {lines.map((r) => (
                <li key={r.id} className={`q3x-tidy-li${r.warn ? ' q3x-tidy-warn' : ''}`}>
                  <button type="button" className="q3x-tidy-rowbtn" aria-label={`Edit row ${r.slNo || ''} ${r.name}`.trim()} onClick={() => pickLine(r.id)}>
                    <ItemLine name={<RichName runs={runsOf(state, r.id)} />} amount={r.amount} qty={r.qty} rate={r.rate} gstPct={view.hasGst ? r.gstRate : ''} priceSetByUser={r.override !== ''} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="q3x-guided-dock">
            <section className="q3x-guided-quick" aria-label="Quick add">
              <GrowText value={quick.name} label="Item" field="q:name" enter="next" onValue={(v) => { setMessage(null); q({ name: v }) }} onEnter={() => setFocusKey('q:qty')} />
              <div className={`q3x-guided-quicknums${view.hasGst ? '' : ' q3x-guided-two'}`}>
                <Num label="Qty" field="q:qty" value={quick.qty} enter="next" onValue={(v) => q({ qty: v })} onEnter={() => setFocusKey('q:rate')} />
                <Num label="Rate" field="q:rate" value={quick.rate} enter={view.hasGst ? 'next' : 'done'} onValue={(v) => q({ rate: v })} onEnter={() => (view.hasGst ? setFocusKey('q:gst') : addLine())} />
                {view.hasGst ? <Num label="GST %" field="q:gst" value={quick.gst} enter="done" onValue={(v) => q({ gst: v })} onEnter={addLine} /> : null}
              </div>
              {message ? <p className="q3x-tidy-note" role="alert">{message}</p> : null}
              <div className="q3x-tidy-actions">
                <Button label={editId ? 'Update' : 'Add'} variant="primary" icon={<Plus size={20} aria-hidden="true" />} onClick={addLine} />
                {editId ? <Button label="Cancel" onClick={cancelEdit} /> : null}
                {editId ? <Button label="Remove row" hideLabel icon={<Trash size={22} aria-hidden="true" />} onClick={() => removeLine(editId)} /> : null}
              </div>
            </section>
            <footer className="q3x-tidy-stickybar q3x-tidy-savebar" aria-label="Running total">
              <div className="q3x-tidy-saverow">
                <span className="q3x-tidy-savetotal" aria-label="Final total"><span className="q3x-tidy-sub">Total</span> <strong className="q3x-amount-grand">{moneyText(view.grandTotal)}</strong></span>
                <Button label="Review" variant="primary" onClick={goReview} />
              </div>
            </footer>
          </div>
        </>
      ) : null}

      {step === 'review' ? (
        <section className="q3x-guided-review" aria-label="Review">
          <h2 className="q3x-tidy-party">{state.bill.party.name.trim()}</h2>
          <p className="q3x-tidy-sub">{state.bill.billDate} {'·'} {lines.length} {lines.length === 1 ? 'item' : 'items'}</p>
          {totals.show ? <TotalsBlock rows={totals.rows} total={totals.total} /> : <p className="q3x-tidy-text">Total <strong className="q3x-amount-grand">{moneyText(view.grandTotal)}</strong></p>}
          {message ? <p className="q3x-tidy-note" role="alert">{message}</p> : null}
          {saved === null ? (
            <Button label={saving ? 'Saving...' : 'Save bill'} variant="primary" disabled={saving} onClick={() => { void doSave(false) }} />
          ) : (
            <>
              <p className="q3x-tidy-text" role="status">Saved as {saved.poNumber}; pick WhatsApp in the share list.</p>
              <SegmentedControl ariaLabel="Style" value={style} onChange={(v) => setStyle(v as ShareStyle)} options={[{ id: 'rough', label: 'Rough' }, { id: 'professional', label: 'Professional' }]} />
              {noCompany && style === 'professional' ? <p className="q3x-tidy-sub" role="note">No company name yet: the page shows a placeholder. Add yours in Settings.</p> : null}
              <Button label={sharing && kind === 'image' ? 'Preparing' : 'Share image'} variant="primary" disabled={sharing} onClick={() => { void share('image') }} />
              <Button label={sharing && kind === 'pdf' ? 'Preparing' : 'Share PDF'} disabled={sharing} onClick={() => { void share('pdf') }} />
              {shareNote ? <p className="q3x-tidy-sub" role="status">{shareNote}</p> : null}
              <Button label="Done" onClick={() => props.onSaved(saved.id)} />
            </>
          )}
        </section>
      ) : null}
      <div className="q3x-tidy-snackwrap"><SnackbarHost snack={snack} /></div>
    </div>
  )
}
