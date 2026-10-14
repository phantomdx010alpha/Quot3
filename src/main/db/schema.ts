import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle schema = docs/DATA_MODEL.md (frozen contract). Defined for ALL tables up front so the schema is
 * stable early. Money/qty/rate/percent columns are TEXT canonical decimal strings, never REAL.
 * Timestamps are ISO-8601 UTC text. Never edit a shipped migration — change this file, then generate a new one.
 */

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const branches = sqliteTable(
  'branches',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    poPrefix: text('po_prefix').notNull(),
    isLocal: integer('is_local').notNull().default(0),
    createdAt: text('created_at').notNull()
  },
  (t) => [uniqueIndex('branches_po_prefix_uq').on(t.poPrefix)]
)

export const poCounters = sqliteTable('po_counters', {
  branchId: text('branch_id')
    .primaryKey()
    .references(() => branches.id),
  nextSeq: integer('next_seq').notNull().default(1)
})

export const parties = sqliteTable(
  'parties',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    nameNorm: text('name_norm').notNull(),
    phone: text('phone'),
    address: text('address'),
    transport: text('transport'),
    source: text('source').notNull().default('manual'), // manual | import | auto
    importId: text('import_id'), // Phase 47: the party_imports row that created this party
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
    /** Phase 133: id of the customer this one was merged into (soft-deleted losers keep the pointer). */
    mergedInto: text('merged_into')
  },
  (t) => [index('parties_name_norm_idx').on(t.nameNorm), index('parties_phone_idx').on(t.phone), index('parties_import_idx').on(t.importId)]
)

/** Phase 47: one row per Excel party import; `before_json` holds the pre-import values of every updated party (for undo). */
export const partyImports = sqliteTable('party_imports', {
  id: text('id').primaryKey(),
  at: text('at').notNull(),
  fileName: text('file_name').notNull(),
  created: integer('created').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  invalid: integer('invalid').notNull().default(0),
  beforeJson: text('before_json').notNull().default('[]'),
  undoneAt: text('undone_at')
})

export const bills = sqliteTable(
  'bills',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    poSeq: integer('po_seq').notNull(),
    poNumber: text('po_number').notNull(),
    partyId: text('party_id').references(() => parties.id),
    partySnapshotJson: text('party_snapshot_json').notNull(),
    formatId: text('format_id').notNull(),
    extraColsJson: text('extra_cols_json').notNull().default('[]'),
    paperOverride: text('paper_override'), // A4 | A5 | NULL
    billDate: text('bill_date').notNull(), // ISO date
    totalsJson: text('totals_json').notNull().default('{}'),
    itemRowCount: integer('item_row_count').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
    syncState: text('sync_state').notNull().default('local_only'), // local_only | pending | synced | conflict
    /** Phase 76: 1 = the grand total is rounded to the nearest rupee (kept internally, never shown as a line). Old bills stay 0. */
    roundOff: integer('round_off').notNull().default(0),
    /** Phase 79: free extra cells on the footer rows `{itemsTotal|adjustmentsTotal|grandTotal: {colKey: ExtraCell}}`. */
    footerExtrasJson: text('footer_extras_json').notNull().default('{}'),
    /** Phase 79: extra-only rows below the Final total `[{extras}]`, trimmed to the last non-empty row on save. */
    tailRowsJson: text('tail_rows_json').notNull().default('[]'),
    /** Phase 150: the Hybrid second table `{v,primary,active,rows,twins}` ('' = none). */
    secondTableJson: text('second_table_json').notNull().default(''),
    /** Phase 85: the old app's bill number text (`BR1_106`) for an imported bill; NULL for every other bill. */
    legacyRef: text('legacy_ref'),
    /** Phase 85: the `import_batches` row that created this bill. */
    importBatchId: text('import_batch_id'),
    /** Phase 85: SHA-256 fingerprint of the legacy file (unique when not null); the bill id is derived from it. */
    importFingerprint: text('import_fingerprint')
  },
  (t) => [
    index('bills_bill_date_idx').on(t.billDate),
    uniqueIndex('bills_import_fingerprint_uq').on(t.importFingerprint).where(sql`${t.importFingerprint} IS NOT NULL`),
    index('bills_import_batch_idx').on(t.importBatchId),
    index('bills_party_id_idx').on(t.partyId),
    uniqueIndex('bills_branch_po_seq_uq').on(t.branchId, t.poSeq),
    index('bills_deleted_at_idx').on(t.deletedAt)
  ]
)

/** Phase 85: one row per legacy-bill import (LEGACY_IMPORT_SPEC section 7); `party_ids_json` = the parties the batch created (for undo). */
export const importBatches = sqliteTable('import_batches', {
  id: text('id').primaryKey(),
  at: text('at').notNull(),
  sourceLabel: text('source_label').notNull(), // the folder's NAME only, never the full path
  branchId: text('branch_id').notNull(),
  poPrefix: text('po_prefix').notNull(),
  filesFound: integer('files_found').notNull().default(0),
  created: integer('created').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  errors: integer('errors').notNull().default(0),
  newParties: integer('new_parties').notNull().default(0),
  poFirst: integer('po_first'),
  poLast: integer('po_last'),
  nextSeqAfter: integer('next_seq_after').notNull(),
  partyIdsJson: text('party_ids_json').notNull().default('[]'),
  reportFile: text('report_file'),
  undoneAt: text('undone_at'),
  undoJson: text('undo_json')
})

