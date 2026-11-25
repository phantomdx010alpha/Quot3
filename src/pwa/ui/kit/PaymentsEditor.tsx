/**
 * Phase 283 (M25) - the Payments list editor: add, edit, remove (with confirm), reorder, set default, the name people see when they pay.
 * Every change goes through `shared/payments/list` (validation and the plain words live there) and is then handed to `onCommit`, which keeps it on
 * the phone and publishes it when this phone may. The result line is either "Published to all phones." or the plain refusal.
 */
import { useState, type ReactElement } from 'react'
import { ArrowDown, ArrowUp, PencilSimple, Plus, Star, Trash } from '@phosphor-icons/react'
import { addPayee, editPayee, movePayee, removePayee, setDefault, setRecipient } from '../../../shared/payments/list'
import type { PayeeKind, PaymentsList, Result } from '../../../shared/payments/types'
import { PAY_WORDS, KIND_LABELS, draftOf, emptyDraft, payeeFromDraft, upiIdOf, type PayeeDraft } from './paymentsModel'

type Commit = (next: PaymentsList) => Promise<{ ok: boolean; words: string }>
interface Form { id: string | null; draft: PayeeDraft }

const KINDS: readonly PayeeKind[] = ['upi', 'merchant', 'account']
const MERCHANT_FIELDS: readonly (readonly [keyof PayeeDraft, string])[] = [
  ['pa', 'Merchant UPI ID'], ['ver', 'ver'], ['mode', 'mode'], ['orgId', 'orgId'], ['tr', 'tr'], ['mid', 'mid'], ['mtid', 'mtid'], ['mc', 'mc'], ['qrMedium', 'qrMedium']
]

