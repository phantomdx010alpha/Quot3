/**
 * Phase 263 - the shapes the desktop master service shows the renderer (API_CONTRACTS.md M24-I). Pure types: no Electron / Node / DOM.
 * NEVER a password, device token, enrol token, service_role key or `*_enc` value in any of them.
 */
import type { MasterErrorCode } from './errors'

export interface MasterStatus {
  /** The build holds a master URL + anon key (`isMasterConfigured`). False = no master call is ever made (T21). */
  configured: boolean
  linked: boolean
  companyLabel: string | null
  seatNo: number | null
  seatLabel: string | null
  isAdmin: boolean
  profileVersion: number | null
  /** Plain words of the last master problem, '' when the last call worked. */
  lastError: string
}

export type MasterFailure = { ok: false; code: MasterErrorCode; message: string }

/** `master:adopt` answer: the status after a SILENT attempt (adopt never throws, T22). */
export interface MasterAdoptOutcome { status: MasterStatus; adopted: boolean; error: MasterFailure | null }

/** `master:refresh` answer (no password crosses to the renderer): `legacy` = the master does not know the password. */
export type MasterRefreshOutcome = { ok: true; legacy: boolean; applied: boolean } | MasterFailure

/** `master:heartbeat` answer. `profileApplied` = a newer company profile was downloaded and handed to the profile port. */
export type MasterHeartbeatOutcome =
  | { ok: true; profileChanged: boolean; profileApplied: boolean; seatStatus: 'active' | 'revoked'; companyStatus: string }
  | MasterFailure
