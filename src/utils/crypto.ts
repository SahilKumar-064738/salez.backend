import {
  createHmac,
  randomBytes,
  createHash,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'crypto';
import { env } from '../config/env';

// ── WEBHOOK SIGNATURE VERIFICATION ────────────────────────────────────────────

/**
 * Verify Twilio webhook signature.
 * https://www.twilio.com/docs/usage/security#validating-signatures
 */
export function verifyTwilioSignature(
  authToken: string,
  twilioSignature: string,
  url: string,
  params: Record<string, string>
): boolean {
  const sortedKeys = Object.keys(params).sort();
  let strToSign = url;
  for (const key of sortedKeys) strToSign += key + params[key];
  const expectedSig = createHmac('sha1', authToken).update(strToSign).digest('base64');
  try {
    return timingSafeEqual(Buffer.from(expectedSig), Buffer.from(twilioSignature));
  } catch {
    return false;
  }
}

/**
 * Verify Meta (WhatsApp Business API) webhook signature.
 * Header format: X-Hub-Signature-256: sha256=<hex>
 */
export function verifyMetaSignature(
  appSecret: string,
  rawBody: Buffer,
  signatureHeader: string
): boolean {
  if (!signatureHeader.startsWith('sha256=')) return false;
  const receivedSig = signatureHeader.slice(7);
  const expectedSig = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(
      Buffer.from(expectedSig, 'hex'),
      Buffer.from(receivedSig, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Verify generic HMAC-SHA256 webhook (tenant-level webhooks).
 */
export function verifyWebhookHmac(
  secret: string,
  rawBody: Buffer,
  signatureHeader: string
): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signatureHeader, 'hex')
    );
  } catch {
    return false;
  }
}

// ── API KEY GENERATION ─────────────────────────────────────────────────────────

/**
 * Generate a raw API key and its SHA-256 hash.
 * The raw key is shown ONCE to the user on creation.
 * Only the hash is stored in the DB.
 */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `sk_live_${randomBytes(32).toString('hex')}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12); // "sk_live_XXXX"
  return { raw, hash, prefix };
}

/**
 * Hash a raw API key for DB lookup.
 */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ── SYMMETRIC ENCRYPTION (for WhatsApp API tokens) ────────────────────────────
// Uses AES-256-GCM: authenticated encryption, prevents tampering.

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Derive a 32-byte key from the ENCRYPTION_SECRET env var.
 * Using a hash ensures the key is always the right length regardless of secret format.
 */
function getDerivedKey(): Buffer {
  const secret = env.ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('ENCRYPTION_SECRET must be at least 32 characters');
  }
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plaintext string.
 * Output format: base64(iv + ciphertext + authTag)
 */
export function encrypt(plaintext: string): string {
  const key = getDerivedKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // Prepend iv + tag to ciphertext for all-in-one storage
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a string encrypted by `encrypt()`.
 */
export function decrypt(encryptedData: string): string {
  const key = getDerivedKey();
  const buf = Buffer.from(encryptedData, 'base64');

  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(ciphertext) + decipher.final('utf8');
}

// ── SLUGS ─────────────────────────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a business name.
 */
export function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = randomBytes(3).toString('hex'); // 6 chars
  return `${base}-${suffix}`;
}
