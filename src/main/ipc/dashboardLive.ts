import { z } from 'zod'
import type { DashboardLiveService } from '../services/dashboardLiveService'
import { wrapHandler } from './envelope'

const force = z.object({ force: z.boolean().optional() }).strict()
const holidays = z.object({ count: z.number().int().min(1).max(10).optional() }).strict()
const search = z.object({ query: z.string().min(2).max(80) }).strict()
const city = z.object({ name: z.string().min(1).max(80), region: z.string().max(80), country: z.string().max(80), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict()
const setCity = z.object({ city }).strict()
const tiles = z.object({ tiles: z.record(z.string().max(20), z.boolean()) }).strict()
const empty = z.object({}).strict()

/** `dashboard:live*` handlers (Phase 125). IPC calls the service only; the renderer never touches the network. */
export function dashboardLiveHandlers(svc: DashboardLiveService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'dashboard:weather': wrapHandler(force, (i) => svc.weather(i)),
    'dashboard:rates': wrapHandler(force, (i) => svc.rates(i)),
    'dashboard:metals': wrapHandler(force, (i) => svc.metals(i)),
    'dashboard:holidays': wrapHandler(holidays, (i) => svc.holidays(i.count)),
    'dashboard:searchCities': wrapHandler(search, (i) => svc.searchCities(i.query)),
    'dashboard:getCity': wrapHandler(empty, () => svc.getCity()),
    'dashboard:setCity': wrapHandler(setCity, (i) => svc.setCity(i.city)),
    'dashboard:getTiles': wrapHandler(empty, () => svc.getTiles()),
    'dashboard:setTiles': wrapHandler(tiles, (i) => svc.setTiles(i.tiles))
  }
}