export const billRows = sqliteTable(
  'bill_rows',
  {
    id: text('id').primaryKey(),
    billId: text('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    nameRunsJson: text('name_runs_json').notNull().default('[]'),
    namePlain: text('name_plain').notNull().default(''),
    qty: text('qty'),
    rate: text('rate'),
    totalOverride: text('total_override'),
    gstRate: text('gst_rate'),
    extrasJson: text('extras_json').notNull().default('{}'),
    cellStyleJson: text('cell_style_json')
  },
  (t) => [uniqueIndex('bill_rows_bill_idx_uq').on(t.billId, t.idx)]
)

export const billRevisions = sqliteTable(
  'bill_revisions',
  {
    id: text('id').primaryKey(),
    billId: text('bill_id')
      .notNull()
      .references(() => bills.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    savedAt: text('saved_at').notNull(),
    savedByBranch: text('saved_by_branch').notNull()
  },
  (t) => [uniqueIndex('bill_revisions_bill_rev_uq').on(t.billId, t.revision)]
)

export const drafts = sqliteTable('drafts', {
  id: text('id').primaryKey(),
  billId: text('bill_id'),
  payloadJson: text('payload_json').notNull(),
  updatedAt: text('updated_at').notNull()
})

/** Phase 109: the owner's item merges / splits / ignores / family choices (ITEM_SORTER_SPEC section 3). Soft delete; id is deterministic. */
export const itemRules = sqliteTable(
  'item_rules',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(), // merge | split | ignore | family
    keyA: text('key_a').notNull(),
    keyB: text('key_b').notNull().default(''),
    canonical: text('canonical'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
    branchId: text('branch_id').notNull()
  },
  (t) => [index('item_rules_kind_idx').on(t.kind, t.deletedAt)]
)

/** Phase 109: undo steps for rule decisions (local only, never synced); `before_json` null = the rule did not exist. */
export const itemRuleLog = sqliteTable(
  'item_rule_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: text('at').notNull(),
    ruleId: text('rule_id').notNull(),
    op: text('op').notNull(), // create | update | revive | delete
    beforeJson: text('before_json'),
    afterJson: text('after_json').notNull(),
    undoneAt: text('undone_at')
  },
  (t) => [index('item_rule_log_open_idx').on(t.undoneAt, t.id)]
)

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull(),
  branchId: text('branch_id'),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  action: text('action').notNull(),
  detailJson: text('detail_json')
})

/** SYNC_POSTBOX_SPEC §5. */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    billId: text('bill_id').notNull(),
    op: text('op').notNull(), // upsert | delete
    revision: integer('revision').notNull(),
    payloadHash: text('payload_hash'),
    createdAt: text('created_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    state: text('state').notNull().default('pending') // pending | synced | failed
  },
  (t) => [index('sync_outbox_state_idx').on(t.state, t.id)]
)

/** Phase 133 (SYNC_SHARED_STORE_SPEC section 8): the last server version this computer saw for each synced record. */
export const syncRecordState = sqliteTable(
  'sync_record_state',
  {
    kind: text('kind').notNull(),
    recId: text('rec_id').notNull(),
    baseVersion: integer('base_version').notNull(),
    baseHash: text('base_hash').notNull(),
    serverSeq: integer('server_seq').notNull().default(0),
    syncedAt: text('synced_at')
  },
  (t) => [primaryKey({ columns: [t.kind, t.recId] })]
)

/** Phase 133: records set aside because this app is older than their `min_reader_ver`. Never applied, never overwritten. */
export const syncAside = sqliteTable(
  'sync_aside',
  {
    kind: text('kind').notNull(),
    recId: text('rec_id').notNull(),
    version: integer('version').notNull(),
    minReaderVer: integer('min_reader_ver').notNull(),
    payloadJson: text('payload_json').notNull(),
    seenAt: text('seen_at').notNull()
  },
  (t) => [primaryKey({ columns: [t.kind, t.recId] })]
)

export const backups = sqliteTable('backups', {
  file: text('file').primaryKey(),
  createdAt: text('created_at').notNull(),
  kind: text('kind').notNull(), // auto | manual | pre-restore
  sizeBytes: integer('size_bytes').notNull().default(0),
  billCount: integer('bill_count').notNull().default(0)
})

/** Phase 137: local log of customer merges (undo information + the sync record of each merge). Never read by other branches. */
export const partyMergeLog = sqliteTable(
  'party_merge_log',
  {
    id: text('id').primaryKey(),
    survivorId: text('survivor_id').notNull(),
    mergedId: text('merged_id').notNull(),
    kind: text('kind').notNull(),
    batchId: text('batch_id').notNull(),
    byBranch: text('by_branch').notNull(),
    at: text('at').notNull(),
    survivorBeforeJson: text('survivor_before_json').notNull(),
    billIdsJson: text('bill_ids_json').notNull(),
    undoneAt: text('undone_at')
  },
  (t) => [index('party_merge_log_at_idx').on(t.at)]
)

/** Phase 137: pairs the owner marked "Not the same" (local only, ordered a < b). */
export const partyNotSame = sqliteTable(
  'party_not_same',
  { aId: text('a_id').notNull(), bId: text('b_id').notNull(), at: text('at').notNull() },
  (t) => [primaryKey({ columns: [t.aId, t.bId] })]
)
