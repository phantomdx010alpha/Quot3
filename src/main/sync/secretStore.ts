/** Phase 52: protects the license key and the org passphrase at rest. Electron's `safeStorage` (Windows DPAPI) in the app, a stub in tests. */
export interface SecretStore {
  available(): boolean
  /** Returns base64 text safe to keep in the database. Throws when `available()` is false. */
  encrypt(plain: string): string
  /** Throws when the blob cannot be decrypted (another Windows user, damaged data). */
  decrypt(blob: string): string
}
