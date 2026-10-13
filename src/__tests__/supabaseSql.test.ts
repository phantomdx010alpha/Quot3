import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 51: there is no Postgres in CI, so these are STRUCTURAL guards over the SQL text (they cannot prove the SQL
 * runs - the owner runs supabase/sql/90_selftest.sql for that). They fail if someone weakens the security shape.
 */
const root = resolve(__dirname, '..', '..')
const dir = join(root, 'supabase', 'sql')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const sql = (f: string): string => readFileSync(join(dir, f), 'utf8')
const v1Files = files.filter((f) => /^(0[1-6]|90)_/.test(f))
const all = v1Files.map(sql).join('\n') // v1 (postbox) files only; the Milestone 12 files have their own describe below
/** SQL with `-- comments` removed, so comments cannot satisfy or break a check. */
const code = (s: string): string => s.replace(/--[^\n]*/g, '')

describe('supabase sql files (Phase 51)', () => {
  it('ships 01..06 and the self-test, in order', () => {
    expect(v1Files).toEqual(['01_licenses.sql', '02_branches.sql', '03_postbox.sql', '04_rpcs.sql', '05_sweep.sql', '06_pending_count.sql', '90_selftest.sql'])
  })

  it('RLS is enabled on all three tables, never forced, and there is NOT A SINGLE policy', () => {
    for (const t of ['licenses', 'branches', 'postbox']) {
      expect(code(all)).toMatch(new RegExp(`alter table public\\.${t} enable row level security`))
      expect(code(all)).toMatch(new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated`))
    }
    expect(code(all)).not.toMatch(/create\s+policy/i)
    expect(code(all)).not.toMatch(/force row level security/i)
  })

  it('every SECURITY DEFINER function pins an empty search_path', () => {
    const fns = code(sql('04_rpcs.sql') + sql('05_sweep.sql')).split(/create or replace function/i).slice(1)
    expect(fns.length).toBeGreaterThanOrEqual(9)
    for (const f of fns.filter((x) => /security definer/i.test(x))) expect(f).toMatch(/set search_path = ''/)
    expect(fns.filter((x) => /security definer/i.test(x)).length).toBe(8)
  })

  it('the seven app RPCs exist, call the license check first, and are the only granted ones', () => {
    const rpc = code(sql('04_rpcs.sql'))
    for (const name of ['qt_register_branch', 'qt_list_branches', 'qt_push', 'qt_pull', 'qt_ack', 'qt_touch']) {
      expect(rpc).toMatch(new RegExp(`create or replace function public\\.${name}\\(`))
      expect(rpc).toMatch(new RegExp(`grant execute on function public\\.${name}\\(`))
      const body = rpc.split(new RegExp(`create or replace function public\\.${name}\\(`))[1]!.split(/create or replace function/)[0]!
      expect(body.indexOf('public.qt_auth(')).toBeGreaterThan(-1)
    }
    const granted = [...rpc.matchAll(/grant execute on function public\.(\w+)\(/g)].map((m) => m[1])
    expect(granted.sort()).toEqual(['qt_ack', 'qt_list_branches', 'qt_pull', 'qt_push', 'qt_register_branch', 'qt_touch'])
    expect(rpc).toMatch(/revoke all on function public\.qt_auth\(text, uuid\)\s+from public, anon, authenticated/)
    expect(code(sql('05_sweep.sql'))).toMatch(/revoke all on function public\.qt_sweep\(\) from public, anon, authenticated/)
    expect(code(sql('05_sweep.sql'))).not.toMatch(/grant execute/i)
  })

  it('the license failures all raise the same generic message and code', () => {
    const auth = code(sql('04_rpcs.sql')).split('create or replace function public.qt_register_branch')[0]!
    const raises = [...auth.matchAll(/raise exception '(\w+)' using errcode = '(\w+)'/g)].map((m) => `${m[1]}/${m[2]}`)
    expect(raises.filter((r) => r.startsWith('invalid_license'))).toEqual(['invalid_license/Q3L01', 'invalid_license/Q3L01'])
    expect(auth).toMatch(/l\.status = 'active'/)
  })

  it('the key is only ever stored hashed, and no service_role key or secret appears anywhere', () => {
    expect(code(all)).not.toMatch(/service_role/i)
    expect(code(sql('01_licenses.sql'))).not.toMatch(/\bkey\s+text/i)
    expect(code(sql('01_licenses.sql'))).toMatch(/key_hash\s+text\s+not null unique/)
    expect(code(sql('03_postbox.sql'))).toMatch(/nonce\s+bytea/)
    expect(code(sql('03_postbox.sql'))).toMatch(/ciphertext\s+bytea/)
    // the server schema has no readable bill columns
    expect(code(sql('03_postbox.sql'))).not.toMatch(/party|amount|item|total|phone|address/i)
  })

  it('statements are well formed: balanced $$ and parentheses, each file ends a statement', () => {
    for (const f of files) {
      const c = code(sql(f))
      expect((c.match(/\$\$/g) ?? []).length % 2).toBe(0)
      const stripped = c.replace(/'(?:[^']|'')*'/g, "''") // quoted strings out (they may hold parentheses)
      expect((stripped.match(/\(/g) ?? []).length).toBe((stripped.match(/\)/g) ?? []).length)
      expect(c.trimEnd().endsWith(';')).toBe(true)
    }
  })

  it('the limits in the spec are in the SQL: 200 items, 1 MB, 12-byte nonce, 30 day TTL, prefix alphabet', () => {
    const rpc = code(sql('04_rpcs.sql'))
    expect(rpc).toMatch(/v_n > 200/)
    expect(rpc).toMatch(/> 1048576/)
    expect(rpc).toMatch(/octet_length\(v_nonce\) <> 12/)
    expect(code(sql('03_postbox.sql'))).toMatch(/interval '30 days'/)
    expect(code(sql('03_postbox.sql'))).toMatch(/octet_length\(nonce\) = 12/)
    expect(code(sql('02_branches.sql'))).toMatch(/\^\[A-Z0-9_\/-\]\{1,8\}\$/)
    expect(code(sql('02_branches.sql'))).toMatch(/unique \(org_id, po_prefix\)/)
  })
})

describe('supabase sql, Milestone 12 server schema (Phase 128)', () => {
  const m12 = ['11_members_branches.sql', '12_records.sql', '13_rls.sql']
  const tables = ['sn_members', 'sn_branches', 'sn_records', 'sn_history', 'sn_ping']
  const c11 = code(sql('11_members_branches.sql'))
  const c12 = code(sql('12_records.sql'))
  const c13 = code(sql('13_rls.sql'))
  const m12code = code(m12.map(sql).join('\n'))

  it('the three new files exist and the v1 files are untouched in number', () => {
    for (const f of m12) expect(files).toContain(f)
  })

  it('RLS is enabled on every sn_* table and all privileges are revoked from anon / authenticated first', () => {
    for (const t of tables) {
      expect(m12code).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`))
      expect(m12code).toMatch(new RegExp(`revoke all on table public\\.${t}\\s+from public, anon, authenticated`))
    }
    expect(m12code).not.toMatch(/force row level security/i)
  })

  it('there is a select policy per table and NO insert / update / delete / all policy', () => {
    const policies = [...c13.matchAll(/create policy (\w+) on public\.(\w+)\s+for (\w+) to (\w+)/g)]
    expect(policies.map((p) => p[2]).sort()).toEqual([...tables].sort())
    for (const p of policies) {
      expect(p[3]).toBe('select')
      expect(p[4]).toBe('authenticated')
    }
    expect(m12code).not.toMatch(/for\s+(insert|update|delete|all)\b/i)
    // each policy is re-runnable
    expect((c13.match(/drop policy if exists/g) ?? []).length).toBe(tables.length)
  })

  it('policies scope to the caller\'s own organisation through sn_members and auth.uid()', () => {
    for (const t of ['sn_branches', 'sn_records', 'sn_history', 'sn_ping']) {
      const body = c13.split(`create policy ${t}_select_org`)[1]!.split(/drop policy|grant select/)[0]!
      expect(body).toMatch(/from public\.sn_members m where m\.user_id = \(select auth\.uid\(\)\)/)
    }
    expect(c13).toMatch(/user_id = \(select auth\.uid\(\)\)/)
  })

  it('nothing is granted to anon, and authenticated only gets select', () => {
    const grants = [...m12code.matchAll(/grant\s+([^;]*?)\s+on\s+/gi)].map((g) => g[1]!.trim().toLowerCase())
    expect(grants.length).toBe(tables.length)
    for (const g of grants) expect(g).toBe('select')
    expect(m12code).not.toMatch(/to\s+[^;]*\banon\b/i)
    expect(m12code).not.toMatch(/service_role/i)
  })

  it('members and branches: seats unique per organisation, name and PO prefix unique per organisation', () => {
    expect(c11).toMatch(/unique \(org_id, seat_no\)/)
    expect(c11).toMatch(/unique \(org_id, name_norm\)/)
    expect(c11).toMatch(/unique \(org_id, po_prefix\)/)
    expect(c11).toMatch(/\^\[A-Z0-9_\/-\]\{1,8\}\$/)
    expect(c11).toMatch(/user_id\s+uuid\s+primary key references auth\.users \(id\) on delete cascade/)
  })

  it('records: kinds, primary key, server_seq sequence + index, 1 MB payload cap, version and reader stamps', () => {
    expect(c12).toMatch(/kind in \('bill', 'party', 'party_merge', 'item_rule'\)/)
    expect(c12).toMatch(/primary key \(org_id, kind, rec_id\)/)
    expect(c12).toMatch(/create sequence if not exists public\.sn_server_seq/)
    expect(c12).toMatch(/server_seq\s+bigint\s+not null default nextval\('public\.sn_server_seq'\)/)
    expect(c12).toMatch(/on public\.sn_records \(org_id, server_seq\)/)
    expect(c12).toMatch(/octet_length\(payload::text\) <= 1048576/)
    for (const col of ['version', 'deleted', 'payload_hash', 'schema_ver', 'min_reader_ver', 'app_ver', 'edited_at', 'from_branch', 'updated_at']) expect(c12).toMatch(new RegExp(`\\b${col}\\b`))
    expect(c12).toMatch(/reason\s+text\s+not null check \(reason in \('superseded', 'conflict_loser'\)\)/)
    expect(c12).toMatch(/org_id\s+uuid\s+primary key references public\.licenses/)
  })

  it('every statement is re-runnable (if not exists / guarded) and no v1 table is touched or dropped', () => {
    for (const f of m12) {
      const c = code(sql(f))
      for (const m of c.matchAll(/create (table|index|sequence)\s+(?!if not exists)/gi)) throw new Error(`${f}: ${m[0]} is not re-runnable`)
      expect(c).not.toMatch(/\bdrop\s+(table|function|schema)\b/i)
      expect(c).not.toMatch(/\b(alter|insert into|update|delete from)\s+(table\s+)?public\.(branches|postbox|licenses)\b/i)
    }
  })
})

describe('supabase sql, license + login generator (Phase 129)', () => {
  const c14 = code(sql('14_license_admin.sql'))
  const fnBodies = c14.split(/create or replace function/i).slice(1)
  const owner = ['qt_create_org', 'qt_add_seats', 'qt_reset_seat', 'qt_revoke_seat', 'qt_set_license_status', 'qt_attach_seat']
  const internal = ['qt_gen_password', 'qt_gen_key', 'qt_slug', 'qt_org_by_label', 'qt_make_login']
  const bodyOf = (n: string): string => fnBodies.find((b) => b.trim().startsWith(`public.${n}(`))!

  it('the file exists and defines every owner function and helper', () => {
    expect(files).toContain('14_license_admin.sql')
    for (const n of [...owner, ...internal]) expect(bodyOf(n), n).toBeTruthy()
    expect(fnBodies.length).toBe(owner.length + internal.length)
  })

  it('every function pins an empty search_path; every one but the pure slug is security definer', () => {
    for (const b of fnBodies) expect(b).toMatch(/set search_path = ''/)
    for (const n of [...owner, ...internal.filter((x) => x !== 'qt_slug')]) expect(bodyOf(n), n).toMatch(/security definer/)
  })

  it('nothing is executable by the app roles: every function is revoked and there is no grant at all', () => {
    expect(c14).not.toMatch(/\bgrant\b/i)
    for (const n of [...owner, ...internal]) expect(c14, n).toMatch(new RegExp(`revoke all on function public\\.${n}\\([^)]*\\)\\s+from public, anon, authenticated;`))
    expect([...c14.matchAll(/revoke all on function/g)].length).toBe(owner.length + internal.length)
  })

  it('the key is stored only as qt_license_hash(key); format and alphabet match the app generator', () => {
    const create = bodyOf('qt_create_org')
    expect(create).toMatch(/insert into public\.licenses \(key_hash, label, max_branches\)\s+values \(public\.qt_license_hash\(v_key\), v_label, p_seats\)/)
    expect(c14).not.toMatch(/insert into public\.licenses[^;]*\bv_key\s*[,)]\s*v_label/)
    expect(bodyOf('qt_gen_key')).toContain("'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'")
    expect(bodyOf('qt_gen_key')).toMatch(/'Q3-'/)
    expect(readFileSync(join(root, 'scripts', 'generate-license.mjs'), 'utf8')).toContain("'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'")
    expect(bodyOf('qt_gen_key')).toMatch(/gen_random_bytes\(12\)/)
  })

  it('passwords: 16 characters, 32-symbol alphabet without look-alikes, from gen_random_bytes, bcrypt only', () => {
    const b = bodyOf('qt_gen_password')
    expect(b).toMatch(/gen_random_bytes\(16\)/)
    const alphabet = /'([A-Z2-9]{32})'/.exec(b)![1]!
    expect(alphabet).not.toMatch(/[IO01]/)
    expect(new Set(alphabet).size).toBe(32)
    expect(b).toMatch(/& 31/)
    expect(bodyOf('qt_make_login')).toMatch(/extensions\.crypt\(p_password, extensions\.gen_salt\('bf'\)\)/)
  })

  it('a password or key is never logged, noticed or written to a plain column', () => {
    expect(c14).not.toMatch(/raise\s+(notice|warning|info|log|debug)/i)
    expect(c14).not.toMatch(/create\s+table|alter\s+table|add\s+column/i)
    expect(c14).not.toMatch(/service_role/i)
    // raise messages never interpolate a secret
    for (const m of c14.matchAll(/raise exception ([^;]*);/g)) expect(m[1]).not.toMatch(/p_password|v_pw|v_key|p_key/)
  })

  it('logins: confirmed at once, provider email, token columns are empty strings (not NULL), identity row created', () => {
    const b = bodyOf('qt_make_login')
    expect(b).toMatch(/insert into auth\.users/)
    expect(b).toMatch(/insert into auth\.identities/)
    expect(b).toMatch(/email_confirmed_at/)
    expect(b).toMatch(/'authenticated', 'authenticated'/)
    expect(b).toMatch(/"provider":"email"/)
    for (const col of ['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change']) expect(b).toContain(col)
    expect(b).toMatch(/'', '', '', ''/)
    expect(b).toMatch(/already has a login/)
  })

  it('qt_create_org: seat count 1..50, one email per seat or none, duplicate label refused, one membership per seat', () => {
    const b = bodyOf('qt_create_org')
    expect(c14).toMatch(/qt_create_org\(\s*p_label\s+text,\s*p_seats\s+int,\s*p_emails\s+text\[\] default null,\s*p_domain\s+text\s+default '[a-z0-9.-]+'\s*\)/)
    expect(b).toMatch(/p_seats not between 1 and 50/)
    expect(b).toMatch(/array_length\(p_emails, 1\), 0\) <> p_seats/)
    expect(b).toMatch(/an organisation with that label already exists/)
    expect(b).toMatch(/insert into public\.sn_members \(user_id, org_id, seat_no\)/)
    expect(b).toMatch(/returns table|return query select v_key, v_i, v_email, v_pw/)
    expect(c14).toMatch(/returns table \(license_key text, seat_no int, email text, password text\)/)
  })

  it('helpers: reset ends sessions, revoke removes the login, suspend bans and restores, attach uses a free seat only', () => {
    expect(bodyOf('qt_reset_seat')).toMatch(/delete from auth\.sessions/)
    expect(bodyOf('qt_revoke_seat')).toMatch(/delete from auth\.users/)
    expect(bodyOf('qt_set_license_status')).toMatch(/p_status not in \('active', 'suspended'\)/)
    expect(bodyOf('qt_set_license_status')).toMatch(/banned_until/)
    expect(bodyOf('qt_attach_seat')).toMatch(/not exists \(select 1 from public\.sn_members m where m\.org_id = v_org and m\.seat_no = g\.n\)/)
    expect(bodyOf('qt_attach_seat')).toMatch(/already has a seat/)
    expect(bodyOf('qt_add_seats')).toMatch(/> 50/)
  })

  it('does not touch the v1 tables other than reading/inserting licenses, and drops nothing', () => {
    expect(c14).not.toMatch(/\bdrop\b/i)
    expect(c14).not.toMatch(/public\.(branches|postbox)\b/)
  })
})

