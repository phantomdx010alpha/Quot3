/** Phase 246 (M23) - the EDIT controls of the phone Price List (shared by tidy / guided / inbox, drawn only inside `PriceEditProvider`).
 *  Every control is switched on or off from the seat's flags ONE BY ONE and, when off, says why in plain words (`reasonFor` = the shared `notAllowedText`).
 *  A save is ONE record change through `data/priceListEdit.ts` (queued in the outbox in the same transaction). The row being edited is kept as a draft
 *  in `meta` so a closed tab does not lose it. Names and amounts are never truncated (wrap rule in `pricelist.css`). Tokens only, no emoji, Phosphor only. */
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { PhoneDb } from '../../data/db'
import { addCategoryRec, addRow, addTabRec, deletePriceRec, renameCategoryRec, renameTabRec, saveRowEdit, MSG, type EditCtx, type EditResult } from '../../data/priceListEdit'
import { clearDraft, readDraft, reasonFor, saveDraft } from '../../data/priceRights'
import { PERM_FLAGS, type PermFlags } from '../../../shared/pricelist/perms'
import { plain } from '../../../shared/richtext/runs'
import type { PriceRow, PriceTab } from '../../../shared/pricelist/types'
import { PriceEditContext, usePriceEdit, type PriceEditValue } from './priceEditContext'
import { tabView, type PriceListData } from './priceListModel'

export const SAVED_NOTE = 'Saved. It reaches the other branches when this phone syncs.'

/** Why a control is off: another tab holds the writer lock, or the flags, or '' when it is on. */
function whyOff(ed: PriceEditValue, need: Parameters<typeof reasonFor>[1]): string {
  return ed.writable ? reasonFor(ed.flags, need) : MSG.readOnly
}

export function PriceEditProvider(props: { db: PhoneDb; data: PriceListData; flags: PermFlags; writable: boolean; now?: () => Date; onDone: () => void; children: ReactNode }): ReactElement {
  const { db, data, flags, writable, now, onDone } = props
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async (action: () => Promise<EditResult>): Promise<EditResult> => {
    setBusy(true)
    try {
      const r = await action()
      setNote({ text: r.ok ? SAVED_NOTE : r.message, bad: !r.ok && r.reason !== 'unchanged' })
      if (r.ok) onDone()
      return r
    } catch (e) {
      const message = `Could not save: ${e instanceof Error ? e.message : String(e)}`
      setNote({ text: message, bad: true })
      return { ok: false, reason: 'invalid', message }
    } finally { setBusy(false) }
  }, [onDone])
  const value = useMemo<PriceEditValue>(() => ({ db, data, flags, writable, now, run }), [db, data, flags, writable, now, run])
  return (
    <PriceEditContext.Provider value={value}>
      {note ? <p className={note.bad ? 'q3-note q3-note-warn q3x-pl-edit-note' : 'q3x-pl-edit-note q3x-pl-saved-text'} role={note.bad ? 'alert' : 'status'} data-testid="price-edit-note">{note.text}</p> : null}
      <fieldset className="q3x-pl-edit-fence" disabled={busy}>{props.children}</fieldset>
    </PriceEditContext.Provider>
  )
}

const ctxOf = (ed: PriceEditValue): EditCtx => ({ db: ed.db, flags: ed.flags, now: ed.now })
const noRights = (f: PermFlags): boolean => PERM_FLAGS.every((k) => !f[k])

/** One labelled text input. `reason` non-empty = disabled, and the reason is its title and its description. */
function Field(props: { id: string; label: string; value: string; onChange: (v: string) => void; reason: string; numeric?: boolean }): ReactElement {
  return (
    <div className="q3x-pl-field">
      <label className="q3x-pl-field-label" htmlFor={props.id}>{props.label}</label>
      <input id={props.id} className="q3x-pl-field-input" type="text" inputMode={props.numeric ? 'decimal' : 'text'} autoComplete="off" value={props.value} disabled={props.reason !== ''} title={props.reason !== '' ? props.reason : undefined} aria-describedby={props.reason !== '' ? `${props.id}-why` : undefined} onChange={(e) => props.onChange(e.target.value)} />
      {props.reason !== '' ? <span id={`${props.id}-why`} className="q3x-pl-why-text">{props.reason}</span> : null}
    </div>
  )
}

function ActionButton(props: { label: string; onClick: () => void; reason: string; icon?: ReactNode; variant?: 'primary' | 'secondary' | 'text' }): ReactElement {
  return (
    <button type="button" className={`q3x-btn q3x-btn-${props.variant ?? 'secondary'}`} disabled={props.reason !== ''} title={props.reason !== '' ? props.reason : undefined} aria-label={props.reason !== '' ? `${props.label}. ${props.reason}` : props.label} onClick={props.onClick}>
      {props.icon ? <span className="q3x-btn-icon" aria-hidden="true">{props.icon}</span> : null}
      <span className="q3x-btn-label">{props.label}</span>
    </button>
  )
}

