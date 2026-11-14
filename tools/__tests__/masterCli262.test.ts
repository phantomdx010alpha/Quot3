import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openText, keyFromBase64Url as sharedKey, looksSealed as sharedLooksSealed } from '../../src/shared/master/seal'
import { validateSeatCode, seatCodeChars as sharedChars } from '../../src/shared/master/seatCode'
import { aadLicense, aadSeatCode, aadSeatPassword, aadServiceRole } from '../../supabase/master/functions/_shared/aad'
import { sha256Hex as sharedSha } from '../../src/shared/master/seal'
import {
  FUNCTION_NAMES, generateKek, generateSeatCode, main, mintEnrolToken, normaliseUrl, orderCompanySqlFiles, parseArgs,
  projectRefFromUrl, redactCliOutput, exportMaster, type CliIo
} from '../master-cli.mjs'

const rnd = (seed = 1) => { let s = seed; return (n: number) => Uint8Array.from({ length: n }, () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16) & 255) }
const MASTER_KEK = generateKek(rnd(7))
const MASTER = 'https://masterref0000.supabase.co'
const SR = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlc2lnbmF0dXJl'

interface Call { method: string; url: string; body: unknown }
function makeIo(over: Partial<CliIo> & { routes?: (c: Call) => unknown } = {}) {
  const calls: Call[] = []; const printed: string[] = []; const secret: string[] = []; const files: Record<string, string> = {}
  const io: CliIo = {
    env: { MASTER_URL: MASTER, MASTER_SERVICE_ROLE_KEY: SR, MASTER_KEK }, cwd: '/p', now: () => new Date('2026-11-13T10:00:00Z'), randomBytes: rnd(3),
    readFile: () => 'select 1;', listDir: () => ['01_licenses.sql', '11_members_branches.sql', '12_records.sql', '13_rls.sql', '14_license_admin.sql', '15_rpcs.sql', '16_realtime.sql', '17_themes.sql', '18_price_list.sql', '19_price_perms.sql', '20_price_log.sql', '21_price_perms_bell.sql', '90_selftest.sql', '99_drop_v1.sql'],
    writeFile: (p, t) => { files[p] = t }, print: (t) => printed.push(t), printSecret: (t) => secret.push(t),
    fetchImpl: async (url, init) => {
      const c = { method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(init.body) : undefined }
      calls.push(c)
      const out = over.routes ? over.routes(c) : null
      return { ok: true, status: 200, text: async () => (out === null || out === undefined ? '' : JSON.stringify(out)) }
    }, ...over
  }
  return { io, calls, printed, secret, files }
}

describe('master CLI (Phase 262): pure helpers', () => {
  it('parses arguments in both flag styles and boolean flags', () => {
    const a = parseArgs(['onboard', 'Acme Traders', '3', '--url', 'https://x.supabase.co', '--dry-run', '--hours=5'])
    expect(a.command).toBe('onboard'); expect(a.positional).toEqual(['Acme Traders', '3']); expect(a.flags).toEqual({ url: 'https://x.supabase.co', 'dry-run': true, hours: '5' })
    expect(parseArgs([]).command).toBe('help'); expect(parseArgs(['export', '--help']).command).toBe('help')
  })
  it('orders only company SQL 11..21', () => {
    expect(orderCompanySqlFiles(['21_price_perms_bell.sql', '99_drop_v1.sql', '11_members_branches.sql', '90_selftest.sql', '15_rpcs.sql', '06_x.sql', 'notes.md', '12_records.sql']))
      .toEqual(['11_members_branches.sql', '12_records.sql', '15_rpcs.sql', '21_price_perms_bell.sql'])
  })
  it('the real supabase/sql folder gives exactly 11 files 11..21 in order', () => {
    const names = ['01_licenses.sql', '11_members_branches.sql', '12_records.sql', '13_rls.sql', '14_license_admin.sql', '15_rpcs.sql', '16_realtime.sql', '17_themes.sql', '18_price_list.sql', '19_price_perms.sql', '20_price_log.sql', '21_price_perms_bell.sql', '91_selftest_v2.sql']
    expect(orderCompanySqlFiles(names).map((n) => n.slice(0, 2))).toEqual(['11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21'])
  })
  it('url helpers', () => {
    expect(projectRefFromUrl('https://abcdefghijklmnop.supabase.co/')).toBe('abcdefghijklmnop'); expect(projectRefFromUrl('http://x')).toBeNull()
    expect(normaliseUrl(' HTTPS://A.supabase.co// ')).toBe('https://a.supabase.co')
  })
  it('redacts keys, JWTs, codes, sealed text and known secrets from output', () => {
    const out = redactCliOutput(`key ${SR} code Q3C-ABCD-EFGH-IJKL-MNOP license Q3-ABCD-EFGH-JKLM password=hunter22 sealed v1.AAAAAAAAAAAAAAAA.${'B'.repeat(30)} plain-secret-value`, ['plain-secret-value'])
    for (const bad of [SR, 'Q3C-ABCD', 'Q3-ABCD', 'hunter22', 'v1.AAAA', 'plain-secret-value']) expect(out).not.toContain(bad)
  })
  it('lists the 13 functions and each has a folder entry file', () => {
    expect(FUNCTION_NAMES.length).toBe(13)
    for (const n of FUNCTION_NAMES) expect(() => readFileSync(`supabase/master/functions/${n}/index.ts`, 'utf8')).not.toThrow()
  })
})

