import type { PriceLogEntry } from './logEntry'
/** A stored activity-log entry: the pure entry plus its local row id (used for paging). */
export interface PriceLogRow extends PriceLogEntry { id: number; /** Shared log only (Phase 243). */ branchName?: string }
