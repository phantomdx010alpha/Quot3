import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Phase 170: structural guards over supabase/sql/17_themes.sql (theme sharing, server side). There is no Postgres here, so these
 * read the SQL text only: they cannot prove it runs (that is the owner's checklist step) and they fail if the security shape weakens.
 */
const dir = join(resolve(__dirname, '..', '..'), 'supabase', 'sql')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const sql = (f: string): string => readFileSync(join(dir, f), 'utf8')
const code = (s: string): string => s.replace(/--[^\n]*/g, '')

describe('supabase sql, shared themes (Phase 170)', () => {
  const c17 = code(sql('17_themes.sql'))
  const tables = ['sn_themes', 'sn_theme_history']
  const fns = c17.split(/create or replace function/i).slice(1)
  const bodyOf = (n: string): string => fns.find((b) => b.trim().startsWith(`public.${n}(`))!

  it('is ONE new numbered file after 16, and no older file mentions it or was given theme tables', () => {
    expect(files).toContain('17_themes.sql')
    expect(files.indexOf('17_themes.sql')).toBeGreaterThan(files.indexOf('16_realtime.sql'))
    for (const f of files) {
      if (f === '17_themes.sql') continue
      expect(sql(f), f).not.toMatch(/sn_themes|sn_theme_/)
    }
    // the file does not edit or redefine anything from files 11-16
    expect(c17).not.toMatch(/create or replace function public\.sn_(member_org|push|pull|manifest|activate|touch|now)\(/)
    expect(c17).not.toMatch(/alter table public\.sn_(members|branches|records|history|ping)\b/)
  })

  it('RLS is on for both tables, all privileges are revoked first, and the only grant is SELECT', () => {
    for (const t of tables) {
      expect(c17).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`))
      expect(c17).toMatch(new RegExp(`revoke all on table public\\.${t}\\s+from public, anon, authenticated`))
      expect(c17).toMatch(new RegExp(`grant select on table public\\.${t}\\s+to authenticated`))
    }
    const tableGrants = [...c17.matchAll(/grant\s+([\w, ]+?)\s+on table/gi)].map((m) => m[1]!.trim().toLowerCase())
    expect(tableGrants).toEqual(['select', 'select'])
    expect(c17).not.toMatch(/force row level security/i)
    expect(c17).not.toMatch(/\bto anon\b/i)
  })

  it('exactly one SELECT policy per table, scoped to the own organisation through sn_members; no write policy', () => {
    const policies = [...c17.matchAll(/create policy (\w+) on public\.(\w+)\s+for (\w+) to (\w+)\s+using \(([^;]*)\);/gi)]
    expect(policies.map((p) => p[2]).sort()).toEqual([...tables].sort())
    for (const p of policies) {
      expect(p[3]).toBe('select')
      expect(p[4]).toBe('authenticated')
      expect(p[5]).toMatch(/org_id in \(select m\.org_id from public\.sn_members m where m\.user_id = \(select auth\.uid\(\)\)\)/)
    }
    expect(c17).not.toMatch(/create policy[^;]*\bfor (insert|update|delete|all)\b/i)
  })

  it('sequences are revoked from the app roles', () => {
    for (const s of ['sn_theme_seq', 'sn_theme_history_id_seq'])
      expect(c17).toMatch(new RegExp(`revoke all on sequence public\\.${s}\\s+from public, anon, authenticated`))
  })

  it('the theme id rule matches validateTheme, and the 64 KB cap is on both tables and in the RPC', () => {
    expect(c17).toMatch(/theme_id\s+text\s+not null check \(theme_id ~ '\^\[a-z0-9\]\[a-z0-9-\]\{0,39\}\$'\)/)
    expect([...c17.matchAll(/octet_length\(payload::text\) <= 65536/g)].length).toBe(2)
    expect(bodyOf('sn_theme_push')).toMatch(/octet_length\(v_payload::text\) > 65536/)
    expect(bodyOf('sn_theme_push')).toMatch(/payload_too_large' using errcode = 'Q3R01'/)
    // the shared id rule in the app: keep these two in step
    const idRule = readFileSync(join(resolve(__dirname, '..'), 'shared', 'theme', 'validateTheme.ts'), 'utf8')
    expect(idRule).toContain('/^[a-z0-9][a-z0-9-]{0,39}$/')
  })

  it('defines exactly one helper and the two app functions; every one pins an empty search_path and is security definer', () => {
    expect(fns.length).toBe(3)
    for (const n of ['sn_theme_history_add', 'sn_theme_push', 'sn_theme_pull']) {
      expect(bodyOf(n), n).toBeTruthy()
      expect(bodyOf(n), n).toMatch(/security definer/)
      expect(bodyOf(n), n).toMatch(/set search_path = ''/)
    }
    expect(c17).not.toMatch(/create or replace function public\.qt_/)
  })

  it('privileges: the helper is never granted; only the push and pull functions are granted, to authenticated', () => {
    expect(c17).toMatch(/revoke all on function public\.sn_theme_history_add\(uuid, text, int, jsonb, uuid, timestamptz, text\)\s+from public, anon, authenticated/)
    expect(c17).toMatch(/revoke all on function public\.sn_theme_push\(text, uuid, jsonb\)\s+from public, anon, authenticated/)
    expect(c17).toMatch(/revoke all on function public\.sn_theme_pull\(text, uuid, bigint, int\)\s+from public, anon, authenticated/)
    const grants = [...c17.matchAll(/grant execute on function public\.(\w+)\(([^)]*)\)\s+to (\w+)/g)]
    expect(grants.map((g) => `${g[1]}(${g[2]})`).sort()).toEqual(['sn_theme_pull(text, uuid, bigint, int)', 'sn_theme_push(text, uuid, jsonb)'])
    for (const g of grants) expect(g[3]).toBe('authenticated')
  })

  it('the signatures are the contract: push (license, branch, items) and pull (license, branch, after_seq, limit)', () => {
    expect(c17).toMatch(/function public\.sn_theme_push\(p_license text, p_branch_id uuid, p_items jsonb\)\s+returns jsonb/)
    expect(c17).toMatch(/function public\.sn_theme_pull\(p_license text, p_branch_id uuid, p_after_seq bigint default 0, p_limit int default 50\)\s+returns jsonb/)
  })

  it('both app functions authenticate first through sn_member_org (membership, hashed key, active, own branch)', () => {
    for (const n of ['sn_theme_push', 'sn_theme_pull']) {
      const b = bodyOf(n)
      expect(b, n).toMatch(/public\.sn_member_org\(p_license, p_branch_id\)/)
      // nothing touches a table before the membership check
      const firstTable = b.search(/(from|into|update)\s+public\.sn_/i)
      expect(b.indexOf('public.sn_member_org(')).toBeLessThan(firstTable)
    }
  })

  it('push limits: 1-20 items, 2 MB per call, 64 KB per theme; bad shape is invalid_input', () => {
    const b = bodyOf('sn_theme_push')
    expect(b).toMatch(/v_n > 20/)
    expect(b).toMatch(/too_many' using errcode = 'Q3I03'/)
    expect(b).toMatch(/octet_length\(p_items::text\) > 2097152/)
    expect(b).toMatch(/v_n = 0/)
    expect(b).toMatch(/jsonb_typeof\(p_items\) <> 'array'/)
    expect(b).toMatch(/jsonb_typeof\(v_payload\) <> 'object'/)
    expect(b).toMatch(/v_theme !~ '\^\[a-z0-9\]\[a-z0-9-\]\{0,39\}\$'/)
    expect(b).toMatch(/char_length\(v_hash\) not between 8 and 128/)
    expect(b).toMatch(/v_edited is null/)
  })

  it('push rule: newer edited_at wins, ties go to the larger branch id, the older version is ALWAYS kept in history, nothing is deleted', () => {
    const b = bodyOf('sn_theme_push')
    expect(b).toMatch(/v_edited > v_row\.edited_at/)
    expect(b).toMatch(/v_edited = v_row\.edited_at and p_branch_id > coalesce\(v_row\.from_branch/)
    expect(b).toMatch(/payload_hash = v_hash then\s+v_outcome := 'noop'/)
    expect([...b.matchAll(/v_outcome := '(\w+)'/g)].map((m) => m[1]).sort()).toEqual(['accepted', 'lost', 'noop', 'won'])
    // the winner replaces: the previous version goes to history first
    expect(b).toMatch(/sn_theme_history_add\(v_org, v_theme, v_row\.version, v_row\.payload, v_row\.from_branch, v_row\.edited_at, 'superseded'\)/)
    // the loser is kept too
    expect(b).toMatch(/sn_theme_history_add\(v_org, v_theme, v_row\.version, v_payload, p_branch_id, v_edited, 'conflict_loser'\)/)
    // one writer at a time per organisation
    expect(b).toMatch(/pg_advisory_xact_lock\(pg_catalog\.hashtextextended\('snt:'/)
    // no delete of themes anywhere in the file; history trimming is the only delete and it keeps the newest 20
    expect(c17).not.toMatch(/delete from public\.sn_themes\b/i)
    expect(c17).not.toMatch(/\btruncate\b|\bdrop table\b/i)
    expect([...c17.matchAll(/delete from public\.(\w+)/g)].map((m) => m[1])).toEqual(['sn_theme_history'])
    expect(bodyOf('sn_theme_history_add')).toMatch(/offset 20/)
  })

  it('a changed theme rings the existing doorbell; a noop does not', () => {
    const b = bodyOf('sn_theme_push')
    expect(b).toMatch(/if v_changed then\s+insert into public\.sn_ping/)
    const noop = b.split("v_outcome := 'noop';")[1]!.split(/else/)[0]!
    expect(noop).not.toMatch(/v_changed := true/)
  })

  it('pull: ordered by server_seq, at most 50 rows and about 2 MB (at least one row), deletes nothing', () => {
    const b = bodyOf('sn_theme_pull')
    expect(b).toMatch(/p_limit not between 1 and 50/)
    expect(b).toMatch(/order by x\.server_seq/)
    expect(b).toMatch(/v_bytes \+ v_size > 2097152/)
    expect(b).toMatch(/v_n > 0 and/)
    expect(b).not.toMatch(/\bdelete\b/i)
    expect(b).toMatch(/min_reader_ver/)
    expect(b).toMatch(/'items', v_items, 'has_more', v_more, 'server_time'/)
  })

  it('no service_role key and no secret; no plpgsql dynamic SQL (execute) anywhere in the file', () => {
    expect(c17).not.toMatch(/service_role/i)
    expect(c17).not.toMatch(/\bexecute\s+(format|'|\$)/i)
    expect(c17).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
  })

  it('the file is safe to re-run and well formed', () => {
    expect(c17).not.toMatch(/create table (?!if not exists)/i)
    expect(c17).not.toMatch(/create index (?!if not exists)/i)
    expect(c17).not.toMatch(/create sequence (?!if not exists)/i)
    expect((c17.match(/create policy/gi) ?? []).length).toBe((c17.match(/drop policy if exists/gi) ?? []).length)
    expect((c17.match(/\$\$/g) ?? []).length % 2).toBe(0)
    const stripped = c17.replace(/'(?:[^']|'')*'/g, "''")
    expect((stripped.match(/\(/g) ?? []).length).toBe((stripped.match(/\)/g) ?? []).length)
    expect(c17.trimEnd().endsWith(';')).toBe(true)
  })

  it('nothing in the theme tables is a table of bills: no bill / customer columns', () => {
    const tbl = c17.split(/create table if not exists/i).slice(1).join('\n')
    expect(tbl).not.toMatch(/\b(party|amount|total|phone|address|customer|bill)\b/i)
  })
})
