import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTIONS, SHORTCUTS, allActions, allShortcuts, findShortcutConflicts, primaryKeys, type ActionId } from '../shared/shortcuts'
import { ROUTES } from '../shared/routes'

/**
 * Phase 67 - the automated half of the keyboard-only acceptance pass. Pure / source checks: no window, no mouse.
 * Rule under test (CLAUDE_MUST_READ 4.7): every action is reachable with the keyboard alone, has ONE registry entry, shows in the
 * palette, the Settings list and the F1 sheet, and does something (a handler exists).
 */
const root = resolve(__dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8')

/** Actions that have no key of their own and are reached through the palette (Ctrl+K). Adding to this list is a conscious decision. */
const PALETTE_ONLY: readonly string[] = [
  // developer pages
  'dev.designPreview', 'dev.grid', 'dev.perf', 'dev.printPreview',
  // History: focus jumps / filters / trash helpers (the History page itself has its own arrow / Enter / Delete keys)
  'history.focusDates', 'history.focusBills', 'history.refresh', 'history.dateRange', 'history.clearFilters', 'history.restore', 'history.purge',
  // Settings sections and one-off tools
  'settings.company', 'settings.branch', 'settings.print', 'settings.behaviour', 'settings.themes', 'settings.appearance', 'settings.shortcuts',
  'settings.backup', 'settings.fresh', 'settings.sync', 'settings.joinBranch', 'settings.audit', 'settings.updates', 'settings.about',
  'updates.check', 'diagnostics.copy', 'sync.keepMine', 'sync.loadTheirs', 'sync.toggle', 'sync.now', 'sync.compare', 'sync.renameBranch',
  // Create
  'grid.red', 'grid.deleteRows', 'grid.moveRowTop', 'grid.moveRowBottom', 'draft.recover', 'output.pdfRough', 'output.pdfPro', 'output.openPdf', 'customers.unify'
]

function actionIdUnion(): string[] {
  const src = read('src/shared/shortcuts.ts')
  const block = src.slice(src.indexOf('export type ActionId ='), src.indexOf('export type ActionGroup'))
  return [...block.matchAll(/\|\s*'([A-Za-z0-9.]+)'/g)].map((m) => m[1]!)
}
function handlerKeys(): string[] {
  const src = read('src/renderer/hooks/useAppActions.ts')
  return [...src.matchAll(/^\s*'([A-Za-z]+\.[A-Za-z0-9]+)':/gm)].map((m) => m[1]!)
}
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p, out) } else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('Phase 67 - the action registry is complete and consistent', () => {
  it('every ActionId in the type has exactly one ACTIONS entry, and no entry is missing from the type', () => {
    const union = actionIdUnion().filter((id) => !id.startsWith('format.set'))
    const ids = ACTIONS.map((a) => a.id as string)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([...union].sort())
  })
  it('action labels are unique (two palette rows must never look the same)', () => {
    const labels = allActions().map((a) => a.label.toLowerCase())
    expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([])
  })
  it('every shortcut points at a real action and no two bindings collide', () => {
    const ids = new Set(allActions().map((a) => a.id))
    expect(allShortcuts().filter((s) => !ids.has(s.action))).toEqual([])
    expect(findShortcutConflicts()).toEqual([])
    const sid = SHORTCUTS.map((s) => s.id)
    expect(new Set(sid).size).toBe(sid.length)
  })
  it('every action has a handler in useAppActions, and every handler belongs to a registered action (nothing in the palette does nothing)', () => {
    const handlers = new Set(handlerKeys())
    const ids = ACTIONS.map((a) => a.id as string)
    expect(ids.filter((id) => !handlers.has(id))).toEqual([])
    expect([...handlers].filter((h) => !ids.includes(h))).toEqual([])
  })
  it('an action without a key of its own is on the reviewed palette-only list; nothing else is keyless', () => {
    const keyed = new Set(allShortcuts().map((s) => s.action as string))
    const keyless = allActions().map((a) => a.id as string).filter((id) => !keyed.has(id))
    expect([...keyless].sort()).toEqual([...PALETTE_ONLY].sort())
  })
  it('the palette itself, help and the five pages are reachable by key from anywhere', () => {
    for (const a of ['palette.open', 'help.shortcuts', 'nav.dashboard', 'nav.create', 'nav.history', 'nav.customers', 'nav.items', 'nav.settings', 'nav.back', 'bill.new', 'bill.save'] as ActionId[]) {
      expect(primaryKeys(a), a).toBeTruthy()
    }
    // F1 and Ctrl+/ both open the sheet
    expect(allShortcuts().filter((s) => s.action === 'help.shortcuts').map((s) => s.keys).sort()).toEqual(['Ctrl+/', 'F1'])
  })
  it('every real page has a navigation action with a key (dev pages are palette-only on purpose)', () => {
    const nav: Record<string, ActionId> = { [ROUTES.dashboard]: 'nav.dashboard', [ROUTES.create]: 'nav.create', [ROUTES.history]: 'nav.history', [ROUTES.customers]: 'nav.customers', [ROUTES.items]: 'nav.items', [ROUTES.settings]: 'nav.settings' }
    for (const [route, action] of Object.entries(nav)) expect(primaryKeys(action), route).toBeTruthy()
    const dev = Object.values(ROUTES).filter((r) => r.startsWith('/dev/'))
    expect(dev).toHaveLength(4)
  })
  it('the core bill, history, customers and output actions all have keys', () => {
    const must: ActionId[] = [
      'create.focusParty', 'create.focusDate', 'create.address', 'edit.undo', 'edit.redo', 'edit.revert', 'edit.historyPanel',
      'cols.add', 'cols.remove', 'cols.rename', 'units.mark', 'units.summary', 'units.marked',
      'output.printRough', 'output.printPro', 'output.imageRough', 'output.imagePro', 'output.tsv',
      'history.search', 'history.open', 'history.delete', 'history.trash', 'history.undoDelete', 'history.emptyTrash', 'history.selectAll', 'history.openPdf',
      'customers.search', 'customers.add', 'customers.edit', 'customers.delete', 'customers.bills', 'revisions.open', 'backup.create', 'partyImport.open'
    ]
    expect(must.filter((a) => !primaryKeys(a))).toEqual([])
  })
})

