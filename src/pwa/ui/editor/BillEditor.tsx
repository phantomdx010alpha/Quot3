import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactElement } from 'react'
import { CaretDown, CaretUp, Plus, Trash } from '@phosphor-icons/react'
import type { PhoneDb } from '../../data/db'
import { loadPartyDirectory, type PartyDirectory } from '../../data/partySearch'
import type { Draft } from '../../data/draftsRepo'
import { RichName } from '../RichName'
import { runsOf } from './editorRuns'
import {
  addAdjustment, addColumn, addItemRow, applyParty, buildEditorView, buildUnitsSummary, checkSave, columnHasData, editableFormats, formatName, isDirty,
  isRoundOff, readNumberText, removeColumn, removeRow, renameColumn, setAdjustment, setExtraCell, setFormat, setItemField, setPartyField, setRoundOff,
  setTotalOverride, toggleMark, unitsText, type EditorState, type ItemField, type NameFormat
} from './editorModel'
import { autosave, discardDraft, findRecoverable, openEditor, recoverDraft, saveEditorBill } from './editorIo'

/** What the app shell can ask of the open editor (the unsaved-changes prompt). */
export interface EditorApi {
  /** Saves like the Save button. Resolves true when the bill was saved (or nothing needed saving). */
  save(): Promise<boolean>
  /** Throws the typed work away (and its draft). */
  discard(): Promise<void>
}

export interface BillEditorProps {
  db: PhoneDb | null
  /** A stored bill's id to edit; absent = a NEW, clean bill. */
  id?: string
  now?: () => Date
  apiRef?: MutableRefObject<EditorApi | null>
  onDirtyChange?: (dirty: boolean) => void
  /** After a successful save: the saved bill's id. */
  onSaved: (id: string) => void
  onChanged?: () => void
  autosaveMs?: number
}

/** A number box: shows what was typed, stores only a clean decimal string (or null). The number keypad opens (`inputMode`). */
function NumInput(props: { value: string; label: string; allowNegative?: boolean; field: string; enter: 'next' | 'done'; onValue: (v: string) => void; onEnter: () => void }): ReactElement {
  const [text, setText] = useState(props.value)
  useEffect(() => { setText((t) => (readNumberText(t, props.allowNegative === true).value === (props.value === '' ? null : props.value) ? t : props.value)) }, [props.value, props.allowNegative])
  return (
    <input
      className="q3-input q3-num" inputMode="decimal" enterKeyHint={props.enter} aria-label={props.label} placeholder={props.label} data-f={props.field}
      value={text}
      onChange={(e) => { const r = readNumberText(e.target.value, props.allowNegative === true); setText(r.text); props.onValue(r.value ?? '') }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); props.onEnter() } }}
    />
  )
}

