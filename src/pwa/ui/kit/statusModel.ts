/** Phase 191 - the status pill model. Pure. Input = the flags `App.tsx` already holds; output = at most ONE pill by priority plus the full list of
 *  active notices (nothing is hidden) and the persistent read-only line. Priority: read-only > storage cleared > version gate > update > offline > install > sync. */
import { OFFLINE_NOTE } from '../../platform/online'

export type StatusKind = 'readonly' | 'cleared' | 'gate' | 'update' | 'offline' | 'install' | 'sync'
export const STATUS_PRIORITY: readonly StatusKind[] = ['readonly', 'cleared', 'gate', 'update', 'offline', 'install', 'sync']
export type StatusActionId = 'tryAgain' | 'reload' | 'install' | 'hideInstall'

export interface StatusAction { id: StatusActionId; label: string; disabled?: boolean }
export interface StatusItem { kind: StatusKind; label: string; text: string; actions: StatusAction[] }
export interface StatusFlags {
  readOnly: boolean
  offline: boolean
  gateNote: string | null
  clearedNote: string | null
  update: { text: string; canReload: boolean } | null
  installOffer: boolean
  sync: { text: string } | null
}
export interface StatusModel {
  pill: { kind: StatusKind; label: string; more: number } | null
  all: StatusItem[]
  readOnlyLine: string | null
}

export const READ_ONLY_LINE = 'Read-only: nothing typed here can be saved.'
export const READ_ONLY_TEXT = 'Quot3 is open in another window or tab, so this one is read-only (nothing can be saved). Close the other one, then tap Try again.'
export const INSTALL_TEXT = 'Install Quot3 on this phone to open it like an app, even offline.'

export function statusModel(f: StatusFlags): StatusModel {
  const items: Partial<Record<StatusKind, StatusItem>> = {}
  if (f.readOnly) items.readonly = { kind: 'readonly', label: 'Read-only', text: READ_ONLY_TEXT, actions: [{ id: 'tryAgain', label: 'Try again' }] }
  if (f.clearedNote) items.cleared = { kind: 'cleared', label: 'Data cleared', text: f.clearedNote, actions: [] }
  if (f.gateNote) items.gate = { kind: 'gate', label: 'Update needed', text: f.gateNote, actions: [] }
  if (f.update) items.update = { kind: 'update', label: 'Update ready', text: f.update.text, actions: [{ id: 'reload', label: 'Reload', disabled: !f.update.canReload }] }
  if (f.offline) items.offline = { kind: 'offline', label: 'Offline', text: OFFLINE_NOTE, actions: [] }
  if (f.installOffer) items.install = { kind: 'install', label: 'Install', text: INSTALL_TEXT, actions: [{ id: 'install', label: 'Install' }, { id: 'hideInstall', label: 'Not now' }] }
  if (f.sync) items.sync = { kind: 'sync', label: 'Sync', text: f.sync.text, actions: [] }
  const all = STATUS_PRIORITY.flatMap((k) => (items[k] ? [items[k]!] : []))
  const top = all[0]
  return {
    pill: top ? { kind: top.kind, label: top.label, more: all.length - 1 } : null,
    all,
    readOnlyLine: f.readOnly ? READ_ONLY_LINE : null
  }
}