describe('master CLI: formats match the shared core (no drift)', () => {
  it('a CLI-made seat code passes the shared validator and hashes the same', async () => {
    for (let i = 1; i < 6; i++) {
      const code = generateSeatCode(rnd(i)(15)); const v = validateSeatCode(code)
      expect(v.ok).toBe(true)
      const { sha256Hex } = await import('../master-cli.mjs')
      expect(await sha256Hex(sharedChars(code))).toBe(await sharedSha(sharedChars(code)))
    }
  })
  it('a CLI-sealed value opens with the shared openText and its aad', async () => {
    const { sealText } = await import('../master-cli.mjs')
    const key = sharedKey(MASTER_KEK)
    const s = await sealText(key, 'secret text', aadLicense('c1'))
    expect(sharedLooksSealed(s)).toBe(true); expect(await openText(key, s, aadLicense('c1'))).toBe('secret text')
    await expect(openText(key, s, aadServiceRole('c1'))).rejects.toThrow()
  })
})

describe('T35 enrol token', () => {
  it('stores only the hash, one-use row, expiry honoured, token shown once', async () => {
    const { io, calls, secret, printed } = makeIo()
    const code = await main(['enrol-token', 'Acme Traders', '--hours', '2'], io)
    expect(code).toBe(0)
    const post = calls[0]!; expect(post.method).toBe('POST'); expect(post.url).toBe(`${MASTER}/rest/v1/enrol_tokens`)
    const row = post.body as { token_hash: string; company_label: string; expires_at: string; used_at?: unknown }
    expect(Object.keys(row).sort()).toEqual(['company_label', 'expires_at', 'token_hash']) // no used_at: unused; no token field
    expect(row.expires_at).toBe('2026-11-13T12:00:00.000Z')
    const token = /^[A-Za-z0-9_-]{43}$/m.exec(secret.join('\n'))![0]
    expect(row.token_hash).toBe(await sharedSha(token))
    expect(JSON.stringify(post.body)).not.toContain(token)
    expect(printed.join('\n')).not.toContain(token) // the normal output never repeats it
  })
  it('refuses a bad label or hours; needs the master settings', async () => {
    const { io } = makeIo()
    await expect(mintEnrolToken({ io, masterUrl: MASTER, masterKey: SR, label: '', hours: 1 })).rejects.toThrow()
    await expect(mintEnrolToken({ io, masterUrl: MASTER, masterKey: SR, label: 'A', hours: 999 })).rejects.toThrow()
    const noEnv = makeIo({ env: {} }); expect(await main(['enrol-token', 'A'], noEnv.io)).toBe(1)
  })
})

