/**
 * Phase 61 - the audit log (pure). `audit_log` rows are written by many services since Phase 29; this file is the one place
 * that knows how to read them back: filters, paging limits, the human sentence for each (entity, action), and retention.
 * No Electron, no Node, no DOM.
 */

/** Setting `audit.retentionDays`: rows older than this are removed at launch (conflict snapshots still needed are kept). */
export const AUDIT_RETENTION_DEFAULT_DAYS = 365
export const AUDIT_RETENTION_MIN_DAYS = 30
export const AUDIT_RETENTION_MAX_DAYS = 3650
/** Choices offered in the viewer. */
export const AUDIT_RETENTION_CHOICES: readonly number[] = [90, 180, 365, 730, 1825]
export const AUDIT_PAGE_DEFAULT = 50
export const AUDIT_PAGE_MAX = 200
export const AUDIT_SEARCH_MAX = 100
/** The viewer shows at most this much of a row's detail. */
export const AUDIT_DETAIL_MAX_CHARS = 2000
const LIST_CAP = 20

export interface AuditInput {
  entity: string
  entityId?: string | null
  action: string
  detail?: Record<string, unknown> | null
}

export interface AuditQuery {
  entity?: string
  action?: string
  /** Inclusive ISO instants (use `dayRangeIso`). */
  from?: string
  to?: string
  /** Matches the entity id, the action and the stored detail text. */
  search?: string
  /** Page cursor: only rows with an id below this. */
  beforeId?: number
  limit?: number
}

export interface AuditItem {
  id: number
  at: string
  branchId: string | null
  /** Branch name when the branch is known on this computer. */
  branchName: string
  entity: string
  entityId: string | null
  action: string
  /** One sentence for the list. */
  summary: string
  /** Pretty detail without the (large) sync-conflict snapshot; at most `AUDIT_DETAIL_MAX_CHARS`. */
  detailText: string
}

export interface AuditPage {
  items: AuditItem[]
  hasMore: boolean
  /** Cursor for the next page (the id of the last item), or null. */
  nextBeforeId: number | null
}

export interface AuditFacets {
  entities: string[]
  actions: string[]
  /** Rows in the log right now. */
  total: number
  retentionDays: number
}

const ENTITY_LABELS: Record<string, string> = {
  bill: 'Bills',
  draft: 'Drafts',
  party: 'Customers',
  customer: 'Customers',
  party_import: 'Customer import',
  license: 'License',
  branch: 'Branch',
  backup: 'Backups',
  audit: 'Activity log',
  app: 'App'
}

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? capitalise(entity.replace(/_/g, ' '))
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

export function actionLabel(action: string): string {
  return capitalise(action.replace(/_/g, ' '))
}

/** Clamp a stored / typed retention to the allowed range; anything unusable gives the default. */
export function clampRetentionDays(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isFinite(n)) return AUDIT_RETENTION_DEFAULT_DAYS
  return Math.min(AUDIT_RETENTION_MAX_DAYS, Math.max(AUDIT_RETENTION_MIN_DAYS, Math.floor(n)))
}

/** The instant before which rows are old (ISO). */
export function auditCutoff(now: Date, days: number): string {
  return new Date(now.getTime() - clampRetentionDays(days) * 86_400_000).toISOString()
}

/** `YYYY-MM-DD` (local day) -> the inclusive ISO instants of that day; a blank or bad day gives undefined for that side. */
export function dayRangeIso(fromDay: string, toDay: string): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {}
  const a = parseDay(fromDay)
  const b = parseDay(toDay)
  if (a) out.from = new Date(a.y, a.m - 1, a.d, 0, 0, 0, 0).toISOString()
  if (b) out.to = new Date(b.y, b.m - 1, b.d, 23, 59, 59, 999).toISOString()
  return out
}

function parseDay(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const probe = new Date(y, mo - 1, d)
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null
  return { y, m: mo, d }
}

/** Escapes `%`, `_` and the escape character for a SQL `LIKE ... ESCAPE '\'`. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Keeps a query inside the limits (the IPC schema enforces the same). */
export function normaliseQuery(q: AuditQuery): Required<Pick<AuditQuery, 'limit'>> & AuditQuery {
  const search = q.search?.trim().slice(0, AUDIT_SEARCH_MAX)
  const out: Required<Pick<AuditQuery, 'limit'>> & AuditQuery = {
    limit: Math.min(AUDIT_PAGE_MAX, Math.max(1, Math.floor(q.limit ?? AUDIT_PAGE_DEFAULT)))
  }
  if (q.entity) out.entity = q.entity
  if (q.action) out.action = q.action
  if (q.from) out.from = q.from
  if (q.to) out.to = q.to
  if (search) out.search = search
  if (q.beforeId !== undefined) out.beforeId = q.beforeId
  return out
}

