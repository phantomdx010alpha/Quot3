import { safeStorage } from 'electron'
import type { SecretStore } from './secretStore'

/** Electron-only (not unit-tested): DPAPI-bound encryption of small secrets. */
export function createElectronSecretStore(): SecretStore {
  return {
    available: () => { try { return safeStorage.isEncryptionAvailable() } catch { return false } },
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (blob) => safeStorage.decryptString(Buffer.from(blob, 'base64'))
  }
}
