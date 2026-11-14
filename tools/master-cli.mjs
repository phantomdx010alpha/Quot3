#!/usr/bin/env node
// Phase 262 (Milestone 24) - the owner's tool for the MASTER project. Run it on YOUR PC only; it is never shipped inside the app.
//   node tools/master-cli.mjs help
// Every network call and file access goes through the injected `io` object so the tests use fakes (no real Supabase, ever).
// Secrets: anything printed passes through `redactCliOutput`; the ONLY secrets shown are the ones the owner must see once
// (the new MASTER_KEK, an enrol token, the Seat-1 code, and the recovery block if the master write fails after a company was made).
// The sealed-text format and the seat-code algorithm are re-implemented here (this file is plain .mjs) and are CROSS-CHECKED against
// src/shared/master/{seal,seatCode}.ts by tools/__tests__/masterCli262.test.ts, so they cannot drift apart unnoticed.
import { fileURLToPath } from 'node:url'

export const COMMANDS = ['help', 'init', 'enrol-token', 'onboard', 'export', 'keepalive', 'bundle']
export const SEAT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const SEATS_MAX = 15
/** Company SQL files, in the order the owner applies them to a NEW company project (design flow 1). 90 / 91 / 99 are NOT part of onboarding. */
export const COMPANY_SQL_FIRST = 11
export const COMPANY_SQL_LAST = 21
/** Every Edge Function folder under supabase/master/functions (13 calls of API_CONTRACTS.md M24-0). */
export const FUNCTION_NAMES = ['redeem', 'adopt', 'refresh', 'heartbeat', 'profile-get', 'seat-list', 'seat-create', 'seat-reset', 'seat-revoke', 'seat-rename', 'seat-regen', 'profile-set', 'enrol']

export class CliError extends Error {}

// ---------------------------------------------------------------- argument parsing
const BOOLEAN_FLAGS = new Set(['dry-run', 'no-sealed', 'help'])
/** `["onboard","Acme","3","--url","https://x","--dry-run"]` -> `{ command, positional, flags }`. `--k=v` and `--k v` both work. */
export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=')
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2)
      if (eq > 0) flags[name] = a.slice(eq + 1)
      else if (BOOLEAN_FLAGS.has(name) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) flags[name] = true
      else flags[name] = argv[++i]
    } else positional.push(a)
  }
  const command = positional.shift() ?? 'help'
  return { command: flags.help === true ? 'help' : command, positional, flags }
}

// ---------------------------------------------------------------- SQL file ordering
/** Keep only `NN_name.sql` with NN in 11..21 and sort by NN. Anything else (01-06, 90, 91, 99, non-sql) is dropped. */
export function orderCompanySqlFiles(names) {
  return names
    .map((n) => ({ n, m: /^(\d{2})_[A-Za-z0-9_]+\.sql$/.exec(n) }))
    .filter((x) => x.m && Number(x.m[1]) >= COMPANY_SQL_FIRST && Number(x.m[1]) <= COMPANY_SQL_LAST)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => x.n)
}

/** The Supabase project ref from `https://<ref>.supabase.co`, or null. */
export const projectRefFromUrl = (url) => /^https:\/\/([a-z0-9]{10,30})\.supabase\.co\/?$/i.exec(String(url).trim())?.[1]?.toLowerCase() ?? null
/** Same normal form the master functions store (`_shared/http.ts normaliseUrl`). */
export const normaliseUrl = (u) => String(u).trim().toLowerCase().replace(/\/+$/, '')

