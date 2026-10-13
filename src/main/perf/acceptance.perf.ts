import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { setFlagsFromString } from 'node:v8'
import { afterAll, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb, MIGRATIONS_DIR } from '../db/__tests__/helpers'
import { openDatabase } from '../db/connection'
import { createBillRepo } from '../db/billRepo'
import { createCustomerRepo } from '../db/customerRepo'
import { createHistoryRepo } from '../db/historyRepo'
import { createPartyRepo } from '../db/partyRepo'
import { getLocalBranch } from '../db/seed'
import { createBillService } from '../services/billService'
import { createCustomerService } from '../services/customerService'
import { createHistoryService } from '../services/historyService'
import { printFontBaseUrl } from '../print/template'
import { CHROME, chromeAvailable } from '../print/__tests__/layoutHarness'
import { historicalBills } from '../../shared/__fixtures__/historicalBills'
import { matrixBill } from '../../shared/__fixtures__/printBills'
import { createPartyIndex } from '../../shared/party/fuzzy'
import { searchCustomers } from '../../shared/customers/customerList'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '../../shared/print/printModel'
import { decideForBill } from '../../shared/print/printFlow'
import { renderPrintHtml } from '../../shared/print/template/renderHtml'
import { acceptanceRows, heapGrowthMbPerHour, meetsAcceptance, resultFromSamples, type AcceptanceId, type AcceptanceResult, type HeapSample } from '../../shared/perf/acceptance'

/**
 * Phase 68 - performance acceptance at the data / service level, on a REAL temp-file SQLite and real headless Chromium
 * (Electron itself is not run). `npm run perf:acceptance`. Sizes and the soak length come from the environment:
 *   QUOT3_PERF_BILLS (5000)  QUOT3_PERF_PARTIES (2000)  QUOT3_SOAK_SECONDS (20; use 3600 for the one-hour soak)
 *   QUOT3_PERF_OUT  = a file to write the PHASE_STATUS rows to      QUOT3_CHROME = path to a Chromium / Chrome binary
 * The tests record numbers and print a verdict table; they only fail on a wrong result (empty list, no PDF), never on speed,
 * because speed depends on the machine. Run it on the owner's PC for numbers that count.
 */
const BILLS = Number(process.env.QUOT3_PERF_BILLS ?? 5000)
const PARTIES = Number(process.env.QUOT3_PERF_PARTIES ?? 2000)
const SOAK_SECONDS = Number(process.env.QUOT3_SOAK_SECONDS ?? 20)
const ROWS_PER_BILL = 12
const results: AcceptanceResult[] = []
const ms = (): number => performance.now()

function time(fn: () => unknown, n: number, warm = 2): number[] {
  for (let i = 0; i < warm; i++) fn()
  const out: number[] = []
  for (let i = 0; i < n; i++) { const t = ms(); fn(); out.push(ms() - t) }
  return out
}
const record = (id: AcceptanceId, samples: number[], notes?: string): void => { results.push(resultFromSamples(id, samples, notes)) }

const WORDS = ['Cotton', 'Silk', 'Steel', 'Brass', 'Copper', 'Plastic', 'Ruby', 'Tomato', 'Notebook', 'Bulb', 'Thread', 'Bowl', 'Lamp', 'Chair', 'Wire', 'Pen']
const SURNAMES = ['Traders', 'Textiles', 'Stores', 'Enterprises', 'Agencies', 'Garments', 'Mart', 'Brothers', 'Emporium', 'Industries']
const partyName = (i: number): string => `${WORDS[i % WORDS.length]} ${SURNAMES[(i * 7) % SURNAMES.length]} ${i}`

