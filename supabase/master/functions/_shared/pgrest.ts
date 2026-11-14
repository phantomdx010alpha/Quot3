/**
 * Phase 260 - the REAL `MasterDb`: the master project's own tables through PostgREST with the master's service role.
 * Written to the M01 / M03 columns, NEVER run from the sandbox (untested against a real Postgres: Phase 273 checklist).
 * Only `fetch`; no Deno-only import.
 */
import type { CompanyRow, DeviceRow, EnrolTokenRow, LogEntry, MasterDb, SeatRow } from './types'

export function pgrestDb(baseUrl: string, serviceRoleKey: string, fetchFn: typeof fetch = fetch): MasterDb {
  const root = `${baseUrl.replace(/\/+$/, '')}/rest/v1`
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json', ...extra
  })
  const q = (v: string): string => encodeURIComponent(v)

  async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<unknown> {
    const res = await fetchFn(`${root}/${path}`, { method, headers: headers(extra), body: body === undefined ? undefined : JSON.stringify(body) })
    if (!res.ok) throw new Error(`master db ${method} ${path.split('?')[0]} failed (${res.status})`)
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }
  const one = async <T>(path: string): Promise<T | null> => {
    const rows = (await call('GET', `${path}${path.includes('?') ? '&' : '?'}limit=1`)) as T[]
    return rows[0] ?? null
  }

  return {
    async findSeatByCodeHash(hash) {
      const seat = await one<SeatRow>(`seats?select=*&code_hash=eq.${q(hash)}`)
      if (!seat) return null
      const company = await one<CompanyRow>(`companies?select=*&id=eq.${q(seat.company_id)}`)
      return company ? { seat, company } : null
    },
    findCompanyById: (id) => one<CompanyRow>(`companies?select=*&id=eq.${q(id)}`),
    findCompanyByUrl: (url) => one<CompanyRow>(`companies?select=*&supabase_url=eq.${q(url)}`),
    findSeat: (companyId, no) => one<SeatRow>(`seats?select=*&company_id=eq.${q(companyId)}&seat_no=eq.${no}`),
    findSeatByAuthUser: (companyId, userId) => one<SeatRow>(`seats?select=*&company_id=eq.${q(companyId)}&auth_user_id=eq.${q(userId)}`),
    findSeatByEmail: (companyId, email) => one<SeatRow>(`seats?select=*&company_id=eq.${q(companyId)}&email=ilike.${q(email)}`),
    async updateSeat(companyId, no, patch) {
      await call('PATCH', `seats?company_id=eq.${q(companyId)}&seat_no=eq.${no}`, patch)
    },
    async insertDevice(row) {
      const out = (await call('POST', 'devices', row, { prefer: 'return=representation' })) as DeviceRow[]
      if (!out[0]) throw new Error('master db insert device returned nothing')
      return out[0]
    },
    findDeviceByTokenHash: (hash) => one<DeviceRow>(`devices?select=*&token_hash=eq.${q(hash)}`),
    async touchDevice(id, at) {
      await call('PATCH', `devices?id=eq.${q(id)}`, { last_seen_at: at })
    },
    async attemptsRecent(ipHash) {
      // M03 helper: failures of this ip hash in the last 15 minutes (the window is fixed in SQL).
      return Number(await call('POST', 'rpc/m_attempts_recent', { p_ip_hash: ipHash }))
    },
    async recordAttempt(ipHash, ok, at) {
      await call('POST', 'attempts', { ip_hash: ipHash, ok, at })
    },
    async log(e: LogEntry) {
      await call('POST', 'master_log', e)
    },
    async listSeats(companyId) {
      return (await call('GET', `seats?select=*&company_id=eq.${q(companyId)}&order=seat_no.asc`)) as SeatRow[]
    },
    async listDevices(companyId) {
      return (await call('GET', `devices?select=*&company_id=eq.${q(companyId)}`)) as DeviceRow[]
    },
    async upsertSeat(row) {
      await call('POST', 'seats?on_conflict=company_id,seat_no', row, { prefer: 'resolution=merge-duplicates' })
    },
    async deleteDevicesOfSeat(companyId, no) {
      await call('DELETE', `devices?company_id=eq.${q(companyId)}&seat_no=eq.${no}`)
    },
    async updateCompany(id, patch) {
      await call('PATCH', `companies?id=eq.${q(id)}`, patch)
    },
    async claimRequest(companyId, action, reqId, seatNo) {
      // The partial unique index (company_id, action, req_id) refuses a second row: 409 = already claimed.
      const res = await fetchFn(`${root}/master_log`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ company_id: companyId, seat_no: seatNo, action, req_id: reqId, detail: 'ok' })
      })
      if (res.status === 409) return false
      if (!res.ok) throw new Error(`master db POST master_log failed (${res.status})`)
      return true
    },
    async releaseRequest(companyId, action, reqId) {
      await call('DELETE', `master_log?company_id=eq.${q(companyId)}&action=eq.${q(action)}&req_id=eq.${q(reqId)}`)
    },
    findCompanyByLabel: (label) => one<CompanyRow>(`companies?select=*&label=eq.${q(label)}`),
    findEnrolToken: (hash) => one<EnrolTokenRow>(`enrol_tokens?select=*&token_hash=eq.${q(hash)}`),
    async registerCompany({ company, seats, device, tokenHash, usedAtIso }) {
      // [A] PostgREST has no multi-table transaction: claim the token first (only if still unused), then insert, and on a
      // failure delete the company (seats + devices cascade) and give the token back.
      const claimed = (await call('PATCH', `enrol_tokens?token_hash=eq.${q(tokenHash)}&used_at=is.null`, { used_at: usedAtIso }, { prefer: 'return=representation' })) as unknown[]
      if (!claimed.length) return null
      try {
        await call('POST', 'companies', company)
        await call('POST', 'seats', seats)
        const out = (await call('POST', 'devices', device, { prefer: 'return=representation' })) as DeviceRow[]
        if (!out[0]) throw new Error('master db insert device returned nothing')
        return out[0]
      } catch (e) {
        await call('DELETE', `companies?id=eq.${q(company.id)}`).catch(() => undefined)
        await call('PATCH', `enrol_tokens?token_hash=eq.${q(tokenHash)}`, { used_at: null }).catch(() => undefined)
        throw e
      }
    }
  }
}
