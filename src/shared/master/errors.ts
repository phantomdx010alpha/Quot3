/**
 * Phase 259 - the master's error table (API_CONTRACTS.md M24-0 C2): one code, one machine name, one HTTP status and the
 * plain-words sentence the person sees. Desktop, phone and the Edge Functions all read THIS table (test T34), so a
 * sentence is never written twice. Pure: no Electron / Node / DOM.
 */

export interface MasterErrorInfo {
  code: string
  /** Machine name (snake case), sent as `error` in the failure body. */
  error: string
  /** HTTP status the Edge Function answers; 0 for client-only codes (never sent by the server). */
  http: number
  /** Plain words, shown to the user as they are. */
  message: string
}

const e = (code: string, error: string, http: number, message: string): MasterErrorInfo => ({ code, error, http, message })

/** Server codes (HTTP 4xx / 5xx) and the client-only codes Q3M90..Q3M93 (http 0). */
export const MASTER_ERRORS = {
  Q3M01: e('Q3M01', 'invalid_code', 400, 'That code did not work. Check it and try again.'),
  Q3M02: e('Q3M02', 'rate_limited', 429, 'Too many tries. Wait 15 minutes and try again.'),
  Q3M03: e('Q3M03', 'bad_request', 400, 'The request was not understood. Update the app and try again.'),
  Q3M04: e('Q3M04', 'device_unknown', 401, 'This device is not known to the master. Ask the admin for a new code.'),
  Q3M05: e('Q3M05', 'admin_only', 403, 'Only the admin seat (seat 1) can do this.'),
  Q3M06: e('Q3M06', 'company_suspended', 403, 'This company is switched off. Contact the owner.'),
  Q3M07: e('Q3M07', 'seat_revoked', 403, 'This seat was removed. Ask the admin for a new code.'),
  Q3M08: e('Q3M08', 'seat_cap', 409, 'The seat limit of 15 is reached.'),
  Q3M09: e('Q3M09', 'seat_not_found', 404, 'That seat does not exist.'),
  Q3M10: e('Q3M10', 'seat1_protected', 409, 'Seat 1 is the admin seat and cannot be reset or removed here.'),
  Q3M11: e('Q3M11', 'company_unreachable', 502, 'The company database could not be reached. Try again.'),
  Q3M12: e('Q3M12', 'company_refused', 502, 'The company database refused the request. Ask the owner to check the setup.'),
  Q3M13: e('Q3M13', 'duplicate_request', 409, 'That request was already done. Open the seat list to see the result.'),
  Q3M14: e('Q3M14', 'session_invalid', 401, 'Your sign-in to the company could not be verified. Sign in again and retry.'),
  Q3M15: e('Q3M15', 'not_registered', 404, 'This company is not linked to the master yet.'),
  Q3M16: e('Q3M16', 'enrol_invalid', 400, 'That setup token is wrong, used or expired.'),
  Q3M17: e('Q3M17', 'already_registered', 409, 'This company is already linked to the master.'),
  Q3M18: e('Q3M18', 'too_large', 413, 'The logo or a text is too large.'),
  Q3M19: e('Q3M19', 'version_unsupported', 426, 'This app is too old or too new for the master. Update the app and try again.'),
  Q3M20: e('Q3M20', 'profile_conflict', 409, 'The company details were changed elsewhere. Reload and try again.'),
  Q3M21: e('Q3M21', 'seat_legacy', 409, 'This seat has no code yet. Reset it first to make one.'),
  Q3M99: e('Q3M99', 'internal', 500, 'Something went wrong on the master. Try again later.'),
  Q3M90: e('Q3M90', 'master_unreachable', 0, 'Master unreachable, try again.'),
  Q3M91: e('Q3M91', 'code_typo', 0, 'That code has a typo. Check it and try again.'),
  Q3M92: e('Q3M92', 'bundle_version', 0, 'This code needs a newer app. Update the app.'),
  Q3M93: e('Q3M93', 'bundle_invalid', 0, 'The master sent something unreadable. Try again later.')
} as const satisfies Record<string, MasterErrorInfo>

export type MasterErrorCode = keyof typeof MASTER_ERRORS

/** Codes the server can send (everything except the client-only Q3M90..Q3M93). */
export const SERVER_ERROR_CODES = (Object.keys(MASTER_ERRORS) as MasterErrorCode[]).filter((c) => MASTER_ERRORS[c].http !== 0)
/** Codes only a client produces. */
export const CLIENT_ERROR_CODES = (Object.keys(MASTER_ERRORS) as MasterErrorCode[]).filter((c) => MASTER_ERRORS[c].http === 0)

export const isMasterErrorCode = (x: unknown): x is MasterErrorCode =>
  typeof x === 'string' && Object.prototype.hasOwnProperty.call(MASTER_ERRORS, x)

/** The plain-words sentence for a code. An unknown code gets the Q3M99 words (never a raw code or a stack). */
export function masterErrorWords(code: string): string {
  return isMasterErrorCode(code) ? MASTER_ERRORS[code].message : MASTER_ERRORS.Q3M99.message
}

/** The failure body an Edge Function sends (`{ ok:false, code, error, message }`). Unknown code -> Q3M99. */
export function masterErrorBody(code: string): { ok: false; code: MasterErrorCode; error: string; message: string } {
  const info = isMasterErrorCode(code) ? MASTER_ERRORS[code] : MASTER_ERRORS.Q3M99
  return { ok: false, code: info.code as MasterErrorCode, error: info.error, message: info.message }
}

/** HTTP status for a code (Q3M99's 500 for an unknown one; client-only codes also fall back to 500). */
export function masterErrorHttp(code: string): number {
  const info = isMasterErrorCode(code) ? MASTER_ERRORS[code] : MASTER_ERRORS.Q3M99
  return info.http === 0 ? 500 : info.http
}
