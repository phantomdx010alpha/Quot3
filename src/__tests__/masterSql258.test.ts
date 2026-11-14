import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 258 (Milestone 24): there is no Postgres in CI, so these are STRUCTURAL guards over the master SQL text (they cannot prove the SQL
 * runs; the owner proves that with the Phase 273 checklist). They fail if someone weakens the security shape frozen in API_CONTRACTS.md "M24-0" C3.
 */
const root = resolve(__dirname, '..', '..')
const dir = join(root, 'supabase', 'master')
const raw = (f: string): string => readFileSync(join(dir, f), 'utf8')
/** SQL with `-- comments` removed, so comments cannot satisfy or break a check. */
const code = (s: string): string => s.replace(/--[^\n]*/g, '')
const m01 = code(raw('M01_tables.sql'))
const m02 = code(raw('M02_rls.sql'))
const m03 = code(raw('M03_helpers.sql'))
const everything = m01 + '\n' + m02 + '\n' + m03
const TABLES = ['companies', 'seats', 'devices', 'enrol_tokens', 'attempts', 'master_log']

/** The text of one `create table` statement (up to its closing `);` line). */
const tableBody = (t: string): string => {
  const start = m01.indexOf(`create table if not exists public.${t} (`)
  expect(start).toBeGreaterThan(-1)
  return m01.slice(start, m01.indexOf('\n);', start) + 3)
}

