import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

/**
 * Derives a 32-byte key from PANEL_ENCRYPTION_KEY. The raw key never leaves
 * the process and never appears in responses or logs.
 */
function key(): Buffer {
  const raw = process.env.PANEL_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error('PANEL_ENCRYPTION_KEY is not configured. Set a random 32+ character secret before connecting a panel.');
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function isEncryptionConfigured(): boolean {
  const raw = process.env.PANEL_ENCRYPTION_KEY;
  return Boolean(raw && raw.length >= 32);
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decryptSecret(blob: string): string {
  const [version, ivPart, tagPart, bodyPart] = blob.split('.');
  if (version !== VERSION || !ivPart || !tagPart || !bodyPart) throw new Error('Stored credential is not readable.');
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(bodyPart, 'base64url')), decipher.final()]).toString('utf8');
}

/** Safe, stable masked form for UI display. Never returns actual characters of the secret. */
export function maskSecret(plaintext: string): string {
  return plaintext ? '••••••••' + plaintext.slice(-4) : '';
}
