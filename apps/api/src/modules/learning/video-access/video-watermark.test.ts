import { describe, expect, it } from 'vitest';
import { buildWatermark, watermarkCode } from './video-watermark';

describe('водяной знак', () => {
  const secret = 'test-secret-test-secret-test-secret';
  const alice = '11111111-1111-1111-1111-111111111111';
  const bob = '22222222-2222-2222-2222-222222222222';

  it('код ученика стабилен между просмотрами', () => {
    expect(watermarkCode(alice, secret)).toBe(watermarkCode(alice, secret));
  });

  it('у разных учеников коды разные', () => {
    expect(watermarkCode(alice, secret)).not.toBe(watermarkCode(bob, secret));
  });

  it('код не восстанавливается без секрета', () => {
    expect(watermarkCode(alice, secret)).not.toBe(watermarkCode(alice, 'другой секрет'));
  });

  it('код короткий и читаемый на видео', () => {
    expect(watermarkCode(alice, secret)).toMatch(/^[0-9A-F]{6}$/);
  });

  it('метка содержит код и время, но не идентификатор пользователя', () => {
    const mark = buildWatermark(alice, secret, new Date('2026-09-14T08:05:00Z'));
    expect(mark).toBe(`PDR-${watermarkCode(alice, secret)}-08:05`);
    expect(mark).not.toContain(alice);
  });
});
