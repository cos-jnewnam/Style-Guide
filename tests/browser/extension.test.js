// Loads the unpacked extension in Playwright's Chromium and drives it like a user would.
// Run with: npm run test:browser
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const EXT_SRC = path.join(__dirname, '..', '..', 'extension');

// Hostile page CSS to prove the shadow DOM panel holds up.
const PAGE = `<!doctype html><html><head><title>Fixture</title>
<style>
  * { font-size: 30px !important; color: hotpink !important; }
  div, section, button { display: inline !important; border: 9px solid lime !important; }
</style></head><body>
<header><p>City of Scottsdale header with 5 things</p></header>
<main>
  <h2>Water Conservation Program Overview</h2>
  <p id="p1">Join us Aug. 10th at 9 AM, 7447 East Indian School Rd. Call (480) 312-2321.</p>
  <p id="p2" style="color:red" title="keep me">Visit https://www.scottsdaleaz.gov/trash for the City of Scottsdale schedule.</p>
  <div id="d3" class="" style="margin:0"><p class="keep me">We have 5 cats, 12 dogs and ten birds.</p></div>
  <font color="red">old markup</font>
  <details><summary>More</summary><p id="hidden">Open 9 AM daily.</p></details>
  <p id="clean">Visit ScottsdaleAZ.gov and search "trash." Open 9-10 a.m.</p>
  ${'<p>Filler paragraph so the page scrolls.</p>'.repeat(40)}
  <p id="far">Call 480.312.2321 today.</p>
</main>
</body></html>`;

let server;
let origin;
let context;
let worker;
let extId;
let userDir;
let extDir;

test.before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;

  // Test-only copy with a host permission, because activeTab is only granted by a real toolbar click.
  extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssc-ext-'));
  fs.cpSync(EXT_SRC, extDir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));

  userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssc-profile-'));
  context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  extId = new URL(worker.url()).host;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
});

test.after(async () => {
  if (context) await context.close();
  if (server) server.close();
  for (const d of [userDir, extDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
});

async function openFixture() {
  const page = await context.newPage();
  await page.goto(origin + '/');
  await page.bringToFront();
  return page;
}

function clickToolbar(page) {
  return worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url, active: true, lastFocusedWindow: true });
    await onAction(tab);
  }, page.url());
}

function badge(page) {
  return worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url, active: true, lastFocusedWindow: true });
    return {
      text: await chrome.action.getBadgeText({ tabId: tab.id }),
      color: await chrome.action.getBadgeBackgroundColor({ tabId: tab.id }),
    };
  }, page.url());
}

async function setSettings(settings) {
  await worker.evaluate((s) => chrome.storage.sync.set({ settings: s }), settings);
}

async function waitForRows(page) {
  await page.locator('#ssc-host .row').first().waitFor();
  return page.locator('#ssc-host .row');
}

test('scan highlights, panel, badge and a clean restore', async () => {
  await setSettings({ rules: { 'css-style-attr': 'error' } });
  const page = await openFixture();
  const before = await page.evaluate(() => document.documentElement.outerHTML);

  await clickToolbar(page);
  const rows = await waitForRows(page);
  assert.ok((await rows.count()) >= 10, 'expected at least 10 rows');

  const marks = await page.locator('main mark.ssc-hl').allTextContents();
  for (const t of ['East', 'Rd.', '(480) 312-2321', 'City of Scottsdale', '5', 'ten', '480.312.2321']) {
    assert.ok(marks.includes(t), `missing mark ${t}: ${JSON.stringify(marks)}`);
  }
  assert.strictEqual(await page.locator('header mark').count(), 0);
  assert.ok(await page.locator('#p2.ssc-el.ssc-error').count());
  assert.ok(await page.locator('h2.ssc-el.ssc-review').count());

  // Page CSS must not reach into the panel.
  const box = await page.locator('#ssc-host .panel').boundingBox();
  assert.ok(Math.abs(box.width - 380) < 2, 'panel width ' + box.width);
  const chipColor = await page.locator('#ssc-host .chip.err').evaluate((el) => getComputedStyle(el).color);
  assert.strictEqual(chipColor, 'rgb(180, 35, 24)');

  const b = await badge(page);
  assert.match(b.text, /^\d+$/);
  assert.deepStrictEqual(b.color.slice(0, 3), [180, 35, 24]);

  await clickToolbar(page);
  await page.locator('#ssc-host').waitFor({ state: 'detached' });
  const after = await page.evaluate(() => document.documentElement.outerHTML);
  assert.strictEqual(after, before, 'page did not restore exactly');
  assert.strictEqual((await badge(page)).text, '');
  await page.close();
});