describe('supabase sql, app RPCs (Phase 130)', () => {
  const c15 = code(sql('15_rpcs.sql'))
  const fns = c15.split(/create or replace function/i).slice(1)
  const bodyOf = (n: string): string => fns.find((b) => b.trim().startsWith(`public.${n}(`))!
  const app = ['sn_now', 'sn_activate', 'sn_branch_name_free', 'sn_rename_branch', 'sn_list_branches', 'sn_manifest', 'sn_push', 'sn_pull', 'sn_touch']
  const helpers = ['sn_name_norm', 'sn_member_org', 'sn_history_add']

  it('defines exactly the nine app functions and three helpers, and does not redefine any v1 qt_ function', () => {
    for (const n of [...app, ...helpers]) expect(bodyOf(n), n).toBeTruthy()
    expect(fns.length).toBe(app.length + helpers.length)
    expect(c15).not.toMatch(/create or replace function public\.qt_/)
    // the v1 signatures that would have been overwritten are untouched
    expect(code(sql('04_rpcs.sql'))).toMatch(/function public\.qt_push\(p_license text, p_branch_id uuid, p_items jsonb\)/)
  })

  it('every function pins an empty search_path; all but the pure name normaliser are security definer', () => {
    for (const f of fns) expect(f).toMatch(/set search_path = ''/)
    for (const n of [...app, 'sn_member_org', 'sn_history_add']) expect(bodyOf(n), n).toMatch(/security definer/)
  })

  it('auth: sn_member_org reads auth.uid(), checks membership, the hashed key and active status; every app RPC calls it', () => {
    const m = bodyOf('sn_member_org')
    expect(m).toMatch(/auth\.uid\(\)/)
    expect(m).toMatch(/from public\.sn_members m where m\.user_id = v_uid/)
    expect(m).toMatch(/l\.key_hash = public\.qt_license_hash\(/)
    expect(m).toMatch(/l\.status = 'active'/)
    expect(m).toMatch(/errcode = 'Q3A01'/)
    expect(m).toMatch(/errcode = 'Q3L01'/)
    expect(m).toMatch(/errcode = 'Q3M01'/)
    for (const n of app.filter((x) => x !== 'sn_now')) expect(bodyOf(n), n).toMatch(/public\.sn_member_org\(p_license, /)
    // a client-supplied organisation id is never trusted: no app function takes one
    for (const n of app) expect(bodyOf(n).split(/\bas \$\$/)[0], n).not.toMatch(/\bp_org/)
  })

  it('privileges: everything revoked from public / anon / authenticated, only the nine app functions granted, and only to authenticated', () => {
    for (const n of [...app, ...helpers]) expect(c15, n).toMatch(new RegExp(`revoke all on function public\\.${n}\\([^)]*\\)\\s+from public, anon, authenticated;`))
    const grants = [...c15.matchAll(/grant execute on function public\.(\w+)\([^)]*\)\s+to (\w+);/g)]
    expect(grants.map((g) => g[1]).sort()).toEqual([...app].sort())
    for (const g of grants) expect(g[2]).toBe('authenticated')
    expect(c15).not.toMatch(/\bto\s+(anon|public)\b/i)
    expect(c15).not.toMatch(/service_role/i)
  })

  it('limits: 200 items, 8 MB per push, 1 MB per payload, 1000 per manifest page, 200 rows / 4 MB per pull, history cap 20', () => {
    const push = bodyOf('sn_push')
    expect(push).toMatch(/v_n > 200/)
    expect(push).toMatch(/octet_length\(p_items::text\) > 8388608/)
    expect(push).toMatch(/octet_length\(v_payload::text\) > 1048576/)
    expect(push).toMatch(/errcode = 'Q3R01'/)
    expect(push).toMatch(/errcode = 'Q3I03'/)
    expect(bodyOf('sn_manifest')).toMatch(/p_limit not between 1 and 1000/)
    expect(bodyOf('sn_pull')).toMatch(/p_limit not between 1 and 200/)
    expect(bodyOf('sn_pull')).toMatch(/4194304/)
    expect(bodyOf('sn_history_add')).toMatch(/offset 20/)
  })

  it('push: outcomes, history reasons, per-record lock, sequence on every write, ONE ping per call, nothing is deleted', () => {
    const push = bodyOf('sn_push')
    for (const o of ['accepted', 'noop', 'won', 'lost']) expect(push).toContain(`v_outcome := '${o}'`)
    expect(push).toContain("'superseded'")
    expect(push).toContain("'conflict_loser'")
    expect(push).toMatch(/for update;/)
    expect(push).toMatch(/pg_advisory_xact_lock/)
    expect((push.match(/nextval\('public\.sn_server_seq'\)/g) ?? []).length).toBe(3)
    expect((push.match(/insert into public\.sn_ping/g) ?? []).length).toBe(1)
    // the ping is after the loop, once
    expect(push.indexOf('insert into public.sn_ping')).toBeGreaterThan(push.indexOf('end loop'))
    expect(push).not.toMatch(/delete from public\.sn_records/)
    expect(c15).not.toMatch(/delete from public\.sn_records|truncate/i)
  })

  it('pull: ordered by server_seq, after a cursor, has_more and server_time returned, deletes nothing', () => {
    const pull = bodyOf('sn_pull')
    expect(pull).toMatch(/x\.server_seq > v_after/)
    expect(pull).toMatch(/order by x\.server_seq/)
    expect(pull).toMatch(/'has_more'/)
    expect(pull).toMatch(/'server_time'/)
    expect(pull).not.toMatch(/\bdelete\b/)
  })

  it('activate: unique name and prefix, seat bound to one branch, explicit takeover, generic constraint fallback', () => {
    const a = bodyOf('sn_activate')
    expect(a).toMatch(/p_takeover boolean default false/)
    expect(a).toMatch(/errcode = 'Q3B05'/)
    expect(a).toMatch(/errcode = 'Q3B04'/)
    expect(a).toMatch(/errcode = 'Q3B02'/)
    expect(a).toMatch(/errcode = 'Q3B03'/)
    expect(a).toMatch(/v_prefix !~ '\^\[A-Z0-9_\/-\]\{1,8\}\$'/)
    expect(a).toMatch(/for update/)
    expect(a).toMatch(/when unique_violation/)
    expect(a.indexOf("errcode = 'Q3B05'")).toBeLessThan(a.indexOf('delete from public.sn_branches'))
    expect(bodyOf('sn_rename_branch')).toMatch(/errcode = 'Q3B04'/)
    expect(bodyOf('sn_branch_name_free')).toMatch(/public\.sn_name_norm\(p_name\)/)
  })

  it('the manifest returns no payloads', () => {
    expect(bodyOf('sn_manifest')).not.toMatch(/payload\b(?!_hash)/)
  })

  it('statements re-runnable and no v1 table is touched', () => {
    expect(c15).not.toMatch(/create\s+table|\bdrop\b|alter\s+table/i)
    expect(c15).not.toMatch(/public\.(branches|postbox)\b/)
    expect(c15).not.toMatch(/raise\s+(notice|warning|info|log|debug)/i)
  })
})

describe('supabase sql, Realtime doorbell + self-test v2 + drop-v1 (Phase 131)', () => {
  const raw16 = sql('16_realtime.sql')
  const raw91 = sql('91_selftest_v2.sql')
  const raw99 = sql('99_drop_v1.sql')
  const c16 = code(raw16)
  const c91 = code(raw91)
  const c99 = code(raw99)
  const c15 = code(sql('15_rpcs.sql'))
  const defined15 = new Set([...c15.matchAll(/create or replace function public\.(sn_\w+)\(/g)].map((m) => m[1]!))
  const v1Fns = [...code(['04_rpcs.sql', '05_sweep.sql', '06_pending_count.sql'].map(sql).join('\n')).matchAll(/create or replace function public\.(qt_\w+)\(/g)].map((m) => m[1]!)

  it('the three files exist, in run order, and the v1 list is unchanged', () => {
    for (const f of ['16_realtime.sql', '91_selftest_v2.sql', '99_drop_v1.sql']) expect(files).toContain(f)
    expect(v1Files.length).toBe(7)
    expect(files.indexOf('16_realtime.sql')).toBeGreaterThan(files.indexOf('15_rpcs.sql'))
    expect(files.indexOf('91_selftest_v2.sql')).toBeGreaterThan(files.indexOf('90_selftest.sql'))
  })

  it('16: adds ONLY sn_ping to the supabase_realtime publication, guarded so it can be re-run', () => {
    expect([...c16.matchAll(/add table\s+([\w.]+)/gi)].map((m) => m[1])).toEqual(['public.sn_ping'])
    expect(c16).toMatch(/pubname = 'supabase_realtime'/)
    expect(c16).toMatch(/pg_publication_tables/)
    expect(c16).toMatch(/if not exists \(select 1 from pg_catalog\.pg_publication where pubname = 'supabase_realtime'\)/)
    expect(c16).toMatch(/elsif exists/)
    expect(c16).not.toMatch(/\b(drop|create|insert|update|delete)\b/i)
    for (const t of ['sn_records', 'sn_history', 'sn_members', 'sn_branches', 'licenses']) expect(c16).not.toMatch(new RegExp(`add table[^;]*${t}`, 'i'))
  })

  it('91: one transaction that ends in ROLLBACK, never commits, and ends with the success line', () => {
    expect(c91.trimStart().startsWith('begin;')).toBe(true)
    expect(c91.trimEnd().endsWith('rollback;')).toBe(true)
    expect(c91).not.toMatch(/\bcommit\b/i)
    expect(raw91).toMatch(/ALL QUOT3 SHARED-NOTEBOOK SELF-TESTS PASSED/)
    expect(c91).toMatch(/raise notice 'PASS  %'/)
    expect(c91).toMatch(/raise exception 'FAIL  %/)
  })

  it('91: calls only functions that exist (sn_* from file 15, the owner qt_ helpers, nothing from v1) and only known error codes', () => {
    const called = new Set([...c91.matchAll(/public\.(sn_\w+)\(/g)].map((m) => m[1]!))
    for (const n of called) expect(defined15.has(n), `${n} is defined in 15_rpcs.sql`).toBe(true)
    for (const n of ['sn_now', 'sn_activate', 'sn_branch_name_free', 'sn_rename_branch', 'sn_list_branches', 'sn_manifest', 'sn_push', 'sn_pull', 'sn_touch']) expect(called.has(n), `${n} is exercised`).toBe(true)
    const qt = new Set([...c91.matchAll(/public\.(qt_\w+)\(/g)].map((m) => m[1]!))
    expect([...qt].sort()).toEqual(['qt_create_org', 'qt_license_hash', 'qt_revoke_seat', 'qt_set_license_status'])
    for (const n of v1Fns) if (!['qt_license_hash'].includes(n)) expect(c91, n).not.toMatch(new RegExp(`public\\.${n}\\(`))
    const known = new Set([...c15.matchAll(/errcode = '(Q3\w\d\d)'/g)].map((m) => m[1]!))
    for (const m of c91.matchAll(/'(Q3[A-Z]\d\d)'/g)) expect(known.has(m[1]!), `${m[1]} is raised by file 15`).toBe(true)
    expect(c91).not.toMatch(/service_role/i)
  })

  it('91: covers every case the phase asked for', () => {
    // org creation and key hashing
    expect(c91).toMatch(/qt_create_org\('selftest notebook A'/)
    expect(c91).toMatch(/l\.key_hash = public\.qt_license_hash\(k_a\)/)
    // name / prefix clash, cross-organisation branch id, takeover
    for (const code_ of ['Q3B04', 'Q3B02', 'Q3B03', 'Q3B05']) expect(c91).toContain(`'${code_}'`)
    expect(c91).toMatch(/, true\)'/) // takeover = true
    // push outcomes both ways, noop, tombstone, history cap, validation, all-or-nothing, doorbell
    for (const o of ['accepted', 'noop', 'won', 'lost']) expect(c91).toContain(`'${o}'`)
    expect(c91).toMatch(/conflict_loser/)
    expect(c91).toMatch(/superseded/)
    expect(c91).toMatch(/tombstone/)
    expect(c91).toMatch(/= 20,/)
    expect(c91).toContain("'Q3I03'")
    expect(c91).toMatch(/all or nothing/)
    expect(c91).toMatch(/sn_ping/)
    // pull cursor, limits, manifest
    expect(c91).toMatch(/has_more/)
    expect(c91).toMatch(/server_seq keeps increasing/)
    expect(c91).toMatch(/sn_manifest/)
    // RLS isolation between two organisations, reads and direct writes
    expect(c91).toMatch(/selftest notebook B/)
    expect(c91).toMatch(/RLS: seat of A cannot see any B record/)
    for (const s of ['insert into public.sn_records', 'update public.sn_records', 'delete from public.sn_records']) expect(c91).toContain(s)
    // anon refused, suspended, revoked, realtime
    expect(c91).toMatch(/'anon'\)/)
    expect(c91).toMatch(/foreach v_tbl in array array\['sn_members', 'sn_branches', 'sn_records', 'sn_history', 'sn_ping', 'licenses'\]/)
    expect(c91).toMatch(/qt_set_license_status\('selftest notebook A', 'suspended'\)/)
    expect(c91).toMatch(/qt_revoke_seat\('selftest notebook A', 2\)/)
    expect(c91).toMatch(/pg_publication_tables/)
  })

  it('91: every tie-break assumption is consistent with the branch ids it uses (b_a3 is greater than b_a2)', () => {
    const id = (n: string): string => new RegExp(`${n}\\s+constant uuid := '([0-9a-f-]{36})'`).exec(c91)![1]!
    expect(id('b_a3') > id('b_a2')).toBe(true)
  })

  it('99: refuses to run as shipped, drops only v1 objects, keeps licenses and the new notebook, and is not wired anywhere', () => {
    expect(c99).toMatch(/v_confirm constant text := 'NO'/)
    expect(c99).toMatch(/if v_confirm <> 'DROP V1' then\s+raise exception 'refused/)
    expect(c99).toMatch(/to_regclass\('public\.sn_records'\) is null/)
    expect(c99.indexOf("raise exception 'refused")).toBeLessThan(c99.indexOf('drop function'))
    const dropped = [...c99.matchAll(/drop function if exists public\.(qt_\w+)\(/g)].map((m) => m[1]!).sort()
    expect(dropped).toEqual(['qt_ack', 'qt_auth', 'qt_list_branches', 'qt_pending_count', 'qt_pull', 'qt_push', 'qt_register_branch', 'qt_sweep', 'qt_touch'])
    for (const n of dropped) expect(v1Fns, `${n} is a v1 function`).toContain(n)
    expect(dropped).not.toContain('qt_license_hash')
    expect([...c99.matchAll(/drop table if exists public\.(\w+)/g)].map((m) => m[1])).toEqual(['postbox', 'branches'])
    expect(c99).not.toMatch(/drop[^;]*\bsn_/i)
    expect(c99).not.toMatch(/drop (table|function)(?! if exists)/i)
    expect(c99).not.toMatch(/\bcascade\b/i)
    const pkg = readFileSync(join(root, 'package.json'), 'utf8')
    expect(pkg).not.toMatch(/99_drop_v1/)
    for (const f of files) if (f !== '99_drop_v1.sql') expect(sql(f), f).not.toMatch(/99_drop_v1/)
  })

  it('SUPABASE_MIGRATIONS.md lists the new files and has the v2 checklist', () => {
    const doc = readFileSync(join(root, 'docs', 'SUPABASE_MIGRATIONS.md'), 'utf8')
    for (const f of ['16_realtime.sql', '91_selftest_v2.sql', '99_drop_v1.sql']) expect(doc).toContain(f)
    expect(doc).toMatch(/Real-Supabase checklist v2/)
    for (const s of ['A. Server', 'B. Sign-in and activation', 'C. Normal flow', 'D. Bad network and conflicts', 'E. Limits, pause and housekeeping']) expect(doc).toContain(s)
    expect(doc).not.toMatch(/to be completed in Phase 131/)
  })
})

describe('scripts/generate-license.mjs (Phase 51)', () => {
  const run = (...args: string[]): string => execFileSync(process.execPath, [join(root, 'scripts', 'generate-license.mjs'), ...args], { encoding: 'utf8' })

  it('prints a well-formed key and an insert whose hash is sha256("quot3-license:" + key)', () => {
    const out = run('--label', "O'Brien & Sons", '--max-branches', '3')
    const key = /: (Q3-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4})\b/.exec(out)![1]!
    const hash = createHash('sha256').update(`quot3-license:${key}`).digest('hex')
    expect(out).toContain(`values ('${hash}', 'O''Brien & Sons', 3);`)
    expect(out).not.toContain(`'${key}'`) // the key itself never goes into the SQL
  })

  it('refuses a bad seat count', () => {
    expect(() => execFileSync(process.execPath, [join(root, 'scripts', 'generate-license.mjs'), '--max-branches', '0'], { stdio: 'pipe' })).toThrow()
  })
})
