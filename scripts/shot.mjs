import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const shots = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const hook = (page) => { page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('pageerror:', e.message)); };
for (const s of shots) {
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true }); hook(page);
  await page.goto(`http://localhost:4173/?shot=${s}`, { timeout: 120000 });
  if (s === 'title') await page.waitForSelector('#title:not([hidden])', { timeout: 180000 });
  else await page.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  await page.waitForFunction(() => (window.__frames||0) > 6, null, { timeout: 240000 });
  await page.screenshot({ timeout: 180000, path: `${process.env.HOME}/shots/${s}.png` });
  await page.close();
  console.log(s, 'ok', (Date.now() - t0) / 1000 + 's');
}
await browser.close();
