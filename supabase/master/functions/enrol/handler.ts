/**
 * Phase 261 - F13 enrol: owner-minted one-use token + seat 1's company session + the company's service_role key + label
 * -> register the company (service_role and license sealed, every existing seat recorded `legacy`), seat 1's device row.
 * The service_role key lives in memory for this request only. Order per M24-0 C5.
 */
import { callCompany, uuidFromBytes } from '../_shared/admin'
import { aadLicense, aadServiceRole } from '../_shared/aad'
import { MasterError, checkRate, logAction, newDeviceToken, noteAttempt, normaliseUrl, parse, runFunction } from '../_shared/http'
import { profileView } from '../_shared/views'
import type { CompanyRow, Deps, SeatRow } from '../_shared/types'
import { EnrolRequestSchema, SEATS_MAX } from '../../../../src/shared/master/schemas'
import { sealText, sha256Hex } from '../../../../src/shared/master/seal'

export function handleEnrol(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'enrol', async (ctx) => {
    await checkRate(ctx)
    const r = parse(EnrolRequestSchema, ctx.body)
    const fail = async (code: 'Q3M05' | 'Q3M11' | 'Q3M14' | 'Q3M16' | 'Q3M17', failedTry: boolean): Promise<never> => {
      if (failedTry) await noteAttempt(ctx, false)
      await logAction(ctx, 'enrol', code)
      throw new MasterError(code)
    }
    // 1. the owner's token: exists, unused, unexpired, minted for THIS label
    const tokenHash = await sha256Hex(r.enrolToken.trim())
    const tok = await deps.db.findEnrolToken(tokenHash)
    if (!tok || tok.used_at || Date.parse(tok.expires_at) <= deps.now().getTime() || tok.company_label !== r.label) return fail('Q3M16', true)
    const url = normaliseUrl(r.supabaseUrl)
    if ((await deps.db.findCompanyByLabel(r.label)) || (await deps.db.findCompanyByUrl(url))) return fail('Q3M17', false)

    // 2. the session is valid at the company project
    const probe = { supabase_url: url, anon_key: r.anonKey }
    let user: { id: string; email: string | null } | null
    try {
      user = await deps.company.getUser(probe, r.accessToken)
    } catch {
      return fail('Q3M11', false)
    }
    if (!user || !user.email) return fail('Q3M14', true)

    // 3. the company's own tables (service_role, this request only)
    const lic = await callCompany(() => deps.company.adminSelect(probe, r.serviceRoleKey, `licenses?select=org_id&label=eq.${encodeURIComponent(r.label)}`))
    const orgId = (lic[0] as { org_id?: unknown } | undefined)?.org_id
    if (typeof orgId !== 'string') throw new MasterError('Q3M12')
    const members = (await callCompany(() => deps.company.adminSelect(probe, r.serviceRoleKey, `sn_members?select=seat_no,user_id&org_id=eq.${encodeURIComponent(orgId)}`)))
      .map((m) => m as { seat_no?: unknown; user_id?: unknown })
    const rows = members.filter((m): m is { seat_no: number; user_id: string } => typeof m.seat_no === 'number' && typeof m.user_id === 'string')
    if (!rows.length) throw new MasterError('Q3M12')
    const seat1 = rows.find((m) => m.seat_no === 1)
    if (!seat1 || seat1.user_id !== user.id) return fail('Q3M05', true) // the session is not seat 1
    if (rows.some((m) => m.seat_no > SEATS_MAX || m.seat_no < 1)) throw new MasterError('Q3M08')

    // 4. register
    const companyId = uuidFromBytes(deps.randomBytes(16))
    const company: CompanyRow = {
      id: companyId, label: r.label, org_id: orgId, supabase_url: url, anon_key: r.anonKey,
      license_key_enc: await sealText(deps.kek, r.license, aadLicense(companyId)),
      service_role_enc: await sealText(deps.kek, r.serviceRoleKey, aadServiceRole(companyId)),
      status: 'active', max_seats: SEATS_MAX, profile: {}, profile_version: 0
    }
    const now = deps.now().toISOString()
    const seats: SeatRow[] = rows.sort((x, y) => x.seat_no - y.seat_no).map((m) => ({
      company_id: companyId, seat_no: m.seat_no, label: `Seat ${m.seat_no}`, email: m.seat_no === 1 ? user!.email : null,
      auth_user_id: m.user_id, password_enc: null, code_hash: null, code_enc: null, code_hint: null,
      legacy: true, status: 'active', created_at: now, reset_at: null
    }))
    const { token, hash } = await newDeviceToken(deps)
    const device = await deps.db.registerCompany({
      company, seats, tokenHash, usedAtIso: now,
      device: { company_id: companyId, seat_no: 1, token_hash: hash, label: '', platform: r.platform, app_version: r.appVersion.slice(0, 40) }
    })
    if (!device) return fail('Q3M16', true) // the token was used by another request meanwhile
    await noteAttempt(ctx, true)
    await logAction(ctx, 'enrol', 'ok', { company_id: companyId, seat_no: 1 })
    return { deviceToken: token, company: { id: companyId, label: r.label }, seats: seats.length, profile: profileView(company) }
  })
}
