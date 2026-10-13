import { describe, expect, it } from 'vitest'
import { CLOCK_WARN_MS, EMPTY_OVERVIEW, clockWarningText, deriveOverview } from '../manager'
import { SHARED_MESSAGES } from '../license'
import {
  EMPTY_SHARED_FORM, branchNameKey, compareSentence, nameStateText, routeSharedError, sharedConnectionLine, sortBranches, validateSharedForm, type SharedForm
} from '../sharedUi'

const good: SharedForm = {
  supabaseUrl: 'https://abcdefghij.supabase.co', anonKey: 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(60) + '.' + 'b'.repeat(40), licenseKey: 'q3-abcd-efgh-jklm',
  email: ' Shop1@Example.com ', password: 'Pa55 word!', branchName: '  Main   shop ', poPrefix: 'mn-', device: ' Counter PC ', takeover: false
}

describe('Phase 139 - sign-in form rules', () => {
  it('accepts a complete form and normalises it; there is no passphrase field', () => {
    const v = validateSharedForm(good)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.input).toMatchObject({ licenseKey: 'Q3-ABCD-EFGH-JKLM', email: 'shop1@example.com', branchName: 'Main shop', poPrefix: 'MN-', device: 'Counter PC' })
    expect(v.input.password).toBe('Pa55 word!') // kept exactly as typed
    expect(Object.keys(v.input)).not.toContain('passphrase')
    expect(Object.keys(EMPTY_SHARED_FORM)).not.toContain('passphrase')
    expect('takeover' in v.input).toBe(false)
  })
  it('reports every bad field with a plain message', () => {
    const v = validateSharedForm(EMPTY_SHARED_FORM)
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(Object.keys(v.errors).sort()).toEqual(['anonKey', 'branchName', 'email', 'licenseKey', 'password', 'poPrefix', 'supabaseUrl'])
    expect(validateSharedForm({ ...good, poPrefix: 'TOOLONGPREFIX' }).ok).toBe(false)
    expect(validateSharedForm({ ...good, email: 'nope' }).ok).toBe(false)
  })
  it('passes takeover only when ticked', () => {
    const v = validateSharedForm({ ...good, takeover: true })
    expect(v.ok && v.input.takeover).toBe(true)
  })
  it('compares branch names case- and space-insensitively', () => {
    expect(branchNameKey('  Main   SHOP ')).toBe(branchNameKey('main shop'))
    expect(nameStateText('taken')).toMatch(/already uses/)
    expect(nameStateText('idle')).toBe('')
  })
})

describe('Phase 139 - server refusals go to the right place', () => {
  const e = (kind: keyof typeof SHARED_MESSAGES, code = 'VALIDATION') => routeSharedError({ code, kind, message: SHARED_MESSAGES[kind] })
  it('name taken -> branch name; prefix taken -> PO prefix', () => {
    expect(e('name_taken').field).toBe('branchName')
    expect(e('prefix_taken').field).toBe('poPrefix')
  })
  it('seat in use asks for the takeover; bad password -> password; license -> key', () => {
    expect(e('seat_in_use')).toMatchObject({ askTakeover: true })
    expect(e('seat_in_use').field).toBeUndefined()
    expect(e('auth_failed', 'AUTH_FAILED').field).toBe('password')
    expect(e('license', 'LICENSE_INVALID').field).toBe('licenseKey')
    expect(e('anon_key').field).toBe('anonKey')
  })
  it('a paused server is paused, not offline; offline stays a plain message', () => {
    expect(e('server_paused', 'SERVER_PAUSED').paused).toBe(true)
    expect(routeSharedError({ code: 'SERVER_PAUSED', message: 'x' }).paused).toBe(true)
    const o = e('offline', 'SYNC_OFFLINE')
    expect(o.paused).toBe(false)
    expect(o.field).toBeUndefined()
  })
})

