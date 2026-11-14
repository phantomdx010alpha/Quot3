/**
 * Phase 260 - in-memory fake master + fake company project for the Edge Function tests (reused by Phase 261).
 * Not production code: lives under `__tests__`.
 */
import { aadLicense, aadSeatCode, aadSeatPassword, aadServiceRole } from '../../../supabase/master/functions/_shared/aad'
import { CompanyCallError, type CompanyClient, type CompanyRow, type Deps, type DeviceRow, type EnrolTokenRow, type LogEntry, type MasterDb, type SeatRow } from '../../../supabase/master/functions/_shared/types'
import { b64urlEncode, openText, sealText, seatCodeHash, sha256Hex } from '../../shared/master/seal'
import { generateSeatCode, seatCodeChars } from '../../shared/master/seatCode'

export const KEK = Uint8Array.from({ length: 32 }, (_, i) => 200 - i)
export const PEPPER = 'test-pepper'
export const ORIGIN = 'https://phone.example.invalid'

export class FakeMaster implements MasterDb {
  companies: CompanyRow[] = []
  seats: SeatRow[] = []
  devices: DeviceRow[] = []
  attempts: Array<{ ip: string; ok: boolean; at: string }> = []
  logs: LogEntry[] = []
  touches = 0
  private n = 0

  async findSeatByCodeHash(hash: string) {
    const seat = this.seats.find((s) => s.code_hash === hash)
    const company = seat && this.companies.find((c) => c.id === seat.company_id)
    return seat && company ? { seat: { ...seat }, company: { ...company } } : null
  }
  async findCompanyById(id: string) { return this.clone(this.companies.find((c) => c.id === id)) }
  async findCompanyByUrl(url: string) { return this.clone(this.companies.find((c) => c.supabase_url.toLowerCase() === url)) }
  async findSeat(companyId: string, no: number) { return this.clone(this.seats.find((s) => s.company_id === companyId && s.seat_no === no)) }
  async findSeatByAuthUser(companyId: string, userId: string) { return this.clone(this.seats.find((s) => s.company_id === companyId && s.auth_user_id === userId)) }
  async findSeatByEmail(companyId: string, email: string) {
    return this.clone(this.seats.find((s) => s.company_id === companyId && s.email?.toLowerCase() === email.toLowerCase()))
  }
  async updateSeat(companyId: string, no: number, patch: Partial<SeatRow>) {
    const s = this.seats.find((x) => x.company_id === companyId && x.seat_no === no)
    if (s) Object.assign(s, patch)
  }
  async insertDevice(row: Omit<DeviceRow, 'id' | 'created_at' | 'last_seen_at'>) {
    const d: DeviceRow = { ...row, id: `dev-${++this.n}`, created_at: new Date().toISOString(), last_seen_at: null }
    this.devices.push(d)
    return { ...d }
  }
  async findDeviceByTokenHash(hash: string) { return this.clone(this.devices.find((d) => d.token_hash === hash)) }
  async touchDevice(id: string, at: string) {
    this.touches++
    const d = this.devices.find((x) => x.id === id)
    if (d) d.last_seen_at = at
  }
  async attemptsRecent(ip: string, since: string) {
    return this.attempts.filter((a) => a.ip === ip && !a.ok && a.at >= since).length
  }
  async recordAttempt(ip: string, ok: boolean, at: string) { this.attempts.push({ ip, ok, at }) }
  async log(e: LogEntry) { this.logs.push(e) }
  // ---- Phase 261 ----
  claims = new Set<string>()
  enrolTokens: EnrolTokenRow[] = []
  failMasterWrite = false
  async listSeats(companyId: string) { return this.seats.filter((s) => s.company_id === companyId).map((s) => ({ ...s })).sort((a, b) => a.seat_no - b.seat_no) }
  async listDevices(companyId: string) { return this.devices.filter((d) => d.company_id === companyId).map((d) => ({ ...d })) }
  async upsertSeat(row: SeatRow) {
    if (this.failMasterWrite) throw new Error('master write failed')
    const i = this.seats.findIndex((s) => s.company_id === row.company_id && s.seat_no === row.seat_no)
    if (i >= 0) this.seats[i] = { ...row }
    else this.seats.push({ ...row })
  }
  async deleteDevicesOfSeat(companyId: string, no: number) { this.devices = this.devices.filter((d) => !(d.company_id === companyId && d.seat_no === no)) }
  async updateCompany(id: string, patch: Partial<Pick<CompanyRow, 'profile' | 'profile_version'>>) {
    const c = this.companies.find((x) => x.id === id)
    if (c) Object.assign(c, patch)
  }
  async claimRequest(companyId: string, action: string, reqId: string) {
    const k = `${companyId}|${action}|${reqId}`
    if (this.claims.has(k)) return false
    this.claims.add(k)
    return true
  }
  async releaseRequest(companyId: string, action: string, reqId: string) { this.claims.delete(`${companyId}|${action}|${reqId}`) }
  async findCompanyByLabel(label: string) { return this.clone(this.companies.find((c) => c.label === label)) }
  async findEnrolToken(hash: string) { return this.clone(this.enrolTokens.find((t) => t.token_hash === hash)) }
  async registerCompany(input: { company: CompanyRow; seats: SeatRow[]; device: Omit<DeviceRow, 'id' | 'created_at' | 'last_seen_at'>; tokenHash: string; usedAtIso: string }) {
    const t = this.enrolTokens.find((x) => x.token_hash === input.tokenHash)
    if (!t || t.used_at) return null
    t.used_at = input.usedAtIso
    this.companies.push({ ...input.company })
    for (const s of input.seats) this.seats.push({ ...s })
    return this.insertDevice(input.device)
  }
  private clone<T>(x: T | undefined): T | null { return x ? { ...x } : null }
}

