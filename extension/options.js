(function () {
  'use strict';
  const SSC = globalThis.SSC;
  const $ = (sel) => document.querySelector(sel);

  const TEXT_FIELDS = ['scopeSelector', 'ignoreSelectors'];
  const LIST_FIELDS = ['ignoredPhrases', 'allowedDomains', 'titles', 'properNouns', 'numberExceptionWords'];
  const BOOL_FIELDS = ['allowTitleCaseTopHeadings'];

  let settings = SSC.defaultSettings();
  let saveTimer = 0;
  let statusTimer = 0;

  function status(msg, bad) {
    const el = $('#saved');
    el.textContent = msg;
    el.className = bad ? 'bad' : '';
    clearTimeout(statusTimer);
    if (msg) statusTimer = setTimeout(() => (el.textContent = ''), 3000);
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await chrome.storage.sync.set({ settings });
        status('Saved');
      } catch (e) {
        status('Could not save: ' + e.message, true);
      }
    }, 300);
  }

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const kid of kids) node.append(kid.nodeType ? kid : document.createTextNode(kid));
    return node;
  }

  function buildRules() {
    const root = $('#rules');
    root.replaceChildren();
    for (const group of SSC.GROUPS) {
      const rules = SSC.RULES.filter((r) => r.group === group);
      if (!rules.length) continue;
      root.append(el('h3', null, group));
      for (const rule of rules) {
        const name = 'rule-' + rule.id;
        const seg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': rule.label });
        for (const [value, text, cls] of [['error', 'Error', 'e'], ['review', 'Review', 'r'], ['off', 'Off', 'o']]) {
          const input = el('input', { type: 'radio', name, value });
          input.addEventListener('change', () => {
            settings.rules[rule.id] = value;
            save();
          });
          seg.append(el('label', null, input, el('span', { class: cls }, text)));
        }
        root.append(
          el(
            'div',
            { class: 'rule' },
            el(
              'div',
              { class: 'rtext' },
              el('strong', null, rule.label),
              el('span', { class: 'help' }, rule.help),
              el('span', { class: 'ex' }, 'Example: ', el('code', null, rule.example))
            ),
            seg
          )
        );
      }
    }
  }

  function fill() {
    for (const rule of SSC.RULES) {
      const value = SSC.severityOf(settings, rule);
      const input = document.querySelector(`input[name="rule-${rule.id}"][value="${value}"]`);
      if (input) input.checked = true;
    }
    for (const f of TEXT_FIELDS) $('#' + f).value = settings[f] || '';
    for (const f of LIST_FIELDS) $('#' + f).value = (settings[f] || []).join('\n');
    for (const f of BOOL_FIELDS) $('#' + f).checked = !!settings[f];
  }

  function wireFields() {
    for (const f of TEXT_FIELDS) {
      $('#' + f).addEventListener('input', (e) => {
        settings[f] = e.target.value;
        save();
      });
    }
    for (const f of LIST_FIELDS) {
      $('#' + f).addEventListener('input', (e) => {
        settings[f] = e.target.value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        save();
      });
    }
    for (const f of BOOL_FIELDS) {
      $('#' + f).addEventListener('change', (e) => {
        settings[f] = e.target.checked;
        save();
      });
    }
  }

  function wireButtons() {
    $('#export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'scottsdale-style-check-settings.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    $('#import').addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('That file is not a settings file.');
        settings = SSC.mergeSettings(parsed);
        fill();
        await chrome.storage.sync.set({ settings });
        status('Imported and saved');
      } catch (err) {
        status('Could not import: ' + err.message, true);
      }
    });

    $('#reset').addEventListener('click', async () => {
      if (!confirm('Reset every rule and list to the defaults? This cannot be undone.')) return;
      settings = SSC.defaultSettings();
      fill();
      try {
        await chrome.storage.sync.set({ settings });
        status('Reset to defaults');
      } catch (e) {
        status('Could not save: ' + e.message, true);
      }
    });
  }

  async function init() {
    // Shown inside the results panel's settings modal.
    if (new URLSearchParams(location.search).has('embedded') && window.parent !== window) {
      document.documentElement.classList.add('embedded');
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.parent.postMessage('ssc-close-settings', '*');
      });
    }
    buildRules();
    wireFields();
    wireButtons();
    try {
      const r = await chrome.storage.sync.get('settings');
      settings = SSC.mergeSettings(r.settings);
    } catch (e) {
      settings = SSC.defaultSettings();
    }
    fill();
  }

  init();
})();
