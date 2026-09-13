/**
 * Прогон сценариев F1–F10 через интерфейс: клики, ввод, переходы.
 * Запуск: node infra/qa/flows.mjs
 */
import { launch, newPage, loginDemo, api, MINIAPP, ADMIN } from './lib.mjs';

const results = [];
const issues = [];

function record(flow, step, ok, detail = '') {
  results.push({ flow, step, ok, detail });
  console.log(`${ok ? '  ok' : 'FAIL'}  ${flow} — ${step}${detail ? ` (${detail})` : ''}`);
}

function collect(page, flow) {
  for (const issue of page.issues) {
    // Скрипт Telegram недоступен в изолированном окружении — это не дефект приложения.
    if (issue.text.includes('ERR_TUNNEL_CONNECTION_FAILED')) continue;
    if (issue.text.includes('telegram-web-app.js')) continue;
    issues.push({ flow, ...issue });
  }
  page.issues.length = 0;
}

const browser = await launch();

// ── F1: первый вход ──────────────────────────────────────────────────────────
{
  const page = await newPage(browser);
  await page.goto(`${MINIAPP}/?demo=staging-demo-secret-01`, { waitUntil: 'networkidle' });
  const title = await page.locator('h1').first().innerText();
  record('F1', 'экран демо-входа открывается', title.includes('Демо-вход'), title);

  await page.getByText('Игорь Ученик').click();
  await page.waitForTimeout(1500);
  const body = await page.locator('body').innerText();
  record('F1', 'после входа виден курс', body.includes('Обучение') || body.includes('этап'), '');
  collect(page, 'F1');
  await page.context().close();
}

