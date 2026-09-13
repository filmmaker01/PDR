import { describe, expect, it } from 'vitest';
import {
  generateLoginCode,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens';

const SECRET = 'unit-test-secret-unit-test-secret';
const NOW = new Date('2026-11-15T12:00:00Z');

describe('access token', () => {
  it('подписывает и проверяет', () => {
    const token = signAccessToken({ sub: 'u1', sid: 's1', kind: 'miniapp' }, SECRET, 900, NOW);
    const payload = verifyAccessToken(token, SECRET, NOW);
    expect(payload.sub).toBe('u1');
    expect(payload.sid).toBe('s1');
    expect(payload.kind).toBe('miniapp');
    expect(payload.exp - payload.iat).toBe(900);
  });

  it('отклоняет чужую подпись', () => {
    const token = signAccessToken({ sub: 'u1', sid: 's1', kind: 'web' }, SECRET, 900, NOW);
    expect(() => verifyAccessToken(token, 'another-secret-another-secret', NOW)).toThrow(
      /bad_signature/,
    );
  });

  it('отклоняет подменённые данные', () => {
    const token = signAccessToken({ sub: 'u1', sid: 's1', kind: 'web' }, SECRET, 900, NOW);
    const [h, , s] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'admin', sid: 's1', kind: 'web', iat: 1, exp: 9e9 }),
    ).toString('base64url');
    expect(() => verifyAccessToken(`${h}.${forged}.${s}`, SECRET, NOW)).toThrow(/bad_signature/);
  });

  it('отклоняет истёкший токен', () => {
    const token = signAccessToken({ sub: 'u1', sid: 's1', kind: 'web' }, SECRET, 60, NOW);
    const later = new Date(NOW.getTime() + 61_000);
    expect(() => verifyAccessToken(token, SECRET, later)).toThrow(/expired/);
  });

  it('отклоняет мусор', () => {
    expect(() => verifyAccessToken('not-a-token', SECRET, NOW)).toThrow(/malformed/);
  });
});

describe('refresh token', () => {
  it('генерирует токен и его хеш', () => {
    const { token, hash } = generateRefreshToken();
    expect(token.length).toBeGreaterThan(30);
    expect(hash).toHaveLength(64);
    expect(hashRefreshToken(token)).toBe(hash);
  });

  it('токены не повторяются', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateRefreshToken().token));
    expect(set.size).toBe(200);
  });
});

describe('login code', () => {
  it('достаточно длинный и уникальный', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateLoginCode()));
    expect(codes.size).toBe(200);
    expect(generateLoginCode().length).toBeGreaterThanOrEqual(12);
  });
});