/** The prices a row or a new item can carry: every shown tab column except the name. */
const editCols = (tab: PriceTab, data: PriceListData) => tabView(tab, [], data.tiers).columns.filter((c) => !c.isName)

// ---- one row -------------------------------------------------------------------------------------------------------------------

function RowEditor(props: { row: PriceRow; tab: PriceTab; onClose: () => void }): ReactElement {
  const ed = usePriceEdit()!
  const { row, tab } = props
  const [name, setName] = useState(plain(row.nameRuns))
  const [cells, setCells] = useState<Record<string, string>>({ ...row.cells })
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    let off = false
    readDraft(ed.db).then((d) => { if (!off && d && d.rowId === row.id) { setName(d.name); setCells(d.cells) } }, () => undefined)
    return () => { off = true }
  }, [ed.db, row.id])
  const keep = (n: string, c: Record<string, string>): void => { void saveDraft(ed.db, { rowId: row.id, name: n, cells: c, at: new Date().toISOString() }).catch(() => undefined) }
  const cols = row.kind === 'section' ? [] : editCols(tab, ed.data)
  const close = (): void => { void clearDraft(ed.db).catch(() => undefined); props.onClose() }
  const save = async (): Promise<void> => {
    const r = await ed.run(() => saveRowEdit(ctxOf(ed), row.id, { name, cells }))
    if (r.ok || r.reason === 'unchanged') close()
  }
  const del = async (): Promise<void> => {
    const r = await ed.run(() => deletePriceRec(ctxOf(ed), 'price_row', row.id))
    if (r.ok) close()
  }
  return (
    <div className="q3x-pl-editor" data-testid="price-row-editor">
      <Field id={`pl-n-${row.id}`} label={row.kind === 'section' ? 'Heading' : 'Item name'} value={name} onChange={(v) => { setName(v); keep(v, cells) }} reason={whyOff(ed, ['edit'])} />
      {cols.map((c) => {
        const had = (row.cells[c.key] ?? '') !== ''
        return <Field key={c.key} id={`pl-${row.id}-${c.key}`} label={c.label} value={cells[c.key] ?? ''} numeric={c.numeric} onChange={(v) => { const next = { ...cells, [c.key]: v }; setCells(next); keep(name, next) }} reason={whyOff(ed, [had ? 'overwrite' : 'edit'])} />
      })}
      <div className="q3x-pl-editor-actions">
        <ActionButton label="Save" variant="primary" onClick={() => void save()} reason={ed.writable ? '' : MSG.readOnly} />
        <ActionButton label="Cancel" variant="text" onClick={close} reason="" />
        {confirm ? (
          <>
            <ActionButton label="Yes, delete it" onClick={() => void del()} reason={whyOff(ed, ['delete'])} icon={<Trash size={20} weight="light" />} />
            <ActionButton label="Keep it" variant="text" onClick={() => setConfirm(false)} reason="" />
          </>
        ) : <ActionButton label="Delete" variant="secondary" onClick={() => setConfirm(true)} reason={whyOff(ed, ['delete'])} icon={<Trash size={20} weight="light" />} />}
      </div>
    </div>
  )
}

/** The Edit button of a row card (and its editor). Nothing is drawn outside the provider (a read only screen). */
export function RowEditControls(props: { rowId: string }): ReactElement | null {
  const ed = usePriceEdit()
  const [open, setOpen] = useState(false)
  const found = useMemo(() => {
    if (!ed) return null
    for (const t of ed.data.tabs) { const r = (ed.data.rows[t.id] ?? []).find((x) => x.id === props.rowId); if (r) return { row: r, tab: t } }
    return null
  }, [ed, props.rowId])
  if (!ed || !found) return null
  if (open) return <RowEditor row={found.row} tab={found.tab} onClose={() => setOpen(false)} />
  // Editing a row needs at least one of edit / overwrite / delete; with none of them the button is off and says why.
  const anyRow = ed.flags.edit || ed.flags.overwrite || ed.flags.delete
  const reason = !ed.writable ? MSG.readOnly : noRights(ed.flags) ? whyOff(ed, ['edit']) : anyRow ? '' : whyOff(ed, ['edit'])
  return <div className="q3x-pl-row-actions"><ActionButton label="Edit" variant="text" icon={<PencilSimple size={20} weight="light" />} reason={reason} onClick={() => setOpen(true)} /></div>
}

// ---- a new item ----------------------------------------------------------------------------------------------------------------