test('jump, step, filters, ignore and copy report', async () => {
  await setSettings(null);
  const page = await openFixture();
  await clickToolbar(page);
  const rows = await waitForRows(page);
  const status = page.locator('#ssc-host .status');

  // Jump to the far item and check it scrolled into view.
  const farRow = rows.filter({ hasText: '480.312.2321' });
  await farRow.locator('.jump').click();
  await page.waitForFunction(() => {
    const r = document.querySelector('#far mark').getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  });
  assert.ok(await page.locator('#far mark.ssc-active').count());
  assert.match(await status.textContent(), /^Item \d+ of \d+$/);

  // Jumping to the item inside the closed <details> opens it.
  const hiddenRow = rows.filter({ has: page.locator('.snip', { hasText: /^9 AM$/ }) });
  for (let i = 0; i < (await hiddenRow.count()); i++) await hiddenRow.nth(i).locator('.jump').click();
  assert.ok(await page.locator('main details').evaluate((d) => d.open), 'details should open on jump');

  await page.locator('#ssc-host button', { hasText: 'Next' }).click();
  assert.match(await status.textContent(), /^Item \d+ of \d+$|hidden/);
  await page.locator('#ssc-host button', { hasText: 'Previous' }).click();

  // Filters
  const total = await rows.count();
  await page.locator('#ssc-host .chip.err').click();
  assert.ok(await page.evaluate(() => document.documentElement.hasAttribute('data-ssc-hide-error')));
  assert.strictEqual(await page.locator('#ssc-host .row.err').count(), 0);
  await page.locator('#ssc-host .chip.err').click();
  assert.strictEqual(await rows.count(), total);

  // Ignore
  const marksBefore = await page.locator('mark.ssc-hl').count();
  await page.locator('#ssc-host .row', { hasText: '(480) 312-2321' }).locator('.ign').click();
  assert.strictEqual(await rows.count(), total - 1);
  assert.strictEqual(await page.locator('mark.ssc-hl').count(), marksBefore - 1);

  // Copy report
  await page.locator('#ssc-host button', { hasText: 'Copy report' }).click();
  await page.waitForFunction(() => /copied|could not/i.test(document.getElementById('ssc-host').shadowRoot.querySelector('.status').textContent));
  assert.match(await status.textContent(), /Report copied/);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /^Scottsdale Style Check/);
  assert.match(clip, /480\.312\.2321/);

  await page.locator('#ssc-host button', { hasText: 'Close' }).click();
  await page.locator('#ssc-host').waitFor({ state: 'detached' });
  assert.strictEqual(await page.locator('mark.ssc-hl, .ssc-el').count(), 0);
  await page.close();
});

test('scope fallback note and rescan on settings change', async () => {
  await setSettings({ scopeSelector: '#nope' });
  const page = await openFixture();
  await clickToolbar(page);
  await waitForRows(page);
  assert.match(await page.locator('#ssc-host .note').textContent(), /Nothing on this page matched "#nope"/);
  assert.ok(await page.locator('header mark').count(), 'whole page should be checked');

  assert.ok((await page.locator('#ssc-host .rname', { hasText: 'Hyphens only' }).count()) > 0);
  await setSettings({ scopeSelector: 'main', rules: { 'phone-format': 'off' } });
  await page.waitForFunction(
    () => !document.getElementById('ssc-host').shadowRoot.querySelector('.note') &&
      ![...document.getElementById('ssc-host').shadowRoot.querySelectorAll('.rname')].some((e) => /Hyphens only/.test(e.textContent))
  );
  await clickToolbar(page);
  await page.close();
});

test('options page saves, exports and imports', async () => {
  await setSettings(null);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/options.html`);
  const ruleCount = await page.evaluate(() => SSC.RULES.length);
  assert.strictEqual(await page.locator('#rules input[type=radio]').count(), ruleCount * 3);
  assert.ok(await page.locator('input[name="rule-date-year"][value="review"]').isChecked());

  await page.locator('input[name="rule-date-year"][value="off"]').check({ force: true });
  await page.locator('#saved', { hasText: 'Saved' }).waitFor();
  let stored = await worker.evaluate(() => chrome.storage.sync.get('settings'));
  assert.strictEqual(stored.settings.rules['date-year'], 'off');

  const bytes = await worker.evaluate(() => chrome.storage.sync.getBytesInUse('settings'));
  assert.ok(bytes < 8192 * 0.6, `settings use ${bytes} bytes of 8192`);

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.strictEqual(exported.rules['date-year'], 'off');

  exported.rules['date-year'] = 'error';
  exported.scopeSelector = '#content';
  await page.locator('#file').setInputFiles({
    name: 'settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page.locator('#saved', { hasText: 'Imported' }).waitFor();
  assert.ok(await page.locator('input[name="rule-date-year"][value="error"]').isChecked());
  assert.strictEqual(await page.locator('#scopeSelector').inputValue(), '#content');
  stored = await worker.evaluate(() => chrome.storage.sync.get('settings'));
  assert.strictEqual(stored.settings.scopeSelector, '#content');

  await page.locator('#file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('[1,2]') });
  await page.locator('#saved', { hasText: 'Could not import' }).waitFor();
  await page.close();
});

test('settings button in the panel opens the options page', async () => {
  await setSettings(null);
  const page = await openFixture();
  await clickToolbar(page);
  await waitForRows(page);
  const [opts] = await Promise.all([
    context.waitForEvent('page', (p) => p.url().startsWith(`chrome-extension://${extId}/options.html`)),
    page.locator('#ssc-host button', { hasText: 'Settings' }).click(),
  ]);
  await opts.close();
  await clickToolbar(page);
  await page.close();
});

test('blocked pages show a red ! badge', async () => {
  const page = await context.newPage();
  await page.goto('chrome://version');
  await page.bringToFront();
  const result = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await onAction(tab);
    return chrome.action.getBadgeText({ tabId: tab.id });
  });
  assert.strictEqual(result, '!');
  await page.close();
});
