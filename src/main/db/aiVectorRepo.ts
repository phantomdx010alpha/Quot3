import Database from 'better-sqlite3'

/**
 * Phase 224 (M22) - the only SQL behind the vector cache `ai_text_vectors` (MILESTONE22_DESIGN 6).
 * A pure cache keyed by (model id, hash of the normalised text). Not synced, not in new backups, droppable any time.
 * Vectors are stored as the raw bytes of a Float32Array.
 */
export interface AiVectorRow { hash: string; vector: Float32Array }
export interface AiVectorInput { hash: string; vector: Float32Array }

export interface AiVectorRepo {
  /** The vectors this model has for these hashes (missing hashes are simply absent). */
  getMany(modelId: string, hashes: readonly string[]): AiVectorRow[]
  /** Which of these hashes already have a vector for this model. */
  have(modelId: string, hashes: readonly string[]): Set<string>
  upsertMany(modelId: string, rows: readonly AiVectorInput[], at: string): number
  count(modelId?: string): number
  deleteAll(): number
  deleteByModel(modelId: string): number
  /** Delete every row whose model id is NOT this one (model id or revision changed). */
  deleteOtherModels(keepModelId: string): number
}

const toBuf = (v: Float32Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength)
function fromBuf(b: Buffer, dim: number): Float32Array | null {
  if (b.byteLength !== dim * 4) return null
  const copy = new Uint8Array(b.byteLength)
  copy.set(b)
  return new Float32Array(copy.buffer)
}
const CHUNK = 400

export function createAiVectorRepo(sqlite: Database.Database): AiVectorRepo {
  const up = sqlite.prepare(
    'INSERT INTO ai_text_vectors (model_id, text_hash, dim, vector, created_at) VALUES (@modelId, @hash, @dim, @vector, @at) ' +
      'ON CONFLICT(model_id, text_hash) DO UPDATE SET dim = excluded.dim, vector = excluded.vector, created_at = excluded.created_at'
  )
  const cnt = sqlite.prepare('SELECT COUNT(*) AS n FROM ai_text_vectors')
  const cntModel = sqlite.prepare('SELECT COUNT(*) AS n FROM ai_text_vectors WHERE model_id = ?')
  const delAll = sqlite.prepare('DELETE FROM ai_text_vectors')
  const delModel = sqlite.prepare('DELETE FROM ai_text_vectors WHERE model_id = ?')
  const delOther = sqlite.prepare('DELETE FROM ai_text_vectors WHERE model_id <> ?')

  const chunks = <T,>(xs: readonly T[]): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
    return out
  }
  const selectIn = (modelId: string, hashes: readonly string[]): { hash: string; dim: number; vector: Buffer }[] => {
    const out: { hash: string; dim: number; vector: Buffer }[] = []
    for (const part of chunks(hashes)) {
      const rows = sqlite
        .prepare(`SELECT text_hash AS hash, dim, vector FROM ai_text_vectors WHERE model_id = ? AND text_hash IN (${part.map(() => '?').join(',')})`)
        .all(modelId, ...part) as { hash: string; dim: number; vector: Buffer }[]
      out.push(...rows)
    }
    return out
  }

  return {
    getMany(modelId, hashes) {
      const out: AiVectorRow[] = []
      for (const r of selectIn(modelId, hashes)) {
        const v = fromBuf(r.vector, r.dim)
        if (v) out.push({ hash: r.hash, vector: v })
      }
      return out
    },
    have(modelId, hashes) {
      return new Set(selectIn(modelId, hashes).map((r) => r.hash))
    },
    upsertMany(modelId, rows, at) {
      let n = 0
      sqlite.transaction(() => {
        for (const r of rows) {
          up.run({ modelId, hash: r.hash, dim: r.vector.length, vector: toBuf(r.vector), at })
          n++
        }
      })()
      return n
    },
    count: (modelId) => (modelId === undefined ? (cnt.get() as { n: number }).n : (cntModel.get(modelId) as { n: number }).n),
    deleteAll: () => delAll.run().changes,
    deleteByModel: (modelId) => delModel.run(modelId).changes,
    deleteOtherModels: (keep) => delOther.run(keep).changes
  }
}

/**
 * Where the indexer finds item names: the names on every live bill row, read-only. A row whose name JSON is malformed is skipped.
 * `billIds` limits it to just those bills (after a save / import).
 */
export interface BillNameSource { listNames(billIds?: readonly string[]): string[] }

export function createBillNameSource(sqlite: Database.Database): BillNameSource {
  const all = sqlite.prepare('SELECT r.name_runs_json AS j FROM bill_rows r JOIN bills b ON b.id = r.bill_id WHERE b.deleted_at IS NULL')
  const some = sqlite.prepare(
    'SELECT r.name_runs_json AS j FROM bill_rows r JOIN bills b ON b.id = r.bill_id WHERE b.deleted_at IS NULL AND b.id IN (SELECT value FROM json_each(?))'
  )
  const toName = (j: string): string | null => {
    try {
      const runs: unknown = JSON.parse(j)
      if (!Array.isArray(runs)) return null
      return runs.map((x) => (typeof x === 'object' && x !== null && typeof (x as { t?: unknown }).t === 'string' ? (x as { t: string }).t : '')).join('')
    } catch { return null }
  }
  return {
    listNames(billIds) {
      const rows = (billIds ? some.all(JSON.stringify(billIds)) : all.all()) as { j: string }[]
      const out: string[] = []
      for (const r of rows) { const n = toName(r.j); if (n) out.push(n) }
      return out
    }
  }
}

/**
 * Backup decision (Phase 224 [A]): a NEW backup file does not carry the cache (it is rebuilt after a restore). Called on the fresh copy,
 * never on the live database. Never throws; an old backup that still carries rows is harmless (the rows are keyed by content).
 */
export function stripAiVectorsFromFile(file: string): boolean {
  let h: Database.Database | null = null
  try {
    h = new Database(file, { fileMustExist: true })
    const t = h.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_text_vectors'").get()
    if (!t) return false
    h.prepare('DELETE FROM ai_text_vectors').run()
    h.exec('VACUUM')
    return true
  } catch { return false } finally { try { h?.close() } catch { /* ignore */ } }
}
