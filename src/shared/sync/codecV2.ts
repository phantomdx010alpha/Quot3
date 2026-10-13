import { z } from 'zod'
import { billRecordSchema, billRowRecordSchema } from '../billModel'
import { ITEM_RULE_KINDS } from '../items/rules'
import { canonicalJson } from './canonicalJson'

/**
 * Phase 133 (docs/SYNC_SHARED_STORE_SPEC.md section 8): the snapshot codec of the shared notebook. Pure (no Electron, Node or DOM).
 *
 * A record is `(kind, rec_id)`; its payload is plain canonical JSON `{ v: 2, kind, deleted, <known fields>, <unknown fields> }`
 * (no encryption, no deflate). Every record travels with `schema_ver` (what wrote it), `min_reader_ver` (the oldest reader that can
 * handle ALL its fields without loss) and `app_ver` (display only).
 *  - A reader with `READER_VER >= min_reader_ver` applies it. Unknown OPTIONAL top-level fields are kept in `unknownJson` and
 *    re-emitted by `encodeRecord`; unknown fields inside the known objects survive too (the schemas are loose).
 *  - A reader with `READER_VER < min_reader_ver` does NOT apply or overwrite it: `decodeRecord` answers `aside` and the caller keeps it
 *    in `sync_aside` (cursor still advances). After an update `retryAside` (main/sync/asideService.ts) decodes it again.
 *
 * The payload hash is the CONTENT hash (spec section 7): it ignores `revision`, `updatedAt`, `createdAt`, the derived totals cache and
 * the local `syncState`, but it DOES include the `deleted` flag (Phase 130: the server decides a `noop` by the hash alone).
 */

/** What this build understands. Raise it ONLY together with a feature that older apps could not read without loss. */
export const READER_VER = 1
/** What this build writes as `schema_ver`. */
export const SCHEMA_VER = 1
/** Payload format number (`payload.v`). */
export const PAYLOAD_V = 2

export const RECORD_KINDS = ['bill', 'party', 'party_merge', 'item_rule'] as const
export type RecordKind = (typeof RECORD_KINDS)[number]
export const isRecordKind = (k: unknown): k is RecordKind => typeof k === 'string' && (RECORD_KINDS as readonly string[]).includes(k)

/** Oldest reader able to handle every field this build writes, per kind. */
export const MIN_READER_VER_BY_KIND: Readonly<Record<RecordKind, number>> = { bill: 1, party: 1, party_merge: 1, item_rule: 1 }

/** The top-level payload keys this build knows, per kind (everything else is "unknown optional" and preserved). */
export const KNOWN_DATA_KEYS: Readonly<Record<RecordKind, readonly string[]>> = {
  bill: ['bill', 'rows'],
  party: ['party'],
  party_merge: ['merge'],
  item_rule: ['rule']
}
const RESERVED_KEYS = ['v', 'kind', 'deleted'] as const

const nul = z.string().nullable()
/** Loose = keys this build does not know are kept (an older app must not drop a newer field). */
const billData = z.object({
  bill: billRecordSchema.omit({ syncState: true }).loose(),
  rows: z.array(billRowRecordSchema.loose())
})
const partyData = z.object({
  party: z.object({
    id: z.string().min(1), name: z.string(), nameNorm: z.string(), phone: nul, address: nul, transport: nul,
    createdAt: z.string(), updatedAt: z.string(), deletedAt: nul, mergedInto: nul.optional()
  }).loose()
})
const mergeData = z.object({
  merge: z.object({ survivorId: z.string().min(1), mergedId: z.string().min(1), by: z.string().min(1), at: z.string().min(1) }).loose()
})
const ruleData = z.object({
  rule: z.object({
    id: z.string().min(1), kind: z.enum(ITEM_RULE_KINDS), keyA: z.string().min(1).max(1000), keyB: z.string().max(1000),
    canonical: z.string().max(1000).nullable(), note: z.string().max(1000).nullable(),
    createdAt: z.string().min(1), updatedAt: z.string().min(1), deletedAt: nul, branchId: z.string().min(1)
  }).loose()
})
const DATA_SCHEMAS = { bill: billData, party: partyData, party_merge: mergeData, item_rule: ruleData } as const

