import { ArrowDown, ArrowUp, Check, Plus, Trash } from '@phosphor-icons/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { loadPartyDirectory, type PartyDirectory } from '../../../data/partySearch'
import type { Draft } from '../../../data/draftsRepo'
import { RichName } from '../../RichName'
import { runsOf } from '../../editor/editorRuns'
import {
  addAdjustment, addItemRow, applyParty, buildEditorView, checkSave, editableFormats, formatName, isDirty, readNumberText, removeRow, setAdjustment,
  setFormat, setItemField, setPartyField, type EditorState, type ItemField, type NameFormat
} from '../../editor/editorModel'
import { autosave, discardDraft, findRecoverable, openEditor, recoverDraft, saveEditorBill } from '../../editor/editorIo'
import { Button } from '../../kit/Button'
import { changeBillDate } from '../../kit/dateField'
import { DateField } from '../../kit/DateField'
import { moneyText, plainNumber } from '../../kit/display'
import { removeRowWithUndo, restoreRemoval } from '../../kit/rowUndo'
import { SegmentedControl } from '../../kit/SegmentedControl'
import { SnackbarHost, useSnackbar } from '../../kit/Snackbar'
import { TotalsBlock } from '../../kit/TotalsBlock'
import { tidyTotals } from '../tidy/tidyTotals'
import { cellOrder, nextCell, prevCell, type PaperField } from './inboxToolbar'
import type { EditorProps } from '../types'

function GrowText(props: { value: string; label: string; field: string; enter: 'next' | 'done'; onValue: (v: string) => void; onEnter?: () => void; onFocus?: () => void; onBlur?: () => void; className?: string }): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !el.scrollHeight) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [props.value])
  return (
    <textarea
      ref={ref} className={props.className ?? 'q3x-input q3x-grow'} rows={1} aria-label={props.label} placeholder={props.label} data-f={props.field} enterKeyHint={props.enter} autoComplete="off"
      value={props.value} onFocus={props.onFocus} onBlur={props.onBlur}
      onChange={(e) => props.onValue(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); props.onEnter?.() } }}
    />
  )
}

/** Bills inbox editor (Phase 194): the paper bill as the editor. The SAME `editorModel` / `editorIo` / `EditorApi`, guard, drafts, clean new bill (A31), name
 *  required. Tap a cell to edit it (the name cell wraps and grows); a docked toolbar above the keyboard has [previous][next][B][R+B][done] and uses the existing
 *  Next / Done order. Save goes to the bill view with the Saved sheet (App.tsx). Not in this layout (use Classic or Tidy): typed totals, extra columns and Mark,
 *  round-off setting. */
