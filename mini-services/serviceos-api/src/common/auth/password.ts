import { randomBytes, createHash, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

/**
 * Local credential hashing using Node's built-in scrypt (OWASP ASVS-aligned:
 * memory-hard, no native build dependency). Format:
 *   scrypt$N$r$p$<salt b64>$<hash b64>
 * The identity adapter boundary allows swapping to an external OIDC provider
 * later without touching domain logic (ADR-006).
 */
const N = 16384;
const r = 8;
const p = 1;
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length === 0) return false;
  try {
    const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
      maxmem: 64 * 1024 * 1024,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    // Malformed stored parameters never crash verification.
    return false;
  }
}

/** Opaque refresh / invitation tokens (random, stored hashed — never JWTs). */
export function generateOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('hex')}`;
}

export function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
