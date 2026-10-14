import { useCallback, useEffect, useRef, useState } from 'react'
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { PARTY_FIELD_LABEL, atEndEdge, type PartyField } from '@shared/partyFields'
import { primaryKeys } from '@shared/shortcuts'
import { Tooltip } from '../ui'
import { partyToSnapshot, type PartyLite } from '@shared/party/partyLite'
import { FormatSwitcher } from './FormatSwitcher'
import { ImportedNote } from './ImportedNote'
import { PartyAutocomplete } from './PartyAutocomplete'
import { BranchPicker } from './BranchPicker'
import { resolveFormat } from '@shared/format/registry'
import { usePartyIndexStore } from '../../stores/partyIndexStore'
import { useBillStore } from '../../stores/billStore'
import { usePartyUiStore } from '../../stores/partyUiStore'
import { setShownPoPreview } from '../../stores/poPreview'
import { runRedo, runUndo } from '../../stores/undoActions'

type TextField = Exclude<PartyField, 'address'>
const FLOW: readonly TextField[] = ['name', 'phone', 'transport']

/** The next bill number, shown read-only: the bill's own once saved, otherwise the DB's preview (never allocated here — Phase 27 allocates inside the save transaction). */
function useNextPo(): string {
  const own = useBillStore((s) => s.poNumber)
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (own) return
    let live = true
    // Phase 154: re-read the preview whenever this window is focused again, because another window may have saved meanwhile.
    const load = (): void => {
      try {
        const app = (window as unknown as { quot3?: { app?: { getDbInfo?: () => Promise<{ ok: boolean; data?: { nextPoPreview?: string } }> } } }).quot3?.app
        void app?.getDbInfo?.().then((r) => { if (live && r.ok && r.data?.nextPoPreview) { setPreview(r.data.nextPoPreview); setShownPoPreview(r.data.nextPoPreview) } }).catch(() => undefined)
      } catch { /* no bridge (tests / design preview) */ }
    }
    load()
    window.addEventListener('focus', load)
    return () => { live = false; window.removeEventListener('focus', load) }
  }, [own])
  return own || preview
}

/**
 * Phase 25 — the compact party/detail bar (KB §7): Party name, Phone, Transport, Date, a read-only PO preview and the
 * format indicator on ONE row; the address lives behind a pull-down (chevron / Alt+Down, closes with Esc / Alt+Up) so the
 * bar stays ≤ ~72 px. Field flow: Right at the end edge of the text, Enter or Tab → next field; Shift+Tab → back; from
 * Transport the same keys drop into the grid at row 1 / Item Name. Every edit is a `billStore` action, so it is one undo
 * entry (coalesced per field) and Ctrl+Z / Ctrl+Y work from inside the fields (the native input undo is suppressed).
 */
