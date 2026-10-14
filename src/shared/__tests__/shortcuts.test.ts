import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  SHORTCUTS,
  eventToKeys,
  findShortcutConflicts,
  matchShortcut,
  normalizeKeys,
  primaryKeys,
  type KeyInput,
  type ShortcutDef
} from '../shortcuts'

const ev = (key: string, m: Partial<KeyInput> = {}): KeyInput => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...m
})

describe('normalizeKeys / eventToKeys', () => {
  it('canonicalises order, case and aliases', () => {
    expect(normalizeKeys('shift+ctrl+k')).toBe('Ctrl+Shift+K')
    expect(normalizeKeys('Alt+Ctrl+=')).toBe('Ctrl+Alt+=')
    expect(normalizeKeys('esc')).toBe('Escape')
    expect(normalizeKeys('Ctrl++')).toBe('Ctrl++')
  })
  it('builds the same form from events', () => {
    expect(eventToKeys(ev('k', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+K')
    expect(eventToKeys(ev('F1'))).toBe('F1')
  })
})

describe('matchShortcut', () => {
  it('matches global shortcuts in any scope', () => {
    expect(matchShortcut(ev('k', { ctrlKey: true }))?.action).toBe('palette.open')
    expect(matchShortcut(ev('K', { ctrlKey: true }), ['create'])?.action).toBe('palette.open')
    expect(matchShortcut(ev('2', { ctrlKey: true }))?.action).toBe('nav.history')
  })
  it('both help bindings resolve to the cheat-sheet', () => {
    expect(matchShortcut(ev('F1'))?.action).toBe('help.shortcuts')
    expect(matchShortcut(ev('/', { ctrlKey: true }))?.action).toBe('help.shortcuts')
  })
  it('requires exact modifiers', () => {
    expect(matchShortcut(ev('k'))).toBeNull()
    expect(matchShortcut(ev('k', { ctrlKey: true, altKey: true }))).toBeNull()
    expect(matchShortcut(ev('1', { ctrlKey: true, shiftKey: true }))).toBeNull()
  })
  it('honours scopes: non-active scopes never match; most specific scope wins', () => {
    const defs: ShortcutDef[] = [
      { id: 'a', keys: 'Ctrl+L', label: 'A', scope: 'global', action: 'nav.back' },
      { id: 'b', keys: 'Ctrl+Q', label: 'B', scope: 'create', action: 'bill.new' },
      { id: 'c', keys: 'Ctrl+L', label: 'C', scope: 'grid', action: 'bill.new' }
    ]
    expect(matchShortcut(ev('q', { ctrlKey: true }), [], defs)).toBeNull()
    expect(matchShortcut(ev('q', { ctrlKey: true }), ['create'], defs)?.id).toBe('b')
    expect(matchShortcut(ev('l', { ctrlKey: true }), [], defs)?.id).toBe('a')
    expect(matchShortcut(ev('l', { ctrlKey: true }), ['grid'], defs)?.id).toBe('c')
  })
})

describe('registry integrity', () => {
  it('has no key conflicts', () => {
    expect(findShortcutConflicts()).toEqual([])
  })
  it('detects a collision in one scope and global-vs-scoped collisions', () => {
    const base = { label: 'x', action: 'nav.back' as const }
    expect(findShortcutConflicts([
      { id: '1', keys: 'ctrl+j', scope: 'create', ...base },
      { id: '2', keys: 'Ctrl+J', scope: 'create', ...base }
    ])).toHaveLength(1)
    expect(findShortcutConflicts([
      { id: '1', keys: 'Ctrl+J', scope: 'global', ...base },
      { id: '2', keys: 'Ctrl+J', scope: 'history', ...base }
    ])).toHaveLength(1)
    expect(findShortcutConflicts([
      { id: '1', keys: 'Ctrl+J', scope: 'create', ...base },
      { id: '2', keys: 'Ctrl+J', scope: 'history', ...base }
    ])).toEqual([])
  })
  it('has unique ids and every shortcut points at a registered action', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const actionIds = new Set(ACTIONS.map((a) => a.id))
    expect(actionIds.size).toBe(ACTIONS.length)
    for (const s of SHORTCUTS) expect(actionIds.has(s.action)).toBe(true)
  })
  it('owner nav map: Ctrl+0..4 → Dashboard, Create, History, Customers, Settings', () => {
    expect(['nav.dashboard', 'nav.create', 'nav.history', 'nav.customers', 'nav.settings'].map((a) => primaryKeys(a as never))).toEqual([
      'Ctrl+0', 'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4'
    ])
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Phase 30 - the FROZEN global shortcut map (KEYBOARD_CELL_RULES section 8). Changing a row here needs owner approval.
// ---------------------------------------------------------------------------------------------------------------
import { allActions, allShortcuts } from '../shortcuts'
import { OUTPUT_ACTIONS, outputDisabledReason, outputTooltip } from '../outputActions'

describe('Phase 30: frozen KB section 8 map', () => {
  const frozen: Record<string, string> = {
    'format.set.gst': 'Alt+1',
    'format.set.non_gst': 'Alt+2',
    'format.set.stock_transfer': 'Alt+4', // Phase 149 (owner-approved: Stock transfer format)
    'hybrid.toggle': 'Alt+3', // Phase 151 (owner-approved: Hybrid format, MILESTONE14_DESIGN 1.6)
    'palette.open': 'Ctrl+K',
    'bill.save': 'Ctrl+S',
    'output.printRough': 'Ctrl+P',
    'output.printPro': 'Ctrl+Shift+P',
    'output.imageRough': 'Ctrl+I',
    'output.imagePro': 'Ctrl+Shift+I',
    'output.tsv': 'Ctrl+Shift+T',
    'units.summary': 'Ctrl+U',
    'units.mark': 'Ctrl+M',
    'units.marked': 'Ctrl+Shift+M',
    'cols.add': 'Ctrl+Alt+=',
    'cols.remove': 'Ctrl+Alt+-',
    'bill.new': 'Ctrl+N',
    'nav.dashboard': 'Ctrl+0',
    'nav.create': 'Ctrl+1',
    'nav.history': 'Ctrl+2',
    'nav.customers': 'Ctrl+3',
    'nav.settings': 'Ctrl+4',
    'nav.items': 'Ctrl+5'
  }
  it('every frozen action has exactly its documented primary key', () => {
    for (const [action, keys] of Object.entries(frozen)) expect(primaryKeys(action as never), action).toBe(keys)
  })
  it('F1 and Ctrl+/ both open the cheat-sheet', () => {
    const k = allShortcuts().filter((s) => s.action === 'help.shortcuts').map((s) => s.keys).sort()
    expect(k).toEqual(['Ctrl+/', 'F1'])
  })
  it('the whole registry (statics + formats) has no key conflicts', () => {
    expect(findShortcutConflicts(allShortcuts())).toEqual([])
  })
  it('Ctrl+Shift+P is Print Professional; focus-party moved to Ctrl+Shift+F', () => {
    expect(matchShortcut(ev('P', { ctrlKey: true, shiftKey: true }), ['global'])?.action).toBe('output.printPro')
    expect(matchShortcut(ev('F', { ctrlKey: true, shiftKey: true }), ['global'])?.action).toBe('create.focusParty')
  })
  it('every bottom-bar output action has a palette entry, a key and a stub reason or none', () => {
    const ids = allActions().map((a) => a.id)
    for (const o of OUTPUT_ACTIONS) {
      expect(ids).toContain(o.id)
      expect(primaryKeys(o.id)).toBeTruthy()
      expect(outputTooltip(o.id)).toContain(o.label)
      if (o.phase !== null) expect(outputDisabledReason(o.id)).toContain(`Phase ${o.phase}`)
    }
    expect(OUTPUT_ACTIONS).toHaveLength(5)
  })
  it('every shortcut points at a registered action and ids are unique', () => {
    const ids = new Set(allActions().map((a) => a.id))
    const keyIds = allShortcuts().map((s) => s.id)
    expect(new Set(keyIds).size).toBe(keyIds.length)
    for (const s of allShortcuts()) expect(ids.has(s.action), s.id).toBe(true)
  })
})

describe('Phase 67 - context key hints (F1 sheet)', () => {
  it('are non-empty, unique, and every key is written in the registry\'s own spelling', async () => {
    const { CONTEXT_KEY_HINTS } = await import('../shortcutList')
    expect(CONTEXT_KEY_HINTS.length).toBeGreaterThan(10)
    const seen = CONTEXT_KEY_HINTS.map((h) => `${h.where}|${h.does}`)
    expect(new Set(seen).size).toBe(seen.length)
    for (const h of CONTEXT_KEY_HINTS) {
      expect(h.keys.length).toBeGreaterThan(0)
      for (const k of h.keys) expect(normalizeKeys(k)).toBe(k)
    }
  })
})
