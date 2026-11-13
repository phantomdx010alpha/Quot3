#!/usr/bin/env node
// Phase 237 (M23) - LOCAL real-run check for the legacy inventory import. NEVER part of the tests, never committed with data.
// Usage:  node tools/price-import-check.mjs "C:\path\to\bills_data.db"
// Opens the file READ-ONLY, reads ONLY inv_categories / inv_tabs / inv_items (never `bills`, never `inv_last_state`) and prints COUNTS only:
// no names, no prices. Compare the numbers with docs/PRICELIST_IMPORT_SPEC.md section 2 ("Today's data").
import { DatabaseSync } from 'node:sqlite'

const file = process.argv[2]
if (!file) { console.error('Usage: node tools/price-import-check.mjs <path to bills_data.db>'); process.exit(2) }
let db
try { db = new DatabaseSync(file, { readOnly: true }) } catch { console.error('The file could not be opened read-only.'); process.exit(1) }
try {
  const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name))
  for (const t of ['inv_categories', 'inv_tabs', 'inv_items']) if (!have.has(t)) { console.error(`Missing table ${t}: this is not the old inventory file.`); process.exit(1) }
  const one = (sql) => Object.values(db.prepare(sql).get())[0]
  const items = db.prepare('SELECT tab_id, item_name, rate, rate_without_gst, unit_qty, qty, qty_with_gst FROM inv_items').all()
  const s = (v) => (v === null || v === undefined ? '' : String(v))
  const withPrice = items.filter((r) => [r.rate, r.rate_without_gst, r.unit_qty, r.qty].some((v) => s(v).trim() !== '')).length
  const keys = new Map()
  let dup = 0
  for (const r of items) { const k = `${r.tab_id}|${s(r.item_name).replace(/\s+/g, ' ').trim().toLowerCase()}`; if (keys.has(k)) dup++; keys.set(k, 1) }
  const nonNumeric = items.reduce((n, r) => n + [r.rate, r.rate_without_gst, r.unit_qty, r.qty].filter((v) => s(v).trim() !== '' && !/^-?\d+(\.\d+)?$/.test(s(v).trim())).length, 0)
  const out = {
    categories: one('SELECT COUNT(*) FROM inv_categories'),
    tabs: one('SELECT COUNT(*) FROM inv_tabs'),
    items: items.length,
    withPrice,
    nameOnly: items.length - withPrice,
    namesWithLineBreak: items.filter((r) => /[\r\n]/.test(s(r.item_name))).length,
    namesWithEdgeSpace: items.filter((r) => s(r.item_name) !== s(r.item_name).trim()).length,
    emptyNames: items.filter((r) => s(r.item_name).trim() === '').length,
    duplicateNamesInATab: dup,
    nonNumericPrices: nonNumeric,
    unitQtyFilled: items.filter((r) => s(r.qty_with_gst).trim() !== '').length
  }
  console.log('Counts from the old inventory file (read-only; no names or prices printed):')
  for (const [k, v] of Object.entries(out)) console.log(`  ${k}: ${v}`)
  console.log("Spec 'today' numbers: 14 categories, 22 tabs, 346 items, 182 with prices, 164 name-only, 57 line breaks, 106 edge whitespace, 0 duplicates, 0 non-numeric.")
} finally { db.close() }
