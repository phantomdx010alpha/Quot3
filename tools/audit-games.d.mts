// Types for tools/audit-games.mjs (Phase 198), so src tests can import it under `strict`.
export interface AuditFinding { rule: string; file: string; line: number; text: string }
export interface AuditResult { ok: boolean; failures: AuditFinding[]; warnings: AuditFinding[]; files: number }
export const MAX_FILE_BYTES: number
export function auditGameFolder(dir: string, opts?: { entry?: string }): AuditResult
export function auditGamesRoot(root: string): Record<string, AuditResult>
