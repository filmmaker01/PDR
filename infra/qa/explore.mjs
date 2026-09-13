import { launch, newPage, loginDemo, api, MINIAPP, SECRET } from './lib.mjs';

const browser = await launch();
const page = await newPage(browser);
const tokens = await loginDemo(page, 'master');

const me = await api('/me', tokens.accessToken);
const wsId = me.body.workspaces[0].id;
console.log('workspace', wsId, me.body.workspaces[0].name);

const paths = [
  ['today', `/workspace/${wsId}/today`],
  ['calendar', `/workspace/${wsId}/calendar`],
  ['orders', `/workspace/${wsId}/orders`],
  ['clients', `/workspace/${wsId}/clients`],
  ['settings', `/workspace/${wsId}/settings`],
  ['analytics', `/workspace/${wsId}/analytics`],
];

for (const [name, path] of paths) {
  page.issues.length = 0;
  await page.goto(`${MINIAPP}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const text = (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400);
  console.log(`\n=== ${name} ===\n${text}`);
  if (page.issues.length) console.log('ISSUES:', JSON.stringify(page.issues.slice(0, 5)));
}

await browser.close();