export function PartyBar({ onLeaveToGrid }: { onLeaveToGrid: () => void }): React.JSX.Element {
  const party = useBillStore((s) => s.party)
  // Phase 149: a format with `partyMode: 'branch'` (Stock transfer) asks for a branch instead of the party fields. Data-driven, no format-name test.
  const branchMode = useBillStore((s) => resolveFormat(s.formatId).partyMode === 'branch')
  const branchRef = useRef<HTMLSelectElement | null>(null)
  const branchModeRef = useRef(branchMode)
  branchModeRef.current = branchMode
  const billDate = useBillStore((s) => s.billDate)
  const setPartyField = useBillStore((s) => s.setPartyField)
  const setBillDate = useBillStore((s) => s.setBillDate)
  const applyParty = useBillStore((s) => s.applyParty)
  const addressOpen = usePartyUiStore((s) => s.addressOpen)
  const setAddressOpen = usePartyUiStore((s) => s.setAddressOpen)
  const po = useNextPo()
  const refs = useRef<Record<TextField, HTMLInputElement | null>>({ name: null, phone: null, transport: null })
  const dateRef = useRef<HTMLInputElement | null>(null)
  const addrRef = useRef<HTMLTextAreaElement | null>(null)
  const wantAddrFocus = useRef(false)
  const lastField = useRef<TextField>('transport')

  // The saved parties are fetched once; searching them is local.
  useEffect(() => { if (!usePartyIndexStore.getState().loaded) void usePartyIndexStore.getState().load() }, [])

  const focusField = useCallback((f: TextField) => { (branchModeRef.current ? branchRef.current : refs.current[f])?.focus() }, [])

  const openAddress = useCallback(() => { wantAddrFocus.current = true; setAddressOpen(true); addrRef.current?.focus() }, [setAddressOpen])
  const closeAddress = useCallback(() => {
    const was = usePartyUiStore.getState().addressOpen
    setAddressOpen(false)
    if (was) focusField(lastField.current) // keep the keyboard where the owner was
  }, [setAddressOpen, focusField])

  useEffect(() => {
    if (addressOpen && wantAddrFocus.current) { wantAddrFocus.current = false; addrRef.current?.focus() }
  }, [addressOpen])

  useEffect(() => {
    const port = {
      focusParty: () => focusField('name'),
      focusDate: () => dateRef.current?.focus(),
      openAddress,
      closeAddress
    }
    usePartyUiStore.setState(port)
    return () => {
      if (usePartyUiStore.getState().focusParty === port.focusParty) usePartyUiStore.setState({ focusParty: null, focusDate: null, openAddress: null, closeAddress: null, addressOpen: false })
    }
  }, [focusField, openAddress, closeAddress])

  /** Keys shared by every field in the bar. Returns true when the key was consumed. */
  const common = (e: React.KeyboardEvent): boolean => {
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) {
      e.preventDefault()
      if (k === 'y' || e.shiftKey) runRedo(); else runUndo()
      return true
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown') { e.preventDefault(); openAddress(); return true }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowUp') { e.preventDefault(); closeAddress(); return true }
    if (e.key === 'Escape' && usePartyUiStore.getState().addressOpen) { e.preventDefault(); closeAddress(); return true }
    return false
  }

  const next = (f: TextField): void => {
    const i = FLOW.indexOf(f)
    if (i < FLOW.length - 1) focusField(FLOW[i + 1] as TextField); else onLeaveToGrid()
  }
  const prev = (f: TextField): void => { const i = FLOW.indexOf(f); if (i > 0) focusField(FLOW[i - 1] as TextField) }

  const onFieldKey = (f: TextField) => (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (common(e)) return
    const el = e.currentTarget
    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) prev(f); else next(f)
    } else if (e.key === 'Enter') {
      e.preventDefault(); next(f)
    } else if (e.key === 'ArrowRight' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && atEndEdge(el.value, el.selectionStart, el.selectionEnd)) {
      e.preventDefault(); next(f)
    }
  }

  /** Picking a suggestion fills phone / transport / address in ONE undo step, then carries on at Phone. */
  const pickParty = (p: PartyLite): void => { applyParty(partyToSnapshot(p)); focusField('phone') }

  const text = (f: TextField, className = ''): React.JSX.Element => (
    <label className={`q3-pbar__f ${className}`.trim()}>
      <span className="q3-pbar__l">{PARTY_FIELD_LABEL[f]}</span>
      <input
        ref={(el) => { refs.current[f] = el }} className="q3-input q3-pbar__in" type="text" value={party[f]} autoComplete="off" spellCheck={false}
        data-party-field={f} onFocus={() => { lastField.current = f }}
        onChange={(e) => setPartyField(f, e.target.value)} onKeyDown={onFieldKey(f)}
      />
    </label>
  )

  const addrKeys = primaryKeys('create.address')
  return (
    <div className="q3-pbar" role="group" aria-label="Party details">
      <div className="q3-pbar__row">
        {branchMode ? (
          <BranchPicker
            value={party.name} selectRef={(el) => { branchRef.current = el }} onChange={(v) => setPartyField('name', v)}
            onFocus={() => { lastField.current = 'name' }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); onLeaveToGrid(); return }
              const k = e.key.toLowerCase()
              if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) { e.preventDefault(); if (k === 'y' || e.shiftKey) runRedo(); else runUndo() }
            }}
          />
        ) : (
          <>
            <PartyAutocomplete
              className="q3-pbar__f--name" value={party.name} inputRef={(el) => { refs.current.name = el }}
              onValueChange={(v) => setPartyField('name', v)} onPick={pickParty} onKeyDown={onFieldKey('name')}
              onFocus={() => { lastField.current = 'name' }}
            />
            {text('phone', 'q3-pbar__f--phone')}
            {text('transport', 'q3-pbar__f--transport')}
          </>
        )}
        <label className="q3-pbar__f q3-pbar__f--date">
          <span className="q3-pbar__l">Date</span>
          <input
            ref={dateRef} className="q3-input q3-pbar__in" type="date" value={billDate} data-party-field="date"
            onChange={(e) => setBillDate(e.target.value)}
            onKeyDown={(e) => { if (common(e)) return; if (e.key === 'Enter') { e.preventDefault(); onLeaveToGrid() } }}
          />
        </label>
        <div className="q3-pbar__f q3-pbar__f--po" title="Next bill number — allocated when the bill is saved">
          <span className="q3-pbar__l">PO</span>
          <span className="q3-pbar__po" data-testid="po-preview">{po || '—'}</span>
        </div>
        <ImportedNote />
        <div className="q3-pbar__f q3-pbar__f--fmt">
          <span className="q3-pbar__l">Format</span>
          <FormatSwitcher />
        </div>
        {branchMode ? null : <Tooltip label={addressOpen ? 'Hide address' : 'Show address'} {...(addrKeys ? { shortcut: addrKeys } : {})}>
          <button
            type="button" className="q3-pbar__addr" tabIndex={-1} aria-expanded={addressOpen} aria-controls="q3-pbar-address"
            data-filled={party.address ? '1' : undefined}
            onClick={() => { if (addressOpen) closeAddress(); else openAddress() }}
          >
            Address {addressOpen ? <CaretUp weight="bold" size={12} /> : <CaretDown weight="bold" size={12} />}
          </button>
        </Tooltip>}
      </div>
      {addressOpen && !branchMode ? (
        <div className="q3-pbar__panel" id="q3-pbar-address" role="region" aria-label="Party address">
          <textarea
            ref={addrRef} className="q3-input q3-pbar__area" rows={3} value={party.address} spellCheck={false} data-party-field="address"
            onChange={(e) => setPartyField('address', e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (common(e)) return
              if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) focusField('transport'); else { setAddressOpen(false); onLeaveToGrid() } }
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
