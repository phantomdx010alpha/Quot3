/**
 * Phase 259 - master build constants (API_CONTRACTS.md M24-0 C1 / C6). The master project's URL and PUBLIC anon key are
 * build-time constants: the anon key opens nothing by itself (RLS on, no policy). They are EMPTY in source on purpose
 * [A]: the owner fills them in when the master project exists (Phase 273 checklist); until then `isMasterConfigured()` is
 * false and no client makes a master call (test T21). Never put a service_role key or the MASTER_KEK here.
 */

export const MASTER_URL: string = 'https://mlejwzywyqkljpejerli.supabase.co'
export const MASTER_ANON: string = 'sb_publishable_eYd_Rj5LlFI0NzGd48lMEA_a0aN4916'

/** The thirteen function names, in contract order F1..F13. */
export const MASTER_FUNCTION_NAMES = [
  'redeem', 'adopt', 'refresh', 'heartbeat', 'profile-get', 'profile-set',
  'seat-list', 'seat-create', 'seat-reset', 'seat-revoke', 'seat-rename', 'seat-regen', 'enrol'
] as const
export type MasterFunctionName = (typeof MASTER_FUNCTION_NAMES)[number]

/** Body size cap of every function (logo included), in bytes. */
export const MASTER_MAX_BODY_BYTES = 400 * 1024
/** Client timeout and number of retries (network error or 5xx only). */
export const MASTER_TIMEOUT_MS = 10_000
export const MASTER_RETRIES = 1
/** Wire version every body carries (`v: 1`). */
export const MASTER_WIRE_VERSION = 1

export function isMasterConfigured(url: string = MASTER_URL, anon: string = MASTER_ANON): boolean {
  return /^https:\/\/[^\s/]+/i.test(url.trim()) && anon.trim().length > 20
}

/** `https://x.supabase.co` + `redeem` -> `https://x.supabase.co/functions/v1/redeem` (trailing slashes tolerated). */
export function masterFunctionUrl(base: string, name: MasterFunctionName): string {
  return `${base.trim().replace(/\/+$/, '')}/functions/v1/${name}`
}

/** The fixed request headers (C1). `deviceToken` adds `x-q3-device` for device-authenticated functions. */
export function masterHeaders(anon: string, deviceToken?: string): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    apikey: anon,
    authorization: `Bearer ${anon}`
  }
  if (deviceToken) h['x-q3-device'] = deviceToken
  return h
}