describe('master sql files (Phase 258)', () => {
  it('ships M01..M03 in order, in their own folder, and none of them leaked into the company series', () => {
    expect(readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()).toEqual(['M01_tables.sql', 'M02_rls.sql', 'M03_helpers.sql'])
    expect(readdirSync(join(root, 'supabase', 'sql')).filter((f) => /^M\d/.test(f))).toEqual([])
  })

  it('every file says NEVER RUN from the sandbox and is safe to re-run', () => {
    for (const f of ['M01_tables.sql', 'M02_rls.sql', 'M03_helpers.sql']) {
      expect(raw(f)).toMatch(/NEVER RUN from the sandbox/)
      expect(raw(f)).toMatch(/Safe to run more than once/)
    }
    expect([...m01.matchAll(/create table (?!if not exists)/g)]).toEqual([])
    expect([...m01.matchAll(/create (unique )?index (?!if not exists)/g)]).toEqual([])
    expect([...m03.matchAll(/create function/g)]).toEqual([])
    expect(everything).not.toMatch(/drop\s+(table|function|index|policy)|truncate/i)
  })

  it('M01 creates exactly the six master tables and nothing else', () => {
    expect([...m01.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])).toEqual(TABLES)
    // the master never holds company data
    expect(m01).not.toMatch(/\b(party|amount|item|total|bill|customer|price)\w*\s+(text|int|numeric|jsonb)/i)
  })

  it('RLS is enabled on all six tables, every client role is revoked, and there is NOT A SINGLE POLICY', () => {
    for (const t of TABLES) {
      expect(m02).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`))
      expect(m02).toMatch(new RegExp(`revoke all on table public\\.${t}\\s+from public, anon, authenticated`))
    }
    expect(everything).not.toMatch(/create\s+policy/i)
    expect(everything).not.toMatch(/force row level security/i)
    expect(everything).not.toMatch(/disable row level security/i)
    expect(m02).toMatch(/revoke all on sequence public\.attempts_id_seq\s+from public, anon, authenticated/)
    expect(m02).toMatch(/revoke all on sequence public\.master_log_id_seq\s+from public, anon, authenticated/)
  })

  it('nothing is ever granted to anon, authenticated or public', () => {
    const grants = [...everything.matchAll(/grant\s[^;]*;/gi)].map((m) => m[0])
    for (const g of grants) expect(g).not.toMatch(/\bto\s+(public|anon|authenticated)\b/i)
    expect(grants.length).toBe(2)
    for (const g of grants) expect(g).toMatch(/to service_role\s*;/)
  })

  it('companies: label / url unique, max_seats is 1..15, status and profile_version are checked', () => {
    const t = tableBody('companies')
    expect(t).toMatch(/label\s+text not null unique check \(char_length\(label\) between 1 and 80\)/)
    expect(t).toMatch(/supabase_url\s+text not null unique check \(supabase_url ~ '\^https:\/\/'\)/)
    expect(t).toMatch(/max_seats\s+int\s+not null default 15 check \(max_seats between 1 and 15\)/)
    expect(t).toMatch(/status\s+text not null default 'active' check \(status in \('active', 'suspended'\)\)/)
    expect(t).toMatch(/profile_version\s+int\s+not null default 0 check \(profile_version >= 0\)/)
    expect(t).toMatch(/org_id\s+uuid not null/)
  })

  it('seats: seat_no is 1..15, composite key, cascade from the company, legacy and revoked rows hold no code', () => {
    const t = tableBody('seats')
    expect(t).toMatch(/seat_no\s+int\s+not null check \(seat_no between 1 and 15\)/)
    expect(t).toMatch(/primary key \(company_id, seat_no\)/)
    expect(t).toMatch(/company_id\s+uuid not null references public\.companies \(id\) on delete cascade/)
    expect(t).toMatch(/code_hash\s+text unique/)
    expect(t).toMatch(/code_hint\s+text check \(code_hint is null or char_length\(code_hint\) = 4\)/)
    expect(t).toMatch(/status\s+text not null default 'active' check \(status in \('active', 'revoked'\)\)/)
    expect(t).toMatch(/check \(not legacy or \(password_enc is null and code_hash is null and code_enc is null\)\)/)
    expect(t).toMatch(/check \(status = 'active' or \(code_hash is null and code_enc is null\)\)/)
    expect(t).toMatch(/auth_user_id\s+uuid,/)
  })

  it('secrets are only ever stored sealed: every secret column is *_enc, and no plain secret column exists', () => {
    for (const col of ['license_key_enc', 'service_role_enc', 'password_enc', 'code_enc']) expect(m01).toMatch(new RegExp(`\\b${col}\\s+text`))
    expect(m01).not.toMatch(/\b(password|service_role|license_key|license|code|token|secret)\s+text/i)
    expect(m01).toMatch(/token_hash\s+text not null unique/)
    expect(m01).toMatch(/token_hash\s+text primary key/)
    // the only server-side hash columns are hashes
    expect(m01).toMatch(/code_hash\s+text unique/)
    expect(m01).toMatch(/ip_hash\s+text not null/)
  })

  it('devices: token is hashed and unique, platform is checked, deleted with its seat', () => {
    const t = tableBody('devices')
    expect(t).toMatch(/platform\s+text not null check \(platform in \('desktop', 'phone'\)\)/)
    expect(t).toMatch(/foreign key \(company_id, seat_no\) references public\.seats \(company_id, seat_no\) on delete cascade/)
    expect(t).toMatch(/label\s+text not null default '' check \(char_length\(label\) <= 40\)/)
  })

  it('enrol_tokens, attempts and master_log carry the frozen columns, limits and indexes', () => {
    expect(tableBody('enrol_tokens')).toMatch(/expires_at\s+timestamptz not null/)
    expect(tableBody('enrol_tokens')).toMatch(/used_at\s+timestamptz,/)
    expect(tableBody('attempts')).toMatch(/ok\s+boolean not null/)
    expect(m01).toMatch(/create index if not exists attempts_ip_at_idx on public\.attempts \(ip_hash, at\)/)
    expect(tableBody('master_log')).toMatch(/detail\s+text not null default '' check \(char_length\(detail\) <= 500\)/)
    expect(m01).toMatch(/create unique index if not exists master_log_req_idx on public\.master_log \(company_id, action, req_id\) where req_id is not null/)
  })

  it('both helpers are SECURITY DEFINER with an empty search_path, revoked from client roles, granted to service_role only', () => {
    const fns = m03.split(/create or replace function/i).slice(1)
    expect(fns.length).toBe(2)
    for (const f of fns) {
      expect(f).toMatch(/security definer/i)
      expect(f).toMatch(/set search_path = ''/)
    }
    for (const sig of ['m_attempts_recent\\(text\\)', 'm_attempts_purge\\(\\)']) {
      expect(m03).toMatch(new RegExp(`revoke all on function public\\.${sig}\\s+from public, anon, authenticated`))
      expect(m03).toMatch(new RegExp(`grant execute on function public\\.${sig}\\s+to service_role`))
    }
  })

  it('the helpers only touch attempts, use qualified names, and count failures over 15 minutes / purge after one day', () => {
    expect(m03).toMatch(/from public\.attempts a/)
    expect(m03).toMatch(/a\.ok = false/)
    expect(m03).toMatch(/interval '15 minutes'/)
    expect(m03).toMatch(/interval '1 day'/)
    expect(m03).not.toMatch(/public\.(companies|seats|devices|enrol_tokens|master_log)\b/)
  })
})
