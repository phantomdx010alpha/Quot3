import { CaretDown, CaretUp, DotsThree, Plus, Trash } from '@phosphor-icons/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { loadPartyDirectory, type PartyDirectory } from '../../../data/partySearch'
import type { Draft } from '../../../data/draftsRepo'
import { RichName } from '../../RichName'
import { runsOf } from '../../editor/editorRuns'
import {
  addAdjustment, addColumn, addItemRow, applyParty, buildEditorView, buildUnitsSummary, checkSave, columnHasData, editableFormats, formatName, isDirty,
  isRoundOff, readNumberText, removeColumn, removeRow, renameColumn, setAdjustment, setExtraCell, setFormat, setItemField, setPartyField, setRoundOff,
  setTotalOverride, toggleMark, unitsText, type EditorState, type ItemField, type NameFormat
} from '../../editor/editorModel'
import { autosave, discardDraft, findRecoverable, openEditor, recoverDraft, saveEditorBill } from '../../editor/editorIo'
import { BottomSheet } from '../../kit/BottomSheet'
import { Button } from '../../kit/Button'
import { changeBillDate } from '../../kit/dateField'
import { DateField } from '../../kit/DateField'
import { ItemLine } from '../../kit/ItemLine'
import { plainText } from '../../kit/plainWords'
import { removeRowWithUndo, restoreRemoval } from '../../kit/rowUndo'
import { SegmentedControl } from '../../kit/SegmentedControl'
import { SnackbarHost, useSnackbar } from '../../kit/Snackbar'
import { TotalsBlock } from '../../kit/TotalsBlock'
import { tidyTotals } from './tidyTotals'
import type { EditorProps } from '../types'

type Sheet = { kind: 'row'; id: string; start: number; end: number } | { kind: 'options' } | { kind: 'columns' } | { kind: 'units' } | null

/** A number box: shows what was typed, stores only a clean decimal string (or null). The number keypad opens. Same rules as the classic editor. */
function TidyNum(props: { value: string; label: string; allowNegative?: boolean; field: string; enter: 'next' | 'done'; onValue: (v: string) => void; onEnter: () => void }): ReactElement {
  const [text, setText] = useState(props.value)
  useEffect(() => { setText((t) => (readNumberText(t, props.allowNegative === true).value === (props.value === '' ? null : props.value) ? t : props.value)) }, [props.value, props.allowNegative])
  return (
    <input
      className="q3x-input q3x-num" inputMode="decimal" enterKeyHint={props.enter} aria-label={props.label} placeholder={props.label} data-f={props.field}
      value={text}
      onChange={(e) => { const r = readNumberText(e.target.value, props.allowNegative === true); setText(r.text); props.onValue(r.value ?? '') }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); props.onEnter() } }}
    />
  )
}

/** A text box that grows while typing, so a long name is always fully visible (never cut). Enter does not add a line: it moves on (`onEnter`). */
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

/** Tidy editor (Phase 192): the classic editor's behaviour (same `editorModel` / `editorIo`, same `EditorApi`, guard, drafts, clean new bill, name required)
 *  in the Tidy layout: party, a visible GST / Non-GST segmented control, bill date, tap a row to edit it (two-line rows, the name box grows), a bottom sheet
 *  for the rare fields, a sticky totals bar with a big Save, and an Undo snackbar when a row is removed. */
