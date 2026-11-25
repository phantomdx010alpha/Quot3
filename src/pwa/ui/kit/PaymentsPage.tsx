/**
 * Phase 283 (M25) - the phone Payments page: pick a payee, switch to bank account, type an amount, generate, save, share, full screen; edit the list.
 * Follows the owner's original page (docs/reference/qr_payments_source). Reads and writes only through `data/paymentsRepo` and `sync/payments`
 * (offline first; a failed publish keeps the edit on the phone). Nothing here logs, and no account number is drawn on a label.
 * The QR picture comes from the `QrPort` (Phase 282); without one the card says so in plain words. Rights gating belongs to Phases 290-291.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ArrowsClockwise, ArrowsOut, DownloadSimple, PencilSimple, QrCode, ShareNetwork, Wallet } from '@phosphor-icons/react'
import { amountText, buildUpiUrl } from '../../../shared/payments/upiUrl'
import { hasAccountMode, pickPayee, visiblePayees } from '../../../shared/payments/list'
import type { PaymentsList } from '../../../shared/payments/types'
import type { PhoneDb } from '../../data/db'
import { readPayments, readPaymentsPrefs, writePayments, writePaymentsPrefs, type PaymentsPrefs, type StoredPayments } from '../../data/paymentsRepo'
import { getSetting } from '../../data/settingsRepo'
import { browserShareEnv, shareFile } from '../../share/shareSheet'
import { PAYMENTS_LOCAL_ONLY_WORDS, type PaymentsSync } from '../../sync/payments'
import type { BillQrInfo } from '../../share/billQr'
import { BillPicker } from './BillPicker'
import { BottomSheet } from './BottomSheet'
import { ACTION_OFF_WORDS } from '../../../shared/seatRights'
import { useSeatRights } from '../useSeatRights'
import { PayeeEditor } from './PaymentsEditor'
import { PAY_WORDS, getQrPort, matrixPath, qrLabels, type QrPort } from './paymentsModel'
import './payments.css'

/** The Home entry (new layouts): one tappable row, like the Price List entry. */
export function PaymentsEntry(props: { onOpen: () => void }): ReactElement | null {
  const rights = useSeatRights()
  if (!rights.can('seePayments')) return null
  return (
    <button type="button" className="q3x-pay-entry" onClick={props.onOpen}>
      <Wallet size={24} weight="light" aria-hidden="true" />
      <span className="q3x-pay-entry-label">{PAY_WORDS.entry}</span>
    </button>
  )
}

interface Generated { url: string; am: string; payeeId: string; accountMode: boolean; billLine: string }