/** The company project: access token -> user. */
export class FakeCompany implements CompanyClient {
  sessions = new Map<string, { id: string; email: string | null }>()
  down = false
  calls = 0
  // ---- Phase 261: the company's own tables behind the service_role key ----
  serviceKey = 'service-role-key-secret'
  orgId = '22222222-2222-4222-8222-222222222222'
  members: Array<{ seat_no: number; user_id: string }> = []
  rpcLog: Array<{ fn: string; args: Record<string, unknown>; key: string }> = []
  failRpc: 'unreachable' | 'refused' | null = null
  /** Force the number `qt_add_seats` returns (to test a number above 15). */
  forceSeatNo: number | null = null
  passwordCounter = 0
  async adminRpc(_c: { supabase_url: string }, key: string, fn: string, args: Record<string, unknown>) {
    this.rpcLog.push({ fn, args, key })
    if (this.failRpc) throw new CompanyCallError(this.failRpc)
    if (key !== this.serviceKey) throw new CompanyCallError('refused')
    const pw = () => `fresh-pw-${++this.passwordCounter}`
    if (fn === 'qt_add_seats') {
      const no = this.forceSeatNo ?? Math.max(0, ...this.members.map((m) => m.seat_no)) + 1
      this.members.push({ seat_no: no, user_id: `user-${no}` })
      return [{ seat_no: no, email: `shop-a-${no}@quot3.example.com`, password: pw() }]
    }
    if (fn === 'qt_reset_seat') {
      const no = args.p_seat_no as number
      if (!this.members.some((m) => m.seat_no === no)) throw new CompanyCallError('refused')
      return [{ seat_no: no, email: `shop-a-${no}@quot3.example.com`, password: pw() }]
    }
    if (fn === 'qt_revoke_seat') {
      const no = args.p_seat_no as number
      if (!this.members.some((m) => m.seat_no === no)) throw new CompanyCallError('refused')
      this.members = this.members.filter((m) => m.seat_no !== no)
      return `seat ${no} revoked`
    }
    throw new CompanyCallError('refused')
  }
  async adminSelect(_c: { supabase_url: string }, key: string, path: string) {
    this.rpcLog.push({ fn: `select:${path.split('?')[0]}`, args: {}, key })
    if (this.failRpc) throw new CompanyCallError(this.failRpc)
    if (key !== this.serviceKey) throw new CompanyCallError('refused')
    if (path.startsWith('licenses')) return [{ org_id: this.orgId }]
    if (path.startsWith('sn_members')) return this.members.map((m) => ({ ...m }))
    return []
  }
  async getUser(_c: { supabase_url: string; anon_key: string }, token: string) {
    this.calls++
    if (this.down) throw new Error('company down')
    return this.sessions.get(token) ?? null
  }
}

