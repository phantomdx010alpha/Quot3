/**
 * Phase 261 - F6 profile-set (seat 1): texts <= 200 chars and logo <= 150 KB (else Q3M18), `expectVersion` must match
 * (else Q3M20), `profile_version` rises by exactly 1 only when something changed. `logo` omitted = unchanged, null = removed.
 */
import { once, requireAdmin } from '../_shared/admin'
import { MasterError, parse, runFunction } from '../_shared/http'
import { profileView } from '../_shared/views'
import type { Deps } from '../_shared/types'
import { ProfileSetRequestSchema, profileTooLarge } from '../../../../src/shared/master/schemas'

export function handleProfileSet(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'profile-set', async (ctx) => {
    const r = parse(ProfileSetRequestSchema, ctx.body)
    const a = await requireAdmin(ctx, 'profile-set')
    if (profileTooLarge(r)) throw new MasterError('Q3M18')
    return once(ctx, a, 'profile-set', r.reqId, async (changed) => {
      const fresh = await deps.db.findCompanyById(a.company.id)
      if (!fresh) throw new MasterError('Q3M04')
      if (r.expectVersion !== undefined && r.expectVersion !== fresh.profile_version) throw new MasterError('Q3M20')
      const now = profileView(fresh)
      const next = {
        name: r.name, phone: r.phone, address: r.address,
        logo: r.logo === undefined ? now.logo : r.logo
      }
      if (next.name === now.name && next.phone === now.phone && next.address === now.address && next.logo === now.logo) {
        return { profile: now } // nothing changed: the version stays
      }
      changed()
      await deps.db.updateCompany(fresh.id, { profile: next, profile_version: fresh.profile_version + 1 })
      const after = await deps.db.findCompanyById(fresh.id)
      if (!after) throw new MasterError('Q3M99')
      return { profile: profileView(after) }
    })
  })
}