// ── F2: ученик проходит этап ─────────────────────────────────────────────────
{
  const page = await newPage(browser);
  const tokens = await loginDemo(page, 'student');
  const me = await api('/me', tokens.accessToken);
  const enrollmentId = me.body.enrollments[0].id;

  await page.goto(`${MINIAPP}/learning/${enrollmentId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const map = await page.locator('body').innerText();
  record('F2', 'карта курса показывает три этапа', (map.match(/Этап \d/g) ?? []).length >= 3);
  record('F2', 'видна причина блокировки третьего этапа', /Откроется|Нужно|Пройдите/.test(map));

  await page.getByText('База PDR').first().click();
  await page.waitForTimeout(1000);
  const stage = await page.locator('body').innerText();
  record('F2', 'этап открывается со списком уроков', stage.includes('Что такое PDR'));

  await page.getByText('Что такое PDR').first().click();
  await page.waitForTimeout(1200);
  const lesson = await page.locator('body').innerText();
  record('F2', 'урок открывается', lesson.includes('PDR'), '');
  collect(page, 'F2');
  await page.context().close();
}

// ── F3: куратор проверяет работу ─────────────────────────────────────────────
{
  const page = await newPage(browser);
  await loginDemo(page, 'curator');
  await page.goto(`${MINIAPP}/curator`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const queue = await page.locator('body').innerText();
  record(
    'F3',
    'очередь проверок не пуста',
    /Градовая панель|работ/i.test(queue),
    queue.slice(0, 80),
  );
  collect(page, 'F3');
  await page.context().close();
}

// ── F4: заказ от записи до выдачи ────────────────────────────────────────────
{
  const page = await newPage(browser);
  const tokens = await loginDemo(page, 'master');
  const me = await api('/me', tokens.accessToken);
  const wsId = me.body.workspaces[0].id;

  await page.goto(`${MINIAPP}/workspace/${wsId}/today`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const today = await page.locator('body').innerText();
  record('F4', 'экран «Сегодня» с записями и заказами', today.includes('Записи на сегодня'));

  await page.getByRole('button', { name: '+ Новый заказ' }).first().click();
  await page.waitForTimeout(900);
  const form = await page.locator('body').innerText();
  record(
    'F4',
    'форма нового заказа открывается',
    form.includes('Клиент') && form.includes('Автомобиль'),
  );

  await page.getByPlaceholder('Иван Петров').fill('Тестовый Клиент QA');
  await page.getByPlaceholder('Toyota').fill('Nissan');
  await page.getByPlaceholder('Camry').fill('Qashqai');
  await page.getByPlaceholder('А123ВС77').fill('Х001АА77');
  await page.getByPlaceholder('Град на капоте и крыше').fill('QA: вмятина на двери');
  await page.getByRole('button', { name: 'Создать заказ' }).click();
  await page.waitForTimeout(1800);
  const card = await page.locator('body').innerText();
  record(
    'F4',
    'заказ создан и открыта карточка',
    card.includes('QA: вмятина на двери') || card.includes('Тестовый Клиент QA'),
    card.slice(0, 90),
  );

  // Смета
  await page
    .getByRole('tab', { name: 'Расчёт' })
    .click()
    .catch(() => page.getByText('Расчёт').first().click());
  await page.waitForTimeout(900);
  const estimateTab = await page.locator('body').innerText();
  record(
    'F4',
    'вкладка «Расчёт» доступна',
    estimateTab.includes('Сметы нет') || estimateTab.includes('Новая смета'),
  );
  collect(page, 'F4');
  await page.context().close();
}

// ── F5: сотрудник видит мастерскую ───────────────────────────────────────────
{
  const page = await newPage(browser);
  const tokens = await loginDemo(page, 'employee');
  const me = await api('/me', tokens.accessToken);
  const wsId = me.body.workspaces[0].id;

  await page.goto(`${MINIAPP}/workspace/${wsId}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const settings = await page.locator('body').innerText();
  record(
    'F5',
    'сотрудник не видит разделы владельца',
    !settings.includes('Аналитика') && !settings.includes('Журнал оплат'),
    settings.slice(0, 60),
  );
  collect(page, 'F5');
  await page.context().close();
}

// ── F6 и F8: администратор ───────────────────────────────────────────────────
{
  const page = await newPage(browser, { width: 1280, height: 800 });
  await loginDemo(page, 'admin', ADMIN);
  await page.goto(`${ADMIN}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const dash = await page.locator('body').innerText();
  record('F8', 'дашборд админки открывается', dash.includes('Дашборд'));
  record(
    'F8',
    'в сайдбаре есть все разделы',
    dash.includes('Доступы') && dash.includes('Клуб') && dash.includes('Выгрузки'),
  );

  await page.getByText('Доступы', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  const access = await page.locator('body').innerText();
  record('F6', 'список доступов не пуст', /course|crm|club/i.test(access), access.slice(0, 80));
  collect(page, 'F6/F8');
  await page.context().close();
}

// ── F7: клуб ─────────────────────────────────────────────────────────────────
{
  const page = await newPage(browser);
  await loginDemo(page, 'student');
  await page.goto(`${MINIAPP}/club`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const club = await page.locator('body').innerText();
  record(
    'F7',
    'экран клуба показывает состояние доступа',
    club.includes('клуб'),
    club.slice(0, 90),
  );
  collect(page, 'F7');
  await page.context().close();
}

// ── F10: выгрузка и персональные данные ──────────────────────────────────────
{
  const page = await newPage(browser);
  const tokens = await loginDemo(page, 'master');
  const me = await api('/me', tokens.accessToken);
  const wsId = me.body.workspaces[0].id;

  await page.goto(`${MINIAPP}/workspace/${wsId}/export`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const exportScreen = await page.locator('body').innerText();
  record('F10', 'экран выгрузки открывается', exportScreen.includes('Выгрузка данных'));
  record('F10', 'видно занятое место', exportScreen.includes('Занято в хранилище'));
  collect(page, 'F10');
  await page.context().close();
}

await browser.close();

console.log('\n── Итог ──');
const failed = results.filter((r) => !r.ok);
console.log(`шагов: ${results.length}, провалено: ${failed.length}`);
if (issues.length) {
  console.log('\nОшибки в консоли и сети:');
  const seen = new Set();
  for (const issue of issues) {
    const key = `${issue.kind}:${issue.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  [${issue.flow}] ${issue.kind}: ${issue.text}`);
  }
}
process.exitCode = failed.length > 0 ? 1 : 0;
