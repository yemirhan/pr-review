import { safeStorage } from 'electron';

/**
 * At-rest encryption for integration secrets (API tokens) using Electron's
 * `safeStorage` (macOS Keychain-backed key). Encrypted values are stored as
 * `enc:v1:<base64>`; anything without that prefix is treated as legacy
 * plaintext and returned unchanged, so older config files keep working.
 *
 * safeStorage is only usable after app 'ready'. Every call is wrapped so a
 * failure degrades to plaintext rather than throwing.
 */

const PREFIX = 'enc:v1:';

function available(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

export function encryptSecret(plain: string | null): string | null {
  if (plain == null || plain === '') return plain;
  if (isEncrypted(plain)) return plain;
  if (!available()) return plain;
  try {
    return PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch {
    return plain;
  }
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!isEncrypted(stored)) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'));
  } catch {
    // Keychain key unavailable/changed — the secret is unrecoverable.
    return null;
  }
}

/**
 * Read a secret via `get`, decrypting it. If the stored value is legacy
 * plaintext and encryption is available, re-save it encrypted via `set`
 * (one-time migration). Never throws.
 */
export function readSecret(
  get: () => string | null | undefined,
  set: (v: string | null) => void
): string | null {
  const stored = get() ?? null;
  if (stored && !isEncrypted(stored)) {
    try {
      const enc = encryptSecret(stored);
      if (enc && enc !== stored) set(enc);
    } catch {
      /* keep plaintext */
    }
    return stored;
  }
  return decryptSecret(stored);
}
