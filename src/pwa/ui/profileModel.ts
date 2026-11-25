/**
 * Phase 295 (M25, design 4.7) - the phone Profile page's READ MODEL. Pure: no DOM, no IndexedDB, no network, no writes.
 * `buildProfile(input)` turns what the phone already knows into groups of label / value rows. A missing part is the plain line
 * \"Not set up\" (never a blank, never an error). Nothing secret can get in: the input type has no code, token, password, key, UPI id
 * or account number, and the diagnostics text still goes through `redactText` (`shared/master/redact.ts`).
 * Honest limits kept in the words: the rights hide and block in the app only (`SEAT_RIGHTS_HONEST_LIMIT`).
 */
import { APP_NAME, PUBLISHER_EMAIL } from '../../shared/appInfo'
import { redactText } from '../../shared/master/redact'
import { PERM_FLAGS, PERM_LABELS, type PermFlags } from '../../shared/pricelist/perms'
import {
  SEAT_RIGHT_FLAGS, SEAT_RIGHT_LABELS, SEAT_RIGHTS_HONEST_LIMIT, SEAT_RIGHTS_SOURCE_WORDS, canDo, type SeatFlags, type SeatRightsSource
} from '../../shared/seatRights'
import { formatBytes, type StorageHealth } from '../platform/storage'
import { selfCheckLine, type SelfCheckResult } from '../sync/selfCheck'

export const NOT_SET_UP = 'Not set up'
export const NOT_SHOWN = 'Not shown'

export interface ProfileInput {
  version: string
  /** The `meta` values the page reads (no org id: it is not needed and not shown). */
  meta: { branchName: string | null; poPrefix: string | null; linked: boolean; lastExportAt: string | null }
  seat: { seatNo: number | null; flags: Readonly<SeatFlags>; source: SeatRightsSource; checkedAt: string | null }
  /** The five Price List edit flags (null = nothing known: no sync means full rights). */
  priceFlags: Readonly<PermFlags> | null
  counts: { bills: number; customers: number; priceRows: number } | null
  storage: StorageHealth | null
  selfCheck: SelfCheckResult | null
  /** Null = no engine in this tab. */
  engine: { lastSuccessAt: string | null; pending: number; failed: number } | null
  company: { name: string; hasPhone: boolean; hasAddress: boolean; hasLogo: boolean; fromCompanyDefault: boolean } | null
  companyDefaultVersion: number | null
  payments: { stored: boolean; count: number; defaultName: string; version: number; unpublished: boolean } | null
  writable: boolean
}

export interface ProfileRow { label: string; value: string }
export type ProfileGroupId = 'who' | 'connection' | 'rights' | 'data' | 'company' | 'payments' | 'help'
export interface ProfileLink { id: 'company' | 'payments'; label: string }
export interface ProfileGroup { id: ProfileGroupId; title: string; rows: ProfileRow[]; note?: string; link?: ProfileLink }
export interface ProfileView { groups: ProfileGroup[]; supportLine: string }