describe('onboard (fake master + fake company, no network)', () => {
  const company = { url: 'https://compref00000a.supabase.co', anon: 'anon-key-123456', sr: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiY29tcGFueSJ9.Y29tcGFueXNpZ25hdHVyZTEyMw' }
  const issued = [1, 2, 3].map((n) => ({ license_key: 'Q3-ABCD-EFGH-JKLM', seat_no: n, email: `seat${n}@quot3.example.com`, password: `pw-for-seat-${n}-xyz` }))
  const routes = (store: { master: Record<string, unknown[]> }) => (c: Call) => {
    if (c.url.startsWith(company.url)) {
      if (c.url.includes('rpc/qt_create_org')) return issued
      if (c.url.includes('licenses?')) return [{ org_id: 'org-1' }]
      if (c.url.includes('sn_members?')) return [1, 2, 3].map((n) => ({ seat_no: n, user_id: `user-${n}` }))
    } else if (c.method === 'POST') { const t = c.url.split('/rest/v1/')[1]!; (store.master[t] ??= []).push(...(Array.isArray(c.body) ? c.body : [c.body])) }
    return null
  }
  const argv = ['onboard', 'Acme Traders', '3', '--url', company.url, '--anon', company.anon, '--service-role', company.sr]

  it('dry run sends nothing', async () => {
    const m = makeIo(); expect(await main([...argv, '--dry-run'], m.io)).toBe(0); expect(m.calls.length).toBe(0)
    expect(m.printed.join('\n')).toContain('11_members_branches.sql')
  })
  it('creates the org, seals everything, prints only the Seat-1 code', async () => {
    const store = { master: {} as Record<string, unknown[]> }
    const m = makeIo({ routes: routes(store) })
    expect(await main(argv, m.io)).toBe(0)
    const comp = store.master.companies![0] as Record<string, string>
    const key = sharedKey(MASTER_KEK)
    expect(comp.supabase_url).toBe(company.url); expect(comp.org_id).toBe('org-1')
    expect(await openText(key, comp.service_role_enc!, aadServiceRole(comp.id!))).toBe(company.sr)
    expect(await openText(key, comp.license_key_enc!, aadLicense(comp.id!))).toBe('Q3-ABCD-EFGH-JKLM')
    const seats = store.master.seats as Array<Record<string, string | number | boolean | null>>
    expect(seats.length).toBe(3)
    for (const s of seats) {
      expect(s.legacy).toBe(false); expect(s.auth_user_id).toBe(`user-${s.seat_no}`)
      expect(await openText(key, s.password_enc as string, aadSeatPassword(comp.id!, s.seat_no as number))).toBe(`pw-for-seat-${s.seat_no}-xyz`)
      const code = await openText(key, s.code_enc as string, aadSeatCode(comp.id!, s.seat_no as number))
      expect(validateSeatCode(code).ok).toBe(true); expect(s.code_hash).toBe(await sharedSha(sharedChars(code))); expect(s.code_hint).toBe(code.slice(-4))
    }
    const seat1 = await openText(key, seats[0]!.code_enc as string, aadSeatCode(comp.id!, 1))
    expect(m.secret.join('\n')).toContain(seat1)
    const shown = m.printed.join('\n') + m.secret.join('\n')
    for (const bad of [company.sr, 'pw-for-seat-1-xyz', 'pw-for-seat-2-xyz', 'Q3-ABCD-EFGH-JKLM', MASTER_KEK, SR]) expect(shown).not.toContain(bad)
    expect(JSON.stringify(store.master)).not.toContain('pw-for-seat') // no plain password in any row sent to the master
  })
  it('with a management token it runs 11..21 in order through the Management API, then stops at the first failure', async () => {
    const store = { master: {} as Record<string, unknown[]> }
    const m = makeIo({ routes: routes(store) })
    expect(await main([...argv, '--management-token', 'sbp_tokentokentoken'], m.io)).toBe(0)
    const sql = m.calls.filter((c) => c.url.startsWith('https://api.supabase.com/'))
    expect(sql.length).toBe(11); expect(sql[0]!.url).toContain('/projects/compref00000a/database/query')
    const bad = makeIo({ fetchImpl: async (u) => ({ ok: !u.includes('api.supabase.com'), status: 400, text: async () => '' }) })
    expect(await main([...argv, '--management-token', 'sbp_tokentokentoken'], bad.io)).toBe(1)
    expect(bad.printed.join('\n')).toContain('Running 11_members_branches.sql failed')
  })
  it('a failed master write prints a recovery block and exits 1', async () => {
    const m = makeIo({ fetchImpl: async (u, i) => {
      if (u.startsWith(company.url)) return { ok: true, status: 200, text: async () => JSON.stringify(u.includes('qt_create_org') ? issued : u.includes('licenses?') ? [{ org_id: 'o' }] : []) }
      return { ok: false, status: 500, text: async () => '' }
    } })
    expect(await main(argv, m.io)).toBe(1)
    expect(m.secret.join('\n')).toContain('RECOVERY'); expect(m.printed.join('\n')).not.toContain('pw-for-seat-1-xyz')
  })
  it('refuses bad input before any call', async () => {
    for (const bad of [['onboard', 'A', '16', '--url', company.url, '--anon', 'a', '--service-role', 'sssssss'], ['onboard', 'A', '3', '--url', 'http://x', '--anon', 'a', '--service-role', 'sssssss'], ['onboard', 'A', '3', '--url', company.url, '--anon', 'a']]) {
      const m = makeIo(); expect(await main(bad, m.io)).toBe(1); expect(m.calls.length).toBe(0)
    }
  })
})

describe('T36 export and keepalive', () => {
  it('export keeps *_enc sealed, writes no plain secret, can drop sealed values', async () => {
    const { sealText } = await import('../master-cli.mjs')
    const key = sharedKey(MASTER_KEK); const sealed = await sealText(key, 'plain-password-1', 'x')
    const m = makeIo({ routes: (c) => (c.url.includes('companies?') ? [{ id: 'c1', label: 'A', service_role_enc: sealed, license_key_enc: sealed, anon_key: 'pub' }] : [{ company_id: 'c1', seat_no: 1, password_enc: sealed, code_enc: null, code_hash: 'h' }]) })
    expect(await main(['export', '--out', 'b.json'], m.io)).toBe(0)
    const text = m.files['b.json']!; const data = JSON.parse(text)
    expect(data.companies[0].service_role_enc).toBe(sealed); expect(text).not.toContain('plain-password-1'); expect(text).not.toContain(SR)
    expect(await exportMaster({ io: m.io, masterUrl: MASTER, masterKey: SR, includeSealed: false }).then((d) => JSON.stringify(d))).not.toContain('_enc')
    // a plain value in an *_enc column is never written out
    const bad = makeIo({ routes: (c) => (c.url.includes('companies?') ? [{ id: 'c1', service_role_enc: 'PLAIN-SERVICE-ROLE' }] : []) })
    expect((await exportMaster({ io: bad.io, masterUrl: MASTER, masterKey: SR })).companies[0]).toEqual({ id: 'c1' })
  })
  it('keepalive: any answer below 500 is awake; 5xx or no answer is a plain-words error', async () => {
    const ok = makeIo({ env: { MASTER_URL: MASTER, MASTER_ANON_KEY: 'anon-key-123456' }, fetchImpl: async () => ({ ok: false, status: 401, text: async () => '' }) })
    expect(await main(['keepalive'], ok.io)).toBe(0)
    const down = makeIo({ env: { MASTER_URL: MASTER, MASTER_ANON_KEY: 'anon-key-123456' }, fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) })
    expect(await main(['keepalive'], down.io)).toBe(1)
    const gone = makeIo({ env: { MASTER_URL: MASTER, MASTER_ANON_KEY: 'anon-key-123456' }, fetchImpl: async () => { throw new Error('x') } })
    expect(await main(['keepalive'], gone.io)).toBe(1); expect(gone.printed.join('')).toContain('paused')
  })
  it('init prints steps and a fresh 32-byte KEK once; help works', async () => {
    const m = makeIo(); expect(await main(['init'], m.io)).toBe(0)
    expect(m.secret.join('')).toMatch(/MASTER_KEK=[A-Za-z0-9_-]{43}/); expect(m.printed.join('')).toBe('')
    const h = makeIo(); expect(await main(['help'], h.io)).toBe(0); expect(h.printed.join('')).toContain('enrol-token')
  })
})
