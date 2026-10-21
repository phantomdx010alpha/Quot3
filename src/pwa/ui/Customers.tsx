import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { formatHistoryDate, formatHistoryTotal } from '../../shared/history/historyList'
import type { BillHead } from '../data/billsRepo'
import { addCustomer, CustomerError, editCustomer, listCustomerBills, type CustomerInput } from '../data/customersRepo'
import type { PhoneDb } from '../data/db'
import { getParty, listCustomers, type CustomerRow, type PartyRecord } from '../data/partiesRepo'
import { withOutbox } from '../sync/outbox'
import { billCountText, CUSTOMER_PAGE_SIZE, filterCustomers, telHref, whatsappHref } from './customersModel'

const NOT_OPEN = 'Your customers could not be opened.'

/** Customers list (Phase 185): search by name or phone, bill count, tap to open, Add customer. */
export function Customers(props: { db: PhoneDb | null; onOpen: (id: string) => void; onAdd: () => void }): ReactElement {
  const { db } = props
  const [rows, setRows] = useState<CustomerRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(CUSTOMER_PAGE_SIZE)

  useEffect(() => {
    if (!db) return undefined
    let cancelled = false
    listCustomers(db).then(
      (r) => { if (!cancelled) setRows(r) },
      (e: unknown) => { if (!cancelled) setError(`Could not read your customers: ${e instanceof Error ? e.message : String(e)}`) }
    )
    return () => { cancelled = true }
  }, [db])

  const shown = useMemo(() => (rows ? filterCustomers(rows, query) : null), [rows, query])
  if (!db) return <p className="q3-note q3-note-warn" role="alert">{NOT_OPEN}</p>
  if (error) return <p className="q3-note q3-note-warn" role="alert">{error}</p>
  if (!shown || !rows) return <p className="q3-muted" role="status">Loading</p>

  return (
    <div className="q3-history">
      <div className="q3-search">
        <MagnifyingGlass size={18} weight="light" aria-hidden="true" />
        <input type="search" aria-label="Search customers" placeholder="Name or phone" enterKeyHint="search" autoComplete="off" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(CUSTOMER_PAGE_SIZE) }} />
      </div>
      <div className="q3-actions">
        <button type="button" className="q3-btn q3-btn-primary" disabled={!db.canWrite()} onClick={props.onAdd}><Plus size={16} weight="bold" aria-hidden="true" /> Add customer</button>
        <span className="q3-muted">{rows.length === 1 ? '1 customer' : `${rows.length} customers`}</span>
      </div>
      {shown.length === 0 ? (
        <p className="q3-muted">{rows.length === 0 ? 'No customers yet. They are added when you save a bill, or tap Add customer.' : 'No customer matches.'}</p>
      ) : (
        <ul className="q3-list" aria-label="Customers">
          {shown.slice(0, limit).map((r) => (
            <li key={r.id} className="q3-li">
              <button type="button" className="q3-li-btn" onClick={() => props.onOpen(r.id)}>
                <span className="q3-li-main">
                  <span className="q3-li-title">{r.name}</span>
                  <span className="q3-muted">{r.phone || 'No phone'}{r.lastBillDate ? ` · last ${formatHistoryDate(r.lastBillDate)}` : ''}</span>
                </span>
                <span className="q3-li-amount">{billCountText(r.billCount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.length > limit ? <button type="button" className="q3-btn" onClick={() => setLimit((n) => n + CUSTOMER_PAGE_SIZE)}>Show more</button> : null}
    </div>
  )
}

const EMPTY: CustomerInput = { name: '', phone: '', address: '', transport: '' }
const messageOf = (e: unknown): string => (e instanceof CustomerError ? e.message : e instanceof Error ? e.message : String(e))

/** One customer: details, Call / WhatsApp, their bills, Edit. `id` is a customer id, or `new` for the Add form. */
export function CustomerPage(props: {
  db: PhoneDb | null; id: string; now?: () => Date
  onOpenBill: (id: string) => void
  /** After Add: the new customer's id. */
  onAdded: (id: string) => void
  onChanged?: () => void
}): ReactElement {
  const { db, id } = props
  const adding = id === 'new'
  const [party, setParty] = useState<PartyRecord | null | undefined>(adding ? null : undefined)
  const [bills, setBills] = useState<BillHead[]>([])
  const [editing, setEditing] = useState(adding)
  const [form, setForm] = useState<CustomerInput>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!db || adding) return
    try {
      const p = await getParty(db, id)
      setParty(p && p.deletedAt === null && (p.mergedInto ?? null) === null ? p : null)
      setBills(await listCustomerBills(db, id))
    } catch (e) {
      setError(`Could not read this customer: ${messageOf(e)}`)
    }
  }, [db, id, adding])
  useEffect(() => { void load() }, [load])

  if (!db) return <p className="q3-note q3-note-warn" role="alert">{NOT_OPEN}</p>
  if (party === undefined && !error) return <p className="q3-muted" role="status">Loading</p>
  if (party === null && !adding) return <p className="q3-muted">This customer no longer exists.</p>

  const startEdit = (): void => {
    if (!party) return
    setForm({ name: party.name, phone: party.phone ?? '', address: party.address ?? '', transport: party.transport ?? '' })
    setError(null); setNotice(null); setEditing(true)
  }
  const set = (k: keyof CustomerInput) => (e: { target: { value: string } }): void => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const opts = { now: props.now, ...withOutbox({ now: props.now }) }
      if (adding) {
        const made = await addCustomer(db, form, { now: props.now, parties: opts.parties })
        props.onChanged?.()
        props.onAdded(made.id)
      } else {
        setParty(await editCustomer(db, id, form, { now: props.now, parties: opts.parties }))
        setEditing(false); setNotice('Saved.'); props.onChanged?.()
      }
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="q3-editor">
        <label className="q3-field"><span className="q3-muted">Name</span>
          <input className="q3-input" aria-label="Name" value={form.name} readOnly={!adding} autoComplete="off" enterKeyHint="next" onChange={set('name')} />
        </label>
        {!adding ? <p className="q3-muted">The name cannot be changed here.</p> : null}
        <label className="q3-field"><span className="q3-muted">Phone</span>
          <input className="q3-input" aria-label="Phone" type="tel" inputMode="tel" autoComplete="off" enterKeyHint="next" value={form.phone} onChange={set('phone')} />
        </label>
        <label className="q3-field"><span className="q3-muted">Address</span>
          <input className="q3-input" aria-label="Address" autoComplete="off" enterKeyHint="next" value={form.address} onChange={set('address')} />
        </label>
        <label className="q3-field"><span className="q3-muted">Transport</span>
          <input className="q3-input" aria-label="Transport" autoComplete="off" enterKeyHint="done" value={form.transport} onChange={set('transport')} />
        </label>
        {error ? <p className="q3-note q3-note-warn" role="alert">{error}</p> : null}
        <div className="q3-actions">
          <button type="button" className="q3-btn q3-btn-primary" disabled={busy || !db.canWrite()} onClick={() => void save()}>Save</button>
          {!adding ? <button type="button" className="q3-btn" onClick={() => { setEditing(false); setError(null) }}>Cancel</button> : null}
        </div>
      </div>
    )
  }

  const p = party!
  const call = p.phone ? telHref(p.phone) : null
  const wa = p.phone ? whatsappHref(p.phone) : null
  return (
    <div className="q3-bill">
      {notice ? <p className="q3-note" role="status">{notice}</p> : null}
      {error ? <p className="q3-note q3-note-warn" role="alert">{error}</p> : null}
      <div className="q3-bill-head">
        <span className="q3-strong">{p.name}</span>
        <div className="q3-kv"><span>Phone</span><span>{p.phone ?? '-'}</span></div>
        <div className="q3-kv"><span>Address</span><span>{p.address ?? '-'}</span></div>
        <div className="q3-kv"><span>Transport</span><span>{p.transport ?? '-'}</span></div>
      </div>
      <div className="q3-actions">
        {call ? <a className="q3-btn" href={call}>Call</a> : null}
        {wa ? <a className="q3-btn" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
        <button type="button" className="q3-btn" disabled={!db.canWrite()} onClick={startEdit}>Edit</button>
      </div>
      <h2 className="q3-h2">Bills ({bills.length})</h2>
      {bills.length === 0 ? <p className="q3-muted">No bills for this customer yet.</p> : (
        <ul className="q3-list" aria-label="Customer bills">
          {bills.map((h) => (
            <li key={h.id} className="q3-li">
              <button type="button" className="q3-li-btn" onClick={() => props.onOpenBill(h.id)}>
                <span className="q3-li-main">
                  <span className="q3-li-title">{h.poNumber}</span>
                  <span className="q3-muted">{formatHistoryDate(h.billDate)}</span>
                </span>
                <span className="q3-li-amount">{formatHistoryTotal(h.grandTotal)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
