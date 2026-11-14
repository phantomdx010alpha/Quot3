/**
 * Phase 259 - redaction for logs and diagnostics (API_CONTRACTS.md M24-0 C6): strips seat codes, passwords, tokens, keys
 * and every `*_enc` value from any object or string, deeply. Everything that may hold a secret goes through
 * `redactSecrets` before it is logged, copied or put in diagnostics (test T28). Pure: no Electron / Node / DOM.
 */

export const REDACTED = '[redacted]'
const MAX_DEPTH = 24
const ERROR_CODE_RE = /^Q3M\d{2}$/

/** Object keys whose value is always replaced (compared lower-case, without `_` and `-`). */
const SECRET_KEYS = new Set([
  'password', 'passwd', 'pass', 'secret', 'code', 'seatcode', 'token', 'accesstoken', 'refreshtoken', 'devicetoken',
  'enroltoken', 'servicerolekey', 'servicerole', 'license', 'licensekey', 'anonkey', 'apikey', 'authorization',
  'xq3device', 'kek', 'masterkek', 'pepper', 'masterpepper', 'key', 'session', 'codehash'
])

const normKey = (k: string): string => k.toLowerCase().replace(/[_\-\s]/g, '')

/** True for a key whose value must never be shown (`password`, `deviceToken`, `service_role_enc`, `x-q3-device` ...). */
export function isSecretKey(key: string): boolean {
  const k = normKey(key)
  return SECRET_KEYS.has(k) || k.endsWith('enc') || k.endsWith('token') || k.endsWith('password') || k.endsWith('secret')
}

const STRING_RULES: Array<[RegExp, string]> = [
  // "password":"x"   password=x   token: x   (JSON or plain)
  [/(["']?)\b(password|passwd|token|accessToken|deviceToken|enrolToken|serviceRoleKey|service_role_key|license|anonKey|apikey|secret)\1(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi, `$1$2$1$3${REDACTED}`],
  // seat code, with or without prefix / grouping
  [/\bQ3C[-\s]?(?:[A-Z2-7]{4}[-\s]?){3}[A-Z2-7]{4}\b/gi, REDACTED],
  // license key of the company project
  [/\bQ3-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}\b/gi, REDACTED],
  // sealed text
  [/\bv1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}/g, REDACTED],
  // bearer header values and JWTs
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  // a device token: 43 base64url characters standing alone
  [/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, REDACTED]
]

/** Replace secrets inside free text (log lines, error messages, JSON text). */
export function redactText(text: string): string {
  let out = text
  for (const [re, to] of STRING_RULES) out = out.replace(re, to)
  return out
}

/**
 * A deep, non-mutating copy of `value` with secrets removed: secret keys get `[redacted]`, strings go through
 * `redactText`, `Error`s become `{ name, message }` (message redacted, no stack), cycles become `[circular]`, `Map` / `Set`
 * are walked, functions and symbols are dropped, very deep data is cut.
 */
export function redactSecrets<T = unknown>(value: T): unknown {
  return walk(value, 0, new WeakSet<object>())
}

function walk(v: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof v === 'string') return redactText(v)
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v
  if (typeof v === 'function' || typeof v === 'symbol') return undefined
  if (typeof v !== 'object') return undefined
  if (depth >= MAX_DEPTH) return '[too deep]'
  if (seen.has(v)) return '[circular]'
  seen.add(v)
  try {
    if (v instanceof Error) return { name: v.name, message: redactText(v.message) }
    if (v instanceof Date) return v.toISOString()
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) return `[bytes ${v.byteLength}]`
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1, seen))
    if (v instanceof Map) return Array.from(v, ([k, x]) => [walk(k, depth + 1, seen), typeof k === 'string' && isSecretKey(k) ? REDACTED : walk(x, depth + 1, seen)])
    if (v instanceof Set) return Array.from(v, (x) => walk(x, depth + 1, seen))
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === 'function' || typeof x === 'symbol') continue
      // An error code like `Q3M01` is safe and useful in diagnostics; a seat code under the same key is not.
      const keepErrorCode = normKey(k) === 'code' && typeof x === 'string' && ERROR_CODE_RE.test(x)
      out[k] = isSecretKey(k) && !keepErrorCode && x !== null && x !== undefined ? REDACTED : walk(x, depth + 1, seen)
    }
    return out
  } finally {
    seen.delete(v)
  }
}

/** Redact, then JSON-stringify for a log line (never throws). */
export function redactedJson(value: unknown): string {
  try {
    return JSON.stringify(redactSecrets(value))
  } catch {
    return '"[unserialisable]"'
  }
}
