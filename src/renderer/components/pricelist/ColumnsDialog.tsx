import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeSlash, Plus, Trash } from '@phosphor-icons/react'
import { PRICELIST_LIMITS, type ColumnRole, type PriceColumn } from '@shared/pricelist/types'
import { Button, Dialog, Input, Select } from '../ui'
import { usePriceListStore } from '../../stores/priceListStore'

const TYPES = [{ value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'choice', label: 'Choice' }]
const ADD_ROLES: { value: ColumnRole; label: string }[] = [{ value: 'price', label: 'Price (uses a price level)' }, { value: 'unit', label: 'Unit' }, { value: 'note', label: 'Note' }, { value: 'other', label: 'Other' }]

function LabelBox({ col }: { col: PriceColumn }): React.JSX.Element {
  const [text, setText] = useState(col.label)
  useEffect(() => setText(col.label), [col.label])
  const done = (): void => { if (text.trim() !== '' && text !== col.label) void usePriceListStore.getState().columnsOp({ action: 'rename', key: col.key, label: text }); else setText(col.label) }
  return <Input aria-label={`Name of ${col.label}`} value={text} disabled={col.role === 'name'} onChange={(e) => setText(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); done() } }} />
}

/** Phase 238 - the columns of the open tab: rename, type, price level, hide, move, remove, add (max 12; the item-name column is fixed). */
export function ColumnsDialog(): React.JSX.Element | null {
  const open = usePriceListStore((s) => s.dialog === 'columns')
  const tree = usePriceListStore((s) => s.tree)
  const tabId = usePriceListStore((s) => s.tabId)
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<ColumnRole>('price')
  const [tier, setTier] = useState('')
  const st = usePriceListStore.getState
  const tab = tree?.tabs.find((t) => t.id === tabId) ?? null
  const tiers = tree?.tiers ?? []
  const cols = tab?.columns ?? []
  const tierOptions = tiers.map((t) => ({ value: t.key, label: t.label }))
  const close = (): void => { st().openDialog(null); st().ports.focusGrid?.() }
  const add = async (): Promise<void> => {
    const ok = await st().columnsOp({ action: 'add', label, role, type: role === 'price' ? 'number' : 'text', ...(role === 'price' ? { tier: tier || tiers[0]?.key || '' } : {}) })
    if (ok) setLabel('')
  }
  return (
    <Dialog open={open} wide title={`Columns of ${tab?.name ?? ''}`} onClose={close} footer={<Button variant="primary" onClick={close}>Done</Button>}>
      <div className="q3-plcols">
        {cols.map((c, i) => (
          <div key={c.key} className="q3-plcols__row" data-hidden={c.hidden ? '' : undefined}>
            <LabelBox col={c} />
            {c.role === 'name' ? <span className="q3-plcols__fixed">Item name (always first)</span> : (
              <>
                {c.role === 'price'
                  ? <Select aria-label={`Price level of ${c.label}`} options={tierOptions} value={c.tier ?? ''} onChange={(e) => { void st().columnsOp({ action: 'update', key: c.key, patch: { tier: e.target.value } }) }} />
                  : <Select aria-label={`Type of ${c.label}`} options={TYPES} value={c.type} onChange={(e) => { void st().columnsOp({ action: 'update', key: c.key, patch: { type: e.target.value as PriceColumn['type'] } }) }} />}
                <Button size="sm" icon={c.hidden ? EyeSlash : Eye} title={c.hidden ? 'Hidden: show it' : 'Shown: hide it'} aria-label={c.hidden ? `Show ${c.label}` : `Hide ${c.label}`} onClick={() => { void st().columnsOp({ action: 'update', key: c.key, patch: { hidden: !c.hidden } }) }} />
                <Button size="sm" icon={ArrowUp} disabled={i <= 1} aria-label={`Move ${c.label} left`} onClick={() => { void st().columnsOp({ action: 'move', key: c.key, toIndex: i - 1 }) }} />
                <Button size="sm" icon={ArrowDown} disabled={i >= cols.length - 1} aria-label={`Move ${c.label} right`} onClick={() => { void st().columnsOp({ action: 'move', key: c.key, toIndex: i + 1 }) }} />
                <Button size="sm" variant="danger" icon={Trash} aria-label={`Remove ${c.label}`} title="Remove the column (its values in this tab are dropped)" onClick={() => { void st().columnsOp({ action: 'remove', key: c.key }) }} />
              </>
            )}
          </div>
        ))}
        <div className="q3-plcols__add">
          <Input label="New column" value={label} placeholder="Name" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && label.trim() !== '') { e.preventDefault(); void add() } }} />
          <Select label="Kind" options={ADD_ROLES} value={role} onChange={(e) => setRole(e.target.value as ColumnRole)} />
          {role === 'price' && <Select label="Price level" options={tierOptions} value={tier || tiers[0]?.key || ''} onChange={(e) => setTier(e.target.value)} />}
          <Button icon={Plus} disabled={label.trim() === '' || cols.length >= PRICELIST_LIMITS.maxColumns} onClick={() => { void add() }}>Add</Button>
        </div>
        <p className="q3-plcols__note">{cols.length} of {PRICELIST_LIMITS.maxColumns} columns. Drag a column border in the table to change its width.</p>
      </div>
    </Dialog>
  )
}
