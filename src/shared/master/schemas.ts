/**
 * Phase 259 - zod schemas for everything the master sends or receives (API_CONTRACTS.md M24-0 C5): the shared types
 * `ProfileView`, `SeatView`, `Bundle`, one request and one response schema per function F1..F13, and the failure body.
 * Desktop, phone and the Edge Functions all parse with THESE. Pure: no Electron / Node / DOM.
 */
import { z } from 'zod'
import { LICENSE_KEY_RE } from '../sync/license'
import { isMasterErrorCode, type MasterErrorCode } from './errors'

// ---- limits (C5) -------------------------------------------------------------------------------------------------------
export const PROFILE_TEXT_MAX = 200
export const LOGO_MAX_BYTES = 150 * 1024
export const SEAT_LABEL_MAX = 40
export const SEATS_MAX = 15

/** Decoded size of a standard base64 string (padding counted), without decoding it. */
export function base64DecodedLength(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - pad
}
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

// ---- small building blocks ---------------------------------------------------------------------------------------------
const wire = z.literal(1)
const platform = z.enum(['desktop', 'phone'])
const appVersion = z.string().min(1).max(32)
const deviceLabel = z.string().max(80)
const httpUrl = z.string().max(300).regex(/^https?:\/\/[^\s/]+/i)
const anonKey = z.string().min(1).max(2048)
const token = z.string().min(1).max(4096)
const reqId = z.uuid()
const seatNo = z.number().int().min(1).max(SEATS_MAX)
const seatLabel = z.string().trim().min(1).max(SEAT_LABEL_MAX)
const iso = z.string().min(10).max(40)
const status2 = z.enum(['active', 'suspended'])

// ---- shared types ------------------------------------------------------------------------------------------------------
/** The company profile. `logo` = base64 of a PNG, <= 150 KB decoded, no `data:` prefix. */
export const ProfileViewSchema = z.object({
  version: z.number().int().min(0),
  name: z.string().max(PROFILE_TEXT_MAX),
  phone: z.string().max(PROFILE_TEXT_MAX),
  address: z.string().max(PROFILE_TEXT_MAX),
  logo: z.string().regex(BASE64_RE).refine((s) => base64DecodedLength(s) <= LOGO_MAX_BYTES).nullable()
})
export type ProfileView = z.infer<typeof ProfileViewSchema>

/** What the admin sees for a seat. `code` is the full seat code (only to seat 1); the password is NEVER in this shape. */
export const SeatViewSchema = z.object({
  no: seatNo,
  label: z.string().max(SEAT_LABEL_MAX),
  email: z.string().nullable(),
  status: z.enum(['active', 'revoked']),
  legacy: z.boolean(),
  code: z.string().nullable(),
  codeHint: z.string().max(8).nullable(),
  createdAt: iso,
  resetAt: iso.nullable(),
  devices: z.number().int().min(0),
  lastSeenAt: iso.nullable()
})
export type SeatView = z.infer<typeof SeatViewSchema>

export const BUNDLE_VERSION = 1
/** What `redeem` returns: everything a new device needs. Version other than 1 is refused by `parseBundle` (Q3M92). */
export const BundleSchema = z.object({
  v: wire,
  company: z.object({ id: z.string().min(1).max(64), label: z.string().min(1).max(80) }),
  supabaseUrl: httpUrl,
  anonKey,
  license: z.string().regex(LICENSE_KEY_RE),
  seat: z.object({ no: seatNo, email: z.string().min(3).max(320), password: z.string().min(1).max(256) }),
  profile: ProfileViewSchema.nullable(),
  deviceToken: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/)
})
export type Bundle = z.infer<typeof BundleSchema>

/** `{ ok: false, code, error, message }`. */
export const ErrorBodySchema = z.object({
  ok: z.literal(false),
  code: z.string().refine(isMasterErrorCode, 'unknown master error code'),
  error: z.string().min(1).max(64),
  message: z.string().min(1).max(300)
})
export type ErrorBody = { ok: false; code: MasterErrorCode; error: string; message: string }

