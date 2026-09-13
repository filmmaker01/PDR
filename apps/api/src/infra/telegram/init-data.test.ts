import { describe, expect, it } from 'vitest';
import {
  InitDataError,
  signInitData,
  signLoginWidget,
  verifyInitData,
  verifyLoginWidget,
} from './init-data';

const BOT_TOKEN = '123456:AAHtestTokenForUnitTests';
const NOW = new Date('2026-11-15T12:00:00Z');
const AUTH_DATE = String(Math.floor(NOW.getTime() / 1000) - 10);

function makeInitData(overrides: Record<string, string> = {}): string {
  return signInitData(
    {
      auth_date: AUTH_DATE,
      query_id: 'AAH123',
      user: JSON.stringify({
        id: 42,
        first_name: 'Иван',
        last_name: 'Петров',
        username: 'ivan',
        language_code: 'ru',
        allows_write_to_pm: true,
      }),
      ...overrides,
    },
    BOT_TOKEN,
  );
}

describe('verifyInitData', () => {
  it('принимает корректную подпись и разбирает пользователя', () => {
    const result = verifyInitData(makeInitData(), BOT_TOKEN, 300, NOW);
    expect(result.user.id).toBe('42');
    expect(result.user.firstName).toBe('Иван');
    expect(result.user.username).toBe('ivan');
    expect(result.user.allowsWriteToPm).toBe(true);
    expect(result.authDate.getTime()).toBe(Number(AUTH_DATE) * 1000);
  });

  it('возвращает start_param для deep-link', () => {
    const result = verifyInitData(makeInitData({ start_param: 'inv_abc' }), BOT_TOKEN, 300, NOW);
    expect(result.startParam).toBe('inv_abc');
  });

  it('отклоняет подпись другим токеном', () => {
    const initData = signInitData(
      { auth_date: AUTH_DATE, user: JSON.stringify({ id: 1, first_name: 'A' }) },
      'other:token',
    );
    expect(() => verifyInitData(initData, BOT_TOKEN, 300, NOW)).toThrow(InitDataError);
  });

  it('отклоняет изменённое поле при сохранённом hash', () => {
    const original = makeInitData();
    const params = new URLSearchParams(original);
    params.set('user', JSON.stringify({ id: 999, first_name: 'Злоумышленник' }));
    expect(() => verifyInitData(params.toString(), BOT_TOKEN, 300, NOW)).toThrow(/bad_signature/);
  });

  it('отклоняет отсутствующий hash', () => {
    const params = new URLSearchParams(makeInitData());
    params.delete('hash');
    expect(() => verifyInitData(params.toString(), BOT_TOKEN, 300, NOW)).toThrow(/missing_hash/);
  });

  it('отклоняет просроченный auth_date', () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 3600);
    expect(() => verifyInitData(makeInitData({ auth_date: old }), BOT_TOKEN, 300, NOW)).toThrow(
      /expired/,
    );
  });

  it('отклоняет auth_date из будущего', () => {
    const future = String(Math.floor(NOW.getTime() / 1000) + 600);
    expect(() => verifyInitData(makeInitData({ auth_date: future }), BOT_TOKEN, 300, NOW)).toThrow(
      /expired/,
    );
  });

  it('отклоняет данные без пользователя', () => {
    const initData = signInitData({ auth_date: AUTH_DATE }, BOT_TOKEN);
    expect(() => verifyInitData(initData, BOT_TOKEN, 300, NOW)).toThrow(/missing_user/);
  });

  it('отклоняет пустую строку', () => {
    expect(() => verifyInitData('', BOT_TOKEN, 300, NOW)).toThrow(/malformed/);
  });

  it('отклоняет чрезмерно длинный вход', () => {
    expect(() => verifyInitData('a'.repeat(9000), BOT_TOKEN, 300, NOW)).toThrow(/malformed/);
  });
});

describe('verifyLoginWidget', () => {
  const base = {
    id: 42,
    first_name: 'Иван',
    username: 'ivan',
    auth_date: Number(AUTH_DATE),
  };

  it('принимает корректную подпись (secret = SHA256(token), не HMAC)', () => {
    const signed = signLoginWidget(base, BOT_TOKEN);
    const result = verifyLoginWidget(signed, BOT_TOKEN, 300, NOW);
    expect(result.id).toBe('42');
    expect(result.username).toBe('ivan');
  });

  it('не принимает подпись по алгоритму Mini App', () => {
    const miniAppStyle = new URLSearchParams(
      signInitData({ id: '42', first_name: 'Иван', auth_date: AUTH_DATE }, BOT_TOKEN),
    );
    const data = Object.fromEntries(miniAppStyle.entries());
    expect(() => verifyLoginWidget(data, BOT_TOKEN, 300, NOW)).toThrow(/bad_signature/);
  });

  it('отклоняет просроченный auth_date', () => {
    const signed = signLoginWidget(
      { ...base, auth_date: Math.floor(NOW.getTime() / 1000) - 3600 },
      BOT_TOKEN,
    );
    expect(() => verifyLoginWidget(signed, BOT_TOKEN, 300, NOW)).toThrow(/expired/);
  });

  it('отклоняет изменённое поле', () => {
    const signed = signLoginWidget(base, BOT_TOKEN);
    expect(() => verifyLoginWidget({ ...signed, id: 999 }, BOT_TOKEN, 300, NOW)).toThrow(
      /bad_signature/,
    );
  });
});