// ---------------------------------------------------------------- redaction of what the CLI prints
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g
const RULES = [
  [/([A-Za-z_]*(?:password|token|secret|service[_-]?role|kek|pepper|license)[A-Za-z_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi, '$1$2[redacted]'],
  [/\bQ3C[-\s]?(?:[A-Z2-7]{4}[-\s]?){3}[A-Z2-7]{4}\b/gi, '[redacted]'],
  [/\bQ3-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}\b/gi, '[redacted]'],
  [/\bv1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}/g, '[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [JWT_RE, '[redacted]'],
  [/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, '[redacted]']
]
/** Text for the terminal: known secret values first (any length >= 6), then the pattern rules. Never throws. */
export function redactCliOutput(text, known = []) {
  let out = String(text)
  for (const k of [...known].filter((s) => typeof s === 'string' && s.length >= 6).sort((a, b) => b.length - a.length)) out = out.split(k).join('[redacted]')
  for (const [re, to] of RULES) out = out.replace(re, to)
  return out
}

// ---------------------------------------------------------------- crypto (same formats as src/shared/master/seal.ts and seatCode.ts)
const enc = new TextEncoder()
const subtle = () => globalThis.crypto.subtle
export const defaultRandomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))
export function b64urlEncode(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function b64urlDecode(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new CliError('not base64url')
  return new Uint8Array(Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))
}
/** `MASTER_KEK` text (base64url of exactly 32 bytes) -> key bytes. */
export function keyFromBase64Url(text) {
  const key = b64urlDecode(String(text).trim())
  if (key.length !== 32) throw new CliError('MASTER_KEK must be 32 bytes (base64url). Run "init" to make one.')
  return key
}
export const generateKek = (random = defaultRandomBytes) => b64urlEncode(random(32))
export async function sha256Hex(text) {
  return Buffer.from(await subtle().digest('SHA-256', enc.encode(text))).toString('hex')
}
export async function sealText(key, plain, aad, random = defaultRandomBytes) {
  const k = await subtle().importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = random(12)
  const params = { name: 'AES-GCM', iv }
  if (aad !== undefined) params.additionalData = enc.encode(aad)
  const ct = new Uint8Array(await subtle().encrypt(params, k, enc.encode(plain)))
  return `v1.${b64urlEncode(iv)}.${b64urlEncode(ct)}`
}
export const looksSealed = (t) => /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/.test(String(t))
export function checkChar(payload15) {
  let sum = 0
  for (let i = 0; i < 15; i++) sum += SEAT_ALPHABET.indexOf(payload15[i]) * (i + 1)
  return SEAT_ALPHABET[sum % 31]
}
export function generateSeatCode(bytes) {
  let p = ''
  for (let i = 0; i < 15; i++) p += SEAT_ALPHABET[bytes[i] & 31]
  const chars = p + checkChar(p)
  return `Q3C-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`
}
export const seatCodeChars = (code) => code.replace(/-/g, '').slice(3)
const aad = {
  password: (c, n) => `seat-password:${c}:${n}`, code: (c, n) => `seat-code:${c}:${n}`,
  license: (c) => `company-license:${c}`, serviceRole: (c) => `company-service-role:${c}`
}
export const uuidFromBytes = (b) => {
  const x = Uint8Array.from(b.slice(0, 16)); x[6] = (x[6] & 0x0f) | 0x40; x[8] = (x[8] & 0x3f) | 0x80
  const h = Buffer.from(x).toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// ---------------------------------------------------------------- REST helpers (service_role over PostgREST)
async function rest(io, base, key, method, path, body, extra = {}) {
  const url = `${String(base).replace(/\/+$/, '')}/rest/v1/${path}`
  let res
  try {
    res = await io.fetchImpl(url, { method, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new CliError(`Could not reach ${new URL(url).host}. Check the address and your internet.`)
  }
  const text = await res.text()
  if (!res.ok) {
    let why = ''
    try { why = String(JSON.parse(text).message ?? '').slice(0, 160) } catch { /* no body */ }
    throw new CliError(`${method} ${path.split('?')[0]} failed (${res.status})${why ? `: ${why}` : ''}`)
  }
  return text ? JSON.parse(text) : null
}

// ---------------------------------------------------------------- command: enrol-token (T35)
/** Mint one enrol token: 32 random bytes, ONLY its sha256 is stored, one use, expires after `hours`. Returns the token (shown once). */
export async function mintEnrolToken({ io, masterUrl, masterKey, label, hours = 24 }) {
  if (!label || label.length > 80) throw new CliError('The company label must be 1 to 80 characters (exactly as in licenses.label).')
  if (!(hours >= 1 && hours <= 168)) throw new CliError('--hours must be between 1 and 168.')
  const token = b64urlEncode(io.randomBytes(32))
  const row = { token_hash: await sha256Hex(token), company_label: label, expires_at: new Date(io.now().getTime() + hours * 3600_000).toISOString() }
  await rest(io, masterUrl, masterKey, 'POST', 'enrol_tokens', row, { prefer: 'return=minimal' })
  return { token, expiresAt: row.expires_at }
}

// ---------------------------------------------------------------- command: onboard (design flow 1)
export function validateOnboard({ label, seats, url, anon, serviceRole }) {
  if (!label || label.length > 80) throw new CliError('Give the company label (1 to 80 characters), e.g. onboard "Acme Traders" 3 ...')
  const n = Number(seats)
  if (!Number.isInteger(n) || n < 1 || n > SEATS_MAX) throw new CliError(`Seats must be a whole number from 1 to ${SEATS_MAX}.`)
  if (!/^https:\/\//i.test(String(url ?? ''))) throw new CliError('--url must be the company project address, starting with https://')
  if (!anon) throw new CliError('--anon (the company project anon key) is missing.')
  if (!serviceRole) throw new CliError('--service-role (the company project service_role key) is missing. Prefer the COMPANY_SERVICE_ROLE_KEY environment variable so it is not kept in your shell history.')
  return { label, seats: n, url: normaliseUrl(url), anon, serviceRole }
}

/** Apply the company SQL through the Supabase Management API (needs the owner's access token). One file per request, stops at the first failure. */
export async function applyCompanySql({ io, ref, token, files, dir }) {
  for (const f of files) {
    const query = io.readFile(`${dir}/${f}`)
    let res
    try {
      res = await io.fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) })
    } catch { throw new CliError('Could not reach api.supabase.com.') }
    if (!res.ok) throw new CliError(`Running ${f} failed (${res.status}). Fix it, then run the same command again (every file is safe to re-run).`)
    io.log(`  ran ${f}`)
  }
}

/** Seal and write the company + its seats into the master. Returns the Seat-1 code. */
export async function registerInMaster({ io, masterUrl, masterKey, kek, company, license, org, seats }) {
  const id = uuidFromBytes(io.randomBytes(16))
  const now = io.now().toISOString()
  await rest(io, masterUrl, masterKey, 'POST', 'companies', {
    id, label: company.label, org_id: org, supabase_url: company.url, anon_key: company.anon,
    license_key_enc: await sealText(kek, license, aad.license(id), io.randomBytes),
    service_role_enc: await sealText(kek, company.serviceRole, aad.serviceRole(id), io.randomBytes),
    status: 'active', max_seats: SEATS_MAX
  }, { prefer: 'return=minimal' })
  const rows = []
  let seat1Code = ''
  for (const s of seats) {
    const code = generateSeatCode(io.randomBytes(15))
    if (s.seat_no === 1) seat1Code = code
    rows.push({
      company_id: id, seat_no: s.seat_no, label: `Seat ${s.seat_no}`, email: s.email, auth_user_id: s.user_id ?? null,
      password_enc: await sealText(kek, s.password, aad.password(id, s.seat_no), io.randomBytes),
      code_hash: await sha256Hex(seatCodeChars(code)), code_enc: await sealText(kek, code, aad.code(id, s.seat_no), io.randomBytes), code_hint: code.slice(-4),
      legacy: false, status: 'active', created_at: now
    })
  }
  await rest(io, masterUrl, masterKey, 'POST', 'seats', rows, { prefer: 'return=minimal' })
  await rest(io, masterUrl, masterKey, 'POST', 'master_log', { company_id: id, action: 'onboard', detail: 'ok' }, { prefer: 'return=minimal' }).catch(() => undefined)
  return { companyId: id, seat1Code }
}

export async function onboard({ io, master, args, say, reveal }) {
  const c = validateOnboard(args)
  const dir = `${io.cwd}/supabase/sql`
  const files = orderCompanySqlFiles(io.listDir(dir))
  if (files.length < 11) throw new CliError(`Could not find the company SQL files in ${dir}. Run this from the project folder.`)
  const ref = args.projectRef || projectRefFromUrl(c.url)
  if (args.dryRun) {
    say(`DRY RUN - nothing is sent. Would onboard "${c.label}" with ${c.seats} seat(s) at ${c.url}.`)
    say(args.managementToken ? `Would run, in order: ${files.join(', ')}` : `No management token: you would paste these files in the company SQL editor, in this order:\n${files.map((f, i) => `  ${i + 1}. supabase/sql/${f}`).join('\n')}`)
    return { dryRun: true, files }
  }
  if (args.managementToken) {
    if (!ref) throw new CliError('Could not read the project ref from --url. Pass --project-ref <ref>.')
    say(`Applying ${files.length} SQL files to project ${ref} ...`)
    await applyCompanySql({ io, ref, token: args.managementToken, files, dir })
  } else {
    say(`No management token given. If this project has NEVER had the company SQL, stop now and paste these files in the Supabase SQL editor of the company project, in this order, then run this command again:\n${files.map((f, i) => `  ${i + 1}. supabase/sql/${f}`).join('\n')}\nContinuing on the assumption that they are already applied ...`)
  }
  let issued
  try {
    issued = await rest(io, c.url, c.serviceRole, 'POST', 'rpc/qt_create_org', { p_label: c.label, p_seats: c.seats })
  } catch (e) {
    throw new CliError(`${e.message}\nIf the message says the function does not exist, the company SQL files have not been applied yet (see above).`)
  }
  if (!Array.isArray(issued) || issued.length !== c.seats) throw new CliError('The company project returned an unexpected answer for qt_create_org. Nothing was written to the master.')
  const license = issued[0].license_key
  const org = (await rest(io, c.url, c.serviceRole, 'GET', `licenses?select=org_id&label=eq.${encodeURIComponent(c.label)}`))?.[0]?.org_id
  const members = (await rest(io, c.url, c.serviceRole, 'GET', `sn_members?select=seat_no,user_id&org_id=eq.${encodeURIComponent(org)}`)) ?? []
  const seats = issued.map((r) => ({ seat_no: r.seat_no, email: r.email, password: r.password, user_id: members.find((m) => m.seat_no === r.seat_no)?.user_id }))
  try {
    const done = await registerInMaster({ io, masterUrl: master.url, masterKey: master.key, kek: master.kek, company: c, license, org, seats })
    say(`Company "${c.label}" is registered in the master with ${c.seats} seat(s).`)
    reveal('SEAT-1 CODE (give it to the person who will run seat 1; seat 1 shows the other codes in the app)', done.seat1Code)
    return done
  } catch (e) {
    // The company already exists and its passwords were shown only by qt_create_org: do not lose them.
    reveal('RECOVERY - the master write FAILED but the company project was created. Keep this block, fix the master, then register by hand or reset the seats:',
      JSON.stringify({ license, org, seats: seats.map((s) => ({ seat_no: s.seat_no, email: s.email, password: s.password })) }, null, 2))
    throw new CliError(`${e.message}\nThe company project was created; the recovery block above is the ONLY copy of its passwords and license key.`)
  }
}

// ---------------------------------------------------------------- command: export (T36)
/** Companies + seats as JSON for the owner's backup. `*_enc` stay sealed (useless without MASTER_KEK); tokens / device rows are never exported. */
export async function exportMaster({ io, masterUrl, masterKey, includeSealed = true }) {
  const companies = (await rest(io, masterUrl, masterKey, 'GET', 'companies?select=*&order=label')) ?? []
  const seats = (await rest(io, masterUrl, masterKey, 'GET', 'seats?select=*&order=company_id,seat_no')) ?? []
  const strip = (row) => Object.fromEntries(Object.entries(row).filter(([k, v]) => {
    if (!k.endsWith('_enc')) return true
    return includeSealed && (v === null || looksSealed(String(v)))
  }))
  return { format: 'quot3-master-export', version: 1, exportedAt: io.now().toISOString(), sealed: includeSealed, companies: companies.map(strip), seats: seats.map(strip) }
}

// ---------------------------------------------------------------- command: keepalive
/** One harmless request so a free project is not paused for inactivity. ANY answer below 500 proves the project is awake [A]. */
export async function keepalive({ io, url, key }) {
  let res
  try {
    res = await io.fetchImpl(`${String(url).replace(/\/+$/, '')}/rest/v1/companies?select=id&limit=1`, { method: 'GET', headers: { apikey: key, authorization: `Bearer ${key}` } })
  } catch { throw new CliError('The master project did not answer. It may be paused: open the Supabase dashboard and press Restore.') }
  if (res.status >= 500) throw new CliError(`The master project answered with an error (${res.status}). It may be paused or restarting.`)
  return { status: res.status }
}

// ---------------------------------------------------------------- command: init
export function initText({ kek, pepper }) {
  return [
    'QUOT3 MASTER - set-up steps (full guide: docs/MASTER_OWNER_SETUP.md)',
    '',
    '1. Create ONE new Supabase project for the master. Turn on 2FA for your Supabase account.',
    '   Authentication > Providers > Email: turn OFF "Allow new users to sign up".',
    '2. SQL editor of the MASTER project: paste and run, in this order: supabase/master/M01_tables.sql, M02_rls.sql, M03_helpers.sql.',
    '3. Secrets for the functions (shown once - put them in your password manager NOW; if MASTER_KEK is lost every sealed value is unreadable):',
    `     MASTER_KEK=${kek}`,
    `     MASTER_PEPPER=${pepper}`,
    '     ALLOWED_ORIGIN=<the address your phone app is served from, e.g. https://yourname.github.io>',
    '   Set them:  supabase secrets set MASTER_KEK=... MASTER_PEPPER=... ALLOWED_ORIGIN=... --project-ref <master ref>',
    '4. Bundle and deploy the 13 functions (they use extension-less imports, so they are bundled first):',
    '     node tools/master-cli.mjs bundle',
    '     supabase functions deploy --project-ref <master ref> --no-verify-jwt   (from the folder it prints)',
    '5. Put these in your shell for the other commands (not in a file in the project):',
    '     MASTER_URL, MASTER_SERVICE_ROLE_KEY (Settings > API of the master), MASTER_KEK (as above)',
    '6. Then: onboard a new company, or mint an enrol token for an existing one (see the guide).'
  ].join('\n')
}

export const HELP = [
  'Quot3 master owner tool',
  '  init                                  print the deploy steps and make a new MASTER_KEK / MASTER_PEPPER (shown once)',
  '  bundle [--out dir]                    bundle the 13 Edge Functions with esbuild (needs: npm install, esbuild)',
  '  enrol-token <label> [--hours 24]      mint a one-use token that lets an EXISTING company be linked (shown once)',
  '  onboard <label> <seats> --url U --anon A --service-role S [--management-token T] [--project-ref R] [--dry-run]',
  '                                        register a NEW company: SQL 11..21, qt_create_org, seal, print the Seat-1 code',
  '  export [--out file] [--no-sealed]     companies + seats as JSON (secrets stay sealed)',
  '  keepalive                             one harmless request to the master (needs MASTER_URL and MASTER_ANON_KEY or the service key)',
  'Environment: MASTER_URL, MASTER_SERVICE_ROLE_KEY, MASTER_KEK, MASTER_ANON_KEY; COMPANY_URL, COMPANY_ANON_KEY, COMPANY_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN.',
  'Nothing here ever prints a password, key or token except the few values you must see once.'
].join('\n')

// ---------------------------------------------------------------- dispatcher
/** Run one command. Returns the process exit code. `io` = { env, cwd, fetchImpl, now, randomBytes, readFile, listDir, writeFile, mkdirp, print, printSecret }. */
export async function main(argv, io) {
  const { command, positional, flags } = parseArgs(argv)
  const env = io.env ?? {}
  const known = []
  const note = (v) => { if (typeof v === 'string' && v) known.push(v); return v }
  const say = (t) => io.print(redactCliOutput(t, known))
  io.log = (t) => say(t)
  const reveal = (label, value) => io.printSecret(`\n${label}:\n${value}\n`)
  try {
    if (command === 'help' || !COMMANDS.includes(command)) { say(HELP); return command === 'help' || command === undefined ? 0 : 1 }
    if (command === 'init') {
      io.printSecret(initText({ kek: generateKek(io.randomBytes), pepper: b64urlEncode(io.randomBytes(32)) }) + '\n')
      return 0
    }
    if (command === 'bundle') { await (io.bundle ?? (async () => { throw new CliError('Bundling is not available here.') }))(flags.out); return 0 }
    const masterUrl = flags['master-url'] || env.MASTER_URL
    const masterKey = note(env.MASTER_SERVICE_ROLE_KEY)
    if (command === 'keepalive') {
      const key = masterKey || note(env.MASTER_ANON_KEY)
      if (!masterUrl || !key) throw new CliError('Set MASTER_URL and MASTER_ANON_KEY (or MASTER_SERVICE_ROLE_KEY).')
      const r = await keepalive({ io, url: masterUrl, key })
      say(`Master answered (${r.status}). It is awake.`)
      return 0
    }
    if (!masterUrl || !masterKey) throw new CliError('Set MASTER_URL and MASTER_SERVICE_ROLE_KEY (Settings > API of the MASTER project).')
    if (command === 'enrol-token') {
      const label = positional[0]
      const hours = flags.hours === undefined ? 24 : Number(flags.hours)
      const r = await mintEnrolToken({ io, masterUrl, masterKey, label, hours })
      say(`Token minted for "${label}"; valid until ${r.expiresAt}; works once.`)
      reveal('ENROL TOKEN (paste it on seat 1\'s PC in Settings > Company seats > Link to master; it is not stored anywhere readable)', r.token)
      return 0
    }
    if (command === 'export') {
      const data = await exportMaster({ io, masterUrl, masterKey, includeSealed: flags['no-sealed'] !== true })
      const out = typeof flags.out === 'string' ? flags.out : `quot3-master-export-${io.now().toISOString().slice(0, 10)}.json`
      io.writeFile(out, JSON.stringify(data, null, 2))
      say(`Wrote ${data.companies.length} company(ies) and ${data.seats.length} seat(s) to ${out}. ${data.sealed ? 'Sealed values are included; they open only with MASTER_KEK - keep both safe, apart.' : 'Sealed values were left out.'}`)
      return 0
    }
    if (command === 'onboard') {
      const kek = keyFromBase64Url(note(env.MASTER_KEK) ?? '')
      const args = {
        label: positional[0], seats: positional[1], url: flags.url || env.COMPANY_URL, anon: flags.anon || env.COMPANY_ANON_KEY,
        serviceRole: note(flags['service-role'] || env.COMPANY_SERVICE_ROLE_KEY), managementToken: note(flags['management-token'] || env.SUPABASE_ACCESS_TOKEN),
        projectRef: flags['project-ref'], dryRun: flags['dry-run'] === true
      }
      await onboard({ io, master: { url: masterUrl, key: masterKey, kek }, args, say, reveal })
      return 0
    }
    return 1
  } catch (e) {
    say(`Error: ${e instanceof CliError ? e.message : 'something unexpected went wrong'}`)
    return 1
  }
}

// ---------------------------------------------------------------- real io (only used when run from the terminal)
async function realIo() {
  const fs = await import('node:fs')
  const path = await import('node:path')
  return {
    env: process.env, cwd: process.cwd(), fetchImpl: (u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(30_000) }), now: () => new Date(), randomBytes: defaultRandomBytes,
    readFile: (p) => fs.readFileSync(p, 'utf8'), listDir: (p) => fs.readdirSync(p), writeFile: (p, t) => fs.writeFileSync(p, t, { mode: 0o600 }),
    print: (t) => console.log(t), printSecret: (t) => console.log(t),
    bundle: async (outDir) => {
      let esbuild
      try { esbuild = await import('esbuild') } catch { throw new CliError('esbuild is not installed here. Run "npm install" in the project folder first.') }
      const out = path.resolve(typeof outDir === 'string' ? outDir : 'build/master-functions')
      for (const name of FUNCTION_NAMES) {
        await esbuild.build({ entryPoints: [path.resolve('supabase/master/functions', name, 'index.ts')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', outfile: path.join(out, 'supabase/functions', name, 'index.ts'), logLevel: 'warning' })
      }
      console.log(`Bundled ${FUNCTION_NAMES.length} functions into ${out}/supabase/functions. Deploy from ${out}:  supabase functions deploy --project-ref <master ref> --no-verify-jwt`)
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  realIo().then((io) => main(process.argv.slice(2), io)).then((code) => { process.exitCode = code })
}
