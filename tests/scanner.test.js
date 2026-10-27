const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ext = (f) => fs.readFileSync(path.join(__dirname, '..', 'extension', f), 'utf8');
const RULES_JS = ext('rules.js');
const CONTENT_JS = ext('content.js');

const MAIN_HTML = `
  <h2>Water Conservation Program Overview</h2>
  <p id="p1">Join us Aug. 10th at 9 AM, 7447 East Indian School Rd. Call (480) 312-2321.</p>
  <p id="p2" style="color:red">Visit https://www.scottsdaleaz.gov/trash for the City of Scottsdale schedule.</p>
  <div id="d3"><style>p { margin: 0 }</style><p class="keep me">We have 5 cats, 12 dogs and ten birds.</p></div>
  <font color="red">old markup</font>
  <p id="clean">Visit ScottsdaleAZ.gov and search "trash." Open 9-10 a.m.</p>
`;

// Inline CSS rules are off by default. Most tests here turn them on.
const CSS_ON = require('../extension/rules.js').defaultSettings();
for (const id of ['css-style-attr', 'css-style-tag', 'css-link-stylesheet']) CSS_ON.rules[id] = 'error';
CSS_ON.rules['css-legacy-markup'] = 'review';
CSS_ON.allowTitleCaseTopHeadings = false;

async function load(opts = {}) {
  const settings = opts.settings === undefined ? CSS_ON : opts.settings;
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
      sync: { get: async () => ({ settings }) },
      onChanged: { addListener() {} },
    },
    runtime: { sendMessage: (m) => sent.push(m) },
  };
  w.Element.prototype.scrollIntoView = function () {};
  // jsdom has no Custom Highlight API, ResizeObserver or Range geometry.
  w.Highlight = class extends Set {};
  w.CSS = { highlights: new Map() };
  w.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  w.Range.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  w.Range.prototype.getClientRects = () => [];
  w.requestAnimationFrame = (f) => setTimeout(f, 0);
  w.cancelAnimationFrame = clearTimeout;
  w.eval(RULES_JS);
  w.eval(CONTENT_JS);
  await w.__ssc.ready;
  return { dom, w, doc: w.document, sent };
}

const panel = (doc) => doc.getElementById('ssc-host').shadowRoot;
const ranges = (w, sev) => (sev ? [...(w.CSS.highlights.get('ssc-' + sev) || [])] : [...ranges(w, 'error'), ...ranges(w, 'review')]);
const marked = (w) => ranges(w).map((r) => r.toString());
const inside = (w, sel) => ranges(w).filter((r) => r.startContainer.parentElement.closest(sel));
const rowsFor = (w, id) =>
  [...panel(w.document).querySelectorAll('.row')].filter((r) => r.querySelector('.rname').textContent === w.SSC.RULES_BY_ID[id].label);
const untouched = (doc) => !doc.querySelector('mark, [class*="ssc-"], [title]') && ![...doc.documentElement.attributes].some((a) => a.name.startsWith('data-ssc'));

test('highlights text inside main only without changing the page', async () => {
  const { w, doc } = await load();
  const texts = marked(w);
  assert.ok(texts.length >= 8, 'expected several highlights, got ' + texts.length);
  assert.strictEqual(inside(w, 'header, footer').length, 0);
  for (const expected of ['East', 'Rd.', '(480) 312-2321', 'https://www.scottsdaleaz.gov/trash', 'City of Scottsdale', '5', 'ten']) {
    assert.ok(texts.includes(expected), `missing highlight for ${expected}. Got: ${JSON.stringify(texts)}`);
  }
  assert.strictEqual(inside(w, '#clean').length, 0, 'the clean paragraph should have no highlights');
  const before = new w.DOMParser().parseFromString(`<main>${MAIN_HTML}</main>`, 'text/html').querySelector('main').innerHTML;
  assert.strictEqual(doc.querySelector('main').innerHTML, before, 'page markup is unchanged while active');
  assert.ok(untouched(doc));
});

test('flags inline CSS, style tags, legacy markup and heading case', async () => {
  const { w, doc } = await load();
  for (const id of ['css-style-attr', 'css-style-tag', 'css-legacy-markup', 'head-sentence-case']) assert.ok(rowsFor(w, id).length, id);
  assert.ok(rowsFor(w, 'css-style-attr')[0].classList.contains('err'));
  assert.ok(rowsFor(w, 'head-sentence-case')[0].classList.contains('rev'));
  assert.ok(panel(doc).querySelector('.layer .box.err'), 'element outlines are drawn in the shadow root');
  assert.ok(panel(doc).querySelector('.layer .box.rev'));
  assert.ok(untouched(doc));
});

test('inline CSS rules are off by default', async () => {
  const { w } = await load({ settings: null });
  assert.strictEqual(rowsFor(w, 'css-style-attr').length, 0);
  assert.strictEqual(rowsFor(w, 'css-legacy-markup').length, 0);
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
  assert.strictEqual(w.CSS.highlights.size, 0, 'highlights are unregistered');
  assert.strictEqual(doc.querySelector('main').innerHTML, before);
  assert.ok(untouched(doc));
  assert.strictEqual(doc.querySelector('.keep').getAttribute('class'), 'keep me');
});