describe('Phase 139 - branch list, compare words, status words', () => {
  it('lists this computer first, then by name', () => {
    const r = sortBranches([
      { branchId: 'b', name: 'zeta', poPrefix: 'Z', deviceName: '', lastSeenAt: null, isThis: false },
      { branchId: 'c', name: 'Main', poPrefix: 'M', deviceName: '', lastSeenAt: null, isThis: true },
      { branchId: 'a', name: 'Alpha', poPrefix: 'A', deviceName: '', lastSeenAt: null, isThis: false }
    ])
    expect(r.map((x) => x.name)).toEqual(['Main', 'Alpha', 'zeta'])
  })
  it('compare sentences', () => {
    expect(compareSentence({ state: 'paused', upload: 0, download: 0, conflict: 0, skip: 0 })).toMatch(/stopped/)
    expect(compareSentence({ state: 'done', upload: 0, download: 0, conflict: 0, skip: 5 })).toMatch(/match/)
    expect(compareSentence({ state: 'done', upload: 2, download: 3, conflict: 1, skip: 0 })).toMatch(/2 to send, 3 to fetch, 1 different/)
  })
  it('connection line: signed-out / paused server / offline / Live / polling', () => {
    const base = { activated: true, enabled: true, serverPaused: false, signedOut: false, mode: 'ok', deliveryText: 'Live' }
    expect(sharedConnectionLine({ ...base, activated: false }).value).toBe('Not signed in')
    expect(sharedConnectionLine({ ...base, signedOut: true })).toMatchObject({ value: 'Signed out', tone: 'bad' })
    expect(sharedConnectionLine({ ...base, serverPaused: true }).value).toBe('Sync server paused')
    expect(sharedConnectionLine({ ...base, mode: 'offline' }).value).toBe('Offline')
    expect(sharedConnectionLine(base)).toMatchObject({ value: 'Live', tone: 'ok' })
    expect(sharedConnectionLine({ ...base, deliveryText: 'Checking every minute' }).tone).toBe('wait')
  })
})

describe('Phase 139 - overview: paused server, signed-out, clock offset, aside count', () => {
  const on = { activated: true, enabled: true, readOnly: false, push: null, pull: null, counts: { pending: 0, failed: 0, synced: 0 }, oldestPendingAt: null, conflicts: 0 }
  it('defaults are quiet', () => {
    expect(EMPTY_OVERVIEW).toMatchObject({ serverPaused: false, signedOut: false, clockOffsetMs: 0, clockWarning: '' })
    expect(deriveOverview(on)).toMatchObject({ mode: 'ok', serverPaused: false, signedOut: false })
  })
  it('a paused server is its own sentence and does not read as "no internet"', () => {
    const o = deriveOverview({ ...on, serverPaused: true })
    expect(o.serverPaused).toBe(true)
    expect(o.mode).toBe('offline')
    expect(o.headline).toMatch(/paused/)
    expect(o.headline).not.toMatch(/No connection/)
  })
  it('signed out needs attention', () => {
    const o = deriveOverview({ ...on, signedOut: true })
    expect(o).toMatchObject({ signedOut: true, mode: 'attention' })
    expect(o.headline).toMatch(/signed out/)
  })
  it('clock: warns only beyond the limit, in both directions, without changing the mode', () => {
    expect(clockWarningText(CLOCK_WARN_MS)).toBe('')
    expect(clockWarningText(Number.NaN)).toBe('')
    expect(clockWarningText(5 * 60_000)).toMatch(/5 minutes behind/)
    expect(clockWarningText(-60 * 60_000)).toMatch(/60 minutes ahead/)
    const o = deriveOverview({ ...on, clockOffsetMs: 600_000 })
    expect(o.mode).toBe('ok')
    expect(o.clockWarning).not.toBe('')
  })
  it('the aside count shows as one line', () => {
    const o = deriveOverview({ ...on, aside: { bills: 12, customers: 0, rules: 0, total: 12 } })
    expect(o.asideLine).toBe('Update the app to see 12 bills.')
    expect(o.mode).toBe('attention')
  })
  it('nothing is reported while sync is off or signed out of the switch', () => {
    expect(deriveOverview({ ...on, activated: false, serverPaused: true, signedOut: true })).toMatchObject({ serverPaused: false, signedOut: false, mode: 'off' })
  })
})
