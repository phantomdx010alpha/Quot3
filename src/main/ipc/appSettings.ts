import { z } from 'zod'
import type { AppSettingsService } from '../services/appSettingsService'
import type { CompanyProfileService } from '../services/companyProfileService'
import { PROFILE_FIELDS } from '../../shared/master/profile'
import { wrapHandler } from './envelope'

const empty = z.object({}).strict()
const company = z.object({ name: z.string().max(10_000), phone: z.string().max(10_000), address: z.string().max(10_000) }).strict()
const useDefault = z.object({ field: z.enum(PROFILE_FIELDS) }).strict()
const prefix = z.object({ prefix: z.string().max(100) }).strict()
const print = z.object({ rupeeOnTotal: z.boolean(), silent: z.boolean(), printer: z.string().max(1000) }).strict()
const image = z.object({ scale: z.number() }).strict()
const nav = z.object({ smoothArrows: z.boolean() }).strict()
const calc = z.object({ roundOff: z.boolean().optional(), percentPresets: z.string().max(200).optional() }).strict()
const behaviour = z.object({ trashRetentionDays: z.number(), leftUnlockPresses: z.number(), autosaveSeconds: z.number() }).strict()

/** `appSettings:*` handlers (Phase 48). IPC calls the service only; every value is re-validated there. */
export function appSettingsHandlers(svc: AppSettingsService, profile?: CompanyProfileService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'appSettings:get': wrapHandler(empty, () => svc.get()),
    // Phase 270: with a company profile service the company calls go through it (it falls back to the plain service when the master is not involved).
    'appSettings:saveCompany': wrapHandler(company, (i) => (profile ? profile.saveCompany(i) : svc.saveCompany(i))),
    'appSettings:chooseLogo': wrapHandler(empty, () => (profile ? profile.chooseLogo() : svc.chooseLogo())),
    'appSettings:removeLogo': wrapHandler(empty, () => (profile ? profile.removeLogo() : svc.removeLogo())),
    'appSettings:companyUseDefault': wrapHandler(useDefault, (i) => (profile ? profile.useDefault(i.field) : svc.get())),
    'appSettings:savePrefix': wrapHandler(prefix, (i) => svc.savePrefix(i.prefix)),
    'appSettings:savePrint': wrapHandler(print, (i) => svc.savePrint(i)),
    'appSettings:saveBehaviour': wrapHandler(behaviour, (i) => svc.saveBehaviour(i)),
    'appSettings:saveImage': wrapHandler(image, (i) => svc.saveImage(i)),
    'appSettings:saveNav': wrapHandler(nav, (i) => svc.saveNav(i)),
    'appSettings:saveCalc': wrapHandler(calc, (i) => svc.saveCalc(i)),
    'appSettings:printers': wrapHandler(empty, async () => ({ printers: await svc.printers() }))
  }
}
