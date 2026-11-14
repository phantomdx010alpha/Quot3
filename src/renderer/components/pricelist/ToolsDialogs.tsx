import { useEffect, useMemo, useState } from 'react'
import { Button, Dialog, Field, Input, Select } from '../ui'
import { usePriceListStore } from '../../stores/priceListStore'
import { applyBulk, applyCategory, applyClean, applyFind, bulkValueOk, canUndoCategory, previewBulk, previewCategory, previewClean, previewFind, undoCategory, type BulkMode, type BulkScopeKind, type BulkSpec } from '../../stores/priceListTools'

const close = (): void => { const s = usePriceListStore.getState(); s.openDialog(null); s.ports.focusGrid?.() }
const SAMPLE = 5

/** Phase 239 - bulk price change: +% / +amount / fill one column from another (one time). Always shows what will change before it is applied. */
export function BulkDialog(): React.JSX.Element | null {
  const open = usePriceListStore((s) => s.dialog === 'bulk')
  const tree = usePriceListStore((s) => s.tree)
  const tabId = usePriceListStore((s) => s.tabId)
  const tab = useMemo(() => tree?.tabs.find((t) => t.id === tabId) ?? null, [tree, tabId])
  const cols = useMemo(() => (tab?.columns ?? []).filter((c) => c.role === 'price' || c.type === 'number'), [tab])
  const [mode, setMode] = useState<BulkMode>('percent')
  const [scope, setScope] = useState<BulkScopeKind>('tab')
  const [columnKey, setColumnKey] = useState('')
  const [fromKey, setFromKey] = useState('')
  const [value, setValue] = useState('')
  const [rounding, setRounding] = useState<'none' | 'two' | 'whole'>('two')
  const [overwrite, setOverwrite] = useState(false)
  const [result, setResult] = useState('')
  const [catPrev, setCatPrev] = useState<{ tab: string; changes: number }[] | null>(null)
  const [undoable, setUndoable] = useState(false)
  useEffect(() => { if (open) { setColumnKey(cols[0]?.key ?? ''); setFromKey(cols[1]?.key ?? cols[0]?.key ?? ''); setValue(''); setResult(''); setCatPrev(null); setUndoable(canUndoCategory()) } }, [open, cols])
  const spec: BulkSpec = { mode, scope, columnKey, fromKey, value, rounding, overwrite }
  const valid = bulkValueOk(value) && columnKey !== '' && (mode !== 'fill' || (fromKey !== '' && fromKey !== columnKey))
  const prev = useMemo(() => (open && valid && scope !== 'category' ? previewBulk({ mode, scope, columnKey, fromKey, value, rounding, overwrite }) : null), [open, valid, scope, mode, columnKey, fromKey, value, rounding, overwrite])
  useEffect(() => {
    setCatPrev(null)
    if (!open || !valid || scope !== 'category') return
    let live = true
    void previewCategory({ mode, scope, columnKey, fromKey, value, rounding, overwrite }).then((p) => { if (live) setCatPrev(p) })
    return () => { live = false }
  }, [open, valid, scope, mode, columnKey, fromKey, value, rounding, overwrite])
  const opts = cols.map((c) => ({ value: c.key, label: c.label }))
  const count = scope === 'category' ? (catPrev?.reduce((n, t) => n + t.changes, 0) ?? 0) : (prev?.changes.length ?? 0)
  const run = async (): Promise<void> => {
    const n = scope === 'category' ? await applyCategory(spec) : applyBulk(spec)
    setResult(n === 0 ? 'Nothing needed changing' : `${n} price${n === 1 ? '' : 's'} changed`)
    setUndoable(canUndoCategory())
  }
  const sample = prev?.changes.slice(0, SAMPLE) ?? []
  return (
    <Dialog open={open} title="Change prices in bulk" onClose={close} footer={<><Button onClick={close}>Close</Button><Button variant="primary" disabled={!valid || count === 0} onClick={() => { void run() }}>{count > 0 ? `Change ${count}` : 'Change'}</Button></>}>
      <div className="q3-plcols">
        <p className="q3-plcols__note">{mode === 'fill' ? 'Fills once from the other column. It is not a formula: later changes to either column do not follow.' : 'Empty and non-number cells are left alone. A price never goes below 0.'}</p>
        <div className="q3-plcols__add">
          <Select label="What" value={mode} onChange={(e) => setMode(e.target.value as BulkMode)} options={[{ value: 'percent', label: 'Add a percent' }, { value: 'amount', label: 'Add an amount' }, { value: 'fill', label: 'Fill from another column by percent' }]} />
          <Select label="Column" value={columnKey} onChange={(e) => setColumnKey(e.target.value)} options={opts} />
          {mode === 'fill' && <Select label="From column" value={fromKey} onChange={(e) => setFromKey(e.target.value)} options={opts} />}
          <Input data-autofocus label={mode === 'amount' ? 'Amount (use - to reduce)' : 'Percent (use - to reduce)'} value={value} inputMode="decimal" error={value !== '' && !bulkValueOk(value) ? 'Type a number like 10 or -2.5' : undefined} onChange={(e) => setValue(e.target.value)} />
          <Select label="Where" value={scope} onChange={(e) => setScope(e.target.value as BulkScopeKind)} options={[{ value: 'tab', label: 'This whole tab' }, { value: 'selection', label: 'Selected rows' }, { value: 'category', label: 'Every tab of this category' }]} />
          <Select label="Round to" value={rounding} onChange={(e) => setRounding(e.target.value as 'none' | 'two' | 'whole')} options={[{ value: 'two', label: '2 decimals' }, { value: 'whole', label: 'Whole numbers' }, { value: 'none', label: 'No rounding' }]} />
        </div>
        {mode === 'fill' && <label className="q3-plcols__note"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Also replace prices already there</label>}
        {valid && scope !== 'category' && prev && (
          <div role="status" aria-live="polite">
            <p className="q3-plcols__note">{prev.changes.length === 0 ? 'No price would change.' : `${prev.changes.length} price${prev.changes.length === 1 ? '' : 's'} will change${prev.skipped > 0 ? `, ${prev.skipped} skipped (empty or not a number)` : ''}. Ctrl+Z undoes it.`}</p>
            {sample.map((c) => <p key={c.rowId} className="q3-plcols__note">{c.before === '' ? '(empty)' : c.before} to {c.after}</p>)}
          </div>
        )}
        {valid && scope === 'category' && (
          <div role="status" aria-live="polite">
            {catPrev === null ? <p className="q3-plcols__note">Checking the tabs...</p> : catPrev.map((t) => <p key={t.tab} className="q3-plcols__note">{t.tab}: {t.changes} to change</p>)}
            <p className="q3-plcols__note">Other tabs are saved right away. Use Undo below to put them back.</p>
          </div>
        )}
        {result !== '' && <p className="q3-plcols__note" role="status">{result}</p>}
        {undoable && <div><Button size="sm" onClick={() => { void undoCategory().then(() => { setUndoable(false); setResult('Category change undone'); void usePriceListStore.getState().selectTab(usePriceListStore.getState().tabId ?? '') }) }}>Undo the last category change</Button></div>}
      </div>
    </Dialog>
  )
}

