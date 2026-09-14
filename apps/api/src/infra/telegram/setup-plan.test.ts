import { describe, expect, it } from 'vitest';
import {
  ALLOWED_UPDATES,
  clubRightsProblems,
  diffWebhook,
  mask,
  maskUrlSecret,
  validateSetup,
  webhookUrl,
} from './setup-plan';

const VALID = {
  TELEGRAM_BOT_TOKEN: '123456789:AAHqwertyuiopasdfghjklzxcvbnm123456789',
  TELEGRAM_BOT_USERNAME: 'pdr_staging_bot',
  TELEGRAM_WEBHOOK_SECRET: 'staging-webhook-secret-01',
  PUBLIC_API_URL: 'https://api.example.com',
  MINIAPP_URL: 'https://app.example.com',
};

describe('validateSetup', () => {
  it('принимает корректное окружение', () => {
    expect(validateSetup(VALID)).toEqual([]);
  });

  it('требует https для вебхука и Mini App', () => {
    const problems = validateSetup({
      ...VALID,
      PUBLIC_API_URL: 'http://api.example.com',
      MINIAPP_URL: 'http://app.example.com',
    });
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).toMatch(/PUBLIC_API_URL/);
    expect(problems.join(' ')).toMatch(/MINIAPP_URL/);
  });

  it('отклоняет секрет с символами, недопустимыми в secret_token и в пути', () => {
    const problems = validateSetup({ ...VALID, TELEGRAM_WEBHOOK_SECRET: 'секрет/со слешем' });
    expect(problems.join(' ')).toMatch(/TELEGRAM_WEBHOOK_SECRET/);
  });

  it('отклоняет слишком короткий секрет', () => {
    expect(validateSetup({ ...VALID, TELEGRAM_WEBHOOK_SECRET: 'short' })).toHaveLength(1);
  });

  it('отклоняет имя бота с @', () => {
    expect(validateSetup({ ...VALID, TELEGRAM_BOT_USERNAME: '@pdr_bot' })).toHaveLength(1);
  });

  it('отклоняет непохожий токен', () => {
    expect(validateSetup({ ...VALID, TELEGRAM_BOT_TOKEN: 'не-токен' })).toHaveLength(1);
  });

  it('принимает id супергруппы и отклоняет ссылку вместо id', () => {
    expect(validateSetup({ ...VALID, TELEGRAM_CLUB_CHAT_ID: '-1001234567890' })).toEqual([]);
    expect(validateSetup({ ...VALID, TELEGRAM_CLUB_CHAT_ID: 'https://t.me/club' })).toHaveLength(1);
  });
});

describe('webhookUrl', () => {
  it('собирает адрес с префиксом v1', () => {
    expect(webhookUrl('https://api.example.com', 'sec')).toBe(
      'https://api.example.com/v1/telegram/webhook/sec',
    );
  });

  it('не удваивает слеш', () => {
    expect(webhookUrl('https://api.example.com/', 'sec')).toBe(
      'https://api.example.com/v1/telegram/webhook/sec',
    );
  });
});

describe('diffWebhook', () => {
  const url = webhookUrl(VALID.PUBLIC_API_URL, VALID.TELEGRAM_WEBHOOK_SECRET);

  it('молчит, когда всё настроено', () => {
    expect(diffWebhook({ url, allowed_updates: [...ALLOWED_UPDATES] }, url)).toEqual([]);
  });

  it('сообщает об отсутствии вебхука', () => {
    expect(diffWebhook({}, url).join(' ')).toMatch(/не установлен/);
  });

  it('ловит набор обновлений по умолчанию: в нём нет chat_member', () => {
    // Пустой allowed_updates у Telegram означает набор по умолчанию.
    const problems = diffWebhook({ url, allowed_updates: [] }, url);
    expect(problems.join(' ')).toMatch(/chat_member/);
    expect(problems.join(' ')).toMatch(/my_chat_member/);
  });

  it('ловит подписку без chat_member при остальных типах на месте', () => {
    const partial = ALLOWED_UPDATES.filter((t) => t !== 'chat_member');
    const problems = diffWebhook({ url, allowed_updates: [...partial] }, url);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('chat_member');
  });

  it('сообщает о чужом адресе, не раскрывая секрет', () => {
    const problems = diffWebhook(
      {
        url: 'https://old.example.com/v1/telegram/webhook/othersecretvalue',
        allowed_updates: [...ALLOWED_UPDATES],
      },
      url,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain('othersecretvalue');
  });

  it('показывает последнюю ошибку доставки', () => {
    const problems = diffWebhook(
      { url, allowed_updates: [...ALLOWED_UPDATES], last_error_message: 'Wrong response' },
      url,
    );
    expect(problems.join(' ')).toMatch(/Wrong response/);
  });
});

describe('clubRightsProblems', () => {
  it('принимает администратора с обоими правами', () => {
    expect(
      clubRightsProblems({
        status: 'administrator',
        can_invite_users: true,
        can_restrict_members: true,
      }),
    ).toEqual([]);
  });

  it('обычный участник не годится', () => {
    expect(clubRightsProblems({ status: 'member' })).toHaveLength(1);
  });

  it('называет каждое недостающее право', () => {
    const problems = clubRightsProblems({ status: 'administrator' });
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).toMatch(/Приглашать/);
    expect(problems.join(' ')).toMatch(/Блокировать/);
  });
});

describe('маскирование', () => {
  it('прячет секрет целиком, если он короткий', () => {
    expect(mask('abc')).toBe('***');
  });

  it('оставляет от секрета только края', () => {
    expect(mask('staging-webhook-secret-01')).toBe('stag…01');
  });

  it('маскирует последний сегмент адреса', () => {
    expect(maskUrlSecret('https://api.example.com/v1/telegram/webhook/supersecretvalue')).toBe(
      'https://api.example.com/v1/telegram/webhook/supe…ue',
    );
  });
});