test('toggling back on and rescanning never duplicates highlights', async () => {
  const { doc, w } = await load();
  const count = ranges(w).length;
  await w.__ssc.toggle();
  await w.__ssc.toggle();
  await w.__ssc.rescan();
  await w.__ssc.rescan();
  assert.strictEqual(ranges(w).length, count);
  assert.strictEqual(doc.querySelectorAll('#ssc-host').length, 1);
});

test('Ignore removes one item and its highlight', async () => {
  const { doc, w } = await load();
  const root = panel(doc);
  const before = root.querySelectorAll('.row').length;
  const rangesBefore = ranges(w).length;
  const boxesBefore = root.querySelectorAll('.box').length;
  root.querySelector('.ign').click();
  assert.strictEqual(root.querySelectorAll('.row').length, before - 1);
  assert.strictEqual(ranges(w).length + root.querySelectorAll('.box').length, rangesBefore + boxesBefore - 1);
});

test('clicking a row marks it current and pulses the target', async () => {
  const { doc } = await load();
  const root = panel(doc);
  root.querySelector('.jump').click();
  assert.ok(root.querySelector('.row.current'));
  assert.ok(root.querySelector('.layer .pulse'));
  assert.ok(untouched(doc));
});

test('filter chips hide review items from the list and page', async () => {
  const { doc, w } = await load();
  const root = panel(doc);
  root.querySelector('.chip.rev').click();
  assert.strictEqual(ranges(w, 'review').length, 0);
  assert.strictEqual(root.querySelectorAll('.box.rev').length, 0);
  assert.strictEqual(root.querySelectorAll('.row.rev').length, 0);
  assert.ok(root.querySelectorAll('.row.err').length > 0);
  assert.ok(ranges(w, 'error').length > 0);
});

test('rules set to off are skipped, and ignored phrases are honored', async () => {
  const settings = require('../extension/rules.js').defaultSettings();
  settings.rules['css-style-attr'] = 'off';
  settings.rules['date-ordinal'] = 'off';
  settings.ignoredPhrases = ['City of Scottsdale'];
  const { w } = await load({ settings });
  assert.strictEqual(rowsFor(w, 'css-style-attr').length, 0);
  const texts = marked(w);
  assert.ok(!texts.includes('10th'));
  assert.ok(!texts.includes('City of Scottsdale'));
});

test('overlapping matches each get a highlight, a row and one tooltip', async () => {
  const { doc, w } = await load({ main: '<p>Join us Aug. 10th at 9 AM today.</p>' });
  assert.ok(ranges(w).length >= 3, 'ranges: ' + ranges(w).length);
  assert.ok(panel(doc).querySelectorAll('.row').length >= 3);
  w.Range.prototype.getClientRects = () => [{ left: 0, top: 0, right: 100, bottom: 100 }];
  doc.querySelector('main p').dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
  const tip = panel(doc).querySelector('.tip');
  assert.ok(!tip.hidden);
  assert.ok(tip.textContent.split('\n').length >= 3, 'tooltip lists every message');
  doc.body.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
  assert.ok(tip.hidden, 'tooltip hides off the highlight');
});

test('default skip selectors leave template parts alone', async () => {
  const { w } = await load({
    main: '<div class="last-updated"><p>Last Updated: Oct 12, 2026</p></div><div class="ev-grid"><p>City of Scottsdale</p></div><p id="body">Oct 12, 2026</p>',
  });
  assert.strictEqual(inside(w, '.last-updated, .ev-grid').length, 0);
  assert.ok(inside(w, '#body').length);
});

test('an ignored phrase matches a long heading in full', async () => {
  const settings = require('../extension/rules.js').defaultSettings();
  const heading = 'FY 2025/26 Consolidated Annual Performance and Evaluation Report (CAPER)';
  settings.ignoredPhrases = [heading];
  settings.allowTitleCaseTopHeadings = false;
  const { w } = await load({ settings, main: `<h2>${heading}</h2>` });
  assert.strictEqual(rowsFor(w, 'head-sentence-case').length, 0);
});

test('a missing or invalid scope falls back to the whole page with a note', async () => {
  const settings = require('../extension/rules.js').defaultSettings();
  settings.scopeSelector = '#nope';
  const { doc, w } = await load({ settings });
  assert.match(panel(doc).querySelector('.note').textContent, /whole page/);
  assert.ok(inside(w, '#outside').length, 'header text should now be checked');

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
  assert.match(copied, /Join us Aug\. 10th at 9 AM, 7447 \[East\] Indian School Rd\./, 'shows the surrounding text with the match in brackets');
  assert.match(copied, /Under "Water Conservation Program Overview"/, 'names the section');
  assert.match(copied, /In a heading/);
});

test('report context trims long text to whole words', async () => {
  const long = 'Residents can drop off items at many sites across the city all year long, including parks, trails, and pools. Staff empty the bins every week in every neighborhood.';
  const { doc, w } = await load({ main: `<h2>Drop-off sites</h2><p>${long}</p>` });
  let copied = '';
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => (copied = t) }, configurable: true });
  [...panel(doc).querySelectorAll('.foot .btn')].find((b) => b.textContent === 'Copy report').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(copied, /^ {3}…[a-z].*parks, trails\[, and \]pools\. .*…$/m);
});
