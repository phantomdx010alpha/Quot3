import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capHistory, HISTORY_CAP, PUSH_CASES, referencePush } from './pushTruthTable.cases'

/** Phase 130: the conflict table of SYNC_SHARED_STORE_SPEC section 6, executable. Phase 132's in-memory server must pass PUSH_CASES too. */
describe('push conflict truth table (Phase 130)', () => {
  for (const c of PUSH_CASES) {
    it(c.name, () => {
      const r = referencePush(c.stored, c.incoming, c.branch)
      expect(r).toEqual({ outcome: c.outcome, versionAfter: c.versionAfter, seqBumps: c.seqBumps, storedAfter: c.storedAfter, history: c.history })
    })
  }

  it('covers every outcome and every history reason', () => {
    expect(new Set(PUSH_CASES.map((c) => c.outcome))).toEqual(new Set(['accepted', 'noop', 'won', 'lost']))
    expect(new Set(PUSH_CASES.map((c) => c.history?.reason).filter(Boolean))).toEqual(new Set(['superseded', 'conflict_loser']))
  })

  it('a noop never bumps the version or the sequence; every other outcome bumps both', () => {
    for (const c of PUSH_CASES) expect(c.seqBumps).toBe(c.outcome !== 'noop')
  })

  it('history is capped at 20 per record', () => {
    expect(HISTORY_CAP).toBe(20)
    expect(capHistory(3)).toBe(3)
    expect(capHistory(25)).toBe(20)
  })

  it('the SQL sn_push implements the same branches in the same order (read, not run)', () => {
    const sql = readFileSync(join(resolve(__dirname, '..', '..', '..', '..'), 'supabase', 'sql', '15_rpcs.sql'), 'utf8').replace(/--[^\n]*/g, '')
    const body = sql.split('create or replace function public.sn_push')[1]!.split('create or replace function public.sn_pull')[0]!
    const order = ["v_outcome := 'accepted'", "v_outcome := 'noop'", "v_outcome := 'accepted'", "v_outcome := 'won'", "v_outcome := 'lost'"]
    // every outcome string appears, and the checks come in the table's order: new row, same hash, base = version, then the conflict
    expect(body.indexOf('if not found')).toBeLessThan(body.indexOf('v_row.payload_hash = v_hash'))
    expect(body.indexOf('v_row.payload_hash = v_hash')).toBeLessThan(body.indexOf('v_base = v_row.version'))
    expect(body.indexOf('v_base = v_row.version')).toBeLessThan(body.indexOf('v_wins :='))
    for (const o of order) expect(body).toContain(o)
    expect(body).toMatch(/v_edited > v_row\.edited_at\s+or \(v_edited = v_row\.edited_at and p_branch_id > coalesce\(v_row\.from_branch, '00000000-0000-0000-0000-000000000000'::uuid\)\)/)
  })
})
