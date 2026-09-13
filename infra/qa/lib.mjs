import { chromium } from 'playwright';

export const MINIAPP = 'http://localhost:5173';
export const ADMIN = 'http://localhost:5174';
export const API = 'http://localhost:3000';
export const SECRET = 'staging-demo-secret-01';

export async function launch() {
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}

/** Страница с записью консольных ошибок и неудачных запросов. */
export async function newPage(browser, { width = 390, height = 844 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    locale: 'ru-RU',
  });
  const page = await context.newPage();
  const issues = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.push({ kind: 'console', text: msg.text().slice(0, 300) });
  });
  page.on('pageerror', (err) =>
    issues.push({ kind: 'pageerror', text: String(err).slice(0, 300) }),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) {
      issues.push({
        kind: 'http',
        text: `${res.status()} ${res.request().method()} ${res.url().replace(API, '')}`,
      });
    }
  });
  page.issues = issues;
  return page;
}

export async function loginDemo(page, key, app = MINIAPP) {
  const tokens = await (
    await fetch(`${API}/v1/auth/demo/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, secret: SECRET }),
    })
  ).json();

  const storageKey = app === MINIAPP ? 'pdr.miniapp' : 'pdr.admin';
  await page.goto(`${app}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([prefix, t, secret]) => {
      localStorage.setItem(`${prefix}:access`, t.accessToken);
      localStorage.setItem(`${prefix}:refresh`, t.refreshToken);
      localStorage.setItem('pdr.demo.secret', secret);
    },
    [storageKey, tokens, SECRET],
  );
  return tokens;
}

export async function api(path, token, options = {}) {
  const res = await fetch(`${API}/v1${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
