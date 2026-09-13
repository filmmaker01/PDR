/**
 * Продуктовый QA: навигация только кликами, проверка состояний интерфейса,
 * снимки основных экранов на мобильной и десктопной ширине.
 *
 * Запуск: node infra/qa/audit.mjs
 */
import { mkdir, rm } from 'node:fs/promises';
import { launch, newPage, loginDemo, api, MINIAPP, ADMIN } from './lib.mjs';

const SHOTS = new URL('../../.qa-screens/', import.meta.url).pathname;
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const results = [];
const issues = [];
let shotIndex = 0;

function record(group, step, ok, detail = '') {
  results.push({ group, step, ok, detail });
  console.log(`${ok ? '  ok' : 'FAIL'}  ${group} — ${step}${detail ? ` (${detail})` : ''}`);
}

async function shot(page, name) {
  shotIndex += 1;
  const file = `${SHOTS}${String(shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
}

function collect(page, group) {
  for (const issue of page.issues) {
    if (issue.text.includes('ERR_TUNNEL_CONNECTION_FAILED')) continue;
    if (issue.text.includes('telegram-web-app.js')) continue;
    if (issue.text.includes('/auth/demo/accounts')) continue; // экран входа до записи секрета
    issues.push({ group, ...issue });
  }
  page.issues.length = 0;
}

async function text(page) {
  return page.locator('body').innerText();
}

/** Клик по видимому элементу с текстом + ожидание отрисовки. */
async function click(page, name, { role = null, wait = 900 } = {}) {
  const locator = role
    ? page.getByRole(role, { name }).first()
    : page.getByText(name, { exact: false }).first();
  await locator.click();
  await page.waitForTimeout(wait);
}

const browser = await launch();

// ── Ученик: обучение целиком кликами ─────────────────────────────────────────
{
  const page = await newPage(browser);
  await loginDemo(page, 'student');
  await page.goto(`${MINIAPP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  record(
    'ученик',
    'стартовый экран ведёт на обучение',
    page.url().includes('/learning'),
    page.url(),
  );
  await shot(page, 'ученик-карта-курса');

  const map = await text(page);
  record('ученик', 'виден прогресс и этапы', /Этап 1/.test(map) && /Этап 3/.test(map));

  await click(page, 'Этап 2');
  const stage = await text(page);
  record('ученик', 'этап открывается кликом', /Урок|урок/.test(stage), page.url());
  await shot(page, 'ученик-этап');

  // Первый урок этапа
  const lessonLink = page.locator('.pdr-list [role="button"], .pdr-list li, .pdr-list > *').first();
  await lessonLink.click().catch(() => {});
  await page.waitForTimeout(1200);
  record('ученик', 'урок открывается', page.url().includes('/lessons/'), page.url());
  await shot(page, 'ученик-урок');

  const lesson = await text(page);
  record(
    'ученик',
    'на уроке есть действие завершения',
    /Урок пройден|Посмотрите ещё/.test(lesson),
    lesson.slice(0, 70),
  );

  collect(page, 'ученик');
  await page.context().close();
}

// ── Ученик: задание и экзамен ────────────────────────────────────────────────
{
  const page = await newPage(browser);
  const tokens = await loginDemo(page, 'student');
  const me = await api('/me', tokens.accessToken);
  const enrollmentId = me.body.enrollments[0].id;
  await page.goto(`${MINIAPP}/learning/${enrollmentId}/stages/stage-1`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(900);
  const stage = await text(page);
  record(
    'ученик',
    'на этапе видны задание и экзамен',
    /Задание|Экзамен|Тест/.test(stage),
    stage.slice(0, 70),
  );
  await shot(page, 'ученик-этап-1');
  collect(page, 'ученик');
  await page.context().close();
}

// ── Новый ученик: пустые состояния ───────────────────────────────────────────
{
  const page = await newPage(browser);
  await loginDemo(page, 'student_new');
  await page.goto(`${MINIAPP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const body = await text(page);
  record(
    'пустые состояния',
    'новый ученик видит курс без прогресса',
    /Этап 1/.test(body),
    body.slice(0, 60),
  );
  await shot(page, 'пусто-новый-ученик');
  collect(page, 'пустые состояния');
  await page.context().close();
}

// ── Куратор ──────────────────────────────────────────────────────────────────
{
  const page = await newPage(browser);
  await loginDemo(page, 'curator');
  await page.goto(`${MINIAPP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await click(page, 'Профиль');
  await shot(page, 'куратор-профиль');
  const profile = await text(page);
  record(
    'куратор',
    'в профиле есть вход в очередь проверок',
    /Проверка работ|Очередь/.test(profile),
  );

  await click(page, 'Проверка работ');
  record('куратор', 'очередь открывается кликом', page.url().includes('/curator'), page.url());
  await shot(page, 'куратор-очередь');

  const queue = await text(page);
  if (/ждёт проверки/.test(queue)) {
    const first = page.locator('.pdr-list > *').first();
    await first.click().catch(() => {});
    await page.waitForTimeout(1200);
    record(
      'куратор',
      'карточка работы открывается',
      page.url().includes('/curator/submissions/'),
      page.url(),
    );
    await shot(page, 'куратор-работа');
  }
  collect(page, 'куратор');
  await page.context().close();
}

// ── Мастер: вся мастерская кликами ───────────────────────────────────────────
{
  const page = await newPage(browser);
  await loginDemo(page, 'master');
  await page.goto(`${MINIAPP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await click(page, 'Мастерская');
  await page.waitForTimeout(600);
  // Если мастерская одна, приложение может сразу открыть её.
  if (!/\/workspace\/[0-9a-f-]{36}/.test(page.url())) {
    await page
      .locator('.pdr-list > *')
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(1200);
  }
  record(
    'мастер',
    'мастерская открывается из таббара',
    /\/workspace\//.test(page.url()),
    page.url(),
  );
  await shot(page, 'мастер-сегодня');

  for (const [tab, marker] of [
    ['Календарь', 'calendar'],
    ['Заказы', 'orders'],
    ['Клиенты', 'clients'],
    ['Ещё', 'settings'],
  ]) {
    await click(page, tab);
    record('мастер', `вкладка «${tab}» открывается`, page.url().includes(marker), page.url());
    await shot(page, `мастер-${marker}`);
  }

  const more = await text(page);
  record(
    'мастер',
    'в «Ещё» есть все разделы владельца',
    [
      'Задолженность',
      'Прайс',
      'Журнал оплат',
      'Сотрудники и приглашения',
      'Аналитика',
      'Журнал действий',
      'Выгрузка данных',
    ].every((label) => more.includes(label)),
    more.slice(0, 120),
  );

  for (const [label, marker] of [
    ['Задолженность', 'debts'],
    ['Прайс', 'price-list'],
    ['Журнал оплат', 'payments'],
    ['Сотрудники и приглашения', 'members'],
    ['Аналитика', 'analytics'],
    ['Журнал действий', 'audit'],
    ['Выгрузка данных', 'export'],
  ]) {
    await click(page, label);
    record(
      'мастер',
      `раздел «${label}» открывается кликом`,
      page.url().includes(marker),
      page.url(),
    );
    await shot(page, `мастер-${marker}`);
    await page.goBack();
    await page.waitForTimeout(700);
  }

  collect(page, 'мастер');
  await page.context().close();
}

// ── Мастер: карточка заказа со всеми вкладками ───────────────────────────────
{
  const page = await newPage(browser);
  const tokens = await loginDemo(page, 'master');
  const me = await api('/me', tokens.accessToken);
  const wsId = me.body.workspaces[0].id;
  await page.goto(`${MINIAPP}/workspace/${wsId}/orders`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  // Заказ с фото, сметой и оплатами: на нём видно наполненные вкладки.
  await page
    .getByText('Град на капоте и крыше')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(1400);
  record(
    'заказ',
    'карточка заказа открывается из списка',
    page.url().includes('/orders/'),
    page.url(),
  );
  await shot(page, 'заказ-работа');

  for (const [tab, marker] of [
    ['Фото', /До ·|Снимк|Добавить/],
    ['Расчёт', /Согласованная сумма|Сметы нет|Новая версия/],
    ['Оплаты', /Оплат|Внести|Платеж/],
  ]) {
    await click(page, tab);
    const body = await text(page);
    record('заказ', `вкладка «${tab}» показывает содержимое`, marker.test(body), body.slice(0, 60));
    await shot(page, `заказ-${tab.toLowerCase()}`);
    if (tab === 'Фото') {
      // Снимок мог сохраниться в один каталог, а отдаваться из другого:
      // визуально это ломается только тем, что картинка не загрузилась.
      const broken = await page.evaluate(
        () => [...document.images].filter((img) => img.complete && img.naturalWidth === 0).length,
      );
      record(
        'заказ',
        'фотографии заказа действительно загружаются',
        broken === 0,
        `битых: ${broken}`,
      );
    }
  }
  collect(page, 'заказ');
  await page.context().close();
}

// ── Сотрудник: ограниченные права ────────────────────────────────────────────
{
  const page = await newPage(browser);
  const tokens = await loginDemo(page, 'employee');
  const me = await api('/me', tokens.accessToken);
  const wsId = me.body.workspaces[0].id;
  await page.goto(`${MINIAPP}/workspace/${wsId}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const settings = await text(page);
  record(
    'сотрудник',
    'разделы владельца скрыты',
    !settings.includes('Аналитика') &&
      !settings.includes('Журнал оплат') &&
      !settings.includes('Журнал действий') &&
      !settings.includes('Выгрузка данных'),
    settings.slice(0, 80),
  );
  await shot(page, 'сотрудник-ещё');

  await page.goto(`${MINIAPP}/workspace/${wsId}/analytics`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const forbidden = await text(page);
  record(
    'сотрудник',
    'прямой заход в аналитику даёт понятный отказ',
    /нет прав|Недостаточно|недоступ/i.test(forbidden),
    forbidden.slice(0, 90),
  );
  await shot(page, 'сотрудник-нет-прав');
  collect(page, 'сотрудник');
  await page.context().close();
}

// ── Завершённый доступ ───────────────────────────────────────────────────────
{
  const page = await newPage(browser);
  const tokens = await loginDemo(page, 'expired');
  const me = await api('/me', tokens.accessToken);
  const wsId = me.body.workspaces[0].id;
  await page.goto(`${MINIAPP}/workspace/${wsId}/today`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const body = await text(page);
  record(
    'доступ завершён',
    'видно объяснение и чтение данных',
    /Доступ к CRM завершён/.test(body),
    body.slice(0, 90),
  );
  await shot(page, 'доступ-завершён');
  collect(page, 'доступ завершён');
  await page.context().close();
}

// ── Клуб и уведомления ───────────────────────────────────────────────────────
{
  const page = await newPage(browser);
  await loginDemo(page, 'student');
  await page.goto(`${MINIAPP}/profile`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await shot(page, 'профиль');
  await click(page, 'Закрытый клуб');
  record('клуб', 'клуб открывается из профиля', page.url().includes('/club'), page.url());
  await shot(page, 'клуб');
  await page.goBack();
  await page.waitForTimeout(800);
  await click(page, 'Уведомления');
  record(
    'уведомления',
    'уведомления открываются из профиля',
    page.url().includes('/notifications'),
    page.url(),
  );
  await shot(page, 'уведомления');
  collect(page, 'профиль');
  await page.context().close();
}

// ── Несуществующий маршрут ───────────────────────────────────────────────────
{
  const page = await newPage(browser);
  await loginDemo(page, 'student');
  await page.goto(`${MINIAPP}/nope-404`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const body = await text(page);
  record(
    'ошибки',
    'неизвестный адрес показывает страницу, а не пустоту',
    /не найдена/i.test(body),
    body.slice(0, 60),
  );
  await shot(page, 'ошибка-404');
  collect(page, 'ошибки');
  await page.context().close();
}

// ── Десктопная ширина Mini App ───────────────────────────────────────────────
{
  const page = await newPage(browser, { width: 1280, height: 900 });
  const tokens = await loginDemo(page, 'master');
  const me = await api('/me', tokens.accessToken);
  const wsId = me.body.workspaces[0].id;
  await page.goto(`${MINIAPP}/workspace/${wsId}/today`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  record('ширина', 'на 1280px нет горизонтальной прокрутки', overflow <= 0, `overflow=${overflow}`);
  await shot(page, 'десктоп-мастерская');
  collect(page, 'ширина');
  await page.context().close();
}

// ── Узкая ширина 360px ───────────────────────────────────────────────────────
{
  const page = await newPage(browser, { width: 360, height: 780 });
  const tokens = await loginDemo(page, 'master');
  const me = await api('/me', tokens.accessToken);
  const wsId = me.body.workspaces[0].id;
  for (const [path, name] of [
    ['today', 'сегодня'],
    ['calendar', 'календарь'],
    ['analytics', 'аналитика'],
  ]) {
    await page.goto(`${MINIAPP}/workspace/${wsId}/${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    record(
      'ширина',
      `360px: «${name}» без горизонтальной прокрутки`,
      overflow <= 0,
      `overflow=${overflow}`,
    );
    await shot(page, `360-${name}`);
  }
  collect(page, 'ширина');
  await page.context().close();
}

// ── Админка ──────────────────────────────────────────────────────────────────
{
  const page = await newPage(browser, { width: 1440, height: 900 });
  await loginDemo(page, 'admin', ADMIN);
  await page.goto(`${ADMIN}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'админка-дашборд');

  const sections = [
    ['Проверка работ', 'reviews'],
    ['Экзамены', 'exam-reviews'],
    ['Ученики', 'students'],
    ['Группы', 'cohorts'],
    ['Курсы', 'courses'],
    ['Видео', 'videos'],
    ['Пользователи', 'users'],
    ['Доступы', 'access'],
    ['Мастерские', 'workspaces'],
    ['Клуб', 'club'],
    ['Выгрузки', 'exports'],
    ['Журнал действий', 'audit'],
  ];
  for (const [label, marker] of sections) {
    const link = page.getByRole('link', { name: label }).first();
    const visible = await link.isVisible().catch(() => false);
    if (!visible) {
      record('админка', `раздел «${label}» есть в меню`, false, 'ссылки нет');
      continue;
    }
    await link.click();
    await page.waitForTimeout(1400);
    record(
      'админка',
      `раздел «${label}» открывается кликом`,
      page.url().includes(marker),
      page.url(),
    );
    await shot(page, `админка-${marker}`);
  }
  collect(page, 'админка');
  await page.context().close();
}

await browser.close();

console.log('\n── Итог ──');
const failed = results.filter((r) => !r.ok);
console.log(`проверок: ${results.length}, провалено: ${failed.length}`);
for (const f of failed) console.log(`  FAIL ${f.group} — ${f.step} ${f.detail}`);
if (issues.length) {
  console.log('\nОшибки в консоли и сети:');
  const seen = new Set();
  for (const issue of issues) {
    const key = `${issue.kind}:${issue.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  [${issue.group}] ${issue.kind}: ${issue.text}`);
  }
}
console.log(`\nСнимки: ${SHOTS}`);
process.exitCode = failed.length > 0 ? 1 : 0;
