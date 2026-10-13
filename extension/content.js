/*
 * Scottsdale Style Check: page scanner, highlighter and results panel.
 * Injected by background.js when the toolbar button is clicked.
 * Click the button again to clear everything.
 */
(function () {
  'use strict';

  if (globalThis.__ssc) {
    globalThis.__ssc.toggle();
    return;
  }
  const SSC = globalThis.SSC;
  if (!SSC) return;

  const SKIP_SELECTOR = 'script,style,noscript,textarea,template,svg,select,option,code,pre,kbd,samp,title';
  const HOST_ID = 'ssc-host';

  const S = {
    on: false,
    settings: null,
    scopeLabel: '',
    notes: [],
    targets: new Map(), // element -> { kind: 'mark' | 'el', issues: [], saved }
    issues: [],
    host: null,
    shadow: null,
    ui: {},
    filters: { error: true, review: true },
    minimized: false,
    currentIssue: null,
    activeEl: null,
    activeTimer: 0,
    rescanTimer: 0,
    runToken: 0,
  };

  // ---------- small helpers ----------

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function trunc(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  async function loadSettings() {
    try {
      const r = await chrome.storage.sync.get('settings');
      return SSC.mergeSettings(r.settings);
    } catch (e) {
      return SSC.mergeSettings(null);
    }
  }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch (e) {
      /* extension was reloaded; nothing to do */
    }
  }

  // ---------- scanning ----------

  function findScopes(selector) {
    const sel = (selector || '').trim() || 'main';
    let found = [];
    let invalid = false;
    try {
      found = Array.from(document.querySelectorAll(sel));
    } catch (e) {
      invalid = true;
    }
    if (!found.length) {
      S.notes.push(
        invalid
          ? `The scope selector "${sel}" is not valid, so the whole page was checked.`
          : `Nothing on this page matched "${sel}", so the whole page was checked.`
      );
      return { scopes: [document.body], label: 'whole page' };
    }
    found = found.filter((el) => !found.some((o) => o !== el && o.contains(el)));
    return { scopes: found, label: sel };
  }

  function collectTextNodes(scopes, isIgnored) {
    const nodes = [];
    for (const scope of scopes) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = n.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (p.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
          if (isIgnored(p)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
    }
    return nodes;
  }

  function scan() {
    const st = S.settings;
    const year = new Date().getFullYear();
    S.notes = [];

    const ignoreSel = (st.ignoreSelectors || '').trim();
    let isIgnored = () => false;
    if (ignoreSel) {
      try {
        document.querySelector(ignoreSel);
        isIgnored = (el) => !!(el && el.closest && el.closest(ignoreSel));
      } catch (e) {
        S.notes.push(`The ignore selector "${ignoreSel}" is not valid, so it was skipped.`);
      }
    }

    const { scopes, label } = findScopes(st.scopeSelector);
    S.scopeLabel = label;

    const ignored = new Set((st.ignoredPhrases || []).map((p) => String(p).trim().toLowerCase()).filter(Boolean));
    const issues = [];
    const sev = {};
    for (const r of SSC.RULES) sev[r.id] = SSC.severityOf(st, r);

    // text rules
    const textRules = SSC.RULES.filter((r) => r.kind === 'text' && sev[r.id] !== 'off');
    if (textRules.length) {
      const nodes = collectTextNodes(scopes, isIgnored);
      for (const node of nodes) {
        const text = node.nodeValue;
        const ctx = { settings: st, year, inHeading: !!node.parentElement.closest('h1,h2,h3,h4,h5,h6') };
        for (const rule of textRules) {
          let found;
          try {
            found = rule.check(text, ctx);
          } catch (e) {
            console.warn('Scottsdale Style Check: rule failed', rule.id, e);
            continue;
          }
          for (const f of found) {
            const snippet = text.slice(f.start, f.end);
            if (ignored.has(snippet.trim().toLowerCase())) continue;
            issues.push({
              id: issues.length,
              rule,
              severity: sev[rule.id],
              message: f.message || rule.help,
              snippet,
              node,
              text,
              start: f.start,
              end: f.end,
              el: null,
            });
          }
        }
      }
    }

    // dom rules
    const domRules = SSC.RULES.filter((r) => r.kind === 'dom' && sev[r.id] !== 'off');
    if (domRules.length) {
      const els = (selector) => {
        const set = new Set();
        for (const scope of scopes) {
          if (scope.matches && scope.matches(selector)) set.add(scope);
          scope.querySelectorAll(selector).forEach((e) => set.add(e));
        }
        return Array.from(set).filter((e) => !isIgnored(e));
      };
      const ctx = { settings: st, year, scopes, els };
      for (const rule of domRules) {
        let found;
        try {
          found = rule.check(ctx);
        } catch (e) {
          console.warn('Scottsdale Style Check: rule failed', rule.id, e);
          continue;
        }
        for (const f of found) {
          if (ignored.has(String(f.snippet || '').trim().toLowerCase())) continue;
          if (f.el && ignored.has(f.el.textContent.replace(/\s+/g, ' ').trim().toLowerCase())) continue;
          issues.push({
            id: issues.length,
            rule,
            severity: sev[rule.id],
            message: f.message || rule.help,
            snippet: f.snippet || '',
            node: null,
            el: f.el,
          });
        }
      }
    }
    return issues;
  }

  // ---------- highlighting ----------

  function paint(el) {
    const t = S.targets.get(el);
    if (!t) return;
    const sev = t.issues.some((i) => i.severity === 'error') ? 'error' : 'review';
    if (t.kind === 'el' && !t.saved) t.saved = { title: el.getAttribute('title'), cls: el.getAttribute('class') };
    el.classList.remove('ssc-error', 'ssc-review');
    el.classList.add(t.kind === 'mark' ? 'ssc-hl' : 'ssc-el', 'ssc-' + sev);
    const msgs = Array.from(new Set(t.issues.map((i) => i.message)));
    el.setAttribute('title', msgs.join('\n'));
  }

  function highlight(issues) {
    // text issues: wrap the matched characters in <mark>
    const byNode = new Map();
    const domIssues = [];
    for (const is of issues) {
      if (is.node) {
        if (!byNode.has(is.node)) byNode.set(is.node, []);
        byNode.get(is.node).push(is);
      } else {
        domIssues.push(is);
      }
    }

    for (const [node, list] of byNode) {
      const first = list[0];
      if (!node.isConnected || node.nodeValue !== first.text) continue;
      list.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
      const groups = [];
      for (const is of list) {
        const last = groups[groups.length - 1];
        if (last && is.start < last.end) {
          last.issues.push(is);
          last.end = Math.max(last.end, is.end);
        } else {
          groups.push({ start: is.start, end: is.end, issues: [is] });
        }
      }
      for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i];
        const mid = node.splitText(g.start);
        mid.splitText(g.end - g.start);
        const mark = document.createElement('mark');
        mark.className = 'ssc-hl';
        mid.parentNode.insertBefore(mark, mid);
        mark.appendChild(mid);
        S.targets.set(mark, { kind: 'mark', issues: g.issues });
        g.issues.forEach((is) => (is.el = mark));
        paint(mark);
      }
    }

    // element issues: outline the element
    for (const is of domIssues) {
      if (!is.el || !is.el.isConnected) continue;
      let t = S.targets.get(is.el);
      if (!t) {
        t = { kind: 'el', issues: [], saved: null };
        S.targets.set(is.el, t);
      }
      t.issues.push(is);
      paint(is.el);
    }

    return issues.filter((is) => is.el);
  }

  function releaseTarget(el, t, parents) {
    if (t.kind === 'mark') {
      const p = el.parentNode;
      if (!p) return;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      p.removeChild(el);
      parents.add(p);
    } else {
      el.classList.remove('ssc-el', 'ssc-error', 'ssc-review', 'ssc-active');
      if (t.saved) {
        if (t.saved.title === null) el.removeAttribute('title');
        else el.setAttribute('title', t.saved.title);
        if (t.saved.cls === null && !el.getAttribute('class')) el.removeAttribute('class');
      }
    }
  }

  function clearHighlights() {
    const parents = new Set();
    for (const [el, t] of S.targets) releaseTarget(el, t, parents);
    parents.forEach((p) => {
      try {
        p.normalize();
      } catch (e) {
        /* ignore */
      }
    });
    S.targets.clear();
    S.issues = [];
    S.currentIssue = null;
    S.activeEl = null;
  }

  function sortIssues(list) {
    return list.sort((a, b) => {
      if (a.el === b.el) return a.id - b.id;
      const pos = a.el.compareDocumentPosition(b.el);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function applyFilterAttrs() {
    const root = document.documentElement;
    root.toggleAttribute('data-ssc-hide-error', !S.filters.error);
    root.toggleAttribute('data-ssc-hide-review', !S.filters.review);
  }

  // ---------- panel ----------

  const PANEL_CSS = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
.panel{position:fixed;top:12px;right:12px;bottom:12px;width:380px;max-width:calc(100vw - 24px);display:flex;flex-direction:column;background:#fff;color:#1b1f24;border:1px solid #b8c0cc;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.3);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;z-index:2147483647;overflow:hidden}
.panel.min{bottom:auto;width:auto;min-width:280px}
.panel.min .body,.panel.min .foot,.panel.min .status,.panel.min .notes{display:none}
.head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#17324d;color:#fff}
.head h2{margin:0;font-size:15px;font-weight:600;flex:1}
.btn{font:inherit;font-size:13px;border:1px solid #6b7686;background:#fff;color:#1b1f24;border-radius:6px;padding:5px 10px;cursor:pointer}
.btn:hover{background:#eef2f6}
.head .btn{background:transparent;color:#fff;border-color:#9fb3c8}
.head .btn:hover{background:#27496b}
button:focus-visible{outline:3px solid #2563eb;outline-offset:2px}
.chips{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid #e1e5ea;flex-wrap:wrap}
.chip{border:2px solid;border-radius:999px;padding:3px 12px;background:#fff;font:inherit;font-weight:600;cursor:pointer}
.chip.err{color:#b42318;border-color:#b42318}
.chip.rev{color:#8a4300;border-color:#b54708}
.chip[aria-pressed="false"]{opacity:.55;text-decoration:line-through}
.notes{padding:0 12px}
.note{margin:8px 0 0;padding:6px 8px;background:#fff4e5;border:1px solid #f0c78a;border-radius:6px;font-size:13px}
.scope{margin:8px 12px 0;font-size:12.5px;color:#3b4350}
.body{flex:1;overflow:auto;padding:0 12px 8px}
details{margin-top:8px}
summary{cursor:pointer;font-weight:600;padding:6px 0}
ul{list-style:none;margin:0;padding:0}
.row{display:flex;align-items:flex-start;border:1px solid #d5dae1;border-left-width:6px;border-radius:6px;margin:6px 0;background:#fff}
.row.err{border-left-color:#b42318}
.row.rev{border-left-color:#b54708}
.row.current{outline:3px solid #17324d;outline-offset:1px}
.jump{flex:1;min-width:0;text-align:left;background:none;border:0;padding:8px;font:inherit;color:inherit;cursor:pointer}
.tag{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-right:6px}
.tag.err{color:#b42318}
.tag.rev{color:#8a4300}
.rname{font-weight:600;font-size:13px}
.snip{display:inline-block;max-width:100%;margin-top:4px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;background:#f2f4f7;border-radius:4px;padding:1px 5px;word-break:break-word}
.msg{font-size:13px;color:#3b4350;margin-top:3px}
.ign{margin:8px 8px 0 0;font-size:12px;padding:3px 8px}
.empty{padding:16px 4px;font-weight:600;color:#067647}
.status{padding:6px 12px;font-size:12.5px;color:#3b4350;min-height:2em;border-top:1px solid #e1e5ea}
.foot{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-top:1px solid #e1e5ea;background:#f6f8fa}
`;

  function buildPanel() {
    if (S.host && S.host.isConnected) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-ssc-ui', '');
    const shadow = host.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(PANEL_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      shadow.appendChild(h('style', null, PANEL_CSS));
    }

    const ui = {};
    ui.errChip = h('button', { class: 'chip err', type: 'button', 'aria-pressed': 'true', onclick: () => toggleFilter('error') });
    ui.revChip = h('button', { class: 'chip rev', type: 'button', 'aria-pressed': 'true', onclick: () => toggleFilter('review') });
    ui.minBtn = h('button', { class: 'btn', type: 'button', onclick: toggleMinimize }, 'Hide list');
    ui.closeBtn = h('button', { class: 'btn', type: 'button', onclick: () => deactivate() }, 'Close');
    ui.notes = h('div', { class: 'notes' });
    ui.scope = h('div', { class: 'scope' });
    ui.list = h('div', { class: 'body' });
    ui.status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    ui.panel = h(
      'section',
      { class: 'panel', role: 'region', 'aria-label': 'Scottsdale style check results' },
      h('div', { class: 'head' }, h('h2', null, 'Style check'), ui.minBtn, ui.closeBtn),
      h('div', { class: 'chips' }, ui.errChip, ui.revChip),
      ui.notes,
      ui.scope,
      ui.list,
      ui.status,
      h(
        'div',
        { class: 'foot' },
        h('button', { class: 'btn', type: 'button', onclick: () => step(-1) }, 'Previous'),
        h('button', { class: 'btn', type: 'button', onclick: () => step(1) }, 'Next'),
        h('button', { class: 'btn', type: 'button', onclick: () => run() }, 'Rescan'),
        h('button', { class: 'btn', type: 'button', onclick: copyReport }, 'Copy report'),
        h('button', { class: 'btn', type: 'button', onclick: () => send({ type: 'open-options' }) }, 'Settings')
      )
    );
    shadow.appendChild(ui.panel);
    document.documentElement.appendChild(host);
    S.host = host;
    S.shadow = shadow;
    S.ui = ui;
  }

  function setStatus(msg) {
    if (S.ui.status) S.ui.status.textContent = msg || '';
  }

  function visibleIssues() {
    return S.issues.filter((i) => S.filters[i.severity]);
  }

  function counts() {
    const errors = S.issues.filter((i) => i.severity === 'error').length;
    return { errors, review: S.issues.length - errors };
  }

  function toggleFilter(sev) {
    S.filters[sev] = !S.filters[sev];
    applyFilterAttrs();
    render();
  }

  function toggleMinimize() {
    S.minimized = !S.minimized;
    S.ui.panel.classList.toggle('min', S.minimized);
    S.ui.minBtn.textContent = S.minimized ? 'Show list' : 'Hide list';
  }

  function render() {
    const ui = S.ui;
    if (!ui.panel) return;
    const c = counts();
    ui.errChip.textContent = `${c.errors} ${c.errors === 1 ? 'error' : 'errors'}`;
    ui.revChip.textContent = `${c.review} to review`;
    ui.errChip.setAttribute('aria-pressed', String(S.filters.error));
    ui.revChip.setAttribute('aria-pressed', String(S.filters.review));
    ui.notes.replaceChildren(...S.notes.map((n) => h('p', { class: 'note' }, n)));
    ui.scope.textContent = `Checked: ${S.scopeLabel}`;

    const kids = [];
    for (const group of SSC.GROUPS) {
      const items = S.issues.filter((i) => i.rule.group === group && S.filters[i.severity]);
      if (!items.length) continue;
      kids.push(
        h(
          'details',
          { open: true },
          h('summary', null, `${group} (${items.length})`),
          h('ul', null, ...items.map(buildRow))
        )
      );
    }
    if (!kids.length) {
      kids.push(
        h(
          'p',
          { class: 'empty' },
          S.issues.length ? 'Everything in view is hidden by the filters above.' : 'No issues found.'
        )
      );
    }
    ui.list.replaceChildren(...kids);
    markCurrentRow();
  }

  function buildRow(issue) {
    const sev = issue.severity === 'error' ? 'err' : 'rev';
    const li = h(
      'li',
      { class: `row ${sev}` },
      h(
        'button',
        { class: 'jump', type: 'button', onclick: () => jump(issue) },
        h('span', { class: `tag ${sev}` }, issue.severity === 'error' ? 'Error' : 'Review'),
        h('span', { class: 'rname' }, issue.rule.label),
        h('br'),
        h('span', { class: 'snip' }, trunc(issue.snippet, 80)),
        h('div', { class: 'msg' }, issue.message)
      ),
      h(
        'button',
        {
          class: 'btn ign',
          type: 'button',
          'aria-label': `Ignore this item: ${trunc(issue.snippet, 40)}`,
          title: 'Ignore this item until the next scan',
          onclick: () => dismiss(issue),
        },
        'Ignore'
      )
    );
    issue.row = li;
    return li;
  }

  function markCurrentRow() {
    for (const i of S.issues) {
      if (i.row) i.row.classList.toggle('current', i === S.currentIssue);
    }
  }

  function pulse(el) {
    if (S.activeEl) S.activeEl.classList.remove('ssc-active');
    el.classList.add('ssc-active');
    S.activeEl = el;
    clearTimeout(S.activeTimer);
    S.activeTimer = setTimeout(() => el.classList.remove('ssc-active'), 2600);
  }

  function jump(issue) {
    const el = issue.el;
    if (!el || !el.isConnected) {
      setStatus('That item is no longer on the page. Try Rescan.');
      return;
    }
    S.currentIssue = issue;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p.tagName === 'DETAILS' && !p.open) p.open = true;
    }
    const hidden = el.getClientRects().length === 0;
    try {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    } catch (e) {
      /* ignore */
    }
    pulse(el);
    const list = visibleIssues();
    setStatus(
      hidden
        ? 'This item is hidden on the page, maybe inside a collapsed accordion or tab. Open it to see the highlight.'
        : `Item ${list.indexOf(issue) + 1} of ${list.length}`
    );
    markCurrentRow();
    if (issue.row && issue.row.scrollIntoView) {
      try {
        issue.row.scrollIntoView({ block: 'nearest' });
      } catch (e) {
        /* ignore */
      }
    }
  }

  function step(dir) {
    const list = visibleIssues();
    if (!list.length) {
      setStatus('Nothing to step through.');
      return;
    }
    let i = list.indexOf(S.currentIssue);
    i = i === -1 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    jump(list[i]);
  }

  function dismiss(issue) {
    const t = S.targets.get(issue.el);
    S.issues = S.issues.filter((i) => i !== issue);
    if (S.currentIssue === issue) S.currentIssue = null;
    if (t) {
      t.issues = t.issues.filter((i) => i !== issue);
      if (t.issues.length) {
        paint(issue.el);
      } else {
        const parents = new Set();
        releaseTarget(issue.el, t, parents);
        parents.forEach((p) => p.normalize());
        S.targets.delete(issue.el);
      }
    }
    render();
    updateBadge();
    setStatus('Ignored until the next scan. To ignore it for good, add the text under "Ignored phrases" in settings.');
  }

  function contextOf(issue) {
    if (!issue.text) return `[${trunc(issue.snippet, 100)}]`;
    const { text, start, end } = issue;
    const R = 60;
    let a = Math.max(0, start - R);
    let b = Math.min(text.length, end + R);
    if (a > 0) {
      const sp = text.indexOf(' ', a);
      if (sp !== -1 && sp < start) a = sp + 1;
    }
    if (b < text.length) {
      const sp = text.lastIndexOf(' ', b);
      if (sp > end) b = sp;
    }
    const s = text.slice(a, start) + '[' + text.slice(start, end) + ']' + text.slice(end, b);
    return ((a > 0 ? '…' : '') + s + (b < text.length ? '…' : '')).replace(/\s+/g, ' ').trim();
  }

  function sectionOf(issue, headings) {
    const el = issue.el;
    const own = el.closest('h1,h2,h3,h4,h5,h6');
    if (own || /^H[1-6]$/.test(el.tagName)) return 'In a heading';
    let last = null;
    for (const hd of headings) {
      if (hd.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) last = hd;
      else break;
    }
    const name = last && trunc(last.textContent, 100);
    return name ? `Under "${name}"` : 'Near the top of the page';
  }

  function reportText() {
    const c = counts();
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const lines = [
      'Scottsdale Style Check',
      document.title || '(no title)',
      location.href,
      `Checked ${S.scopeLabel} on ${new Date().toLocaleString()}. Found ${c.errors} ${c.errors === 1 ? 'error' : 'errors'} and ${c.review} to review.`,
      'Text in [brackets] is the part to fix.',
    ];
    let n = 0;
    for (const sev of ['error', 'review']) {
      const items = S.issues.filter((i) => i.severity === sev);
      if (!items.length) continue;
      lines.push('', sev === 'error' ? 'ERRORS' : 'TO REVIEW');
      for (const i of items) {
        lines.push('', `${++n}. ${i.rule.label}`, `   ${sectionOf(i, headings)}`, `   ${contextOf(i)}`, `   ${i.message}`);
      }
    }
    return lines.join('\n');
  }

  async function copyReport() {
    const text = reportText();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      const ta = h('textarea', { style: 'position:fixed;top:0;left:0;opacity:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch (e2) {
        ok = false;
      }
      ta.remove();
    }
    setStatus(ok ? 'Report copied. Paste it into an email or chat.' : 'Could not copy. Your browser blocked clipboard access.');
  }

  function updateBadge() {
    const c = counts();
    const total = c.errors + c.review;
    send({
      type: 'badge',
      text: total === 0 ? 'OK' : total > 99 ? '99+' : String(total),
      state: c.errors ? 'error' : c.review ? 'review' : 'ok',
    });
  }

  // ---------- lifecycle ----------

  async function run() {
    const token = ++S.runToken;
    clearHighlights();
    S.settings = await loadSettings();
    if (token !== S.runToken || !S.on) return;
    const issues = scan();
    const marked = highlight(issues);
    S.issues = sortIssues(marked);
    applyFilterAttrs();
    buildPanel();
    render();
    updateBadge();
    setStatus(S.issues.length ? 'Select an item to jump to it on the page.' : '');
  }

  function activate() {
    S.on = true;
    return run();
  }

  function deactivate() {
    S.on = false;
    S.runToken++;
    clearTimeout(S.activeTimer);
    clearHighlights();
    if (S.host) S.host.remove();
    S.host = null;
    S.shadow = null;
    S.ui = {};
    document.documentElement.removeAttribute('data-ssc-hide-error');
    document.documentElement.removeAttribute('data-ssc-hide-review');
    send({ type: 'badge', text: '', state: 'ok' });
    return Promise.resolve();
  }

  function toggle() {
    return S.on ? deactivate() : activate();
  }

  try {
    chrome.storage.onChanged.addListener((changes) => {
      if (S.on && changes.settings) {
        clearTimeout(S.rescanTimer);
        S.rescanTimer = setTimeout(run, 300);
      }
    });
  } catch (e) {
    /* storage events are optional */
  }

  globalThis.__ssc = {
    toggle,
    rescan: run,
    get active() {
      return S.on;
    },
    ready: null,
  };
  globalThis.__ssc.ready = activate();
})();