export function BillEditor(props: BillEditorProps): ReactElement {
  const { db, id, onDirtyChange } = props
  const [state, setState] = useState<EditorState | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [recover, setRecover] = useState<Draft | null>(null)
  const [dir, setDir] = useState<PartyDirectory | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [showAddress, setShowAddress] = useState(false)
  const [sheet, setSheet] = useState<'columns' | 'units' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const stateRef = useRef<EditorState | null>(null)
  stateRef.current = state
  const nowFn = props.now

  // Open: a NEW bill is always clean (A31); a saved draft is only offered.
  useEffect(() => {
    if (!db) return undefined
    let cancelled = false
    void (async () => {
      const r = await openEditor(db, id, nowFn ? nowFn() : new Date())
      if (cancelled) return
      if (r.kind === 'ready') {
        setState(r.state)
        const d = await findRecoverable(db, id)
        if (!cancelled && d) setRecover(d)
      } else setBlocked(r.kind === 'read-only' ? r.reason : r.message)
      const directory = await loadPartyDirectory(db)
      if (!cancelled) setDir(directory)
    })().catch((e: unknown) => { if (!cancelled) setBlocked(`Could not open the bill: ${e instanceof Error ? e.message : String(e)}`) })
    return () => { cancelled = true }
  }, [db, id, nowFn])

  const dirty = state ? isDirty(state) : false
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  // Autosave the open bill (debounced, off the typing path). A bill with nothing typed has no draft.
  const ms = props.autosaveMs ?? 800
  useEffect(() => {
    if (!db || !state || !dirty || recover) return undefined
    const t = setTimeout(() => { void autosave(db, state, nowFn).catch(() => undefined) }, ms)
    return () => clearTimeout(t)
  }, [db, state, dirty, recover, ms, nowFn])

  const update = useCallback((f: (s: EditorState) => EditorState) => { setMessage(null); setState((s) => (s ? f(s) : s)) }, [])

  // Focus the field the keypad's Next / Done moved to.
  useEffect(() => {
    if (!focusKey) return
    const el = root.current?.querySelector<HTMLInputElement>(`[data-f="${focusKey}"]`)
    if (el) { el.focus(); setFocusKey(null) }
  }, [focusKey, openId, state])

  const doSave = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current
    if (!db || !s) return false
    const issue = checkSave(s)
    if (issue) { setMessage(issue.message); setFocusKey(issue.code === 'PARTY_NAME_REQUIRED' ? 'party:name' : null); return false }
    setSaving(true)
    const r = await saveEditorBill(db, s, props.onChanged)
    setSaving(false)
    if (!r.ok) { setMessage(r.message); return false }
    onDirtyChange?.(false)
    props.onSaved(r.id)
    return true
  }, [db, onDirtyChange, props])

  useEffect(() => {
    if (!props.apiRef) return undefined
    const ref = props.apiRef
    ref.current = {
      save: async () => (stateRef.current && isDirty(stateRef.current) ? doSave() : true),
      discard: async () => { if (db && stateRef.current) await discardDraft(db, stateRef.current.bill.id) }
    }
    return () => { ref.current = null }
  }, [props.apiRef, doSave, db])

  const view = useMemo(() => (state ? buildEditorView(state) : null), [state])
  const formats = useMemo(() => editableFormats(), [])
  const suggestions = useMemo(() => (state && dir && suggestOpen ? dir.search(state.bill.party.name) : []), [state, dir, suggestOpen])

  if (blocked) return <p className="q3-note q3-note-warn" role="alert">{blocked}</p>
  if (!db) return <p className="q3-muted">The phone database is not available.</p>
  if (!state || !view) return <p className="q3-muted">Opening the bill...</p>

  const isNewName = dir ? dir.isNew(state.bill.party.name) : false
  const next = (fromId: string, field: 'name' | 'qty' | 'rate' | 'gstRate'): void => {
    const order: ('name' | 'qty' | 'rate')[] = ['name', 'qty', 'rate']
    const i = order.indexOf(field as 'name' | 'qty' | 'rate')
    if (i >= 0 && i < order.length - 1) { setFocusKey(`${fromId}:${order[i + 1]}`); return }
    const idx = view.items.findIndex((r) => r.id === fromId)
    const following = view.items[idx + 1]
    if (following) { setOpenId(following.id); setFocusKey(`${following.id}:name`); return }
    const added = addItemRow(state)
    setState(added.state); setOpenId(added.id); setFocusKey(`${added.id}:name`)
  }
  const setItem = (rid: string, f: ItemField, v: string): void => update((s) => setItemField(s, rid, f, v))
  /** B / R+B act on the selection of the name box (the buttons keep the box focused so the keyboard stays open). */
  const styleName = (rid: string, kind: NameFormat): void => {
    const el = root.current?.querySelector<HTMLInputElement>(`[data-f="${rid}:name"]`)
    update((s) => formatName(s, rid, kind, el?.selectionStart ?? 0, el?.selectionEnd ?? 0))
  }
  const units = sheet === 'units' ? buildUnitsSummary(state) : null

  return (
    <div className="q3-editor" ref={root}>
      {recover ? (
        <div className="q3-banner" role="status">
          <span>You have an unsaved bill from last time.</span>
          <span className="q3-actions">
            <button type="button" className="q3-btn q3-btn-primary" onClick={() => { void recoverDraft(db, recover).then((s) => { setState(s); setRecover(null); setOpenId(null) }) }}>Recover</button>
            <button type="button" className="q3-btn" onClick={() => { void discardDraft(db, recover.id).then(() => setRecover(null)) }}>Discard</button>
          </span>
        </div>
      ) : null}

      <section className="q3-party" aria-label="Party">
        <div className="q3-party-name">
          <input
            className="q3-input" aria-label="Party name" placeholder="Party name" autoComplete="off" data-f="party:name" enterKeyHint="next"
            value={state.bill.party.name}
            onChange={(e) => { update((s) => setPartyField(s, 'name', e.target.value)); setSuggestOpen(true) }}
            onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
            onFocus={() => setSuggestOpen(true)}
          />
          {suggestions.length > 0 ? (
            <ul className="q3-suggest" role="listbox" aria-label="Customers">
              {suggestions.map((p) => (
                <li key={p.id} role="option" aria-selected="false">
                  <button type="button" className="q3-li-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => { update((s) => applyParty(s, p)); setSuggestOpen(false) }}>
                    <span className="q3-li-title">{p.name}</span><span className="q3-muted">{p.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="q3-party-line">
          <input className="q3-input" inputMode="tel" aria-label="Phone" placeholder="Phone" value={state.bill.party.phone} onChange={(e) => update((s) => setPartyField(s, 'phone', e.target.value))} />
          <input className="q3-input" aria-label="Transport" placeholder="Transport" value={state.bill.party.transport} onChange={(e) => update((s) => setPartyField(s, 'transport', e.target.value))} />
          <button type="button" className="q3-btn q3-icon-btn" aria-expanded={showAddress} aria-label="Address" onClick={() => setShowAddress((v) => !v)}>
            {showAddress ? <CaretUp size={18} aria-hidden="true" /> : <CaretDown size={18} aria-hidden="true" />}
          </button>
        </div>
        {showAddress ? <textarea className="q3-input q3-address" aria-label="Address" placeholder="Address" rows={2} value={state.bill.party.address} onChange={(e) => update((s) => setPartyField(s, 'address', e.target.value))} /> : null}
        {isNewName ? <p className="q3-note">New customer: it is added when you save.</p> : null}
        <div className="q3-chips" role="group" aria-label="Bill format">
          {formats.map((f) => <button key={f.id} type="button" className="q3-chip" aria-pressed={state.bill.formatId === f.id} onClick={() => update((s) => setFormat(s, f.id))}>{f.label}</button>)}
        </div>
      </section>

      <ol className="q3-rows" aria-label="Items">
        {view.items.map((r) => {
          const open = openId === r.id
          return (
            <li key={r.id} className={`q3-erow${open ? ' is-open' : ''}${r.warn ? ' has-warn' : ''}`}>
              {open ? (
                <div className="q3-erow-edit">
                  <div className="q3-erow-top">
                    <span className="q3-sl">{r.slNo}</span>
                    <input className="q3-input" aria-label="Item name" placeholder="Item name" data-f={`${r.id}:name`} enterKeyHint="next" value={r.name}
                      onChange={(e) => setItem(r.id, 'name', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); next(r.id, 'name') } }} />
                  </div>
                  <div className="q3-actions q3-fmt" role="group" aria-label="Name style">
                    <button type="button" className="q3-btn q3-fmt-b" aria-label="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => styleName(r.id, 'bold')}>B</button>
                    <button type="button" className="q3-btn q3-fmt-rb" aria-label="Red bold" onMouseDown={(e) => e.preventDefault()} onClick={() => styleName(r.id, 'redBold')}>R+B</button>
                  </div>
                  <div className="q3-erow-nums">
                    <NumInput label="Qty" field={`${r.id}:qty`} value={r.qty} enter="next" onValue={(v) => setItem(r.id, 'qty', v)} onEnter={() => next(r.id, 'qty')} />
                    <NumInput label="Rate" field={`${r.id}:rate`} value={r.rate} enter={view.hasGst ? 'next' : 'done'} onValue={(v) => setItem(r.id, 'rate', v)} onEnter={() => next(r.id, 'rate')} />
                    {view.hasGst ? <NumInput label="GST %" field={`${r.id}:gstRate`} value={r.gstRate} enter="done" onValue={(v) => setItem(r.id, 'gstRate', v)} onEnter={() => next(r.id, 'gstRate')} /> : null}
                    <span className="q3-erow-amt" aria-label="Line total">{r.amount}</span>
                  </div>
                  <div className="q3-erow-nums">
                    <NumInput label="Total (typed)" field={`${r.id}:total`} value={r.override} enter="done" onValue={(v) => update((s) => setTotalOverride(s, r.id, v))} onEnter={() => undefined} />
                  </div>
                  {state.bill.extraCols.map((c) => {
                    const cell = r.extras[c.key]
                    return (
                      <div key={c.key} className="q3-erow-nums">
                        <input className="q3-input" aria-label={`${c.header} cell`} placeholder={c.header} data-f={`${r.id}:x:${c.key}`} value={cell?.text ?? ''} onChange={(e) => update((s) => setExtraCell(s, r.id, c.key, e.target.value))} />
                        <button type="button" className="q3-btn" aria-pressed={cell?.marked === true} aria-label={`Mark ${c.header}`} onClick={() => update((s) => toggleMark(s, r.id, c.key))}>Mark</button>
                      </div>
                    )
                  })}
                  <div className="q3-actions">
                    <button type="button" className="q3-btn" onClick={() => setOpenId(null)}>Done</button>
                    <button type="button" className="q3-btn q3-icon-btn" aria-label="Remove row" onClick={() => { update((s) => removeRow(s, r.id)); setOpenId(null) }}><Trash size={18} aria-hidden="true" /></button>
                  </div>
                </div>
              ) : (
                <button type="button" className="q3-erow-line" aria-label={`Edit row ${r.slNo || ''} ${r.name}`.trim()} onClick={() => { setOpenId(r.id); setFocusKey(`${r.id}:name`) }}>
                  <span className="q3-sl">{r.slNo}</span>
                  <span className="q3-ename">{r.name ? <RichName runs={runsOf(state, r.id)} /> : <span className="q3-muted">Item</span>}</span>
                  <span className="q3-eqty">{r.qty}</span>
                  <span className="q3-erate">{r.rate}</span>
                  <span className="q3-eamt">{r.amount}</span>
                </button>
              )}
            </li>
          )
        })}
      </ol>
      <button type="button" className="q3-btn q3-add" onClick={() => { const a = addItemRow(state); setState(a.state); setOpenId(a.id); setFocusKey(`${a.id}:name`) }}>
        <Plus size={16} aria-hidden="true" /> Add row
      </button>

      <div className="q3-chips" role="group" aria-label="Bill options">
        <button type="button" className="q3-chip" aria-pressed={isRoundOff(state)} onClick={() => update((s) => setRoundOff(s, !isRoundOff(s)))}>Round off</button>
        <button type="button" className="q3-chip" onClick={() => setSheet('columns')}>Columns{state.bill.extraCols.length > 0 ? ` (${state.bill.extraCols.length})` : ''}</button>
        {state.bill.extraCols.length > 0 ? <button type="button" className="q3-chip" onClick={() => setSheet('units')}>Units</button> : null}
      </div>

      <section aria-label="Adjustments" className="q3-adjs">
        {view.adjustments.length > 0 ? <h2 className="q3-h2">Adjustments</h2> : null}
        {view.adjustments.map((a) => (
          <div key={a.id} className="q3-adj">
            <input className="q3-input" aria-label="Adjustment name" placeholder="Adjustment" value={a.name} onChange={(e) => update((s) => setAdjustment(s, a.id, { name: e.target.value }))} />
            <NumInput label="Amount" allowNegative field={`${a.id}:amount`} value={a.amount} enter="done" onValue={(v) => update((s) => setAdjustment(s, a.id, { amount: v }))} onEnter={() => undefined} />
            <button type="button" className="q3-btn q3-icon-btn" aria-label="Remove adjustment" onClick={() => update((s) => removeRow(s, a.id))}><Trash size={18} aria-hidden="true" /></button>
          </div>
        ))}
        <button type="button" className="q3-btn q3-add" onClick={() => { const a = addAdjustment(state); setState(a.state) }}><Plus size={16} aria-hidden="true" /> Add adjustment</button>
      </section>

      {sheet === 'columns' ? (
        <div className="q3-modal" role="dialog" aria-modal="true" aria-label="Columns">
          <div className="q3-modal-card">
            <h2 className="q3-h2">Extra columns</h2>
            {state.bill.extraCols.length === 0 ? <p className="q3-muted">No extra columns. Add one to record codes with unit counts, like 125-5.</p> : null}
            {state.bill.extraCols.map((c) => (
              <div key={c.key} className="q3-adj">
                <input className="q3-input" aria-label={`Header of ${c.key}`} defaultValue={c.header} onBlur={(e) => update((s) => renameColumn(s, c.key, e.target.value))} />
                <button type="button" className="q3-btn" aria-label={`Remove ${c.header}`} onClick={() => {
                  if (columnHasData(state, c.key) && confirmRemove !== c.key) { setConfirmRemove(c.key); return }
                  setConfirmRemove(null); update((s) => removeColumn(s, c.key))
                }}>{confirmRemove === c.key ? 'Tap again to remove' : 'Remove'}</button>
              </div>
            ))}
            <button type="button" className="q3-btn" onClick={() => update((s) => addColumn(s)?.state ?? s)}>Add column</button>
            <button type="button" className="q3-btn q3-btn-primary" onClick={() => { setSheet(null); setConfirmRemove(null) }}>Close</button>
          </div>
        </div>
      ) : null}
      {units ? (
        <div className="q3-modal" role="dialog" aria-modal="true" aria-label="Units summary">
          <div className="q3-modal-card">
            <h2 className="q3-h2">Units</h2>
            {units.byColumn.map((c) => (
              <div key={c.colKey} className="q3-units-col">
                <div className="q3-kv"><span>{c.base.label}</span><span>{c.base.units}</span></div>
                {c.marked.map((m) => <div key={m.rowId} className="q3-kv q3-units-mark"><span>{m.label}</span><span>{m.units}</span></div>)}
              </div>
            ))}
            <p className="q3-note">{unitsText(units, 'units')}</p>
            <button type="button" className="q3-btn q3-btn-primary" onClick={() => setSheet(null)}>Close</button>
          </div>
        </div>
      ) : null}

      <footer className="q3-totals" aria-label="Totals">
        {message ? <p className="q3-note q3-note-warn" role="alert">{message}</p> : null}
        <div className="q3-totals-lines">
          {view.footer.filter((f) => !f.strong).map((f) => <span key={f.key} className="q3-tline"><span>{f.label}</span><span>{f.value}</span></span>)}
        </div>
        <div className="q3-totals-main">
          <span className="q3-grand" aria-label="Final total"><span>Total</span> <strong>{view.grandTotal}</strong></span>
          <button type="button" className="q3-btn q3-btn-primary" disabled={saving} onClick={() => { void doSave() }}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </footer>
    </div>
  )
}