export function PayeeEditor(props: { list: PaymentsList; unpublished: boolean; onCommit: Commit; onClose: () => void }): ReactElement {
  const { list } = props
  const [form, setForm] = useState<Form | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [recipient, setRecipientText] = useState(list.recipient)
  const [msg, setMsg] = useState<{ ok: boolean; words: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (op: Result<PaymentsList>): Promise<boolean> => {
    if (!op.ok) { setMsg({ ok: false, words: op.words }); return false }
    setBusy(true)
    const r = await props.onCommit(op.value)
    setBusy(false)
    setMsg(r)
    return r.ok
  }

  const setField = (k: keyof PayeeDraft, v: string): void => { if (form) setForm({ ...form, draft: { ...form.draft, [k]: v } }); setMsg(null) }

  const saveForm = async (): Promise<void> => {
    if (!form) return
    const payee = payeeFromDraft(form.draft)
    const ok = await run(form.id === null ? addPayee(list, payee) : editPayee(list, form.id, payee))
    if (ok) setForm(null)
  }

  if (form) {
    const d = form.draft
    const text = (k: keyof PayeeDraft, label: string, extra?: { inputMode?: 'numeric' | 'text' }): ReactElement => (
      <label className="q3x-pay-field" key={k}>
        <span className="q3x-pay-label">{label}</span>
        <input className="q3x-pay-input" aria-label={label} autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode={extra?.inputMode} value={d[k]} onChange={(e) => setField(k, e.target.value)} />
      </label>
    )
    return (
      <div className="q3x-pay-page">
        <h2 className="q3x-pay-h2">{form.id === null ? 'Add payee' : 'Edit payee'}</h2>
        {text('name', 'Name')}
        {form.id === null ? (
          <div className="q3x-pay-kinds" role="group" aria-label="Payee type">
            {KINDS.map((k) => (
              <button key={k} type="button" className="q3x-pay-chip" aria-pressed={d.kind === k} onClick={() => { setForm({ ...form, draft: { ...d, kind: k } }); setMsg(null) }}>{KIND_LABELS[k]}</button>
            ))}
          </div>
        ) : <p className="q3x-pay-hint">{KIND_LABELS[d.kind]}</p>}
        {d.kind === 'upi' ? text('upiId', 'UPI ID') : null}
        {d.kind === 'merchant' ? MERCHANT_FIELDS.map(([k, label]) => text(k, label)) : null}
        {d.kind === 'account' ? <p className="q3x-pay-hint">This payee is used only when Pay to bank account is on.</p> : <p className="q3x-pay-hint">Bank account (optional). Fill both to allow Pay to bank account.</p>}
        {text('number', 'Account number', { inputMode: 'numeric' })}
        {text('ifsc', 'IFSC code')}
        {msg ? <p className={msg.ok ? 'q3x-pay-note' : 'q3x-pay-warn'} role={msg.ok ? 'status' : 'alert'}>{msg.words}</p> : null}
        <div className="q3x-pay-actions">
          <button type="button" className="q3x-pay-primary" disabled={busy} onClick={() => void saveForm()}><span>Save payee</span></button>
          <button type="button" className="q3x-pay-btn" onClick={() => { setForm(null); setMsg(null) }}><span>Cancel</span></button>
        </div>
      </div>
    )
  }

  return (
    <div className="q3x-pay-page">
      <h2 className="q3x-pay-h2">{PAY_WORDS.edit}</h2>
      {props.unpublished ? <p className="q3x-pay-note" role="status">This list has a change that is not shared with other phones yet.</p> : null}

      <label className="q3x-pay-field">
        <span className="q3x-pay-label">Name people see when they pay</span>
        <input className="q3x-pay-input" aria-label="Name people see" autoComplete="off" value={recipient} onChange={(e) => { setRecipientText(e.target.value); setMsg(null) }} />
      </label>
      <button type="button" className="q3x-pay-btn" disabled={busy || recipient.trim() === list.recipient} onClick={() => void run(setRecipient(list, recipient))}><span>Save name</span></button>

      <ul className="q3x-pay-rows" aria-label="Payees">
        {list.accounts.map((a, i) => (
          <li key={a.id} className="q3x-pay-row">
            <div className="q3x-pay-row-text">
              <span className="q3x-pay-row-name">{a.name}{a.id === list.defaultId ? ' (default)' : ''}</span>
              <span className="q3x-pay-row-sub">{KIND_LABELS[a.kind]}{upiIdOf(a) ? ` \u00b7 ${upiIdOf(a)}` : ''}</span>
            </div>
            {confirmId === a.id ? (
              <div className="q3x-pay-actions" role="group" aria-label={`Remove ${a.name}`}>
                <span className="q3x-pay-hint">{PAY_WORDS.removeAsk}</span>
                <button type="button" className="q3x-pay-btn" disabled={busy} onClick={() => { setConfirmId(null); void run(removePayee(list, a.id)) }}><span>Remove</span></button>
                <button type="button" className="q3x-pay-btn" onClick={() => setConfirmId(null)}><span>Keep</span></button>
              </div>
            ) : (
              <div className="q3x-pay-actions">
                <button type="button" className="q3x-pay-icon" aria-label={`Edit ${a.name}`} onClick={() => { setForm({ id: a.id, draft: draftOf(a) }); setMsg(null) }}><PencilSimple size={20} weight="light" aria-hidden="true" /></button>
                <button type="button" className="q3x-pay-icon" aria-label={`Move ${a.name} up`} disabled={busy || i === 0} onClick={() => void run(movePayee(list, a.id, i - 1))}><ArrowUp size={20} weight="light" aria-hidden="true" /></button>
                <button type="button" className="q3x-pay-icon" aria-label={`Move ${a.name} down`} disabled={busy || i === list.accounts.length - 1} onClick={() => void run(movePayee(list, a.id, i + 1))}><ArrowDown size={20} weight="light" aria-hidden="true" /></button>
                <button type="button" className="q3x-pay-icon" aria-label={`Make ${a.name} the default`} disabled={busy || a.id === list.defaultId} onClick={() => void run(setDefault(list, a.id))}><Star size={20} weight="light" aria-hidden="true" /></button>
                <button type="button" className="q3x-pay-icon" aria-label={`Remove ${a.name}`} onClick={() => setConfirmId(a.id)}><Trash size={20} weight="light" aria-hidden="true" /></button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {msg ? <p className={msg.ok ? 'q3x-pay-note' : 'q3x-pay-warn'} role={msg.ok ? 'status' : 'alert'}>{msg.words}</p> : null}
      <div className="q3x-pay-actions">
        <button type="button" className="q3x-pay-btn" onClick={() => { setForm({ id: null, draft: emptyDraft('upi') }); setMsg(null) }}><Plus size={20} weight="light" aria-hidden="true" /><span>Add payee</span></button>
        <button type="button" className="q3x-pay-btn" onClick={props.onClose}><span>Done</span></button>
      </div>
    </div>
  )
}
