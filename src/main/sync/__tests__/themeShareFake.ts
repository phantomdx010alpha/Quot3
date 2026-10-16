import type { SharedStoreTransport, ThemePullResult, ThemePushItem, ThemePushResult, ThemeShareCalls } from '../sharedTransport'

/** Test double of supabase/sql/17_themes.sql (same push rule: newer edited_at wins, ties to the larger branch id, the older version always kept). */
interface Row { themeId: string; version: number; serverSeq: number; payload: Record<string, unknown>; payloadHash: string; schemaVer: number; minReaderVer: number; appVer: string; editedAt: string; fromBranch: string }

export class FakeThemeServer {
  rows = new Map<string, Row>()
  history: { themeId: string; version: number; reason: 'superseded' | 'conflict_loser' }[] = []
  pushes = 0
  pulls = 0
  private seq = 0
  branches = [{ branchId: 'branch-a', name: 'Shop A', poPrefix: 'A' }, { branchId: 'branch-b', name: 'Shop B', poPrefix: 'B' }]

  push(branchId: string, items: ThemePushItem[]): ThemePushResult[] {
    this.pushes++
    return items.map((i) => {
      const cur = this.rows.get(i.themeId)
      const mk = (version: number): Row => ({ themeId: i.themeId, version, serverSeq: ++this.seq, payload: i.payload, payloadHash: i.payloadHash, schemaVer: i.schemaVer, minReaderVer: i.minReaderVer, appVer: i.appVer, editedAt: i.editedAt, fromBranch: branchId })
      if (!cur) { const r = mk(1); this.rows.set(i.themeId, r); return { themeId: i.themeId, outcome: 'accepted', version: 1, serverSeq: r.serverSeq } }
      if (cur.payloadHash === i.payloadHash) return { themeId: i.themeId, outcome: 'noop', version: cur.version, serverSeq: cur.serverSeq }
      const wins = Date.parse(i.editedAt) > Date.parse(cur.editedAt) || (i.editedAt === cur.editedAt && branchId > cur.fromBranch)
      if (!wins) { this.history.push({ themeId: i.themeId, version: cur.version + 1, reason: 'conflict_loser' }); return { themeId: i.themeId, outcome: 'lost', version: cur.version, serverSeq: cur.serverSeq } }
      this.history.push({ themeId: i.themeId, version: cur.version, reason: 'superseded' })
      const r = mk(cur.version + 1)
      this.rows.set(i.themeId, r)
      return { themeId: i.themeId, outcome: 'won', version: r.version, serverSeq: r.serverSeq }
    })
  }

  pull(afterSeq: number, limit: number): ThemePullResult {
    this.pulls++
    const all = [...this.rows.values()].filter((r) => r.serverSeq > afterSeq).sort((a, b) => a.serverSeq - b.serverSeq)
    return { items: all.slice(0, limit).map((r) => ({ ...r })), hasMore: all.length > limit, serverTime: new Date().toISOString() }
  }

  /** Puts a row straight in (a theme another build / a hostile client sent). */
  inject(themeId: string, payload: Record<string, unknown>, o: Partial<Row> & { payloadHash: string }): void {
    this.rows.set(themeId, { themeId, version: 1, serverSeq: ++this.seq, payload, schemaVer: 1, minReaderVer: 1, appVer: '0.1.13', editedAt: new Date().toISOString(), fromBranch: 'branch-b', ...o })
  }

  transportFor(branchId: string): SharedStoreTransport & ThemeShareCalls {
    const t = {
      now: async () => ({ serverTime: new Date().toISOString() }),
      listBranches: async () => this.branches.map((b) => ({ ...b, deviceName: '', lastSeenAt: null })),
      themePush: async (a: { items: ThemePushItem[] }) => this.push(branchId, a.items),
      themePull: async (a: { afterSeq: number; limit?: number }) => this.pull(a.afterSeq, a.limit ?? 50)
    }
    return t as unknown as SharedStoreTransport & ThemeShareCalls
  }
}
