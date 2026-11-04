import { hashPassword, verifyPassword, generateOpaqueToken, sha256hex } from '../../src/common/auth/password';

describe('local credential hashing (ADR-006 — scrypt)', () => {
  it('hashes and verifies round-trip', async () => {
    const hash = await hashPassword('NotARealPassword1!');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('NotARealPassword1!');
    await expect(verifyPassword('NotARealPassword1!', hash)).resolves.toBe(true);
  });

  it('rejects wrong passwords', async () => {
    const hash = await hashPassword('NotARealPassword1!');
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('rejects malformed/empty stored hashes without throwing', async () => {
    await expect(verifyPassword('x', null)).resolves.toBe(false);
    await expect(verifyPassword('x', 'garbage')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$1$2$3$4$5')).resolves.toBe(false);
  });

  it('salts every hash uniquely', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('opaque tokens are unguessable and hashable', () => {
    const t1 = generateOpaqueToken('rt');
    const t2 = generateOpaqueToken('rt');
    expect(t1).not.toBe(t2);
    expect(t1).toMatch(/^rt_[0-9a-f]{64}$/);
    expect(sha256hex(t1)).toBe(sha256hex(t1));
    expect(sha256hex(t1)).not.toBe(sha256hex(t2));
  });
});