export function AddItemControls(props: { tabId: string }): ReactElement | null {
  const ed = usePriceEdit()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [cells, setCells] = useState<Record<string, string>>({})
  const tab = ed?.data.tabs.find((t) => t.id === props.tabId)
  if (!ed || !tab) return null
  if (!open) return <div className="q3x-pl-row-actions"><ActionButton label="Add item" variant="secondary" icon={<Plus size={20} weight="light" />} reason={whyOff(ed, ['add'])} onClick={() => setOpen(true)} /></div>
  const cols = editCols(tab, ed.data)
  const reset = (): void => { setOpen(false); setName(''); setCells({}) }
  return (
    <div className="q3x-pl-editor" data-testid="price-add-editor">
      <Field id={`pl-add-${tab.id}`} label="New item name" value={name} onChange={setName} reason="" />
      {cols.map((c) => <Field key={c.key} id={`pl-add-${tab.id}-${c.key}`} label={c.label} value={cells[c.key] ?? ''} numeric={c.numeric} onChange={(v) => setCells({ ...cells, [c.key]: v })} reason="" />)}
      <div className="q3x-pl-editor-actions">
        <ActionButton label="Add" variant="primary" reason={whyOff(ed, ['add'])} onClick={() => void ed.run(() => addRow(ctxOf(ed), tab.id, { name, cells })).then((r) => { if (r.ok) reset() })} />
        <ActionButton label="Cancel" variant="text" reason="" onClick={reset} />
      </div>
    </div>
  )
}

// ---- categories and tabs ---------------------------------------------------------------------------------------------------------

function NameForm(props: { id: string; label: string; initial: string; button: string; reason: string; onSubmit: (name: string) => Promise<EditResult> }): ReactElement {
  const [v, setV] = useState(props.initial)
  return (
    <div className="q3x-pl-nameform">
      <Field id={props.id} label={props.label} value={v} onChange={setV} reason={props.reason} />
      <ActionButton label={props.button} reason={props.reason} onClick={() => void props.onSubmit(v).then((r) => { if (r.ok && props.initial === '') setV('') })} />
    </div>
  )
}

function DeleteButton(props: { label: string; reason: string; onDelete: () => void }): ReactElement {
  const [sure, setSure] = useState(false)
  return sure ? (
    <span className="q3x-pl-confirm">
      <ActionButton label={`Yes, delete ${props.label}`} reason={props.reason} onClick={props.onDelete} icon={<Trash size={20} weight="light" />} />
      <ActionButton label="Keep it" variant="text" reason="" onClick={() => setSure(false)} />
    </span>
  ) : <ActionButton label={`Delete ${props.label}`} reason={props.reason} onClick={() => setSure(true)} icon={<Trash size={20} weight="light" />} />
}

/** Add / rename / delete categories and tabs. Structure changes need `structure`, deletes need `delete`. A delete takes what is under it (tombstones, like the desktop trash). */
export function StructurePanel(): ReactElement | null {
  const ed = usePriceEdit()
  if (!ed) return null
  const c = ctxOf(ed)
  return (
    <details className="q3x-pl-manage">
      <summary className="q3x-pl-manage-summary">Manage categories and tabs</summary>
      <NameForm id="pl-new-cat" label="New category" initial="" button="Add category" reason={whyOff(ed, ['structure'])} onSubmit={(n) => ed.run(() => addCategoryRec(c, n))} />
      {ed.data.categories.map((cat) => (
        <section key={cat.id} className="q3x-pl-manage-cat" aria-label={cat.name}>
          <h3 className="q3x-pl-manage-title">{cat.name}</h3>
          <NameForm id={`pl-rc-${cat.id}`} label="Category name" initial={cat.name} button="Rename category" reason={whyOff(ed, ['structure'])} onSubmit={(n) => ed.run(() => renameCategoryRec(c, cat.id, n))} />
          <DeleteButton label="this category" reason={whyOff(ed, ['delete'])} onDelete={() => void ed.run(() => deletePriceRec(c, 'price_category', cat.id))} />
          {ed.data.tabs.filter((t) => t.categoryId === cat.id).map((t) => (
            <div key={t.id} className="q3x-pl-manage-tab">
              <NameForm id={`pl-rt-${t.id}`} label="Tab name" initial={t.name} button="Rename tab" reason={whyOff(ed, ['structure'])} onSubmit={(n) => ed.run(() => renameTabRec(c, t.id, n))} />
              <DeleteButton label="this tab" reason={whyOff(ed, ['delete'])} onDelete={() => void ed.run(() => deletePriceRec(c, 'price_tab', t.id))} />
            </div>
          ))}
          <NameForm id={`pl-nt-${cat.id}`} label="New tab" initial="" button="Add tab" reason={whyOff(ed, ['structure'])} onSubmit={(n) => ed.run(() => addTabRec(c, cat.id, n))} />
        </section>
      ))}
    </details>
  )
}