export function TidyEditor(props: EditorProps): ReactElement {
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
  const [showDetails, setShowDetails] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const snack = useSnackbar()
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
  useEffect(() => {
    if (!db || !state || !dirty || recover) return undefined
    const t = setTimeout(() => { void autosave(db, state, nowFn).catch(() => undefined) }, 800)
    return () => clearTimeout(t)
  }, [db, state, dirty, recover, nowFn])

  const update = useCallback((f: (s: EditorState) => EditorState) => { setMessage(null); setState((s) => (s ? f(s) : s)) }, [])

  useEffect(() => {
    if (!focusKey) return
    const el = root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-f="${focusKey}"]`)
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
  const totals = useMemo(() => (state ? tidyTotals(state.bill) : null), [state])
  const formats = useMemo(() => editableFormats(), [])
  const suggestions = useMemo(() => (state && dir && suggestOpen ? dir.search(state.bill.party.name) : []), [state, dir, suggestOpen])

  if (blocked) return <p className="q3-note q3-note-warn" role="alert">{blocked}</p>
  if (!db) return <p className="q3-muted">The phone database is not available.</p>
  if (!state || !view || !totals) return <p className="q3-muted">Opening the bill...</p>

  const isNewName = dir ? dir.isNew(state.bill.party.name) : false
  const next = (fromId: string, f: 'name' | 'qty' | 'rate'): void => {
    const order: ('name' | 'qty' | 'rate')[] = ['name', 'qty', 'rate']
    const i = order.indexOf(f)
    if (i >= 0 && i < order.length - 1) { setFocusKey(`${fromId}:${order[i + 1]}`); return }
    const idx = view.items.findIndex((r) => r.id === fromId)
    const following = view.items[idx + 1]
    if (following) { setOpenId(following.id); setFocusKey(`${following.id}:name`); return }
    const added = addItemRow(state)
    setState(added.state); setOpenId(added.id); setFocusKey(`${added.id}:name`)
  }
  const setItem = (rid: string, f: ItemField, v: string): void => update((s) => setItemField(s, rid, f, v))
  const removeItemRow = (rid: string): void => {
    const s0 = stateRef.current
    if (!s0) return
    const r = removeRowWithUndo(s0, rid)
    setMessage(null); setState(r.state); setOpenId(null); setSheet(null)
    const removal = r.removal
    if (removal) snack.show('Row removed', () => update((s) => restoreRemoval(s, removal)))
  }
  const openRowSheet = (rid: string): void => {
    const el = root.current?.querySelector<HTMLTextAreaElement>(`[data-f="${rid}:name"]`)
    setSheet({ kind: 'row', id: rid, start: el?.selectionStart ?? 0, end: el?.selectionEnd ?? 0 })
  }
  const styleName = (rid: string, kind: NameFormat, start: number, end: number): void => update((s) => formatName(s, rid, kind, start, end))
  const units = sheet?.kind === 'units' ? buildUnitsSummary(state) : null
  const rowSheet = sheet?.kind === 'row' ? view.items.find((r) => r.id === sheet.id) : undefined
  const roundOn = isRoundOff(state)

  return (
    <div className="q3x-tidy-page q3x-tidy-editor" ref={root}>
      {recover ? (
        <section className="q3x-tidy-card" role="status" aria-label="Unsaved bill from last time">
          <p className="q3x-tidy-text">You have an unsaved bill from last time.</p>
          <div className="q3x-tidy-actions">
            <Button label="Recover" variant="primary" onClick={() => { void recoverDraft(db, recover).then((s) => { setState(s); setRecover(null); setOpenId(null) }) }} />
            <Button label="Discard" onClick={() => { void discardDraft(db, recover.id).then(() => setRecover(null)) }} />
          </div>
        </section>
      ) : null}

      <section className="q3x-tidy-party-block" aria-label="Party">
        <div className="q3x-tidy-partyname">
          <GrowText
            value={state.bill.party.name} label="Party name" field="party:name" enter="next"
            onValue={(v) => { update((s) => setPartyField(s, 'name', v)); setSuggestOpen(true) }}
            onEnter={() => setFocusKey(view.items[0] ? `${view.items[0].id}:name` : null)}
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
        <Button
          label="Phone, transport and address" variant="text" onClick={() => setShowDetails((v) => !v)}
          icon={showDetails ? <CaretUp size={18} aria-hidden="true" /> : <CaretDown size={18} aria-hidden="true" />}
        />
        {showDetails ? (
          <div className="q3x-tidy-details">
            <input className="q3x-input" inputMode="tel" aria-label="Phone" placeholder="Phone" value={state.bill.party.phone} onChange={(e) => update((s) => setPartyField(s, 'phone', e.target.value))} />
            <input className="q3x-input" aria-label="Transport" placeholder="Transport" value={state.bill.party.transport} onChange={(e) => update((s) => setPartyField(s, 'transport', e.target.value))} />
            <textarea className="q3x-input q3x-grow" rows={2} aria-label="Address" placeholder="Address" value={state.bill.party.address} onChange={(e) => update((s) => setPartyField(s, 'address', e.target.value))} />
          </div>
        ) : null}
      </section>

      <ol className="q3x-tidy-list" aria-label="Items">
        {view.items.map((r) => {
          const open = openId === r.id
          return (
            <li key={r.id} className={`q3x-tidy-li${r.warn ? ' q3x-tidy-warn' : ''}`}>
              {open ? (
                <div className="q3x-tidy-edit">
                  <GrowText value={r.name} label="Item name" field={`${r.id}:name`} enter="next" onValue={(v) => setItem(r.id, 'name', v)} onEnter={() => next(r.id, 'name')} />
                  <div className="q3x-tidy-nums">
                    <TidyNum label="Qty" field={`${r.id}:qty`} value={r.qty} enter="next" onValue={(v) => setItem(r.id, 'qty', v)} onEnter={() => next(r.id, 'qty')} />
                    <TidyNum label="Rate" field={`${r.id}:rate`} value={r.rate} enter="done" onValue={(v) => setItem(r.id, 'rate', v)} onEnter={() => next(r.id, 'rate')} />
                  </div>
                  <ItemLine name={<span className="q3x-tidy-sub">Line total</span>} amount={r.amount} />
                  <div className="q3x-tidy-actions">
                    <Button label="Done" variant="primary" onClick={() => setOpenId(null)} />
                    <Button label="More for this row" icon={<DotsThree size={22} weight="bold" aria-hidden="true" />} onClick={() => openRowSheet(r.id)} />
                    <Button label="Remove row" hideLabel icon={<Trash size={22} aria-hidden="true" />} onClick={() => removeItemRow(r.id)} />
                  </div>
                </div>
              ) : (
                <button type="button" className="q3x-tidy-rowbtn" aria-label={`Edit row ${r.slNo || ''} ${r.name}`.trim()} onClick={() => { setOpenId(r.id); setFocusKey(`${r.id}:name`) }}>
                  <ItemLine
                    name={r.name ? <RichName runs={runsOf(state, r.id)} /> : <span className="q3x-tidy-sub">Item</span>} amount={r.amount}
                    qty={r.qty} rate={r.rate} gstPct={view.hasGst ? r.gstRate : ''} priceSetByUser={r.override !== ''}
                  />
                </button>
              )}
            </li>
          )
        })}
      </ol>
      <Button label="Add item" variant="secondary" icon={<Plus size={20} aria-hidden="true" />} onClick={() => { const a = addItemRow(state); setState(a.state); setOpenId(a.id); setFocusKey(`${a.id}:name`) }} />
      <Button label={`Bill options${state.bill.extraCols.length > 0 ? ` (${state.bill.extraCols.length} extra)` : ''}`} variant="text" onClick={() => setSheet({ kind: 'options' })} />

      <section aria-label="Adjustments" className="q3x-tidy-adjs">
        {view.adjustments.length > 0 ? <h2 className="q3x-tidy-h2">Adjustments</h2> : null}
        {view.adjustments.map((a) => (
          <div key={a.id} className="q3x-tidy-adj">
            <GrowText value={a.name} label="Adjustment name" field={`${a.id}:name`} enter="next" onValue={(v) => update((s) => setAdjustment(s, a.id, { name: v }))} />
            <TidyNum label="Amount" allowNegative field={`${a.id}:amount`} value={a.amount} enter="done" onValue={(v) => update((s) => setAdjustment(s, a.id, { amount: v }))} onEnter={() => undefined} />
            <Button label="Remove adjustment" hideLabel icon={<Trash size={22} aria-hidden="true" />} onClick={() => update((s) => removeRow(s, a.id))} />
          </div>
        ))}
        <Button label="Add adjustment" variant="text" icon={<Plus size={20} aria-hidden="true" />} onClick={() => { const a = addAdjustment(state); setState(a.state) }} />
      </section>

      {totals.show ? <TotalsBlock rows={totals.rows} total={totals.total} /> : null}

      <footer className="q3x-tidy-stickybar q3x-tidy-savebar" aria-label="Save">
        {message ? <p className="q3x-tidy-note" role="alert">{message}</p> : null}
        <div className="q3x-tidy-saverow">
          <span className="q3x-tidy-savetotal" aria-label="Final total"><span className="q3x-tidy-sub">Total</span> <strong className="q3x-amount-grand">{view.grandTotal}</strong></span>
          <Button label={saving ? 'Saving...' : 'Save'} variant="primary" disabled={saving} onClick={() => { void doSave() }} />
        </div>
      </footer>
      <div className="q3x-tidy-snackwrap"><SnackbarHost snack={snack} /></div>

      <BottomSheet open={sheet?.kind === 'row' && rowSheet !== undefined} title="More for this row" onClose={() => setSheet(null)}>
        {rowSheet && sheet?.kind === 'row' ? (
          <>
            <div className="q3x-tidy-actions" role="group" aria-label="Name style">
              <Button label="Bold" onClick={() => styleName(rowSheet.id, 'bold', sheet.start, sheet.end)} icon={<strong aria-hidden="true">B</strong>} />
              <Button label="Red and bold" onClick={() => styleName(rowSheet.id, 'redBold', sheet.start, sheet.end)} icon={<strong aria-hidden="true">R+B</strong>} />
            </div>
            <p className="q3x-tidy-sub">Bold and red apply to the part of the name you had selected.</p>
            {view.hasGst ? <TidyNum label="GST %" field={`${rowSheet.id}:gstRate`} value={rowSheet.gstRate} enter="done" onValue={(v) => setItem(rowSheet.id, 'gstRate', v)} onEnter={() => undefined} /> : null}
            <TidyNum label={plainText('Total (typed)')} field={`${rowSheet.id}:total`} value={rowSheet.override} enter="done" onValue={(v) => update((s) => setTotalOverride(s, rowSheet.id, v))} onEnter={() => undefined} />
            {state.bill.extraCols.map((c) => {
              const cell = rowSheet.extras[c.key]
              return (
                <div key={c.key} className="q3x-tidy-adj">
                  <input className="q3x-input" aria-label={`${c.header} cell`} placeholder={c.header} data-f={`${rowSheet.id}:x:${c.key}`} value={cell?.text ?? ''} onChange={(e) => update((s) => setExtraCell(s, rowSheet.id, c.key, e.target.value))} />
                  <button type="button" className="q3x-seg-btn q3x-tidy-mark" aria-pressed={cell?.marked === true} aria-label={`Mark ${c.header}`} onClick={() => update((s) => toggleMark(s, rowSheet.id, c.key))}>Mark</button>
                </div>
              )
            })}
            <Button label="Remove this row" icon={<Trash size={20} aria-hidden="true" />} onClick={() => removeItemRow(rowSheet.id)} />
          </>
        ) : null}
      </BottomSheet>

      <BottomSheet open={sheet?.kind === 'options'} title="Bill options" onClose={() => setSheet(null)}>
        <SegmentedControl ariaLabel="Round off" value={roundOn ? 'on' : 'off'} onChange={(v) => update((s) => setRoundOff(s, v === 'on'))} options={[{ id: 'off', label: 'Round off: no' }, { id: 'on', label: 'Round off: yes' }]} />
        <Button label={`Extra columns${state.bill.extraCols.length > 0 ? ` (${state.bill.extraCols.length})` : ''}`} onClick={() => setSheet({ kind: 'columns' })} />
        {state.bill.extraCols.length > 0 ? <Button label="Units" onClick={() => setSheet({ kind: 'units' })} /> : null}
      </BottomSheet>

      <BottomSheet open={sheet?.kind === 'columns'} title="Extra columns" onClose={() => { setSheet(null); setConfirmRemove(null) }}>
        {state.bill.extraCols.length === 0 ? <p className="q3x-tidy-text">No extra columns. Add one to record codes with unit counts, like 125-5.</p> : null}
        {state.bill.extraCols.map((c) => (
          <div key={c.key} className="q3x-tidy-adj">
            <input className="q3x-input" aria-label={`Header of ${c.key}`} defaultValue={c.header} onBlur={(e) => update((s) => renameColumn(s, c.key, e.target.value))} />
            <Button label={confirmRemove === c.key ? 'Tap again to remove' : `Remove ${c.header}`} onClick={() => {
              if (columnHasData(state, c.key) && confirmRemove !== c.key) { setConfirmRemove(c.key); return }
              setConfirmRemove(null); update((s) => removeColumn(s, c.key))
            }} />
          </div>
        ))}
        <Button label="Add column" onClick={() => update((s) => addColumn(s)?.state ?? s)} />
      </BottomSheet>

      <BottomSheet open={units !== null} title="Units" onClose={() => setSheet(null)}>
        {units ? (
          <>
            {units.byColumn.map((c) => (
              <div key={c.colKey}>
                <p className="q3x-tidy-text">{c.base.label}: {c.base.units}</p>
                {c.marked.map((m) => <p key={m.rowId} className="q3x-tidy-sub">{m.label}: {m.units}</p>)}
              </div>
            ))}
            <p className="q3x-tidy-sub">{unitsText(units, 'units')}</p>
          </>
        ) : null}
      </BottomSheet>
    </div>
  )
}