/** The QR as one SVG. Black on white on purpose: a scanner needs fixed contrast whatever the theme is. */
function QrSvg(props: { matrix: boolean[][]; label: string }): ReactElement {
  const { d, size } = matrixPath(props.matrix)
  return (
    <svg className="q3x-pay-qr-svg" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={props.label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="white" />
      <path d={d} fill="black" />
    </svg>
  )
}

export function PaymentsPage(props: { db: PhoneDb | null; payments?: PaymentsSync; qr?: QrPort | null; onChanged?: () => void; /** Phase 284: a bill to pay for (the Share QR sheet on a bill). */ bill?: BillQrInfo }): ReactElement {
  const { db, payments } = props
  const [stored, setStored] = useState<StoredPayments | null>(null)
  const [prefs, setPrefs] = useState<PaymentsPrefs>({ accountMode: false, lastPayeeId: null })
  const [picked, setPicked] = useState<BillQrInfo | null>(props.bill ?? null)
  const [amount, setAmount] = useState(props.bill?.amount ?? '')
  const [gen, setGen] = useState<Generated | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const rights = useSeatRights()
  const [editing, setEditing] = useState(false)
  const [full, setFull] = useState(false)
  const [busy, setBusy] = useState(false)
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false

  const reload = useCallback(async (): Promise<void> => {
    if (!db) return
    const [s, p] = await Promise.all([readPayments(db), readPaymentsPrefs(db)])
    setStored(s); setPrefs(p)
  }, [db])

  useEffect(() => {
    if (!db) return undefined
    let off = false
    void reload().then(async () => {
      if (!payments) return
      const r = await payments.refresh(true) // on open: never throws; the saved list stays when offline
      if (!off && r === 'updated') await reload()
    }, () => undefined)
    return () => { off = true }
  }, [db, payments, reload])

  if (!db) return <p className="q3-note q3-note-warn" role="alert">{PAY_WORDS.noDb}</p>
  if (!stored) return <p className="q3-muted" role="status">{PAY_WORDS.loading}</p>

  const list = stored.list
  const qr = props.qr === undefined ? getQrPort() : props.qr
  const accountMode = prefs.accountMode && hasAccountMode(list)
  const payee = pickPayee(list, accountMode, prefs.lastPayeeId)
  const tabs = visiblePayees(list, accountMode)
  const canWrite = db.canWrite()

  const savePrefs = (next: PaymentsPrefs): void => {
    setPrefs(next); setGen(null)
    if (canWrite) void writePaymentsPrefs(db, next).catch(() => undefined)
  }

  /** Keep an edit: publish when the phone may, else keep it on this phone. Returns the plain words for the editor. */
  const commit = async (next: PaymentsList): Promise<{ ok: boolean; words: string }> => {
    if (!rights.can('editPayments')) return { ok: false, words: ACTION_OFF_WORDS.editPayments }
    if (!canWrite) return { ok: false, words: 'Quot3 is open in another window, so nothing can be saved here.' }
    try {
      if (payments) {
        const r = await payments.publish(next)
        await reload(); setGen(null); props.onChanged?.()
        return r.ok ? { ok: true, words: PAY_WORDS.published } : { ok: false, words: r.words }
      }
      await writePayments(db, next, true)
      await reload(); setGen(null)
      return { ok: true, words: PAYMENTS_LOCAL_ONLY_WORDS }
    } catch {
      return { ok: false, words: 'Could not save. Try again.' }
    }
  }

  const refresh = async (): Promise<void> => {
    if (!payments) { setNote(PAYMENTS_LOCAL_ONLY_WORDS); return }
    setBusy(true)
    const r = await payments.refresh(true)
    await reload().catch(() => undefined)
    setBusy(false)
    setNote(r === 'updated' ? PAY_WORDS.refreshedNew : r === 'same' ? PAY_WORDS.refreshed : r === 'refused' ? PAY_WORDS.refusedRead : r === 'skipped' ? PAYMENTS_LOCAL_ONLY_WORDS : PAY_WORDS.refreshFailed)
  }

  const generate = (): void => {
    setNote(null); setWarn(null)
    if (!payee) { setWarn(PAY_WORDS.noPayees); return }
    const am = amountText(amount)
    if (!am.ok) { setWarn(am.words); return }
    const url = buildUpiUrl(payee, list.recipient, accountMode, am.value)
    if (!url) { setWarn(PAY_WORDS.noPayees); return }
    setGen({ url, am: am.value, payeeId: payee.id, accountMode, billLine: picked?.line ?? '' })
    if (canWrite) void writePaymentsPrefs(db, { ...prefs, lastPayeeId: payee.id }).catch(() => undefined)
  }

  const shown = gen && payee && gen.payeeId === payee.id && gen.accountMode === accountMode ? gen : null
  const matrix = shown && qr ? qr.matrix(shown.url) : null
  const labels = shown && payee ? qrLabels(payee, shown.am, shown.accountMode) : null

  const sendImage = async (mode: 'share' | 'save'): Promise<void> => {
    if (!shown || !labels) return
    if (!qr?.image) { setWarn(PAY_WORDS.noImage); return }
    setWarn(null)
    try {
      const logo = (await getSetting(db, 'company.profile').catch(() => null))?.logoDataUrl ?? null
      const img = await qr.image({ url: shown.url, payeeName: payee?.name ?? '', bankLabel: labels.bankLabel, amountLine: labels.amountLine, logoDataUrl: logo, ...(shown.billLine !== '' ? { billLine: shown.billLine } : {}) })
      if (!img) { setWarn(PAY_WORDS.noQr); return }
      const env = browserShareEnv()
      // Save = a normal download; Share = the system sheet (WhatsApp), falling back to a download.
      const res = await shareFile(mode === 'save' ? { ...env, nav: undefined } : env, img.bytes, img.fileName, 'image/png', 'Payment QR')
      setNote(res.outcome === 'cancelled' ? PAY_WORDS.cancelled : res.outcome === 'shared' ? PAY_WORDS.shared : PAY_WORDS.saved)
    } catch { setWarn(PAY_WORDS.noQr) }
  }

  if (editing) {
    return <PayeeEditor list={list} unpublished={stored.unpublished} onCommit={commit} onClose={() => setEditing(false)} />
  }

  return (
    <div className="q3x-pay-page">
      {!online ? <p className="q3x-pay-note" role="status">{PAY_WORDS.offline}</p> : null}
      {stored.unpublished ? <p className="q3x-pay-note" role="status">{PAYMENTS_LOCAL_ONLY_WORDS}</p> : null}

      {hasAccountMode(list) ? (
        <div className="q3x-pay-switch" data-on={accountMode ? 'true' : 'false'}>
          <span className="q3x-pay-switch-text">
            <span className="q3x-pay-switch-title">{PAY_WORDS.switchTitle}</span>
            <span className="q3x-pay-switch-sub" role="status">{accountMode ? PAY_WORDS.switchOn : PAY_WORDS.switchOff}</span>
          </span>
          <button type="button" role="switch" aria-checked={accountMode} aria-label={PAY_WORDS.switchTitle} className="q3x-pay-toggle"
            onClick={() => { const on = !accountMode; const next = pickPayee(list, on, prefs.lastPayeeId); savePrefs({ accountMode: on, lastPayeeId: next?.id ?? prefs.lastPayeeId }) }} />
        </div>
      ) : null}

      {tabs.length === 0 ? <p className="q3x-pay-empty" role="status">{PAY_WORDS.noPayees}</p> : (
        <ul className="q3x-pay-tabs" aria-label="Payee">
          {tabs.map((t) => (
            <li key={t.id} className="q3x-pay-tab-li">
              <button type="button" className="q3x-pay-tab" aria-pressed={t.id === payee?.id} onClick={() => savePrefs({ ...prefs, lastPayeeId: t.id })}>
                <span className="q3x-pay-tab-name">{t.name}</span>
                <span className="q3x-pay-tab-sub">{accountMode ? 'Bank account transfer' : (t.upiId ?? t.merchant?.pa ?? '')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!props.bill ? (
        <BillPicker db={db} picked={picked} onClear={() => { setPicked(null); setGen(null) }}
          onPick={(info) => { setPicked(info); setAmount(info.amount); setGen(null); setWarn(null); setNote(info.amount === '' ? PAY_WORDS.billNoAmount : null) }} />
      ) : null}
      {picked ? <p className="q3x-pay-note" role="note">{picked.amount === '' ? PAY_WORDS.billNoAmount : PAY_WORDS.billAmountNote}</p> : null}

      <label className="q3x-pay-field">
        <span className="q3x-pay-label">{PAY_WORDS.amountLabel}</span>
        <input className="q3x-pay-input" aria-label="Amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount}
          onChange={(e) => { setAmount(e.target.value); setWarn(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') generate() }} />
      </label>
      {warn ? <p className="q3x-pay-warn" role="alert">{warn}</p> : null}
      <button type="button" className="q3x-pay-primary" disabled={!payee} onClick={generate}>
        <QrCode size={22} weight="light" aria-hidden="true" /><span>{PAY_WORDS.generate}</span>
      </button>

      {shown && labels ? (
        <section className="q3x-pay-card" aria-label="QR code">
          <div className="q3x-pay-card-head">
            {shown.billLine !== '' ? <span className="q3x-pay-card-bill">{shown.billLine}</span> : null}
            <strong className="q3x-pay-card-amount">{labels.head}</strong>
            <span className="q3x-pay-card-payee">{labels.payee}</span>
            <span className="q3x-pay-card-scan">{PAY_WORDS.scan}</span>
          </div>
          {matrix ? <div className="q3x-pay-qr"><QrSvg matrix={matrix} label={`QR code for ${labels.payee}`} /></div> : <p className="q3x-pay-warn" role="status">{PAY_WORDS.noQr}</p>}
          <div className="q3x-pay-actions">
            {rights.can('shareBills') ? <button type="button" className="q3x-pay-btn" onClick={() => void sendImage('share')}><ShareNetwork size={20} weight="light" aria-hidden="true" /><span>{PAY_WORDS.share}</span></button> : null}
            {rights.can('shareBills') ? <button type="button" className="q3x-pay-btn" onClick={() => void sendImage('save')}><DownloadSimple size={20} weight="light" aria-hidden="true" /><span>{PAY_WORDS.save}</span></button> : <p className="q3x-pay-note" role="note">{ACTION_OFF_WORDS.shareBills}</p>}
            <button type="button" className="q3x-pay-btn" disabled={!matrix} onClick={() => setFull(true)}><ArrowsOut size={20} weight="light" aria-hidden="true" /><span>{PAY_WORDS.fullScreen}</span></button>
          </div>
        </section>
      ) : null}

      {note ? <p className="q3x-pay-note" role="status">{note}</p> : null}

      <div className="q3x-pay-actions">
        {rights.can('editPayments') ? <button type="button" className="q3x-pay-btn" onClick={() => setEditing(true)}><PencilSimple size={20} weight="light" aria-hidden="true" /><span>{PAY_WORDS.edit}</span></button> : null}
        <button type="button" className="q3x-pay-btn" disabled={busy} onClick={() => void refresh()}><ArrowsClockwise size={20} weight="light" aria-hidden="true" /><span>{PAY_WORDS.refresh}</span></button>
      </div>

      <BottomSheet open={full && matrix !== null} title={labels?.head ?? PAY_WORDS.title} onClose={() => setFull(false)}>
        {matrix && labels ? <div className="q3x-pay-full"><QrSvg matrix={matrix} label={`QR code for ${labels.payee}`} /><p className="q3x-pay-card-payee">{labels.payee}</p></div> : null}
      </BottomSheet>
    </div>
  )
}