// ---- requests F1..F13 (every body carries `v: 1`) ---------------------------------------------------------------------
export const RedeemRequestSchema = z.object({ v: wire, code: z.string().min(1).max(64), platform, deviceLabel: deviceLabel.optional(), appVersion })
export const AdoptRequestSchema = z.object({ v: wire, supabaseUrl: httpUrl, accessToken: token, platform, deviceLabel: deviceLabel.optional(), appVersion })
export const RefreshRequestSchema = z.object({ v: wire })
export const HeartbeatRequestSchema = z.object({ v: wire, profileVersion: z.number().int().min(0).nullable(), appVersion })
export const ProfileGetRequestSchema = z.object({ v: wire })
/** Text lengths and the logo size are NOT limited here: over-size is Q3M18 (`profileTooLarge`), not "bad request". */
export const ProfileSetRequestSchema = z.object({
  v: wire,
  reqId,
  expectVersion: z.number().int().min(0).optional(),
  name: z.string(),
  phone: z.string(),
  address: z.string(),
  logo: z.string().nullable().optional()
})
export const SeatListRequestSchema = z.object({ v: wire })
export const SeatCreateRequestSchema = z.object({ v: wire, reqId, label: seatLabel })
export const SeatResetRequestSchema = z.object({ v: wire, reqId, seatNo })
export const SeatRevokeRequestSchema = z.object({ v: wire, reqId, seatNo })
export const SeatRenameRequestSchema = z.object({ v: wire, seatNo, label: seatLabel })
export const SeatRegenRequestSchema = z.object({ v: wire, reqId, seatNo })
export const EnrolRequestSchema = z.object({
  v: wire,
  enrolToken: z.string().min(1).max(200),
  label: z.string().trim().min(1).max(80),
  supabaseUrl: httpUrl,
  anonKey,
  license: z.string().regex(LICENSE_KEY_RE),
  accessToken: token,
  serviceRoleKey: token,
  platform,
  appVersion
})

// ---- responses (success side; failures are `ErrorBodySchema`) ----------------------------------------------------------
const ok = z.literal(true)
const companyRef = z.object({ id: z.string().min(1).max(64), label: z.string().min(1).max(80) })

export const RedeemResponseSchema = z.object({ ok, bundle: BundleSchema })
export const AdoptResponseSchema = z.object({
  ok,
  deviceToken: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/).nullable(),
  existing: z.boolean(),
  company: companyRef,
  seat: z.object({ no: seatNo, label: z.string().max(SEAT_LABEL_MAX) }),
  profile: ProfileViewSchema.nullable()
})
export const RefreshResponseSchema = z.object({
  ok,
  supabaseUrl: httpUrl,
  anonKey,
  license: z.string().regex(LICENSE_KEY_RE),
  seat: z.object({ no: seatNo, email: z.string().min(3).max(320), password: z.string().min(1).max(256).nullable() }),
  legacy: z.boolean()
})
export const HeartbeatResponseSchema = z.object({
  ok,
  profileVersion: z.number().int().min(0),
  profileChanged: z.boolean(),
  seat: z.object({ no: seatNo, label: z.string().max(SEAT_LABEL_MAX), status: z.enum(['active', 'revoked']) }),
  company: z.object({ status: status2 }),
  serverTime: iso
})
export const ProfileGetResponseSchema = z.object({ ok, profile: ProfileViewSchema })
export const ProfileSetResponseSchema = z.object({ ok, profile: ProfileViewSchema })
export const SeatListResponseSchema = z.object({
  ok,
  company: z.object({ id: z.string().min(1).max(64), label: z.string().min(1).max(80), maxSeats: z.number().int().min(1).max(SEATS_MAX), status: status2 }),
  seats: z.array(SeatViewSchema).max(SEATS_MAX)
})
const seatOne = z.object({ ok, seat: SeatViewSchema })
export const SeatCreateResponseSchema = seatOne
export const SeatResetResponseSchema = seatOne
export const SeatRevokeResponseSchema = seatOne
export const SeatRenameResponseSchema = seatOne
export const SeatRegenResponseSchema = seatOne
export const EnrolResponseSchema = z.object({
  ok,
  deviceToken: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/),
  company: companyRef,
  seats: z.number().int().min(1).max(SEATS_MAX),
  profile: ProfileViewSchema
})

