#!/usr/bin/env node
// LEGACY (v1 postbox, superseded by Milestone 12 / Phase 129: use `select * from public.qt_create_org('Label', 3)` in the Supabase SQL editor,
// which also creates the email/password logins). Kept so the v1 tests and old licenses still work.
// Phase 51 - generates a Quot3 license key and the SQL that registers it in Supabase.
//
//   node scripts/generate-license.mjs --label "Acme Traders" --max-branches 3
//
// The KEY is printed once and is never stored anywhere by this script: give it to the customer. Only its hash goes into the
// database (public.licenses.key_hash). The hash is exactly what public.qt_license_hash() computes in SQL:
//   sha256( 'quot3-license:' + KEY ) as lower-case hex, KEY upper-case and trimmed.
// Format: Q3-XXXX-XXXX-XXXX with X from A-Z and 2-7 (RFC 4648 base32 letters) = 60 bits of randomness.
import { createHash, randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const KEY_RE = /^Q3-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' // 32 symbols: byte & 31 is uniform, no modulo bias

export function normaliseKey(key) {
  return String(key ?? '').trim().toUpperCase()
}

export function generateKey(bytes = randomBytes(12)) {
  const chars = Array.from(bytes.subarray(0, 12), (b) => ALPHABET[b & 31]).join('')
  return `Q3-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`
}

export function licenseHash(key) {
  return createHash('sha256').update(`quot3-license:${normaliseKey(key)}`, 'utf8').digest('hex')
}

/** The insert statement; the label is cleaned (control characters out, 100 chars max) and quoted safely. */
export function buildInsertSql(hash, label = '', maxBranches = 5) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('hash must be 64 lower-case hex characters')
  const n = Number(maxBranches)
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('--max-branches must be a whole number from 1 to 50')
  // eslint-disable-next-line no-control-regex
  const clean = String(label).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100).replace(/'/g, "''")
  return `insert into public.licenses (key_hash, label, max_branches) values ('${hash}', '${clean}', ${n});`
}

function parseArgs(argv) {
  const out = { label: '', maxBranches: 5 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--label') out.label = argv[++i] ?? ''
    else if (argv[i] === '--max-branches') out.maxBranches = argv[++i]
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true
    else throw new Error(`unknown argument: ${argv[i]}`)
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: node scripts/generate-license.mjs [--label "Customer name"] [--max-branches 5]')
    return
  }
  const key = generateKey()
  const sql = buildInsertSql(licenseHash(key), args.label, args.maxBranches)
  console.log(`License key (give it to the customer; it is NOT stored anywhere): ${key}\n`)
  console.log('Run this in the Supabase SQL editor (it stores only the hash):\n')
  console.log(sql)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}
