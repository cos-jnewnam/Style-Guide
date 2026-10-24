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
    issues: [],
    boxes: [], // { el, div } outlines for element issues
    pulse: null, // { target, div }
    hl: null, // { error, review } Highlight objects
    stopTracking: null,
    host: null,
    shadow: null,
    ui: {},
    filters: { error: true, review: true },
    minimized: false,
    currentIssue: null,
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
            const range = document.createRange();
            range.setStart(node, f.start);
            range.setEnd(node, f.end);
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
              range,
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
            range: null,
            el: f.el,
          });
        }
      }
    }
    return issues;
  }

  // ---------- highlighting ----------
  // Never edits the page DOM: text uses CSS highlights, everything else is drawn in the shadow root.

  const HL_NAMES = { error: 'ssc-error', review: 'ssc-review' };

  function anchorEl(issue) {
    return issue.el || issue.node.parentElement;
  }

  function targetOf(issue) {
    return issue.range || issue.el;
  }

  function isLive(issue) {
    return issue.node ? issue.node.isConnected && issue.node.nodeValue === issue.text : !!(issue.el && issue.el.isConnected);
  }

  function ensureHighlights() {
    if (S.hl) return;
    S.hl = { error: new Highlight(), review: new Highlight() };
    S.hl.error.priority = 1;
    for (const sev of Object.keys(HL_NAMES)) CSS.highlights.set(HL_NAMES[sev], S.hl[sev]);
  }

  function removeHighlights() {
    if (!S.hl) return;
    for (const name of Object.values(HL_NAMES)) CSS.highlights.delete(name);
    S.hl = null;
  }

  function draw() {
    ensureHighlights();
    S.hl.error.clear();
    S.hl.review.clear();
    const byEl = new Map();
    for (const is of S.issues) {
      if (!S.filters[is.severity]) continue;
      if (is.range) {
        S.hl[is.severity].add(is.range);
      } else {
        if (!byEl.has(is.el)) byEl.set(is.el, []);
        byEl.get(is.el).push(is);
      }
    }
    S.boxes = Array.from(byEl, ([el, list]) => ({
      el,
      div: h('div', { class: 'box ' + (list.some((i) => i.severity === 'error') ? 'err' : 'rev') }),
    }));
    S.ui.boxes.replaceChildren(...S.boxes.map((b) => b.div));
    layout();
  }

  function place(div, target, pad) {
    const r = target.getBoundingClientRect();
    div.hidden = !r.width && !r.height;
    if (div.hidden) return;
    div.style.left = r.left - pad + 'px';
    div.style.top = r.top - pad + 'px';
    div.style.width = r.width + pad * 2 + 'px';
    div.style.height = r.height + pad * 2 + 'px';
  }

  function layout() {
    for (const b of S.boxes) place(b.div, b.el, 0);
    if (S.pulse) place(S.pulse.div, S.pulse.target, 4);
  }

  function showTip(e) {
    const tip = S.ui.tip;
    if (!tip) return;
    const t = e.target;
    const msgs = new Set();
    if (t && t.nodeType === 1 && t !== S.host) {
      const hit = (r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      for (const is of S.issues) {
        if (!S.filters[is.severity]) continue;
        const over = is.range
          ? is.node.parentElement === t && Array.from(is.range.getClientRects()).some(hit)
          : is.el.contains(t) && hit(is.el.getBoundingClientRect());
        if (over) msgs.add(is.message);
      }
    }
    tip.hidden = !msgs.size;
    if (tip.hidden) return;
    tip.textContent = Array.from(msgs).join('\n');
    const below = e.clientY + 18;
    const top = below + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : below;
    tip.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  function startTracking() {
    if (S.stopTracking) return;
    let frame = 0;
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          layout();
        });
      }
    };
    // Catches layout shifts such as an accordion opening above a boxed element.
    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('mousemove', showTip, { capture: true, passive: true });
    S.stopTracking = () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      document.removeEventListener('mousemove', showTip, { capture: true });
    };
  }

  function stopTracking() {
    if (S.stopTracking) S.stopTracking();
    S.stopTracking = null;
  }

  function clearHighlights() {
    if (S.hl) {
      S.hl.error.clear();
      S.hl.review.clear();
    }
    S.boxes = [];
    if (S.ui.boxes) S.ui.boxes.replaceChildren();
    if (S.ui.tip) S.ui.tip.hidden = true;
    if (S.pulse) S.pulse.div.remove();
    S.pulse = null;
    S.issues = [];
    S.currentIssue = null;
  }

  function sortIssues(list) {
    return list.sort((a, b) => {
      const x = a.node || a.el;
      const y = b.node || b.el;
      if (x === y) return (a.start || 0) - (b.start || 0) || a.id - b.id;
      return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
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
.settings{width:min(900px,calc(100vw - 32px));height:min(900px,calc(100vh - 48px));max-width:none;max-height:none;padding:0;border:1px solid #b8c0cc;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);overflow:hidden;background:#f4f6f8;color:#1b1f24;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.settings[open]{display:flex;flex-direction:column}
.settings::backdrop{background:rgba(0,0,0,.45)}
.settings iframe{flex:1;width:100%;border:0;display:block}
.layer{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:2147483646}
.box{position:absolute;outline:4px solid #b42318;outline-offset:2px;border-radius:2px}
.box.rev{outline:4px dashed #b54708}
.pulse{position:absolute;border-radius:4px;animation:ssc-pulse .9s ease-in-out 3}
@keyframes ssc-pulse{0%,100%{box-shadow:0 0 0 0 rgba(23,50,77,0)}50%{box-shadow:0 0 0 8px rgba(23,50,77,.55)}}
@media (prefers-reduced-motion:reduce){.pulse{animation:none;box-shadow:0 0 0 6px rgba(23,50,77,.55)}}
.tip{position:fixed;max-width:340px;padding:6px 9px;background:#1b1f24;color:#fff;border-radius:6px;font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;white-space:pre-line;box-shadow:0 4px 14px rgba(0,0,0,.3)}
.tip[hidden],.box[hidden],.pulse[hidden]{display:none}
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
    ui.boxes = h('div');
    ui.tip = h('div', { class: 'tip', hidden: true });
    ui.layer = h('div', { class: 'layer', 'aria-hidden': 'true' }, ui.boxes, ui.tip);
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
        h('button', { class: 'btn', type: 'button', onclick: openSettings }, 'Settings')
      )
    );
    shadow.append(ui.layer, ui.panel);
    document.documentElement.appendChild(host);
    S.host = host;
    S.shadow = shadow;
    S.ui = ui;
  }

  function setStatus(msg) {
    if (S.ui.status) S.ui.status.textContent = msg || '';
  }

  function openSettings() {
    if (!S.shadow || (S.ui.dialog && S.ui.dialog.open)) return;
    const frame = h('iframe', {
      title: 'Style check settings',
      src: chrome.runtime.getURL('options.html?embedded=1'),
    });
    const dlg = h(
      'dialog',
      {
        class: 'settings',
        'aria-label': 'Style check settings',
        onclose: () => {
          dlg.remove();
          S.ui.dialog = null;
          S.ui.frame = null;
        },
        onclick: (e) => {
          if (e.target === dlg) dlg.close();
        },
      },
      h(
        'div',
        { class: 'head' },
        h('h2', null, 'Settings'),
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Done')
      ),
      frame
    );
    S.shadow.appendChild(dlg);
    S.ui.dialog = dlg;
    S.ui.frame = frame;
    dlg.showModal();
  }

  function closeSettings() {
    if (S.ui.dialog && S.ui.dialog.open) S.ui.dialog.close();
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
    draw();
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

  function pulse(issue) {
    if (S.pulse) S.pulse.div.remove();
    const p = { target: targetOf(issue), div: h('div', { class: 'pulse' }) };
    S.pulse = p;
    S.ui.layer.appendChild(p.div);
    place(p.div, p.target, 4);
    clearTimeout(S.activeTimer);
    S.activeTimer = setTimeout(() => {
      p.div.remove();
      if (S.pulse === p) S.pulse = null;
    }, 2600);
  }

  function jump(issue) {
    if (!isLive(issue)) {
      setStatus('That item is no longer on the page. Try Rescan.');
      return;
    }
    const el = anchorEl(issue);
    S.currentIssue = issue;
    for (let p = el; p; p = p.parentElement) {
      if (p.tagName === 'DETAILS' && !p.open) p.open = true;
    }
    const hidden = targetOf(issue).getClientRects().length === 0;
    try {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    } catch (e) {
      /* ignore */
    }
    pulse(issue);
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
    S.issues = S.issues.filter((i) => i !== issue);
    if (S.currentIssue === issue) S.currentIssue = null;
    draw();
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
    const el = anchorEl(issue);
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
    buildPanel();
    S.issues = sortIssues(issues.filter(isLive));
    draw();
    startTracking();
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
    stopTracking();
    clearHighlights();
    removeHighlights();
    if (S.host) S.host.remove();
    S.host = null;
    S.shadow = null;
    S.ui = {};
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

  // Escape inside the settings iframe never reaches the dialog, so the options page posts this instead.
  window.addEventListener('message', (e) => {
    if (e.data === 'ssc-close-settings' && S.ui.frame && e.source === S.ui.frame.contentWindow) closeSettings();
  });

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
