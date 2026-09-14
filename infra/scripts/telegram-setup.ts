#!/usr/bin/env tsx
/**
 * Настройка бота через Bot API.
 *
 * Всё, что можно сделать программно, делается здесь: вебхук с секретом и
 * нужным набором обновлений, команды, кнопка меню с Mini App, проверка прав
 * бота в группе клуба и ссылка-заявка. В BotFather руками остаётся только то,
 * чего в Bot API нет: создать бота, включить режим Mini App и указать домен
 * для Login Widget (/setdomain).
 *
 * Запуск:
 *   pnpm telegram:setup            — применить настройки
 *   pnpm telegram:check            — только проверить, ничего не меняя
 *
 * Флаги:
 *   --env=<файл>     другой файл окружения (по умолчанию apps/api/.env)
 *   --check          режим проверки
 *   --drop-pending   выбросить накопившиеся обновления (осторожно: в очереди
 *                    могут лежать необработанные заявки в клуб)
 *   --new-invite     создать новую ссылку-заявку, даже если она уже задана
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ALLOWED_UPDATES,
  BOT_COMMANDS,
  clubRightsProblems,
  diffWebhook,
  mask,
  maskUrlSecret,
  validateSetup,
  webhookUrl,
  type ChatMemberInfo,
  type WebhookInfo,
} from '../../apps/api/src/infra/telegram/setup-plan';

const args = process.argv.slice(2);
const has = (flag: string): boolean => args.includes(flag);
const argValue = (name: string): string | null => {
  const found = args.find((a) => a.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : null;
};

const CHECK_ONLY = has('--check');

/** Файл окружения ищется вверх по дереву: скрипт запускают из разных мест. */
function findEnvFile(explicit: string | null): string | null {
  if (explicit) return existsSync(explicit) ? resolve(explicit) : null;
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(dir, 'apps/api/.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

class BotApiError extends Error {}

async function api<T>(token: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!payload.ok) {
    throw new BotApiError(`${method}: ${payload.description ?? `HTTP ${response.status}`}`);
  }
  return payload.result as T;
}

const problems: string[] = [];
const note = (text: string): void => console.log(`  ${text}`);
const fail = (text: string): void => {
  problems.push(text);
  console.log(`  ✗ ${text}`);
};
const done = (text: string): void => console.log(`  ✓ ${text}`);

async function main(): Promise<void> {
  const envFile = findEnvFile(argValue('--env'));
  if (envFile) {
    loadEnv({ path: envFile });
    console.log(`Окружение: ${envFile}`);
  } else {
    console.log('Файл окружения не найден, беру значения из переменных процесса.');
  }

  const env = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    TELEGRAM_CLUB_CHAT_ID: process.env.TELEGRAM_CLUB_CHAT_ID,
    PUBLIC_API_URL: process.env.PUBLIC_API_URL,
    MINIAPP_URL: process.env.MINIAPP_URL,
  };

  const invalid = validateSetup(env);
  if (invalid.length > 0) {
    console.error('\nОкружение заполнено не полностью:');
    for (const line of invalid) console.error(`  ✗ ${line}`);
    process.exit(1);
  }

  const token = env.TELEGRAM_BOT_TOKEN!;
  const secret = env.TELEGRAM_WEBHOOK_SECRET!;
  const expectedUrl = webhookUrl(env.PUBLIC_API_URL!, secret);

  console.log(CHECK_ONLY ? '\nРежим проверки, ничего не меняю.\n' : '\nПрименяю настройки.\n');

  // ── Бот ───────────────────────────────────────────────────────────────
  console.log('Бот');
  const me = await api<{ id: number; username?: string; can_join_groups?: boolean }>(
    token,
    'getMe',
  );
  done(`@${me.username ?? '?'} (id ${me.id})`);
  if (me.username?.toLowerCase() !== env.TELEGRAM_BOT_USERNAME!.toLowerCase()) {
    fail(
      `TELEGRAM_BOT_USERNAME=${env.TELEGRAM_BOT_USERNAME} не совпадает с @${me.username ?? '?'}: ` +
        'ссылки на Mini App будут вести не туда',
    );
  }

  // ── Вебхук ────────────────────────────────────────────────────────────
  console.log('\nВебхук');
  if (!CHECK_ONLY) {
    await api(token, 'setWebhook', {
      url: expectedUrl,
      secret_token: secret,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: has('--drop-pending'),
      max_connections: 40,
    });
    done(`установлен: ${maskUrlSecret(expectedUrl)}`);
    done(`обновления: ${ALLOWED_UPDATES.join(', ')}`);
  }

  const info = await api<WebhookInfo>(token, 'getWebhookInfo');
  const webhookProblems = diffWebhook(info, expectedUrl);
  if (webhookProblems.length === 0) {
    if (CHECK_ONLY) done(`адрес и подписки верны: ${maskUrlSecret(info.url ?? '')}`);
    if (info.pending_update_count) note(`в очереди обновлений: ${info.pending_update_count}`);
  } else {
    for (const line of webhookProblems) fail(line);
  }

  // ── Команды и кнопка меню ────────────────────────────────────────────
  console.log('\nКоманды и кнопка меню');
  if (CHECK_ONLY) {
    const commands = await api<{ command: string }[]>(token, 'getMyCommands');
    const missing = BOT_COMMANDS.filter(
      (c) => !commands.some((existing) => existing.command === c.command),
    );
    if (missing.length > 0) fail(`не заданы команды: ${missing.map((c) => c.command).join(', ')}`);
    else done(`команды на месте: ${commands.map((c) => `/${c.command}`).join(' ')}`);

    const button = await api<{ type?: string; web_app?: { url?: string } }>(
      token,
      'getChatMenuButton',
    );
    if (button.type !== 'web_app') fail(`кнопка меню не ведёт в Mini App (тип: ${button.type})`);
    else if (button.web_app?.url !== env.MINIAPP_URL) {
      fail(`кнопка меню ведёт на ${button.web_app?.url ?? '?'}, а не на ${env.MINIAPP_URL}`);
    } else done(`кнопка меню: ${button.web_app?.url}`);
  } else {
    await api(token, 'setMyCommands', { commands: BOT_COMMANDS });
    done(`команды: ${BOT_COMMANDS.map((c) => `/${c.command}`).join(' ')}`);
    await api(token, 'setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'Приложение',
        web_app: { url: env.MINIAPP_URL },
      },
    });
    done(`кнопка меню открывает ${env.MINIAPP_URL}`);
  }

  // ── Клуб ──────────────────────────────────────────────────────────────
  console.log('\nКлуб');
  if (!env.TELEGRAM_CLUB_CHAT_ID) {
    note('TELEGRAM_CLUB_CHAT_ID не задан — проверка пропущена.');
  } else {
    const chatId = env.TELEGRAM_CLUB_CHAT_ID;
    const chat = await api<{ title?: string; type?: string }>(token, 'getChat', {
      chat_id: chatId,
    });
    done(`группа: ${chat.title ?? '?'} (${chat.type ?? '?'})`);
    if (chat.type !== 'supergroup') {
      note(
        'заявки на вступление работают в супергруппе; обычная группа станет ею сама при включении заявок',
      );
    }

    const member = await api<ChatMemberInfo>(token, 'getChatMember', {
      chat_id: chatId,
      user_id: me.id,
    });
    const rights = clubRightsProblems(member);
    for (const line of rights) fail(line);
    if (rights.length === 0) done('бот — администратор с правами одобрять и исключать');

    const existingLink = process.env.TELEGRAM_CLUB_INVITE_LINK;
    if (rights.length > 0) {
      note('ссылку-заявку не создаю, пока у бота нет прав.');
    } else if (CHECK_ONLY) {
      if (existingLink) done('TELEGRAM_CLUB_INVITE_LINK задана');
      else fail('TELEGRAM_CLUB_INVITE_LINK не задана');
    } else if (existingLink && !has('--new-invite')) {
      done(`ссылка уже задана: ${existingLink}`);
      note('чтобы выпустить новую, добавьте --new-invite');
    } else {
      const link = await api<{ invite_link: string }>(token, 'createChatInviteLink', {
        chat_id: chatId,
        name: 'PDR клуб',
        creates_join_request: true,
      });
      done('ссылка-заявка создана, запишите её в окружение:');
      console.log(`\n      TELEGRAM_CLUB_INVITE_LINK=${link.invite_link}\n`);
    }
  }

  // ── Итог ──────────────────────────────────────────────────────────────
  console.log('');
  if (problems.length > 0) {
    console.error(`Осталось исправить (${problems.length}):`);
    for (const line of problems) console.error(`  • ${line}`);
    process.exit(1);
  }

  console.log('Всё настроено.');
  if (!CHECK_ONLY) {
    console.log(
      [
        '',
        'В BotFather остаётся сделать руками (этого нет в Bot API):',
        `  /setdomain — домен админки для кнопки входа: ${new URL(process.env.ADMIN_URL ?? 'https://admin.example.com').host}`,
        '  /newapp или «Configure Mini App» — включить Mini App, если бот новый',
        '',
        `Секрет вебхука: ${mask(secret)} (значение целиком — в окружении API)`,
      ].join('\n'),
    );
  }
}

main().catch((err: unknown) => {
  console.error(`\nОшибка: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