/**
 * The detail as stored, made safe to show: the full sync-conflict snapshot is replaced by its row count and long lists are cut.
 * Returns the shortened object (never throws; unreadable JSON gives null).
 */
export function trimDetail(detailJson: string | null): Record<string, unknown> | null {
  if (detailJson === null || detailJson === '') return null
  let parsed: unknown
  try { parsed = JSON.parse(detailJson) } catch { return null }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { value: parsed }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (k === 'snapshot' && v && typeof v === 'object') {
      const rows = (v as { rows?: unknown }).rows
      out['snapshotRows'] = Array.isArray(rows) ? rows.length : 0
      continue
    }
    if (Array.isArray(v) && v.length > LIST_CAP) {
      out[k] = [...v.slice(0, LIST_CAP), `... and ${v.length - LIST_CAP} more`]
      continue
    }
    out[k] = v
  }
  return out
}

export function detailToText(detail: Record<string, unknown> | null): string {
  if (!detail) return ''
  let text = JSON.stringify(detail, null, 2)
  if (text.length > AUDIT_DETAIL_MAX_CHARS) text = `${text.slice(0, AUDIT_DETAIL_MAX_CHARS)}\n...`
  return text
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The sentence shown in the list for one row. Unknown pairs fall back to "<Entity>: <action>". */
export function describeAudit(entity: string, action: string, detail: Record<string, unknown> | null): string {
  const d = detail ?? {}
  const po = str(d['poNumber'])
  const billName = po === '' ? 'a bill' : `bill ${po}`
  const party = str(d['partyName'])
  const withParty = party === '' ? '' : ` (${party})`
  const count = num(d['count']) ?? num(d['removed'])
  const key = `${entity}/${action}`
  switch (key) {
    case 'bill/create': return `Created ${billName}${withParty}`
    case 'bill/edit': return `Edited ${billName}${withParty}${num(d['revision']) !== null ? `, revision ${num(d['revision'])}` : ''}`
    case 'bill/delete': return `Moved ${billName} to Recently deleted`
    case 'bill/restore': return `Restored ${billName} from Recently deleted`
    case 'bill/purge': return `Deleted ${plural(count ?? 0, 'bill', 'bills')} for good`
    case 'bill/empty_trash': return `Emptied Recently deleted (${plural(count ?? 0, 'bill', 'bills')})`
    case 'bill/auto_purge': return `Removed ${plural(count ?? 0, 'old deleted bill', 'old deleted bills')} automatically`
    case 'bill/conflict': {
      const lost = str(d['lost']) === 'delete' ? 'delete' : 'edit'
      return `Sync conflict: this computer's ${lost} was replaced by a newer change from another branch`
    }
    case 'party/delete': return `Deleted customer${str(d['name']) === '' ? '' : ` ${str(d['name'])}`}`
    case 'party/create': return `Added customer${str(d['name']) === '' ? '' : ` ${str(d['name'])}`}`
    case 'party/update': return `Changed customer${str(d['name']) === '' ? '' : ` ${str(d['name'])}`}`
    case 'draft/cleanup': return `Removed ${plural(count ?? 0, 'old unsaved bill', 'old unsaved bills')}`
    case 'party_import/import': return `Imported customers: ${num(d['created']) ?? 0} added, ${num(d['updated']) ?? 0} updated`
    case 'party_import/undo': return 'Undid a customer import'
    case 'license/activate': return 'Activated sync and license'
    case 'license/deactivate': return 'Deactivated sync and license'
    case 'branch/po_prefix': return `Changed the PO prefix${str(d['from']) === '' ? '' : ` from ${str(d['from'])}`}${str(d['to']) === '' ? '' : ` to ${str(d['to'])}`}`
    case 'branch/bootstrap_import': return `Joined a branch: imported ${num(d['billsAdded']) ?? 0} bills from a backup`
    case 'backup/restore': return 'Restored a backup'
    case 'backup/reset': return 'Reset local data'
    case 'backup/import': return 'Added a backup file from outside'
    case 'audit/purge': return `Removed ${plural(count ?? 0, 'old log entry', 'old log entries')}`
    case 'app/update_downloaded': return `Downloaded update ${str(d['to'])}`.trim()
    case 'app/update_install': return `Restarted to install version ${str(d['to'])}`.trim()
    case 'app/crash_recovered': return 'Started again after the app closed unexpectedly'
    default: return `${entityLabel(entity)}: ${actionLabel(action).toLowerCase()}`
  }
}