export function InboxEditor(props: EditorProps): ReactElement {
  const { db, id, onDirtyChange } = props
  const [state, setState] = useState<EditorState | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [recover, setRecover] = useState<Draft | null>(null)
  const [dir, setDir] = useState<PartyDirectory | null>(null)
  const [cur, setCur] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const snack = useSnackbar()
  const root = useRef<HTMLDivElement>(null)
  const stateRef = useRef<EditorState | null>(null)
  stateRef.current = state
  const nowFn = props.now

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
  }, [focusKey, cur, state])

  const doSave = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current
    if (!db || !s) return false
    const issue = checkSave(s)
    if (issue) { setMessage(issue.message); setCur(null); setFocusKey(issue.code === 'PARTY_NAME_REQUIRED' ? 'party:name' : null); return false }
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

  const order = cellOrder(view.items.map((r) => r.id), view.hasGst)
  const isNewName = dir ? dir.isNew(state.bill.party.name) : false
  const go = (key: string | null): void => { setCur(key); setFocusKey(key) }
  const goNext = (): void => {
    const n = nextCell(order, cur)
    if (n) { go(n); return }
    const a = addItemRow(state)
    setState(a.state); go(`${a.id}:name`)
  }
  const goPrev = (): void => { const p = prevCell(order, cur); if (p) go(p) }
  const styleName = (kind: NameFormat): void => {
    if (!cur || !cur.endsWith(':name')) return
    const rid = cur.slice(0, -':name'.length)
    const el = root.current?.querySelector<HTMLTextAreaElement>(`[data-f="${cur}"]`)
    update((s) => formatName(s, rid, kind, el?.selectionStart ?? 0, el?.selectionEnd ?? 0))
    setFocusKey(cur)
  }
  const removeItemRow = (rid: string): void => {
    const r = removeRowWithUndo(state, rid)
    setMessage(null); setState(r.state); setCur(null)
    const removal = r.removal
    if (removal) snack.show('Row removed', () => update((s) => restoreRemoval(s, removal)))
  }
  const noMouse = (e: { preventDefault: () => void }): void => e.preventDefault() // keep the cell focused and its selection while a toolbar button is tapped
  const inName = cur !== null && cur.endsWith(':name')

  return (
    <div className="q3x-tidy-page q3x-inbox-editor" ref={root}>
      {recover ? (
        <section className="q3x-tidy-card" role="status" aria-label="Unsaved bill from last time">
          <p className="q3x-tidy-text">You have an unsaved bill from last time.</p>
          <div className="q3x-tidy-actions">
            <Button label="Recover" variant="primary" onClick={() => { void recoverDraft(db, recover).then((s) => { setState(s); setRecover(null); setCur(null) }) }} />
            <Button label="Discard" onClick={() => { void discardDraft(db, recover.id).then(() => setRecover(null)) }} />
          </div>
        </section>
      ) : null}

      <div className="q3x-paper q3x-paper-editor">
        <section className="q3x-tidy-party-block" aria-label="Party">
          <div className="q3x-tidy-partyname">
            <GrowText
              className="q3x-paper-input q3x-grow" value={state.bill.party.name} label="Party name" field="party:name" enter="next"
              onValue={(v) => { update((s) => setPartyField(s, 'name', v)); setSuggestOpen(true) }}
              onEnter={() => { setSuggestOpen(false); if (order[0]) go(order[0]) }}
              onFocus={() => { setSuggestOpen(true); setCur(null) }} onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
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
          {isNewName ? <p className="q3x-paper-sub">New customer: it is added when you save.</p> : null}
          <SegmentedControl ariaLabel="Bill format" value={state.bill.formatId} onChange={(f) => update((s) => setFormat(s, f))} options={formats.map((f) => ({ id: f.id, label: f.label }))} />
          <DateField label="Bill date" value={state.bill.billDate} onChange={(d) => update((s) => changeBillDate(s, d))} />
        </section>

        <table className="q3x-paper-table" aria-label="Items">
          <thead><tr><th scope="col">#</th><th scope="col">Item</th><th scope="col" className="q3x-paper-num">Qty</th><th scope="col" className="q3x-paper-num">Rate</th>{view.hasGst ? <th scope="col" className="q3x-paper-num">GST %</th> : null}<th scope="col" className="q3x-paper-num">Amount</th><th scope="col"><span className="q3x-sr">Remove</span></th></tr></thead>
          <tbody>
            {view.items.map((r, i) => {
              const key = (f: PaperField): string => `${r.id}:${f}`
              const numCell = (f: 'qty' | 'rate' | 'gstRate', label: string): ReactElement => {
                const k = key(f)
                const val = r[f]
                return cur === k ? (
                  <input
                    className="q3x-paper-input q3x-num" inputMode="decimal" enterKeyHint="next" aria-label={label} placeholder={label} data-f={k} value={val}
                    onChange={(e) => update((s) => setItemField(s, r.id, f as ItemField, readNumberText(e.target.value, false).text))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); goNext() } }}
                  />
                ) : (
                  <button type="button" className="q3x-paper-cell q3x-paper-num" aria-label={`Edit ${label} of row ${i + 1}`} onClick={() => go(k)}>{val === '' ? '' : plainNumber(val)}</button>
                )
              }
              return (
                <tr key={r.id} className={r.warn ? 'q3x-tidy-warn' : undefined}>
                  <td className="q3x-paper-slno">{i + 1}</td>
                  <td className="q3x-paper-name">
                    {cur === key('name') ? (
                      <GrowText className="q3x-paper-input q3x-grow" value={r.name} label="Item name" field={key('name')} enter="next" onValue={(v) => update((s) => setItemField(s, r.id, 'name', v))} onEnter={goNext} />
                    ) : (
                      <button type="button" className="q3x-paper-cell" aria-label={`Edit item name of row ${i + 1}`} onClick={() => go(key('name'))}>
                        {r.name ? <RichName runs={runsOf(state, r.id)} /> : <span className="q3x-paper-sub">Item</span>}
                      </button>
                    )}
                  </td>
                  <td className="q3x-paper-num">{numCell('qty', 'Qty')}</td>
                  <td className="q3x-paper-num">{numCell('rate', 'Rate')}</td>
                  {view.hasGst ? <td className="q3x-paper-num">{numCell('gstRate', 'GST %')}</td> : null}
                  <td className="q3x-paper-num">{moneyText(r.amount)}</td>
                  <td><Button label={`Remove row ${i + 1}`} hideLabel variant="text" icon={<Trash size={20} aria-hidden="true" />} onClick={() => removeItemRow(r.id)} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <Button label="Add item" variant="secondary" icon={<Plus size={20} aria-hidden="true" />} onClick={() => { const a = addItemRow(state); setState(a.state); go(`${a.id}:name`) }} />

        <section aria-label="Adjustments" className="q3x-tidy-adjs">
          {view.adjustments.map((a) => (
            <div key={a.id} className="q3x-tidy-adj">
              <GrowText className="q3x-paper-input q3x-grow" value={a.name} label="Adjustment name" field={`${a.id}:name`} enter="next" onValue={(v) => update((s) => setAdjustment(s, a.id, { name: v }))} onFocus={() => setCur(null)} />
              <input className="q3x-paper-input q3x-num" inputMode="decimal" aria-label="Adjustment amount" placeholder="Amount" value={a.amount} onFocus={() => setCur(null)} onChange={(e) => update((s) => setAdjustment(s, a.id, { amount: readNumberText(e.target.value, true).text }))} />
              <Button label="Remove adjustment" hideLabel variant="text" icon={<Trash size={20} aria-hidden="true" />} onClick={() => update((s) => removeRow(s, a.id))} />
            </div>
          ))}
          <Button label="Add adjustment" variant="text" icon={<Plus size={20} aria-hidden="true" />} onClick={() => { setState(addAdjustment(state).state) }} />
        </section>

        {totals.show ? <TotalsBlock rows={totals.rows} total={totals.total} /> : null}
      </div>

      <footer className="q3x-tidy-stickybar q3x-tidy-savebar" aria-label="Save">
        {message ? <p className="q3x-tidy-note" role="alert">{message}</p> : null}
        <div className="q3x-tidy-saverow">
          <span className="q3x-tidy-savetotal" aria-label="Final total"><span className="q3x-tidy-sub">Total</span> <strong className="q3x-amount-grand">{moneyText(view.grandTotal)}</strong></span>
          <Button label={saving ? 'Saving...' : 'Save'} variant="primary" disabled={saving} onClick={() => { void doSave() }} />
        </div>
      </footer>

      {cur ? (
        <div className="q3x-inbox-toolbar" role="toolbar" aria-label="Cell tools" onMouseDown={noMouse}>
          <Button label="Previous cell" hideLabel icon={<ArrowUp size={22} aria-hidden="true" />} onClick={goPrev} />
          <Button label="Next cell" hideLabel icon={<ArrowDown size={22} aria-hidden="true" />} onClick={goNext} />
          <Button label="Bold" disabled={!inName} icon={<strong aria-hidden="true">B</strong>} onClick={() => styleName('bold')} />
          <Button label="Red and bold" disabled={!inName} icon={<strong aria-hidden="true">R+B</strong>} onClick={() => styleName('redBold')} />
          <Button label="Done" variant="primary" icon={<Check size={22} aria-hidden="true" />} onClick={() => { setCur(null); (document.activeElement as HTMLElement | null)?.blur() }} />
        </div>
      ) : null}
      <div className="q3x-tidy-snackwrap"><SnackbarHost snack={snack} /></div>
    </div>
  )
}
