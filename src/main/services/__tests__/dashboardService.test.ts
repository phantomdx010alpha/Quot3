import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createCustomerRepo } from '../../db/customerRepo'
import { createDashboardRepo } from '../../db/dashboardRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createBillService, type SaveBillInput } from '../billService'
import { createCustomerService } from '../customerService'
import { createDashboardService, latestBackupTime, localToday } from '../dashboardService'
import { dashboardHandlers } from '../../ipc/dashboard'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
const dirs: string[] = []
afterEach(() => { open.splice(0).forEach((t) => t.cleanup()); dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })) })

let n = 0
function mk(backup: string | null = null) {
  const t = openTestDb()
  open.push(t)
  const sqlite = t.handle.sqlite
  const parties = createPartyRepo(sqlite)
  const bills = createBillService({ sqlite, bills: createBillRepo(sqlite), parties }, { newId: () => `gen-${++n}` })
  const customers = createCustomerService({ parties, customers: createCustomerRepo(sqlite) })
  const dash = createDashboardService({ repo: createDashboardRepo(sqlite), customers, lastBackup: () => backup, today: () => '2026-10-09' })
  return { bills, dash, customers }
}
const bill = (id: string, party: string, date: string, qty: string, rate: string): SaveBillInput => ({
  bill: { id, party: { name: party, phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: date, rows: [row('Pen', qty, rate), blankRow(), blankRow(), blankRow()] }
})

describe('dashboardService', () => {
  it('seeded data: today / month / week / recent / top customers are right, trashed bills excluded', () => {
    const { bills, dash } = mk('2026-10-08T10:00:00.000Z')
    bills.save(bill('b1', 'Ruby Traders', '2026-10-09', '10', '9'))      // 90 today
    bills.save(bill('b2', 'Ruby Traders', '2026-10-09', '1', '10.10'))   // 10.10 today
    bills.save(bill('b3', 'Zakers Clothing', '2026-10-05', '2', '45.50'))// 91
    bills.save(bill('b4', 'Zakers Clothing', '2026-09-20', '1', '500'))  // last month
    bills.save(bill('b5', 'Old Co', '2026-10-09', '1', '100000'))        // trashed
    bills.delete(['b5'])
    const s = dash.stats()
    expect(s.today).toEqual({ date: '2026-10-09', count: 2, total: '100.10' })
    expect(s.month).toEqual({ month: '2026-10', count: 3, total: '191.10' })
    expect(s.week.map((d) => d.total)).toEqual(['0.00', '0.00', '91.00', '0.00', '0.00', '0.00', '100.10'])
    expect(s.recent.map((b) => b.id)).toEqual(['b2', 'b1', 'b3', 'b4'])
    expect(s.recent[0]).toMatchObject({ partyName: 'Ruby Traders', grandTotal: '10.10' })
    expect(s.topCustomers.map((c) => [c.name, c.totalBilled])).toEqual([['Zakers Clothing', '591.00'], ['Ruby Traders', '100.10']])
    expect(s.lastBackup).toBe('2026-10-08T10:00:00.000Z')
    expect(s.syncStatus).toBe('off')
  })

  it('empty database: zeros, empty lists, no backup', () => {
    const s = mk().dash.stats()
    expect(s.today).toMatchObject({ count: 0, total: '0.00' })
    expect(s.month.total).toBe('0.00')
    expect(s.week).toHaveLength(7)
    expect(s.recent).toEqual([])
    expect(s.topCustomers).toEqual([])
    expect(s.lastBackup).toBeNull()
  })

  it('recent is capped at 8 and top customers at 5', () => {
    const { bills, dash } = mk()
    for (let i = 1; i <= 9; i++) bills.save(bill(`r${i}`, `Party ${i}`, '2026-10-09', '1', String(i)))
    const s = dash.stats()
    expect(s.recent).toHaveLength(8)
    expect(s.topCustomers.map((c) => c.name)).toEqual(['Party 9', 'Party 8', 'Party 7', 'Party 6', 'Party 5'])
  })

  it('IPC handler validates strictly and returns the envelope', async () => {
    const h = dashboardHandlers(mk().dash)
    expect(((await h['dashboard:stats']!({})) as { ok: boolean }).ok).toBe(true)
    expect(((await h['dashboard:stats']!({ x: 1 })) as { ok: boolean }).ok).toBe(false)
  })
})

describe('latestBackupTime / localToday', () => {
  it('finds the newest .db file; null for an empty or missing folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quot3-bk-'))
    dirs.push(dir)
    expect(latestBackupTime(dir)).toBeNull()
    expect(latestBackupTime(join(dir, 'nope'))).toBeNull()
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'old.db'), 'x'); utimesSync(join(dir, 'old.db'), new Date('2026-10-01T10:00:00Z'), new Date('2026-10-01T10:00:00Z'))
    writeFileSync(join(dir, 'new.db'), 'x'); utimesSync(join(dir, 'new.db'), new Date('2026-10-05T10:00:00Z'), new Date('2026-10-05T10:00:00Z'))
    writeFileSync(join(dir, 'notes.txt'), 'x')
    expect(latestBackupTime(dir)).toBe('2026-10-05T10:00:00.000Z')
  })
  it('localToday uses the local calendar date', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