describe('Phase 67 - no control is mouse-only (source scan of the renderer)', () => {
  const files = walk(join(root, 'src/renderer'))
  it('every IconButton taken out of the Tab order carries a registered shortcut (spread or prop), i.e. has a keyboard twin', () => {
    const bad: string[] = []
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((l, i) => {
        if (/<IconButton\b/.test(l) && /tabIndex=\{-1\}/.test(l) && !/\{\.\.\.k\(|\{\.\.\.key\(|shortcut=|\{\.\.\.\(keys|primaryKeys\(/.test(l)) bad.push(`${f.slice(root.length + 1)}:${i + 1}`)
      })
    }
    expect(bad).toEqual([])
  })
  it('a click handler on a plain element (div, span, li, tr, td) only exists with a role and a keyboard route', () => {
    const found: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (/<(div|span|li|tr|td|section|p|img|svg)\b[^>]*\bonClick=/.test(l) && !/role=/.test(l)) found.push(`${f.slice(root.length + 1)}:${i + 1}`)
      })
    }
    expect(found).toEqual([])
  })
  it('double-click is only ever an extra: each double-click handler sits beside an Enter / action key route (reviewed list)', () => {
    const where = files.filter((f) => /onDoubleClick=/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1).replace(/\\/g, '/')).sort()
    expect(where).toEqual([
      'src/renderer/components/customers/CustomerList.tsx', // Enter / customers.edit
      'src/renderer/components/dashboard/DashList.tsx', // Enter opens the highlighted bill / draft
      'src/renderer/components/grid/ColumnHeader.tsx', // rename = cols.rename (Ctrl+Alt+R); width reset = grid.colWidthsReset (Ctrl+Alt+0)
      'src/renderer/components/history/BillList.tsx', // Enter / history.open
      'src/renderer/components/history/TrashView.tsx', // Enter restores
      'src/renderer/components/items/SalesPanel.tsx' // Enter / items.confirm opens the sale (Phase 114)
    ])
  })
  it('the one right-click menu (Reset total to auto on the grid) has a key twin: grid.resetTotal', () => {
    const where = files.filter((f) => /onContextMenu=/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1).replace(/\\/g, '/'))
    expect(where).toEqual(['src/renderer/components/grid/BillGrid.tsx'])
    expect(primaryKeys('grid.resetTotal')).toBeTruthy()
  })
})