/** Direct SQL seed (the save path is timed separately): PARTIES parties, BILLS bills of ROWS_PER_BILL rows over ~400 days. */
function seed(t: TestDb): void {
  const sqlite = t.handle.sqlite
  const branch = getLocalBranch(sqlite).id
  const parties = createPartyRepo(sqlite)
  const at = '2026-01-01T00:00:00.000Z'
  sqlite.transaction(() => {
    for (let i = 0; i < PARTIES; i++) {
      const name = partyName(i)
      parties.insert({ id: `p${i}`, name, nameNorm: name.toLowerCase(), phone: `98${String(10000000 + i * 37).slice(0, 8)}`, address: `${i} Main Road`, transport: i % 3 === 0 ? 'VRL' : null, at } as never, 'perf')
    }
    const insBill = sqlite.prepare(
      `INSERT INTO bills (id, branch_id, po_seq, po_number, party_id, party_snapshot_json, format_id, bill_date, totals_json, item_row_count, revision, created_at, updated_at)
       VALUES (@id, @branch, @seq, @po, @pid, @party, 'non_gst', @date, @totals, @n, 1, @at, @at)`
    )
    const insRow = sqlite.prepare(`INSERT INTO bill_rows (id, bill_id, idx, name_runs_json, name_plain, qty, rate) VALUES (@id, @bid, @idx, @runs, @plain, @qty, @rate)`)
    const day0 = Date.UTC(2025, 8, 1)
    for (let b = 0; b < BILLS; b++) {
      const d = new Date(day0 + Math.floor((b / BILLS) * 400) * 86_400_000).toISOString().slice(0, 10)
      const pi = (b * 13) % PARTIES
      const total = String(1000 + ((b * 97) % 90000))
      insBill.run({ id: `b${b}`, branch, seq: b + 1, po: `Q3-${String(b + 1).padStart(4, '0')}`, pid: `p${pi}`, party: JSON.stringify({ name: partyName(pi), phone: '', address: '', transport: '' }), date: d, totals: JSON.stringify({ itemsSubtotal: total, adjustmentsTotal: '0', grandTotal: total, gstTotal: '0' }), n: ROWS_PER_BILL, at: `${d}T${String(8 + (b % 10)).padStart(2, '0')}:${String(b % 60).padStart(2, '0')}:00.000Z` })
      for (let r = 0; r < ROWS_PER_BILL; r++) {
        const plain = `${WORDS[(b + r) % WORDS.length]} ${WORDS[(b * 3 + r * 5) % WORDS.length]} ${r}`
        insRow.run({ id: `b${b}r${r}`, bid: `b${b}`, idx: r, runs: JSON.stringify([{ t: plain }]), plain, qty: String((r % 9) + 1), rate: String(10 + ((b + r * 31) % 400)) })
      }
    }
  })()
  // the seed bypassed the PO allocator, so move the counter past the seeded numbers (saves below allocate normally)
  sqlite.prepare('UPDATE po_counters SET next_seq = ? WHERE branch_id = ?').run(BILLS + 1, branch)
}

/** A save input from a fixture bill; row ids are made unique per saved bill (row ids are primary keys). */
const saveInput = (id: string, b: ReturnType<typeof historicalBills>[number]) => ({ bill: { id, party: b.party, formatId: b.formatId, extraCols: b.extraCols, paperOverride: b.paperOverride, billDate: b.billDate, rows: b.rows.map((r) => ({ ...r, id: `${id}-${r.id}` })) } })

let db: TestDb
let idCounter = 0 // shared by every wiring() so generated revision / row ids never repeat
const wiring = (t: TestDb) => {
  const sqlite = t.handle.sqlite
  const history = createHistoryService(createHistoryRepo(sqlite))
  const partyRepo = createPartyRepo(sqlite)
  const customers = createCustomerService({ parties: partyRepo, customers: createCustomerRepo(sqlite) })
  const bills = createBillService({ sqlite, bills: createBillRepo(sqlite), parties: partyRepo }, { newId: () => `perf-new-${++idCounter}` })
  return { sqlite, history, partyRepo, customers, bills }
}

