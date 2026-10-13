const test = require('node:test');
const assert = require('node:assert');
const SSC = require('../extension/rules.js');

const settings = SSC.defaultSettings();
const ctx = (extra) => Object.assign({ settings, year: 2026, inHeading: false }, extra);

function hits(id, text, extra) {
  return SSC.RULES_BY_ID[id].check(text, ctx(extra)).map((h) => text.slice(h.start, h.end));
}

// [rule id, text that should be flagged, expected flagged text, text that should pass]
const cases = [
  ['date-month-abbrev', 'The event is August 10 at the park.', ['August'], ['Aug. 10', 'in August', 'March 5', 'August 2026']],
  ['date-month-spell', 'Join us Mar. 5 or May. 9.', ['Mar.', 'May.'], ['March 5', 'May 9']],
  ['date-month-format', 'See you Sep. 4 and Oct 5 and Sept 6.', ['Sep.', 'Oct', 'Sept'], ['Sept. 4', 'Oct. 5', 'Jan. 1']],
  ['date-ordinal', 'Register by Aug. 10th.', ['10th'], ['Aug. 10', 'the 10th floor']],
  ['date-year', 'Posted Oct. 12, 2026 and Oct. 5, 2027.', ['2026'], ['Oct. 5, 2027', 'Oct. 12']],
  ['date-order', 'Meet Aug. 10 at 9 a.m. or Aug. 11, Wednesday or Aug. 12 at noon.', ['Aug. 10 at 9 a.m', 'Aug. 11, Wednesday', 'Aug. 12 at noon'], ['9 a.m., Tuesday, Aug. 10', 'Tuesday, Aug. 10', 'Aug. 10 with lunch being served at noon']],
  ['time-format', 'Open 9 AM to 5 pm, or 7:30 P.M.', ['9 AM', '5 pm', '7:30 P.M.'], ['9 a.m. to 5 p.m.']],
  ['time-colon-zero', 'Doors open at 9:00 a.m.', ['9:00'], ['9 a.m.', '9:30 a.m.']],
  ['time-noon-midnight', 'Lunch at 12 p.m., or 12 noon, or 12:00 a.m.', ['12 p.m.', '12 noon', '12:00 a.m.'], ['noon', '12:30 p.m.', 'midnight']],
  ['time-repeat', 'Open 9 a.m. - 10 a.m. daily.', ['9 a.m. - 10 a.m.'], ['11 a.m. - 2 p.m.', '9-10 a.m.']],
  ['num-spell-small', 'We have 5 cats.', ['5'], ['Aug. 5', '5 a.m.', 'Room 5', '3.5 million', '5 acres', '10 cats', '5 to 6 p.m.', 'Prop 4', 'Step 3', '5:30', '25 pets']],
  ['num-use-numerals', 'We need twelve people and twenty-five chairs.', ['twelve', 'twenty-five'], ['Twelve people came.', 'We need nine people.']],
  ['addr-direction', 'Visit 7447 East Indian School Road or 123 N Main St.', ['East', 'N'], ['7447 E. Indian School Road']],
  ['addr-street-type-abbrev', 'It is at 3939 N. Drinkwater Boulevard.', ['Boulevard'], ['3939 N. Drinkwater Blvd.', 'a street fair']],
  ['addr-street-type-period', 'Located at 123 Main St and 55 Oak Ave today.', ['St', 'Ave'], ['123 Main St.', '55 Oak Ave.']],
  ['addr-spell-rad', 'Visit 7447 E. Indian School Rd. today.', ['Rd.'], ['7447 E. Indian School Road']],
  ['web-protocol', 'Go to https://example.com/page.', ['https://example.com/page'], ['example.com']],
  ['web-www', 'Go to www.example.com today.', ['www.example.com'], ['ScottsdaleAZ.gov']],
  ['web-direct-url', 'See ScottsdaleAZ.gov/trash for details.', ['ScottsdaleAZ.gov/trash'], ['Visit ScottsdaleAZ.gov and search "trash."']],
  ['web-domain-case', 'Email jane@scottsdaleaz.gov or see scottsdaleaz.gov.', ['scottsdaleaz.gov', 'scottsdaleaz.gov'], ['ScottsdaleAZ.gov', 'jane@ScottsdaleAZ.gov']],
  ['phone-format', 'Call (480) 312-2321 or 480.312.2321 or 480 312 2321.', ['(480) 312-2321', '480.312.2321', '480 312 2321'], ['480-312-2321', '1-800-555-1234']],
  ['wording-city-of-scottsdale', 'The City of Scottsdale offers trash service.', ['City of Scottsdale'], ['Scottsdale offers trash service.']],
  ['wording-double-space', 'One.  Two.', ['.  '], ['One. Two.', 'One.\n   Two.']],
  ['wording-oxford-comma', 'We have parks, trails, and pools.', [', and '], ['We have parks, trails and pools.', 'We went home, and we saw the whole show happen again.']],
  ['title-before-name', 'We thank mayor Jane Smith.', ['mayor'], ['Mayor Jane Smith', 'the mayor said']],
  ['title-after-name', 'Jane Smith, Mayor, spoke.', ['Mayor'], ['Jane Smith, mayor, spoke.']],
  ['title-without-name', 'We asked the Mayor about it.', ['Mayor'], ['Mayor Jane Smith spoke.', 'Mayor said hello.', 'We asked the mayor.', 'Jane Smith, the Mayor']],
];

