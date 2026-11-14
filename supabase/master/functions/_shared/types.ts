/**
 * Phase 260 - the seams of the master Edge Functions. Handlers are plain functions `(Request, Deps) => Response`; every
 * outside thing (master tables, the company project, the clock, randomness, the key) is injected, so vitest runs them
 * against an in-memory fake and Deno runs them against `deps.ts`. Row names follow API_CONTRACTS.md M24-0 C3.
 * No Deno / Node-only import: this file must type-check under both.
 */

export interface CompanyRow {
  id: string
  label: string
  org_id: string
  supabase_url: string
  anon_key: string
  license_key_enc: string
  service_role_enc: string
  status: 'active' | 'suspended'
  max_seats: number
  profile: { name?: string; phone?: string; address?: string; logo?: string | null }
  profile_version: number
}

export interface SeatRow {
  company_id: string
  seat_no: number
  label: string
  email: string | null
  auth_user_id: string | null
  password_enc: string | null
  code_hash: string | null
  code_enc: string | null
  code_hint: string | null
  legacy: boolean
  status: 'active' | 'revoked'
  created_at: string
  reset_at: string | null
}

export interface DeviceRow {
  id: string
  company_id: string
  seat_no: number
  token_hash: string
  label: string
  platform: 'desktop' | 'phone'
  app_version: string
  created_at: string
  last_seen_at: string | null
}

export interface LogEntry {
  company_id: string | null
  seat_no: number | null
  action: string
  req_id: string | null
  /** `ok` or an error code only. Never a secret. */
  detail: string
}

/** The master's tables, as the functions need them. The real one is `pgrest.ts`; tests use `src/__tests__/master/fakes.ts`. */
export interface MasterDb {
  findSeatByCodeHash(hash: string): Promise<{ seat: SeatRow; company: CompanyRow } | null>
  findCompanyById(id: string): Promise<CompanyRow | null>
  findCompanyByUrl(normalisedUrl: string): Promise<CompanyRow | null>
  findSeat(companyId: string, seatNo: number): Promise<SeatRow | null>
  findSeatByAuthUser(companyId: string, userId: string): Promise<SeatRow | null>
  findSeatByEmail(companyId: string, email: string): Promise<SeatRow | null>
  updateSeat(companyId: string, seatNo: number, patch: Partial<SeatRow>): Promise<void>
  insertDevice(row: Omit<DeviceRow, 'id' | 'created_at' | 'last_seen_at'>): Promise<DeviceRow>
  findDeviceByTokenHash(hash: string): Promise<DeviceRow | null>
  touchDevice(id: string, atIso: string): Promise<void>
  /** Failed tries from this ip hash since `sinceIso` (the real database uses its own 15-minute window). */
  attemptsRecent(ipHash: string, sinceIso: string): Promise<number>
  recordAttempt(ipHash: string, ok: boolean, atIso: string): Promise<void>
  log(entry: LogEntry): Promise<void>
  // ---- Phase 261 (seat admin, profile-set, enrol) ----
  listSeats(companyId: string): Promise<SeatRow[]>
  listDevices(companyId: string): Promise<DeviceRow[]>
  /** Insert a seat row, or replace the row of the same (company, seat_no). */
  upsertSeat(row: SeatRow): Promise<void>
  deleteDevicesOfSeat(companyId: string, seatNo: number): Promise<void>
  updateCompany(id: string, patch: Partial<Pick<CompanyRow, 'profile' | 'profile_version'>>): Promise<void>
  /** Idempotency (D8): write the `master_log` row of (company, action, reqId); false = that row already exists. */
  claimRequest(companyId: string, action: string, reqId: string, seatNo: number): Promise<boolean>
  /** Undo a claim after a failure that changed nothing, so the same `reqId` may be retried. */
  releaseRequest(companyId: string, action: string, reqId: string): Promise<void>
  findCompanyByLabel(label: string): Promise<CompanyRow | null>
  findEnrolToken(tokenHash: string): Promise<EnrolTokenRow | null>
  /** Enrol: insert the company, its seats and seat 1's device, and mark the token used. null = the token was used meanwhile. */
  registerCompany(input: { company: CompanyRow; seats: SeatRow[]; device: Omit<DeviceRow, 'id' | 'created_at' | 'last_seen_at'>; tokenHash: string; usedAtIso: string }): Promise<DeviceRow | null>
}

export interface EnrolTokenRow {
  token_hash: string
  company_label: string
  expires_at: string
  used_at: string | null
}

/** A company-project call that failed: `unreachable` (network / timeout / 5xx) -> Q3M11, `refused` (4xx) -> Q3M12. */
export class CompanyCallError extends Error {
  constructor(public readonly kind: 'unreachable' | 'refused') {
    super(`company call ${kind}`)
    this.name = 'CompanyCallError'
  }
}

/** The company project, reached with the company's own anon key (never its service_role key in Phase 260). */
export interface CompanyClient {
  /** `GET /auth/v1/user` with the company anon key and the device's access token. null = the session is not valid. */
  getUser(company: { supabase_url: string; anon_key: string }, accessToken: string): Promise<{ id: string; email: string | null } | null>
  /** Phase 261: `POST /rest/v1/rpc/<fn>` with the company's service_role key. Throws `CompanyCallError`. The key is never logged. */
  adminRpc(company: { supabase_url: string }, serviceRoleKey: string, fn: string, args: Record<string, unknown>): Promise<unknown>
  /** Phase 261: `GET /rest/v1/<path>` (a PostgREST query string) with the service_role key. Throws `CompanyCallError`. */
  adminSelect(company: { supabase_url: string }, serviceRoleKey: string, path: string): Promise<unknown[]>
}

export interface Deps {
  db: MasterDb
  company: CompanyClient
  /** `MASTER_KEK`, 32 bytes. */
  kek: Uint8Array
  /** `MASTER_PEPPER`. */
  pepper: string
  /** `ALLOWED_ORIGIN` (the PWA origin; '' = no CORS origin header). */
  allowedOrigin: string
  now: () => Date
  randomBytes: (n: number) => Uint8Array
  /** One already-redacted line for the function log. */
  log: (line: string) => void
}