/** Phase 239 - find and replace (literal, never a pattern) plus name clean-up. */
export function FindDialog(): React.JSX.Element | null {
  const open = usePriceListStore((s) => s.dialog === 'find')
  const [find, setFind] = useState('')
  const [rep, setRep] = useState('')
  const [cs, setCs] = useState(false)
  const [names, setNames] = useState(true)
  const [cells, setCells] = useState(true)
  const [msgText, setMsgText] = useState('')
  useEffect(() => { if (open) { setMsgText('') } }, [open])
  const spec = { find, replace: rep, caseSensitive: cs, names, cells }
  const prev = open && find !== '' ? previewFind(spec) : null
  const total = prev ? prev.names.length + prev.cells.length : 0
  const dirty = open ? previewClean().length : 0
  return (
    <Dialog open={open} title="Find and replace" onClose={close} footer={<><Button onClick={close}>Close</Button><Button variant="primary" disabled={total === 0} onClick={() => { const n = applyFind(spec); setMsgText(`${n} change${n === 1 ? '' : 's'} made`) }}>{total > 0 ? `Replace ${total}` : 'Replace'}</Button></>}>
      <div className="q3-plcols">
        <div className="q3-plcols__add">
          <Input data-autofocus label="Find" value={find} onChange={(e) => setFind(e.target.value)} />
          <Input label="Replace with" value={rep} onChange={(e) => setRep(e.target.value)} />
        </div>
        <label className="q3-plcols__note"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Item names</label>
        <label className="q3-plcols__note"><input type="checkbox" checked={cells} onChange={(e) => setCells(e.target.checked)} /> Other text columns</label>
        <label className="q3-plcols__note"><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Match capital letters exactly</label>
        {find !== '' && <p className="q3-plcols__note" role="status" aria-live="polite">{total === 0 ? 'Nothing found in this tab.' : `${total} place${total === 1 ? '' : 's'} in this tab will change. Ctrl+Z undoes it.`}</p>}
        <div className="q3-plcols__add">
          <p className="q3-plcols__note">{dirty === 0 ? 'Names in this tab are already tidy.' : `${dirty} name${dirty === 1 ? ' has' : 's have'} extra spaces or line breaks.`}</p>
          <Button size="sm" disabled={dirty === 0} onClick={() => { const n = applyClean(); setMsgText(`${n} name${n === 1 ? '' : 's'} tidied`) }}>Tidy names</Button>
        </div>
        {msgText !== '' && <p className="q3-plcols__note" role="status">{msgText}</p>}
      </div>
    </Dialog>
  )
}