const pad = (n: number): string => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** \"25 Nov 2026, 14:05\" in the phone's local time; anything unreadable is \"Never\". */
export function whenWords(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return 'Never'
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const yes = (b: boolean): string => (b ? 'Yes' : 'No')
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`
const ok = (b: boolean): string => (b ? 'Allowed' : 'Not allowed')

function whoGroup(i: ProfileInput): ProfileGroup {
  const seat = i.seat.seatNo === null ? NOT_SET_UP : `Seat ${i.seat.seatNo}${i.seat.seatNo === 1 ? ' (main branch)' : ''}`
  return {
    id: 'who', title: 'Who this phone is',
    rows: [
      { label: 'Seat', value: seat },
      { label: 'Company', value: i.company && i.company.name.trim() !== '' ? i.company.name.trim() : NOT_SET_UP },
      { label: 'Branch', value: i.meta.branchName && i.meta.branchName.trim() !== '' ? i.meta.branchName.trim() : NOT_SET_UP },
      { label: 'PO prefix', value: i.meta.poPrefix && i.meta.poPrefix.trim() !== '' ? i.meta.poPrefix.trim() : NOT_SET_UP },
      { label: 'Device', value: 'This phone' },
      { label: 'App version', value: i.version }
    ]
  }
}

function connectionGroup(i: ProfileInput): ProfileGroup {
  const rows: ProfileRow[] = [{ label: 'Signed in', value: yes(i.meta.linked) }]
  if (!i.meta.linked) {
    rows.push({ label: 'Last sync', value: NOT_SET_UP }, { label: 'Bills only on this phone', value: NOT_SET_UP })
  } else {
    rows.push({ label: 'Last sync', value: i.engine ? whenWords(i.engine.lastSuccessAt) : 'Not checked here' })
    rows.push({ label: 'Bills only on this phone', value: i.engine ? String(i.engine.pending + i.engine.failed) : 'Not checked here' })
  }
  rows.push({ label: 'Company defaults from your admin', value: i.companyDefaultVersion === null ? NOT_SET_UP : `Received (version ${i.companyDefaultVersion})` })
  return { id: 'connection', title: 'Connection', rows }
}

function rightsGroup(i: ProfileInput): ProfileGroup {
  const rows: ProfileRow[] = SEAT_RIGHT_FLAGS.map((f) => ({ label: SEAT_RIGHT_LABELS[f], value: ok(canDo(i.seat.flags, f)) }))
  const price = i.priceFlags
  for (const f of PERM_FLAGS) rows.push({ label: `Price List: ${PERM_LABELS[f]}`, value: price === null ? ok(true) : ok(price[f] === true) })
  rows.push({ label: 'Last checked', value: i.seat.checkedAt ? whenWords(i.seat.checkedAt) : 'Not checked yet' })
  return { id: 'rights', title: 'What this phone may do', rows, note: `${SEAT_RIGHTS_SOURCE_WORDS[i.seat.source]} ${SEAT_RIGHTS_HONEST_LIMIT}` }
}

function dataGroup(i: ProfileInput): ProfileGroup {
  const rows: ProfileRow[] = []
  rows.push({ label: 'Bills', value: i.counts ? String(i.counts.bills) : NOT_SET_UP })
  rows.push({ label: 'Customers', value: i.counts ? String(i.counts.customers) : NOT_SET_UP })
  rows.push({ label: 'Price List rows', value: !canDo(i.seat.flags, 'seePriceList') ? NOT_SHOWN : i.counts ? String(i.counts.priceRows) : NOT_SET_UP })
  const s = i.storage
  rows.push({ label: 'Storage used', value: s && s.usageBytes !== null ? `${formatBytes(s.usageBytes)}${s.quotaBytes !== null ? ` of ${formatBytes(s.quotaBytes)}` : ''}` : 'Unknown' })
  rows.push({ label: 'Protected from clean-up', value: s === null || s.persisted === null ? 'Unknown' : yes(s.persisted) })
  rows.push({ label: 'Last backup file saved', value: whenWords(i.meta.lastExportAt) })
  const line = selfCheckLine(i.selfCheck)
  rows.push({ label: 'Last self-check', value: line !== '' ? line : 'Never' })
  return { id: 'data', title: "This phone's data", rows }
}

function companyGroup(i: ProfileInput): ProfileGroup {
  const c = i.company
  const named = c !== null && c.name.trim() !== ''
  const rows: ProfileRow[] = [
    { label: 'Name on bills', value: named ? c.name.trim() : NOT_SET_UP },
    { label: 'Phone', value: c && c.hasPhone ? 'Set' : NOT_SET_UP },
    { label: 'Address', value: c && c.hasAddress ? 'Set' : NOT_SET_UP },
    { label: 'Logo', value: c && c.hasLogo ? 'Set' : NOT_SET_UP },
    { label: 'Comes from', value: !named ? NOT_SET_UP : c.fromCompanyDefault ? 'Your admin (company default)' : 'This phone' }
  ]
  return { id: 'company', title: 'Company on bills', rows, link: { id: 'company', label: 'Open Company settings' } }
}

function paymentsGroup(i: ProfileInput): ProfileGroup {
  const p = i.payments
  const rows: ProfileRow[] = !p || !p.stored
    ? [{ label: 'Payees', value: NOT_SET_UP }]
    : [
      { label: 'Payees', value: String(p.count) },
      { label: 'Default payee', value: p.defaultName.trim() !== '' ? p.defaultName.trim() : NOT_SET_UP },
      { label: 'List version', value: p.version > 0 ? String(p.version) : 'Not shared yet' },
      { label: 'Waiting to be shared', value: yes(p.unpublished) }
    ]
  return { id: 'payments', title: 'Payments', rows, link: { id: 'payments', label: 'Open Payments' } }
}

/** The support line is a fixed sentence plus the publisher's address (public text); no account, no code. */
export const supportLine = (): string => `Need help? Write to ${PUBLISHER_EMAIL} and quote the app version above.`

function helpGroup(): ProfileGroup {
  return { id: 'help', title: 'Help', rows: [{ label: 'Support', value: supportLine() }] }
}

/** Pure. `Payments` is left out entirely when the phone is not allowed to see it (`seePayments` off). */
export function buildProfile(i: ProfileInput): ProfileView {
  const groups: ProfileGroup[] = [whoGroup(i), connectionGroup(i), rightsGroup(i), dataGroup(i), companyGroup(i)]
  if (canDo(i.seat.flags, 'seePayments')) groups.push(paymentsGroup(i))
  groups.push(helpGroup())
  return { groups, supportLine: supportLine() }
}

/** The text the \"Copy diagnostics\" button puts on the clipboard: every group except Help, then `redactText` over the whole thing. */
export function diagnosticsText(view: ProfileView): string {
  const lines: string[] = [`${APP_NAME} phone profile`]
  for (const g of view.groups) {
    if (g.id === 'help') continue
    lines.push('', g.title)
    for (const r of g.rows) lines.push(`${r.label}: ${r.value}`)
  }
  return redactText(lines.join('\n'))
}
