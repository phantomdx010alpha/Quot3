/**
 * Phase 260 - the `aad` (authenticated, not stored) bound to every sealed value, so a sealed text copied to another row
 * fails to open. Phase 261 seals with the SAME helpers. [A] convention, not in the Phase 257 contract.
 */
export const aadSeatPassword = (companyId: string, seatNo: number): string => `seat-password:${companyId}:${seatNo}`
export const aadSeatCode = (companyId: string, seatNo: number): string => `seat-code:${companyId}:${seatNo}`
export const aadLicense = (companyId: string): string => `company-license:${companyId}`
export const aadServiceRole = (companyId: string): string => `company-service-role:${companyId}`