describe('Phase 68 - performance acceptance (service level, real SQLite, real headless Chromium)', () => {
  it('startup: open + migrate a new database, then seed', () => {
    const samples: number[] = []
    for (let i = 0; i < 5; i++) {
      const dir = mkdtempSync(join(tmpdir(), 'q3perf-open-'))
      const t = ms()
      const h = openDatabase({ file: join(dir, 'quot3.db'), migrationsDir: MIGRATIONS_DIR, backupsDir: join(dir, 'backups') })
      samples.push(ms() - t)
      h.close(); rmSync(dir, { recursive: true, force: true })
    }
    record('startup.dbOpenEmpty', samples, 'temp file; all migrations applied')
    db = openTestDb()
    const t0 = ms()
    seed(db)
    console.log(`seeded ${BILLS} bills / ${PARTIES} parties / ${BILLS * ROWS_PER_BILL} rows in ${(ms() - t0).toFixed(0)} ms`)
    expect((db.handle.sqlite.prepare('SELECT count(*) AS c FROM bills').get() as { c: number }).c).toBe(BILLS)
  })

  it('startup: reopen the large database', () => {
    const samples: number[] = []
    for (let i = 0; i < 8; i++) { const t = ms(); db.reopen(); samples.push(ms() - t) }
    const kb = Math.round(statSync(db.file).size / 1024)
    record('startup.dbOpenLarge', samples, `database file ${kb} KB`)
  })

  it('history: dates, first page, deep page, search', () => {
    const { history } = wiring(db)
    const dates = history.listDates({})
    expect(dates.length).toBeGreaterThan(100)
    record('history.listDates', time(() => history.listDates({}), 30), `${dates.length} dates`)
    const first = history.listBills({})
    expect(first.items.length).toBeGreaterThan(0)
    record('history.firstPage', time(() => history.listBills({}), 30), `${first.items.length} rows per page`)
    // walk to a deep page with real cursors, then time that page
    let cursor = first.next
    for (let i = 0; i < 15 && cursor; i++) cursor = history.listBills({ cursor }).next
    expect(cursor).toBeTruthy()
    record('history.pageDeep', time(() => history.listBills({ cursor: cursor! }), 30), 'page 17 of the list')
    const queries = [partyName(777).split(' ').slice(0, 2).join(' '), 'Q3-2500', 'Cotton Silk', '45000']
    const samples: number[] = []
    for (const q of queries) {
      const s = time(() => history.search({ query: q }), 8, 1)
      samples.push(...s)
      console.log(`search "${q}": ${history.search({ query: q }).items.length} hits, p50 ${s.slice().sort((a, b) => a - b)[Math.floor(s.length / 2)]!.toFixed(1)} ms`)
    }
    record('history.search', samples, 'queries: party, PO number, item words, amount')
  })

  it('customers: list with stats, autocomplete index and per-keystroke search', () => {
    const { customers, partyRepo } = wiring(db)
    const list = customers.list()
    expect(list.length).toBe(PARTIES)
    record('customers.list', time(() => customers.list(), 20), `${list.length} customers, JSON ${Math.round(JSON.stringify(list).length / 1024)} KB over IPC`)
    const lite = partyRepo.list()
    record('customers.partyIndexBuild', time(() => createPartyIndex(lite), 10), 'Fuse index over the saved parties')
    const index = createPartyIndex(lite)
    const typed = ['c', 'co', 'cot', 'cott', 'cotto', 'cotton', 'cotton t', 'cotton tr', 'steel', 'ruby tra', '98100', 'brass mart 1']
    const samples: number[] = []
    for (const q of typed) samples.push(...time(() => index.search(q), 5, 1))
    expect(index.search('cotton').length).toBeGreaterThan(0)
    const pageSamples: number[] = []
    for (const q of ['c', 'co', 'cot', 'cotton', 'cotton t', 'steel mart', '98100', 'main road']) pageSamples.push(...time(() => searchCustomers(list, q), 5, 1))
    record('customers.pageFilter', pageSamples, 'the Customers page filter (renderer code, run here in Node)')
    record('customers.partySearch', samples, 'renderer code, run here in Node (a browser is usually faster)')
  })

  it('save: a 12-row bill into the large database', () => {
    const { bills } = wiring(db)
    const hb = historicalBills(60)
    let i = 0
    const samples = time(() => { const b = hb[i++ % hb.length]!; bills.save(saveInput(`perf-save-${i}`, b)) }, 50, 3)
    record('bill.save', samples, `${BILLS}+ bills in the database`)
  })

  it('print: build the HTML of an 80-row bill', () => {
    const bill = matrixBill('non_gst', 80, 0)
    const root = join(__dirname, '..', '..', '..', 'resources')
    const build = (): string => renderPrintHtml(buildPrintModel(bill, 'rough', DEFAULT_PRINT_SETTINGS, decideForBill(bill, 'rough', {})), { fontBaseUrl: printFontBaseUrl(root) })
    const html = build()
    expect(html.length).toBeGreaterThan(1000)
    record('print.buildHtml', time(build, 30), `${Math.round(html.length / 1024)} KB of HTML`)
  })

  const chrome = chromeAvailable()
  ;(chrome ? it : it.skip)('print + image: one real headless Chromium run each (includes browser start)', () => {
    const bill = matrixBill('non_gst', 80, 0)
    const decision = decideForBill(bill, 'rough', {})
    const root = join(__dirname, '..', '..', '..', 'resources')
    const html = renderPrintHtml(buildPrintModel(bill, 'rough', DEFAULT_PRINT_SETTINGS, decision), { fontBaseUrl: printFontBaseUrl(root) })
    const dir = mkdtempSync(join(tmpdir(), 'q3perf-chrome-'))
    const f = join(dir, 'p.html')
    writeFileSync(f, html)
    const base = ['--headless=new', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files']
    const pdf: number[] = []
    const png: number[] = []
    for (let i = 0; i < 4; i++) {
      const out = join(dir, `p${i}.pdf`)
      const t = ms()
      spawnSync(CHROME, [...base, '--no-pdf-header-footer', `--print-to-pdf=${out}`, 'file://' + f], { encoding: 'utf8' })
      const dt = ms() - t
      expect(existsSync(out)).toBe(true)
      if (i > 0) pdf.push(dt) // the first run is a cold start
      const img = join(dir, `p${i}.png`)
      const t2 = ms()
      spawnSync(CHROME, [...base, `--screenshot=${img}`, '--window-size=794,1123', 'file://' + f], { encoding: 'utf8' })
      const dt2 = ms() - t2
      expect(existsSync(img)).toBe(true)
      if (i > 0) png.push(dt2)
    }
    record('print.pdf', pdf, `80 rows, ${decision.size}; Chromium CLI process, NOT Electron's printToPDF; cold first run dropped`)
    record('image.capture', png, `80 rows; Chromium CLI --screenshot at 794x1123, NOT the app's capture path; no clipboard write; cold first run dropped`)
    rmSync(dir, { recursive: true, force: true })
  })

  it(`memory: soak for ${SOAK_SECONDS} s (list / search / customers / autocomplete / save / print build in a loop)`, () => {
    setFlagsFromString('--expose-gc')
    const gc = runInNewContext('gc') as () => void
    const { history, customers, partyRepo, bills } = wiring(db)
    const index = createPartyIndex(partyRepo.list())
    const bill = matrixBill('non_gst', 40, 1)
    const root = join(__dirname, '..', '..', '..', 'resources')
    const hb = historicalBills(30)
    const samples: HeapSample[] = []
    const start = ms()
    let nextSample = 0
    let cycles = 0
    while (ms() - start < SOAK_SECONDS * 1000) {
      history.listBills({}); history.search({ query: 'cotton' }); customers.list(); index.search('steel t')
      const b = hb[cycles % hb.length]!
      if (cycles % 5 === 0) bills.save(saveInput(`perf-soak-${cycles}`, b))
      renderPrintHtml(buildPrintModel(bill, 'rough', DEFAULT_PRINT_SETTINGS, decideForBill(bill, 'rough', {})), { fontBaseUrl: printFontBaseUrl(root) })
      cycles++
      if (ms() - start >= nextSample) { gc(); samples.push({ atMs: ms() - start, heapMb: process.memoryUsage().heapUsed / 1048576 }); nextSample += Math.max(500, SOAK_SECONDS * 1000 / 60) }
    }
    gc()
    const slope = heapGrowthMbPerHour(samples)
    const first = samples[0]?.heapMb ?? 0
    const last = samples[samples.length - 1]?.heapMb ?? 0
    record('memory.soakGrowth', [Math.max(0, slope)], `${cycles} cycles in ${SOAK_SECONDS} s; JS heap ${first.toFixed(1)} -> ${last.toFixed(1)} MB (${samples.length} samples after forced GC); Node main-process work only, NOT the renderer or Chromium memory${SOAK_SECONDS < 600 ? '; short run, slope is indicative only' : ''}`)
    expect(samples.length).toBeGreaterThan(3)
  })

  afterAll(() => {
    const rows = acceptanceRows(results, new Date().toISOString().slice(0, 10))
    console.log('\n' + rows.join('\n'))
    console.log('\nOVER BUDGET: ' + (results.filter((r) => !meetsAcceptance(r)).map((r) => r.id).join(', ') || 'none'))
    if (process.env.QUOT3_PERF_OUT) writeFileSync(process.env.QUOT3_PERF_OUT, rows.join('\n') + '\n')
    try { db?.cleanup() } catch { /* already closed */ }
  })
})
