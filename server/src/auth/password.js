// Password hashing using Node's built-in scrypt (zero external deps).
// Production would use the same interface backed by bcrypt/argon2 per the
// security stack; callers only use hashPassword/verifyPassword.

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plain, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(plain, stored) {
  try {
    const [scheme, salt, hash] = stored.split(':');
    if (scheme !== 'scrypt') return false;
    const derived = scryptSync(plain, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