/** Function registry in contract order F1..F13: name, who may call, request and response schema. */
export const MASTER_FUNCTIONS = {
  redeem: { n: 1, auth: 'none', request: RedeemRequestSchema, response: RedeemResponseSchema },
  adopt: { n: 2, auth: 'session', request: AdoptRequestSchema, response: AdoptResponseSchema },
  refresh: { n: 3, auth: 'device', request: RefreshRequestSchema, response: RefreshResponseSchema },
  heartbeat: { n: 4, auth: 'device', request: HeartbeatRequestSchema, response: HeartbeatResponseSchema },
  'profile-get': { n: 5, auth: 'device', request: ProfileGetRequestSchema, response: ProfileGetResponseSchema },
  'profile-set': { n: 6, auth: 'admin', request: ProfileSetRequestSchema, response: ProfileSetResponseSchema },
  'seat-list': { n: 7, auth: 'admin', request: SeatListRequestSchema, response: SeatListResponseSchema },
  'seat-create': { n: 8, auth: 'admin', request: SeatCreateRequestSchema, response: SeatCreateResponseSchema },
  'seat-reset': { n: 9, auth: 'admin', request: SeatResetRequestSchema, response: SeatResetResponseSchema },
  'seat-revoke': { n: 10, auth: 'admin', request: SeatRevokeRequestSchema, response: SeatRevokeResponseSchema },
  'seat-rename': { n: 11, auth: 'admin', request: SeatRenameRequestSchema, response: SeatRenameResponseSchema },
  'seat-regen': { n: 12, auth: 'admin', request: SeatRegenRequestSchema, response: SeatRegenResponseSchema },
  enrol: { n: 13, auth: 'owner-token', request: EnrolRequestSchema, response: EnrolResponseSchema }
} as const

export type MasterFunctionKey = keyof typeof MASTER_FUNCTIONS

// ---- helpers -----------------------------------------------------------------------------------------------------------
export type ParsedRequest<S extends z.ZodType> =
  | { ok: true; value: z.infer<S> }
  | { ok: false; code: 'Q3M19' | 'Q3M03' }

/**
 * Parse a request body for a handler: an unknown wire version `v` is Q3M19, any other shape problem is Q3M03.
 * (Over-size profile text / logo is checked separately with `profileTooLarge` -> Q3M18.)
 */
export function parseRequest<S extends z.ZodType>(schema: S, body: unknown): ParsedRequest<S> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'Q3M03' }
  if ((body as { v?: unknown }).v !== 1) return { ok: false, code: (body as { v?: unknown }).v === undefined ? 'Q3M03' : 'Q3M19' }
  const r = schema.safeParse(body)
  return r.success ? { ok: true, value: r.data } : { ok: false, code: 'Q3M03' }
}

/** True when a profile-set body breaks a size rule (text over 200 characters, or a logo over 150 KB / not base64) -> Q3M18. */
export function profileTooLarge(p: { name: string; phone: string; address: string; logo?: string | null }): boolean {
  if (p.name.length > PROFILE_TEXT_MAX || p.phone.length > PROFILE_TEXT_MAX || p.address.length > PROFILE_TEXT_MAX) return true
  if (p.logo === undefined || p.logo === null) return false
  return !BASE64_RE.test(p.logo) || base64DecodedLength(p.logo) > LOGO_MAX_BYTES
}

export type ParsedBundle =
  | { ok: true; bundle: Bundle }
  | { ok: false; code: 'Q3M92' | 'Q3M93' }

/** Client side of `redeem`: a bundle with `v` other than 1 -> Q3M92 (needs a newer app); one that fails its schema -> Q3M93. */
export function parseBundle(raw: unknown): ParsedBundle {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'Q3M93' }
  const v = (raw as { v?: unknown }).v
  if (typeof v === 'number' && v !== BUNDLE_VERSION) return { ok: false, code: 'Q3M92' }
  const r = BundleSchema.safeParse(raw)
  return r.success ? { ok: true, bundle: r.data } : { ok: false, code: 'Q3M93' }
}

/** The failure body of a response, or null when it is not one. */
export function parseErrorBody(raw: unknown): ErrorBody | null {
  const r = ErrorBodySchema.safeParse(raw)
  return r.success ? (r.data as ErrorBody) : null
}
