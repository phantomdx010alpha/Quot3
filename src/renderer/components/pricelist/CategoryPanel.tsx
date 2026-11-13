import { useState } from 'react'
import { ArrowDown, ArrowUp, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { Button, ConfirmDialog } from '../ui'
import { usePriceListStore } from '../../stores/priceListStore'
import { usePriceRightsStore } from '../../stores/priceRightsStore'
import { NamePrompt } from './NamePrompt'

type Prompt = null | { kind: 'add' } | { kind: 'rename'; id: string; name: string }

/** Phase 238 - the category side panel (collapsible from the page): pick, add, rename, reorder, delete (to Trash). */
export function CategoryPanel(): React.JSX.Element {
  const tree = usePriceListStore((s) => s.tree)
  const categoryId = usePriceListStore((s) => s.categoryId)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [del, setDel] = useState<string | null>(null)
  const rights = usePriceRightsStore((s) => s.flags)
  const cats = tree?.categories ?? []
  const cur = cats.find((c) => c.id === categoryId) ?? null
  const idx = cur ? cats.findIndex((c) => c.id === cur.id) : -1
  const st = usePriceListStore.getState
  const tabsIn = (id: string): number => (tree?.tabs ?? []).filter((t) => t.categoryId === id).length
  return (
    <aside className="q3-plcat" aria-label="Categories">
      <div className="q3-plcat__head">
        <span className="q3-plcat__title">Categories</span>
        <Button size="sm" icon={Plus} disabled={!rights.structure} title="Add a category" onMouseDown={(e) => e.preventDefault()} onClick={() => setPrompt({ kind: 'add' })}>Add</Button>
      </div>
      <ul className="q3-plcat__list" role="listbox" aria-label="Categories">
        {cats.map((c) => (
          <li key={c.id} role="option" aria-selected={c.id === categoryId}>
            <button type="button" className="q3-plcat__item" data-active={c.id === categoryId ? '' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => { void st().selectCategory(c.id) }}>
              <span className="q3-plcat__name">{c.name}</span>
              <span className="q3-plcat__count">{tabsIn(c.id)}</span>
            </button>
          </li>
        ))}
        {cats.length === 0 && <li className="q3-plcat__empty">No categories yet.</li>}
      </ul>
      <div className="q3-plcat__tools">
        <Button size="sm" icon={PencilSimple} disabled={!cur || !rights.structure} title="Rename the category" onMouseDown={(e) => e.preventDefault()} onClick={() => cur && setPrompt({ kind: 'rename', id: cur.id, name: cur.name })} aria-label="Rename category" />
        <Button size="sm" icon={ArrowUp} disabled={!cur || idx <= 0 || !rights.structure} title="Move up" onMouseDown={(e) => e.preventDefault()} onClick={() => cur && void st().structure({ op: 'reorderCategory', id: cur.id, toIndex: idx - 1 })} aria-label="Move category up" />
        <Button size="sm" icon={ArrowDown} disabled={!cur || idx < 0 || idx >= cats.length - 1 || !rights.structure} title="Move down" onMouseDown={(e) => e.preventDefault()} onClick={() => cur && void st().structure({ op: 'reorderCategory', id: cur.id, toIndex: idx + 1 })} aria-label="Move category down" />
        <Button size="sm" variant="danger" icon={Trash} disabled={!cur || !rights.delete} title="Delete the category (goes to Trash)" onMouseDown={(e) => e.preventDefault()} onClick={() => cur && setDel(cur.id)} aria-label="Delete category" />
      </div>
      <NamePrompt open={prompt !== null} title={prompt?.kind === 'rename' ? 'Rename category' : 'New category'} label="Category name" initial={prompt?.kind === 'rename' ? prompt.name : ''} confirmLabel={prompt?.kind === 'rename' ? 'Rename' : 'Add'}
        onCancel={() => { setPrompt(null); st().ports.focusGrid?.() }}
        onSubmit={async (name) => {
          const p = prompt
          if (!p) return null
          const err = await st().structure(p.kind === 'add' ? { op: 'addCategory', name } : { op: 'renameCategory', id: p.id, name })
          if (!err) { setPrompt(null); st().ports.focusGrid?.() }
          return err
        }} />
      <ConfirmDialog open={del !== null} danger title="Delete category" confirmLabel="Delete" message={<>Delete "{cats.find((c) => c.id === del)?.name ?? ''}" with its {del ? tabsIn(del) : 0} tab(s) and all their items? They go to Trash and can be restored.</>}
        onCancel={() => setDel(null)} onConfirm={() => { const id = del; setDel(null); if (id) void st().structure({ op: 'deleteCategory', id }) }} />
    </aside>
  )
}