export interface World {
  master: FakeMaster
  company: FakeCompany
  deps: Deps
  clock: { t: number }
  logLines: string[]
}

export function world(): World {
  const master = new FakeMaster()
  const company = new FakeCompany()
  const clock = { t: Date.parse('2026-11-13T10:00:00Z') }
  const logLines: string[] = []
  let ctr = 0
  const deps: Deps = {
    db: master, company, kek: KEK, pepper: PEPPER, allowedOrigin: ORIGIN,
    now: () => new Date(clock.t),
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (++ctr * 31 + i * 7) & 255),
    log: (l) => logLines.push(l)
  }
  return { master, company, deps, clock, logLines }
}

export const COMPANY_ID = '11111111-1111-4111-8111-111111111111'
export const COMPANY_URL = 'https://abcd.supabase.co'
export const LICENSE = 'Q3-ABCD-EFGH-IJKL'

export async function seedCompany(w: World, over: Partial<CompanyRow> = {}): Promise<CompanyRow> {
  const c: CompanyRow = {
    id: COMPANY_ID, label: 'Shop A', org_id: '22222222-2222-4222-8222-222222222222', supabase_url: COMPANY_URL,
    anon_key: 'company-anon-key-value', license_key_enc: await sealText(KEK, LICENSE, aadLicense(COMPANY_ID)),
    service_role_enc: await sealText(KEK, 'service-role-key-secret', aadServiceRole(COMPANY_ID)), status: 'active', max_seats: 15, profile: {}, profile_version: 0, ...over
  }
  w.master.companies.push(c)
  return c
}

export interface SeededSeat { seat: SeatRow; code: string; password: string }

/** An active seat with a sealed password and a code (unless `legacy`). */
export async function seedSeat(
  w: World, no: number, opts: { legacy?: boolean; status?: 'active' | 'revoked'; randomSeed?: number; userId?: string } = {}
): Promise<SeededSeat> {
  const password = `pw-seat-${no}-secret`
  const code = generateSeatCode(Uint8Array.from({ length: 15 }, (_, i) => (i * 5 + no * 3 + (opts.randomSeed ?? 0)) & 255))
  const legacy = opts.legacy === true
  const revoked = opts.status === 'revoked'
  const seat: SeatRow = {
    company_id: COMPANY_ID, seat_no: no, label: `Seat ${no}`, email: `seat${no}@shop.invalid`, auth_user_id: opts.userId ?? `user-${no}`,
    password_enc: legacy ? null : await sealText(KEK, password, aadSeatPassword(COMPANY_ID, no)),
    code_hash: legacy || revoked ? null : await seatCodeHash(seatCodeChars(code)),
    code_enc: legacy || revoked ? null : await sealText(KEK, code, aadSeatCode(COMPANY_ID, no)),
    code_hint: legacy || revoked ? null : code.slice(-4), legacy, status: opts.status ?? 'active',
    created_at: '2026-11-01T00:00:00Z', reset_at: null
  }
  w.master.seats.push(seat)
  return { seat, code, password }
}

export function post(fn: string, body: unknown, headers: Record<string, string> = {}, ip = '203.0.113.7'): Request {
  return new Request(`https://master.example.invalid/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: JSON.stringify(body)
  })
}

export const deviceTokenOf = (b64urlBytes: Uint8Array): string => b64urlEncode(b64urlBytes)
export { openText, sha256Hex }