/** Fields left out of the content hash (and only those), per kind and per known top-level object. */
const HASH_SKIP: Readonly<Record<RecordKind, Readonly<Record<string, readonly string[]>>>> = {
  // `partyId` is a per-computer link (the same customer can have a different local id until Phase 137 unifies them; `partySnapshotJson`
  // carries what the bill says), so, like `sameContent`, it is not content (Phase 135 fix: identical bills hashed differently on two computers).
  bill: { bill: ['revision', 'updatedAt', 'createdAt', 'totalsJson', 'itemRowCount', 'syncState', 'deletedAt', 'partyId'] },
  party: { party: ['updatedAt', 'createdAt', 'deletedAt'] },
  party_merge: { merge: ['by', 'at'] },
  item_rule: { rule: ['updatedAt', 'createdAt', 'deletedAt', 'branchId'] }
}

// ---------------------------------------------------------------------------------------------------------------- SHA-256 (pure)

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

/** UTF-8 bytes of a string (lone surrogates become U+FFFD, like the platform encoders). */
export function utf8Bytes(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++ }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

/** SHA-256 of the UTF-8 bytes of `text`, lower-case hex (64 chars). Synchronous, so the hash can be computed on the push path without async. */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text)
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  for (const w of [hi, lo]) bytes.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4
      w[i] = ((bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!, w2 = w[i - 2]!
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

// ------------------------------------------------------------------------------------------------------------------------ encode

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface EncodeInput {
  kind: RecordKind
  recId: string
  /** The known top-level fields of this kind (`{ bill, rows }`, `{ party }`, `{ merge }`, `{ rule }`). Validated. */
  data: Obj
  deleted: boolean
  /** The sender's clock, already corrected by the measured server offset (spec section 6). */
  editedAt: string
  appVer: string
  /** From `decodeRecord().record.unknownJson`: unknown optional top-level fields to write back. */
  unknownJson?: string | null
  /** From `decodeRecord().record.minReaderVer`: never lowered when a record read from a newer writer is pushed again. */
  minReaderVer?: number
}

/** One item of `sn_push` (before `baseVersion` is added by the push worker). */
export interface EncodedRecord {
  kind: RecordKind
  recId: string
  payload: Obj
  payloadHash: string
  schemaVer: number
  minReaderVer: number
  appVer: string
  editedAt: string
  deleted: boolean
}

function parseUnknown(json: string | null | undefined, kind: RecordKind): Obj {
  if (json === null || json === undefined || json === '') return {}
  let v: unknown
  try { v = JSON.parse(json) } catch { throw new TypeError('encodeRecord: unknownJson is not valid JSON') }
  if (!isObj(v)) throw new TypeError('encodeRecord: unknownJson must be an object')
  const known = KNOWN_DATA_KEYS[kind]
  const out: Obj = {}
  // A known or reserved key in the unknown bag would let stale data override what this build just wrote: it never wins.
  for (const k of Object.keys(v)) if (!known.includes(k) && !(RESERVED_KEYS as readonly string[]).includes(k)) out[k] = v[k]
  return out
}

/** The payload to store / send: unknown fields first, then the known fields, then the three reserved keys (which always win). */
function buildPayload(kind: RecordKind, data: Obj, deleted: boolean, unknown: Obj): Obj {
  const out: Obj = { ...unknown }
  for (const k of KNOWN_DATA_KEYS[kind]) if (data[k] !== undefined) out[k] = data[k]
  out.v = PAYLOAD_V
  out.kind = kind
  out.deleted = deleted
  return out
}

function stripKeys(o: unknown, skip: readonly string[]): unknown {
  if (!isObj(o)) return o
  const out: Obj = {}
  for (const k of Object.keys(o)) if (!skip.includes(k)) out[k] = o[k]
  return out
}

/** The content the hash is taken over: the payload minus the per-kind volatile fields (the `deleted` flag stays in). */
export function contentOf(kind: RecordKind, payload: Obj): Obj {
  const skip = HASH_SKIP[kind]
  const out: Obj = {}
  for (const k of Object.keys(payload)) {
    const v = payload[k]
    const s = skip[k]
    out[k] = s ? stripKeys(v, s) : v
  }
  if (kind === 'bill' && Array.isArray(out.rows)) {
    out.rows = [...(out.rows as unknown[])].sort((a, b) => (isObj(a) && isObj(b) ? (Number(a.idx) || 0) - (Number(b.idx) || 0) : 0))
  }
  return out
}

/** Content hash of a payload (sha-256 hex of its canonical content JSON). Same content on two computers = same hash. */
export const hashPayload = (kind: RecordKind, payload: Obj): string => sha256Hex(canonicalJson(contentOf(kind, payload)))

export function encodeRecord(input: EncodeInput): EncodedRecord {
  if (!isRecordKind(input.kind)) throw new TypeError(`encodeRecord: unknown kind ${String(input.kind)}`)
  if (typeof input.recId !== 'string' || input.recId === '') throw new TypeError('encodeRecord: recId is required')
  if (typeof input.editedAt !== 'string' || input.editedAt === '') throw new TypeError('encodeRecord: editedAt is required')
  const parsed = DATA_SCHEMAS[input.kind].safeParse(input.data)
  if (!parsed.success) throw new TypeError(`encodeRecord: ${input.kind} data is not valid: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  const payload = buildPayload(input.kind, parsed.data as Obj, input.deleted, parseUnknown(input.unknownJson, input.kind))
  const floor = Number.isInteger(input.minReaderVer) && (input.minReaderVer as number) >= 1 ? (input.minReaderVer as number) : 1
  return {
    kind: input.kind,
    recId: input.recId,
    payload,
    payloadHash: hashPayload(input.kind, payload),
    schemaVer: SCHEMA_VER,
    minReaderVer: Math.max(MIN_READER_VER_BY_KIND[input.kind], floor),
    appVer: input.appVer,
    editedAt: input.editedAt,
    deleted: input.deleted
  }
}

// ------------------------------------------------------------------------------------------------------------------------ decode

/** A record as the server returns it (`sn_pull` row, camelCase as `SharedStoreTransport` hands it over). */
export interface RawRecord {
  kind: string
  recId: string
  version: number
  serverSeq?: number
  payload: unknown
  schemaVer: number
  minReaderVer: number
  appVer?: string
  editedAt?: string
  deleted?: boolean
}

export interface DecodedRecord {
  kind: RecordKind
  recId: string
  version: number
  serverSeq: number
  deleted: boolean
  /** Known top-level fields, validated (`{ bill, rows }` etc.). Nested unknown fields are still inside. */
  data: Obj
  /** Canonical JSON of the unknown optional top-level fields, or null when there are none. Pass back to `encodeRecord`. */
  unknownJson: string | null
  schemaVer: number
  minReaderVer: number
  appVer: string
  editedAt: string
  payloadHash: string
}

export type AsideReason = 'newer_reader_required' | 'unknown_kind'

export type DecodeResult =
  | { outcome: 'apply'; record: DecodedRecord }
  | { outcome: 'aside'; reason: AsideReason; kind: string; recId: string; version: number; minReaderVer: number }
  | { outcome: 'invalid'; reason: string }

const posInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1

/**
 * Reads one server record. The version check comes FIRST and never looks at the payload: a newer writer's payload may not even
 * validate with this build's schemas, and it must be kept as it is. `invalid` is for damage (same or older writer, bad data); it is
 * never set aside silently - the caller counts and logs it (no payload content in logs).
 */
export function decodeRecord(raw: RawRecord, readerVer: number = READER_VER): DecodeResult {
  if (!isObj(raw) || typeof raw.recId !== 'string' || raw.recId === '' || typeof raw.kind !== 'string') return { outcome: 'invalid', reason: 'record envelope is incomplete' }
  if (!posInt(raw.schemaVer) || !posInt(raw.minReaderVer) || !posInt(raw.version)) return { outcome: 'invalid', reason: 'record version numbers are missing or not whole numbers' }
  if (!isRecordKind(raw.kind)) {
    return { outcome: 'aside', reason: 'unknown_kind', kind: raw.kind, recId: raw.recId, version: raw.version, minReaderVer: raw.minReaderVer }
  }
  if (raw.minReaderVer > readerVer) {
    return { outcome: 'aside', reason: 'newer_reader_required', kind: raw.kind, recId: raw.recId, version: raw.version, minReaderVer: raw.minReaderVer }
  }
  const p = raw.payload
  if (!isObj(p)) return { outcome: 'invalid', reason: 'payload is not an object' }
  if (p.v !== PAYLOAD_V) return { outcome: 'invalid', reason: 'payload format number is not 2' }
  if (p.kind !== raw.kind) return { outcome: 'invalid', reason: 'payload kind does not match the record kind' }
  if (typeof p.deleted !== 'boolean') return { outcome: 'invalid', reason: 'payload has no deleted flag' }
  if (raw.deleted !== undefined && raw.deleted !== p.deleted) return { outcome: 'invalid', reason: 'deleted flag differs between the record and its payload' }
  const parsed = DATA_SCHEMAS[raw.kind].safeParse(p)
  if (!parsed.success) return { outcome: 'invalid', reason: `${raw.kind} data is not valid: ${parsed.error.issues[0]?.message ?? 'unknown'}` }

  const known = KNOWN_DATA_KEYS[raw.kind]
  const data: Obj = {}
  for (const k of known) data[k] = (parsed.data as Obj)[k]
  const unknown: Obj = {}
  for (const k of Object.keys(p)) if (!known.includes(k) && !(RESERVED_KEYS as readonly string[]).includes(k)) unknown[k] = p[k]
  return {
    outcome: 'apply',
    record: {
      kind: raw.kind,
      recId: raw.recId,
      version: raw.version,
      serverSeq: typeof raw.serverSeq === 'number' ? raw.serverSeq : 0,
      deleted: p.deleted,
      data,
      unknownJson: Object.keys(unknown).length > 0 ? canonicalJson(unknown) : null,
      schemaVer: raw.schemaVer,
      minReaderVer: raw.minReaderVer,
      appVer: typeof raw.appVer === 'string' ? raw.appVer : '',
      editedAt: typeof raw.editedAt === 'string' ? raw.editedAt : '',
      payloadHash: hashPayload(raw.kind, p)
    }
  }
}

// --------------------------------------------------------------------------------------------------------------------- aside rows

/** What `sync_aside.payload_json` holds: the whole record envelope, so a retry can decode and apply it exactly as it arrived. */
export interface AsideEnvelope {
  payload: unknown
  schemaVer: number
  appVer: string
  editedAt: string
  serverSeq: number
  deleted: boolean | null
}

export function asideEnvelopeJson(raw: RawRecord): string {
  const env: AsideEnvelope = {
    payload: raw.payload ?? null, schemaVer: raw.schemaVer, appVer: raw.appVer ?? '', editedAt: raw.editedAt ?? '',
    serverSeq: raw.serverSeq ?? 0, deleted: typeof raw.deleted === 'boolean' ? raw.deleted : null
  }
  return canonicalJson(env)
}

export interface AsideRowLike { kind: string; recId: string; version: number; minReaderVer: number; payloadJson: string }

/** Rebuilds the server record from a `sync_aside` row (null when the stored JSON is damaged). */
export function rawFromAside(row: AsideRowLike): RawRecord | null {
  let env: unknown
  try { env = JSON.parse(row.payloadJson) } catch { return null }
  if (!isObj(env) || !posInt(env.schemaVer)) return null
  return {
    kind: row.kind, recId: row.recId, version: row.version, minReaderVer: row.minReaderVer, payload: env.payload,
    schemaVer: env.schemaVer as number, appVer: typeof env.appVer === 'string' ? env.appVer : '',
    editedAt: typeof env.editedAt === 'string' ? env.editedAt : '', serverSeq: typeof env.serverSeq === 'number' ? env.serverSeq : 0,
    ...(typeof env.deleted === 'boolean' ? { deleted: env.deleted } : {})
  }
}
