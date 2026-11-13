import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react'
import type { PriceTier } from '@shared/pricelist/types'
import { Button, ConfirmDialog, Dialog, Input } from '../ui'
import { usePriceListStore } from '../../stores/priceListStore'

function TierLabel({ tier }: { tier: PriceTier }): React.JSX.Element {
  const [text, setText] = useState(tier.label)
  const [err, setErr] = useState('')
  useEffect(() => setText(tier.label), [tier.label])
  const done = async (): Promise<void> => {
    if (text.trim() === '' || text === tier.label) { setText(tier.label); return }
    const e = await usePriceListStore.getState().structure({ op: 'renameTier', key: tier.key, label: text })
    if (e) { setErr(e); setText(tier.label) } else setErr('')
  }
  return <Input aria-label={`Name of ${tier.label}`} value={text} error={err} onChange={(e) => setText(e.target.value)} onBlur={() => { void done() }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void done() } }} />
}

/** Phase 238 - the price levels (tiers) the whole Price List shares. Billing asks for a level, never for a column name. Renaming changes the label only. */
export function TiersDialog(): React.JSX.Element | null {
  const open = usePriceListStore((s) => s.dialog === 'tiers')
  const tree = usePriceListStore((s) => s.tree)
  const [label, setLabel] = useState('')
  const [err, setErr] = useState('')
  const [del, setDel] = useState<string | null>(null)
  const st = usePriceListStore.getState
  const tiers = tree?.tiers ?? []
  const close = (): void => { st().openDialog(null); st().ports.focusGrid?.() }
  const add = async (): Promise<void> => {
    const e = await st().structure({ op: 'addTier', label })
    if (e) setErr(e); else { setLabel(''); setErr('') }
  }
  const used = (key: string): number => (tree?.tabs ?? []).filter((t) => t.columns.some((c) => c.tier === key)).length
  return (
    <Dialog open={open} title="Price levels" onClose={close} footer={<Button variant="primary" onClick={close}>Done</Button>}>
      <div className="q3-plcols">
        <p className="q3-plcols__note">A price level is a kind of price, like "cash w/o". Tabs may have different columns; billing looks for the level.</p>
        {tiers.map((t, i) => (
          <div key={t.id} className="q3-plcols__row">
            <TierLabel tier={t} />
            <span className="q3-plcols__fixed">{used(t.key)} tab(s)</span>
            <Button size="sm" icon={ArrowUp} disabled={i === 0} aria-label={`Move ${t.label} up`} onClick={() => { void st().structure({ op: 'reorderTier', key: t.key, toIndex: i - 1 }) }} />
            <Button size="sm" icon={ArrowDown} disabled={i >= tiers.length - 1} aria-label={`Move ${t.label} down`} onClick={() => { void st().structure({ op: 'reorderTier', key: t.key, toIndex: i + 1 }) }} />
            <Button size="sm" variant="danger" icon={Trash} aria-label={`Remove ${t.label}`} onClick={() => setDel(t.key)} />
          </div>
        ))}
        <div className="q3-plcols__add">
          <Input label="New price level" value={label} error={err} placeholder="Name" onChange={(e) => { setLabel(e.target.value); setErr('') }} onKeyDown={(e) => { if (e.key === 'Enter' && label.trim() !== '') { e.preventDefault(); void add() } }} />
          <Button icon={Plus} disabled={label.trim() === ''} onClick={() => { void add() }}>Add</Button>
        </div>
      </div>
      <ConfirmDialog open={del !== null} danger title="Remove price level" confirmLabel="Remove" message={<>Remove "{tiers.find((t) => t.key === del)?.label ?? ''}"? Columns that use it keep their values but no longer count as that level for billing.</>}
        onCancel={() => setDel(null)} onConfirm={() => { const k = del; setDel(null); if (k) void st().structure({ op: 'removeTier', key: k }) }} />
    </Dialog>
  )
}
