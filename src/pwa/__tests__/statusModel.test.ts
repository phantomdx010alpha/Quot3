import { describe, expect, it } from 'vitest'
import { OFFLINE_NOTE } from '../platform/online'
import { INSTALL_TEXT, READ_ONLY_LINE, STATUS_PRIORITY, statusModel, type StatusFlags } from '../ui/kit/statusModel'

// Phase 191 - one pill by priority, every notice still listed.
const none: StatusFlags = { readOnly: false, offline: false, gateNote: null, clearedNote: null, update: null, installOffer: false, sync: null }
const all: StatusFlags = { readOnly: true, offline: true, gateNote: 'Update the app to see 3 bills.', clearedNote: 'Your data was cleared.', update: { text: 'New version available.', canReload: false }, installOffer: true, sync: { text: 'Sync paused.' } }

describe('statusModel', () => {
  it('nothing active: no pill, no list, no line', () => {
    expect(statusModel(none)).toEqual({ pill: null, all: [], readOnlyLine: null })
  })
  it('priority is read-only > cleared > gate > update > offline > install > sync', () => {
    expect(STATUS_PRIORITY).toEqual(['readonly', 'cleared', 'gate', 'update', 'offline', 'install', 'sync'])
    let flags: StatusFlags = { ...all }
    const seen: string[] = []
    const strip: ((f: StatusFlags) => StatusFlags)[] = [
      (f) => ({ ...f, readOnly: false }), (f) => ({ ...f, clearedNote: null }), (f) => ({ ...f, gateNote: null }), (f) => ({ ...f, update: null }),
      (f) => ({ ...f, offline: false }), (f) => ({ ...f, installOffer: false })
    ]
    for (const s of strip) { seen.push(statusModel(flags).pill!.kind); flags = s(flags) }
    seen.push(statusModel(flags).pill!.kind)
    expect(seen).toEqual(['readonly', 'cleared', 'gate', 'update', 'offline', 'install', 'sync'])
  })
  it('ONE pill, and the list holds every active notice in priority order (nothing hidden)', () => {
    const m = statusModel(all)
    expect(m.pill).toEqual({ kind: 'readonly', label: 'Read-only', more: 6 })
    expect(m.all.map((n) => n.kind)).toEqual([...STATUS_PRIORITY])
    expect(m.all.find((n) => n.kind === 'gate')!.text).toBe('Update the app to see 3 bills.')
    expect(m.all.find((n) => n.kind === 'offline')!.text).toBe(OFFLINE_NOTE)
    expect(m.all.find((n) => n.kind === 'install')!.text).toBe(INSTALL_TEXT)
  })
  it('read-only also gives the persistent thin line, and only read-only does', () => {
    expect(statusModel({ ...none, readOnly: true }).readOnlyLine).toBe(READ_ONLY_LINE)
    expect(statusModel({ ...none, offline: true }).readOnlyLine).toBeNull()
  })
  it('actions: Try again, Reload (disabled with an unsaved bill), Install and Not now', () => {
    const m = statusModel(all)
    expect(m.all.find((n) => n.kind === 'readonly')!.actions).toEqual([{ id: 'tryAgain', label: 'Try again' }])
    expect(m.all.find((n) => n.kind === 'update')!.actions).toEqual([{ id: 'reload', label: 'Reload', disabled: true }])
    expect(statusModel({ ...none, update: { text: 'x', canReload: true } }).all[0]!.actions[0]!.disabled).toBe(false)
    expect(m.all.find((n) => n.kind === 'install')!.actions.map((a) => a.id)).toEqual(['install', 'hideInstall'])
  })
  it('a lone notice has more = 0', () => {
    expect(statusModel({ ...none, offline: true }).pill).toEqual({ kind: 'offline', label: 'Offline', more: 0 })
  })
})
