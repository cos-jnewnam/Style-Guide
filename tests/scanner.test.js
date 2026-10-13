const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ext = (f) => fs.readFileSync(path.join(__dirname, '..', 'extension', f), 'utf8');
const RULES_JS = ext('rules.js');
const CONTENT_JS = ext('content.js');

const MAIN_HTML = `
  <h1>Water Conservation Program Overview</h1>
  <p id="p1">Join us Aug. 10th at 9 AM, 7447 East Indian School Rd. Call (480) 312-2321.</p>
  <p id="p2" style="color:red">Visit https://www.scottsdaleaz.gov/trash for the City of Scottsdale schedule.</p>
  <div id="d3"><style>p { margin: 0 }</style><p class="keep me">We have 5 cats, 12 dogs and ten birds.</p></div>
  <font color="red">old markup</font>
  <p id="clean">Visit ScottsdaleAZ.gov and search "trash." Open 9-10 a.m.</p>
`;

async function load(opts = {}) {
  const html = `<!doctype html><html><head><title>Test page</title></head><body>
    <header><p id="outside">City of Scottsdale  header with 5 things</p></header>
    <main>${opts.main || MAIN_HTML}</main>
    <footer><p style="color:blue">footer</p></footer>
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/page' });
  const w = dom.window;
  const sent = [];
  w.chrome = {
    storage: {
      sync: { get: async () => ({ settings: opts.settings }) },
      onChanged: { addListener() {} },
    },
    runtime: { sendMessage: (m) => sent.push(m) },
  };
  w.Element.prototype.scrollIntoView = function () {};
  w.eval(RULES_JS);
  w.eval(CONTENT_JS);
  await w.__ssc.ready;
  return { dom, w, doc: w.document, sent };
}

const panel = (doc) => doc.getElementById('ssc-host').shadowRoot;

test('highlights text and elements inside main only', async () => {
  const { doc } = await load();
  const marks = [...doc.querySelectorAll('mark.ssc-hl')];
  assert.ok(marks.length >= 8, 'expected several marks, got ' + marks.length);
  assert.strictEqual(doc.querySelectorAll('header mark, footer mark').length, 0);
  assert.ok(!doc.querySelector('#outside').classList.contains('ssc-el'));
  assert.ok(!doc.querySelector('footer p').classList.contains('ssc-el'), 'footer style attr is outside main');

  const texts = marks.map((m) => m.textContent);
  // the date, ordinal and time findings overlap, so they share one mark
  assert.ok(texts.some((t) => t.includes('10th') && t.includes('9 AM')), 'merged date/time mark. Got: ' + JSON.stringify(texts));
  for (const expected of ['East', 'Rd.', '(480) 312-2321', 'https://www.scottsdaleaz.gov/trash', 'City of Scottsdale', '5', 'ten']) {
    assert.ok(texts.includes(expected), `missing mark for ${expected}. Got: ${JSON.stringify(texts)}`);
  }
  assert.ok(!doc.querySelector('#clean mark'), 'the clean paragraph should have no marks');
});

test('flags inline CSS, style tags, legacy markup and heading case', async () => {
  const { doc } = await load();
  assert.ok(doc.getElementById('p2').classList.contains('ssc-el'), 'style attribute');
  assert.ok(doc.getElementById('d3').classList.contains('ssc-el'), 'element holding the <style> tag');
  assert.ok(doc.querySelector('font').classList.contains('ssc-el'), 'legacy font tag');
  assert.ok(doc.querySelector('h1').classList.contains('ssc-el'), 'title case heading');
  assert.ok(doc.getElementById('p2').classList.contains('ssc-error'));
  assert.ok(doc.querySelector('h1').classList.contains('ssc-review'));
});

test('panel lists the issues and reports counts to the toolbar badge', async () => {
  const { doc, sent } = await load();
  const root = panel(doc);
  const rows = root.querySelectorAll('.row');
  assert.ok(rows.length >= 10, 'rows: ' + rows.length);
  assert.match(root.querySelector('.chip.err').textContent, /\d+ errors/);
  const badge = sent.filter((m) => m.type === 'badge').pop();
  assert.ok(badge && Number(badge.text) > 0);
  assert.strictEqual(badge.state, 'error');
});

test('closing restores the page exactly', async () => {
  const { doc, w } = await load();
  const before = new w.DOMParser().parseFromString(`<main>${MAIN_HTML}</main>`, 'text/html').querySelector('main').innerHTML;
  await w.__ssc.toggle();
  assert.strictEqual(doc.getElementById('ssc-host'), null);
  assert.strictEqual(doc.querySelectorAll('mark.ssc-hl, .ssc-el').length, 0);
  assert.strictEqual(doc.documentElement.hasAttribute('data-ssc-hide-error'), false);
  assert.strictEqual(doc.querySelector('main').innerHTML, before);
  assert.strictEqual(doc.querySelector('.keep').getAttribute('class'), 'keep me');
  assert.strictEqual(doc.getElementById('p2').getAttribute('title'), null);
  assert.strictEqual(doc.querySelector('font').hasAttribute('class'), false, 'empty class attribute should be removed');
});

test('toggling back on and rescanning never nests marks', async () => {
  const { doc, w } = await load();
  await w.__ssc.toggle();
  await w.__ssc.toggle();
  await w.__ssc.rescan();
  await w.__ssc.rescan();
  assert.strictEqual(doc.querySelectorAll('mark mark').length, 0);
  assert.strictEqual(doc.querySelectorAll('#ssc-host').length, 1);
});

test('Ignore removes one item and its highlight', async () => {
  const { doc } = await load();
  const root = panel(doc);
  const before = root.querySelectorAll('.row').length;
  const marksBefore = doc.querySelectorAll('mark.ssc-hl').length;
  root.querySelector('.ign').click();
  assert.strictEqual(root.querySelectorAll('.row').length, before - 1);
  assert.ok(doc.querySelectorAll('mark.ssc-hl').length <= marksBefore);
});

test('clicking a row marks it current and pulses the target', async () => {
  const { doc } = await load();
  const root = panel(doc);
  root.querySelector('.jump').click();
  assert.ok(root.querySelector('.row.current'));
  assert.ok(doc.querySelector('.ssc-active'));
});

test('filter chips hide review items from the list and page', async () => {
  const { doc } = await load();
  const root = panel(doc);
  root.querySelector('.chip.rev').click();
  assert.ok(doc.documentElement.hasAttribute('data-ssc-hide-review'));
  assert.strictEqual(root.querySelectorAll('.row.rev').length, 0);
  assert.ok(root.querySelectorAll('.row.err').length > 0);
});

test('rules set to off are skipped, and ignored phrases are honored', async () => {
  const settings = require('../extension/rules.js').defaultSettings();
  settings.rules['css-style-attr'] = 'off';
  settings.rules['date-ordinal'] = 'off';
  settings.ignoredPhrases = ['City of Scottsdale'];
  const { doc } = await load({ settings });
  assert.ok(!doc.getElementById('p2').classList.contains('ssc-el'));
  const texts = [...doc.querySelectorAll('mark.ssc-hl')].map((m) => m.textContent);
  assert.ok(!texts.includes('10th'));
  assert.ok(!texts.includes('City of Scottsdale'));
});

test('overlapping matches share one mark and list every issue', async () => {
  const { doc } = await load({ main: '<p>Join us Aug. 10th at 9 AM today.</p>' });
  const marks = doc.querySelectorAll('mark.ssc-hl');
  assert.strictEqual(marks.length, 1);
  assert.strictEqual(marks[0].textContent, 'Aug. 10th at 9 AM');
  const rows = panel(doc).querySelectorAll('.row');
  assert.ok(rows.length >= 3, 'rows: ' + rows.length);
  assert.ok(marks[0].getAttribute('title').split('\n').length >= 3, 'tooltip lists every message');
});

test('default skip selectors leave template parts alone', async () => {
  const { doc } = await load({
    main: '<div class="last-updated"><p>Last Updated: Oct 12, 2026</p></div><div class="ev-grid"><p>City of Scottsdale</p></div><p id="body">Oct 12, 2026</p>',
  });
  assert.strictEqual(doc.querySelectorAll('.last-updated mark, .ev-grid mark').length, 0);
  assert.ok(doc.querySelector('#body mark'));
});

test('an ignored phrase matches a long heading in full', async () => {
  const settings = require('../extension/rules.js').defaultSettings();
  const heading = 'FY 2025/26 Consolidated Annual Performance and Evaluation Report (CAPER)';
  settings.ignoredPhrases = [heading];
  const { doc } = await load({ settings, main: `<h2>${heading}</h2>` });
  assert.ok(!doc.querySelector('h2').classList.contains('ssc-el'));
});

test('a missing or invalid scope falls back to the whole page with a note', async () => {
  const settings = require('../extension/rules.js').defaultSettings();
  settings.scopeSelector = '#nope';
  const { doc } = await load({ settings });
  assert.match(panel(doc).querySelector('.note').textContent, /whole page/);
  assert.ok(doc.querySelector('#outside mark'), 'header text should now be checked');

  settings.scopeSelector = '###bad[';
  const second = await load({ settings });
  assert.match(panel(second.doc).querySelector('.note').textContent, /not valid/);
});

test('a clean page shows the empty state and an OK badge', async () => {
  const { doc, sent } = await load({ main: '<p>Visit ScottsdaleAZ.gov and search "trash."</p>' });
  assert.match(panel(doc).querySelector('.empty').textContent, /No issues/);
  assert.strictEqual(sent.filter((m) => m.type === 'badge').pop().text, 'OK');
});

test('page text cannot inject markup into the panel', async () => {
  const { doc } = await load({ main: '<p>Aug. 10th <b>x</b> &lt;img src=x onerror=alert(1)&gt; 12:00 p.m.</p>' });
  assert.strictEqual(panel(doc).querySelectorAll('img').length, 0);
});

test('report text lists the findings', async () => {
  const { doc, w } = await load();
  let copied = '';
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => (copied = t) }, configurable: true });
  const copyBtn = [...panel(doc).querySelectorAll('.foot .btn')].find((b) => b.textContent === 'Copy report');
  copyBtn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(copied, /Scottsdale Style Check/);
  assert.match(copied, /ERRORS/);
  assert.match(copied, /Drop the ordinal/);
});
