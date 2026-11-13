import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Copy, PencilSimple, Plus, X } from '@phosphor-icons/react'
import { Button, ConfirmDialog } from '../ui'
import { usePriceListStore } from '../../stores/priceListStore'
import { usePriceRightsStore } from '../../stores/priceRightsStore'
import { NamePrompt } from './NamePrompt'

type Prompt = null | { kind: 'add' } | { kind: 'rename'; id: string; name: string }

/** Phase 238 - the tab strip of the open category: a red x on each tab, "+ Tab", rename (button), duplicate, move earlier / later. */
export function TabStrip(): React.JSX.Element {
  const tree = usePriceListStore((s) => s.tree)
  const categoryId = usePriceListStore((s) => s.categoryId)
  const tabId = usePriceListStore((s) => s.tabId)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [del, setDel] = useState<string | null>(null)
  const st = usePriceListStore.getState
  const rights = usePriceRightsStore((s) => s.flags)
  const tabs = (tree?.tabs ?? []).filter((t) => t.categoryId === categoryId)
  const cur = tabs.find((t) => t.id === tabId) ?? null
  const idx = cur ? tabs.findIndex((t) => t.id === cur.id) : -1
  useEffect(() => {
    st().setPorts({ askAddTab: () => { if (usePriceListStore.getState().categoryId) setPrompt({ kind: 'add' }) } })
    return () => st().setPorts({ askAddTab: null })
  }, [st])
  const noCat = categoryId === null
  return (
    <div className="q3-pltabs" role="tablist" aria-label="Tabs">
      {tabs.map((t) => (
        <div key={t.id} className="q3-pltab" role="tab" aria-selected={t.id === tabId} data-active={t.id === tabId ? '' : undefined}>
          <button type="button" className="q3-pltab__name" onMouseDown={(e) => e.preventDefault()} onClick={() => { void st().selectTab(t.id) }} title={t.name}>{t.name}</button>
          <button type="button" className="q3-pltab__x" disabled={!rights.delete} aria-label={`Delete tab ${t.name}`} title="Delete the tab (goes to Trash)" onMouseDown={(e) => e.preventDefault()} onClick={() => setDel(t.id)}><X size={12} weight="bold" /></button>
        </div>
      ))}
      <Button size="sm" icon={Plus} disabled={noCat || !rights.structure} title="Add a tab (Ctrl+Alt+A)" onMouseDown={(e) => e.preventDefault()} onClick={() => setPrompt({ kind: 'add' })}>Tab</Button>
      <span className="q3-pltabs__tools">
        <Button size="sm" icon={PencilSimple} disabled={!cur || !rights.structure} title="Rename the tab" aria-label="Rename tab" onMouseDown={(e) => e.preventDefault()} onClick={() => cur && setPrompt({ kind: 'rename', id: cur.id, name: cur.name })} />
        <Button size="sm" icon={Copy} disabled={!cur || !rights.structure || !rights.add} title="Duplicate the tab with its items" aria-label="Duplicate tab" onMouseDown={(e) => e.preventDefault()} onClick={() => cur && void st().structure({ op: 'duplicateTab', id: cur.id })} />
        <Button size="sm" icon={ArrowLeft} disabled={!cur || idx <= 0 || !rights.structure} title="Move the tab earlier" aria-label="Move tab earlier" onMouseDown={(e) => e.preventDefault()} onClick={() => cur && void st().structure({ op: 'reorderTab', id: cur.id, toIndex: idx - 1 })} />
        <Button size="sm" icon={ArrowRight} disabled={!cur || idx < 0 || idx >= tabs.length - 1 || !rights.structure} title="Move the tab later" aria-label="Move tab later" onMouseDown={(e) => e.preventDefault()} onClick={() => cur && void st().structure({ op: 'reorderTab', id: cur.id, toIndex: idx + 1 })} />
      </span>
      <NamePrompt open={prompt !== null} title={prompt?.kind === 'rename' ? 'Rename tab' : 'New tab'} label="Tab name" initial={prompt?.kind === 'rename' ? prompt.name : ''} confirmLabel={prompt?.kind === 'rename' ? 'Rename' : 'Add'}
        onCancel={() => { setPrompt(null); st().ports.focusGrid?.() }}
        onSubmit={async (name) => {
          const p = prompt
          if (!p || !categoryId) return null
          // A new tab copies the columns of the open tab, so the owner's layout carries over.
          const err = await st().structure(p.kind === 'add' ? { op: 'addTab', categoryId, name, ...(tabId ? { copyColumnsFromTabId: tabId } : {}) } : { op: 'renameTab', id: p.id, name })
          if (!err) { setPrompt(null); st().ports.focusGrid?.() }
          return err
        }} />
      <ConfirmDialog open={del !== null} danger title="Delete tab" confirmLabel="Delete" message={<>Delete the tab "{tabs.find((t) => t.id === del)?.name ?? ''}" and all its items? They go to Trash and can be restored.</>}
        onCancel={() => setDel(null)} onConfirm={() => { const id = del; setDel(null); if (id) void st().structure({ op: 'deleteTab', id }) }} />
    </div>
  )
}
