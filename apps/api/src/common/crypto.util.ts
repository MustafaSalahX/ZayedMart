import crypto from 'node:crypto';
import type { Request } from 'express';

export function deterministicSaltHex(seedKey: string): string {
  return crypto.createHash('sha256').update(`zayed-salt:${seedKey}`).digest('hex').slice(0, 32);
}

export function deterministicUuidFromSeed(seedStr: string): string {
  const hash = crypto.createHash('sha256').update(String(seedStr)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function hashPin(pin: string, existingSaltHex?: string): { saltHex: string; hashHex: string } {
  const saltHex = existingSaltHex || crypto.randomBytes(16).toString('hex');
  const derivedHex = crypto
    .scryptSync(String(pin).trim(), Buffer.from(saltHex, 'hex'), 64)
    .toString('hex');
  return { saltHex, hashHex: derivedHex };
}

export function verifyPinHash(pin: string, saltHex: string, expectedHashHex: string): boolean {
  if (!pin || !saltHex || !expectedHashHex) return false;
  try {
    const actualHex = crypto
      .scryptSync(String(pin).trim(), Buffer.from(saltHex, 'hex'), 64)
      .toString('hex');
    const a = Buffer.from(actualHex, 'hex');
    const b = Buffer.from(expectedHashHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function encryptPasswordForAdmin(plainPassword: string, secretHex: string): string {
  if (!plainPassword || !secretHex) return '';
  try {
    const key = crypto
      .createHash('sha256')
      .update(Buffer.from(secretHex, 'hex'))
      .digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(String(plainPassword).trim(), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch {
    return '';
  }
}

export function decryptPasswordForAdmin(cipherText: string, secretHex: string): string {
  if (!cipherText || !secretHex || !cipherText.includes(':')) return '';
  try {
    const [ivHex, tagHex, encHex] = cipherText.split(':');
    const key = crypto
      .createHash('sha256')
      .update(Buffer.from(secretHex, 'hex'))
      .digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

export function signSessionToken(sessionId: string, secretHex: string): string {
  const sig = crypto
    .createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(sessionId)
    .digest('hex');
  return `${sessionId}.${sig}`;
}

export function verifySignedTokenFormat(rawToken: string, secretHex: string): string | null {
  if (!rawToken || typeof rawToken !== 'string' || !rawToken.includes('.')) return null;
  const [sessionId, sigHex] = rawToken.split('.');
  if (!sessionId || !sigHex || !secretHex) return null;
  try {
    const expectedHex = crypto
      .createHmac('sha256', Buffer.from(secretHex, 'hex'))
      .update(sessionId)
      .digest('hex');
    const a = Buffer.from(sigHex, 'hex');
    const b = Buffer.from(expectedHex, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return sessionId;
  } catch {
    return null;
  }
}

export function validateImageMagicBytes(buffer: Buffer, ext: string): boolean {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer.length > 8 * 1024 * 1024) return false;
  if (ext === 'jpg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (ext === 'png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (ext === 'webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    return riff === 'RIFF' && webp === 'WEBP';
  }
  return false;
}

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    return String(xff).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'local';
}

export function extractBearerOrQueryToken(req: Request): string {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (typeof req.query?.token === 'string') {
    return req.query.token.trim();
  }
  return '';
}

export function createLoginRateLimiter({
  maxAttempts = 5,
  windowMs = 180000,
  blockMs = 60000,
}: {
  maxAttempts?: number;
  windowMs?: number;
  blockMs?: number;
} = {}) {
  const attempts = new Map<string, { count: number; firstAt: number; blockedUntil: number }>();

  const getKey = (ip: string, targetId = 'any') => `${ip || 'unknown'}:${targetId}`;

  return {
    checkBlocked(ip: string, targetId = 'any') {
      const key = getKey(ip, targetId);
      const entry = attempts.get(key);
      if (!entry) return { blocked: false, retryAfterSec: 0 };
      const now = Date.now();
      if (entry.blockedUntil && entry.blockedUntil > now) {
        return {
          blocked: true,
          retryAfterSec: Math.ceil((entry.blockedUntil - now) / 1000),
        };
      }
      if (now - entry.firstAt > windowMs) {
        attempts.delete(key);
      }
      return { blocked: false, retryAfterSec: 0 };
    },
    recordFailure(ip: string, targetId = 'any') {
      const key = getKey(ip, targetId);
      const now = Date.now();
      const entry = attempts.get(key);
      if (!entry || now - entry.firstAt > windowMs) {
        attempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
        return { lockedNow: false, remaining: maxAttempts - 1 };
      }
      entry.count += 1;
      if (entry.count >= maxAttempts) {
        entry.blockedUntil = now + blockMs;
        return { lockedNow: true, remaining: 0 };
      }
      return { lockedNow: false, remaining: maxAttempts - entry.count };
    },
    reset(ip: string, targetId = 'any') {
      attempts.delete(getKey(ip, targetId));
    },
  };
}
