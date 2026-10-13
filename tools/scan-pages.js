// Runs the scanner on live pages and writes every finding with its context to scan-results/.
// Usage: node tools/scan-pages.js urls.txt
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const EXT = path.join(__dirname, '..', 'extension');
const OUT = path.join(__dirname, '..', 'scan-results');

// Records what each rule returns, with the full text node or element text as context.
const SHIM = `(() => {
  globalThis.__sscLog = [];
  const label = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
    [...e.classList].slice(0, 2).map((c) => '.' + c).join('') +
    (e.getAttribute('data-sfname') ? '[data-sfname="' + e.getAttribute('data-sfname') + '"]' : '');
  const where = (el) => {
    const out = [];
    for (let p = el; p && p.tagName !== 'MAIN' && p !== document.body; p = p.parentElement) out.unshift(label(p));
    return out.slice(0, 4).join(' > ');
  };
  const nodeFor = (text) => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (n.nodeValue === text) return n.parentElement;
    return null;
  };
  for (const r of SSC.RULES) {
    const orig = r.check;
    r.check = function (a, ctx) {
      const found = orig.call(this, a, ctx);
      for (const f of found) {
        const el = r.kind === 'text' ? nodeFor(a) : f.el;
        globalThis.__sscLog.push(r.kind === 'text'
          ? { rule: r.id, match: a.slice(f.start, f.end), context: a.slice(Math.max(0, f.start - 120), f.end + 120).replace(/\\s+/g, ' ').trim(), where: el ? where(el) : '' }
          : { rule: r.id, match: f.snippet, context: (f.el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300), where: where(f.el) });
      }
      return found;
    };
  }
})();`;

(async () => {
  const urls = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1400, height: 900 } });
  const all = [];
  for (const url of urls) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(2500);
      await page.addScriptTag({ path: path.join(EXT, 'rules.js') });
      await page.addScriptTag({ content: SHIM });
      await page.addScriptTag({ path: path.join(EXT, 'content.js') });
      await page.waitForFunction(() => globalThis.__ssc && document.getElementById('ssc-host'), null, { timeout: 15000 });
      const data = await page.evaluate(() => ({
        log: globalThis.__sscLog,
        notes: [...document.getElementById('ssc-host').shadowRoot.querySelectorAll('.note')].map((n) => n.textContent),
        mains: document.querySelectorAll('main').length,
      }));
      for (const f of data.log) all.push({ url, ...f });
      console.log(`${data.log.length}\t${data.mains} main\t${url}${data.notes.length ? '\t' + data.notes.join(' ') : ''}`);
    } catch (e) {
      console.log(`ERROR\t${url}\t${e.message.split('\n')[0]}`);
    }
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify(all, null, 1));
  const counts = {};
  for (const f of all) counts[f.rule] = (counts[f.rule] || 0) + 1;
  console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n}\t${r}`).join('\n'));
})();