for (const [id, bad, expected, good] of cases) {
  test(`${id} flags the right text`, () => {
    assert.deepStrictEqual(hits(id, bad), expected);
  });
  for (const g of good) {
    test(`${id} leaves alone: ${JSON.stringify(g)}`, () => {
      const r = hits(id, g);
      // title-without-name: "Jane Smith, the Mayor" is another rule's job
      assert.deepStrictEqual(r, [], `unexpected hits: ${JSON.stringify(r)}`);
    });
  }
}

test('title-without-name is skipped inside headings', () => {
  assert.deepStrictEqual(hits('title-without-name', 'Ask the Mayor', { inHeading: true }), []);
});

test('date-year follows the year passed in', () => {
  assert.deepStrictEqual(hits('date-year', 'Oct. 5, 2027', { year: 2027 }), ['2027']);
});

test('web-domain-case honors a custom domain list', () => {
  const s = SSC.defaultSettings();
  s.allowedDomains = ['MyDept.gov'];
  const out = SSC.RULES_BY_ID['web-domain-case'].check('see mydept.gov', { settings: s, year: 2026 });
  assert.strictEqual(out.length, 1);
});

test('number rule honors custom exception words', () => {
  const s = SSC.defaultSettings();
  s.numberExceptionWords = ['Widget'];
  const rule = SSC.RULES_BY_ID['num-spell-small'];
  assert.strictEqual(rule.check('Widget 4 is here', { settings: s, year: 2026 }).length, 0);
  assert.strictEqual(rule.check('Room 4 is here', { settings: s, year: 2026 }).length, 1);
});

test('every rule has the fields the options page needs', () => {
  const ids = new Set();
  for (const r of SSC.RULES) {
    assert.ok(!ids.has(r.id), 'duplicate id ' + r.id);
    ids.add(r.id);
    assert.ok(SSC.GROUPS.includes(r.group), r.id + ' has an unknown group');
    assert.ok(r.label && r.help && r.example, r.id + ' is missing text');
    assert.ok(['error', 'review'].includes(r.defaultSeverity));
    assert.ok(['text', 'dom'].includes(r.kind));
  }
});

test('mergeSettings keeps defaults for bad input', () => {
  const merged = SSC.mergeSettings({ rules: { 'date-ordinal': 'off', 'date-year': 'nonsense', bogus: 'error' }, titles: 'not an array', scopeSelector: '#x' });
  assert.strictEqual(merged.rules['date-ordinal'], 'off');
  assert.strictEqual(merged.rules['date-year'], 'review');
  assert.ok(!('bogus' in merged.rules));
  assert.ok(Array.isArray(merged.titles));
  assert.strictEqual(merged.scopeSelector, '#x');
});

test('the guide example line passes every date and time rule', () => {
  const line = 'The event is 11 a.m. - 2 p.m., Tuesday, Aug. 10 with lunch being served at noon. Registration is 9-10 a.m.';
  for (const id of ['date-month-abbrev', 'date-month-spell', 'date-month-format', 'date-ordinal', 'date-order', 'time-format', 'time-colon-zero', 'time-noon-midnight', 'time-repeat', 'num-spell-small']) {
    assert.deepStrictEqual(hits(id, line), [], id);
  }
});

// Examples are written "good, not bad". The good half must pass every text rule and the bad half must trip its own rule.
for (const rule of SSC.RULES.filter((r) => r.kind === 'text' && r.example.includes(', not '))) {
  test(`${rule.id} example agrees with the rules`, () => {
    const [good, bad] = rule.example.split(', not ');
    for (const other of SSC.RULES.filter((r) => r.kind === 'text')) {
      assert.deepStrictEqual(hits(other.id, good), [], `"${good}" trips ${other.id}`);
    }
    for (const part of bad.replace(/\s*\(.*\)$/, '').split(' or ')) {
      assert.ok(hits(rule.id, 'Then ' + part).length > 0, `"${part}" does not trip ${rule.id}`);
    }
  });
}
