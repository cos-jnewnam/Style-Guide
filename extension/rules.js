/*
 * Scottsdale Style Check: rules and default settings.
 *
 * This file is loaded three ways: as a content script on the page being
 * checked, on the options page, and by the Node tests. It has no DOM
 * dependency except inside the "dom" rules, which receive helpers from
 * the caller.
 *
 * Text rules:  check(text, ctx) returns [{ start, end, message }]
 * DOM rules:   check(ctx) returns [{ el, message, snippet }]
 * ctx has: settings, year, and for text rules inHeading.
 * DOM rule ctx also has: scopes, els(selector).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SSC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const GROUPS = [
    'Dates',
    'Times',
    'Numbers',
    'Addresses',
    'Website',
    'Phone numbers',
    'Wording',
    'Headlines and titles',
    'Inline CSS',
  ];

  // ---------- helpers ----------

  const MONTH =
    '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

  function esc(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function matches(re, text) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    const out = [];
    let m;
    while ((m = g.exec(text)) !== null) {
      if (m[0].length === 0) {
        g.lastIndex++;
        continue;
      }
      out.push(m);
    }
    return out;
  }

  function trunc(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
  }

  function trimTrailingPunct(str) {
    return str.replace(/[.,;:!?]+$/, '');
  }

  function alternation(list) {
    return list
      .filter(Boolean)
      .slice()
      .sort((a, b) => b.length - a.length)
      .map(esc)
      .join('|');
  }

  const ABBR = {
    January: 'Jan.',
    February: 'Feb.',
    August: 'Aug.',
    September: 'Sept.',
    October: 'Oct.',
    November: 'Nov.',
    December: 'Dec.',
  };
  const FULL = { Mar: 'March', Apr: 'April', Jun: 'June', Jul: 'July', May: 'May' };
  const PROPER_ABBR = {
    Jan: 'Jan.',
    Feb: 'Feb.',
    Aug: 'Aug.',
    Sep: 'Sept.',
    Sept: 'Sept.',
    Oct: 'Oct.',
    Nov: 'Nov.',
    Dec: 'Dec.',
  };

  const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const UNITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  const TEENS = {
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
    fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

  function spelledToNumber(s) {
    const w = s.toLowerCase().split(/[-\s]+/);
    if (TEENS[w[0]]) return TEENS[w[0]];
    if (TENS[w[0]]) return TENS[w[0]] + (w[1] ? UNITS[w[1]] || 0 : 0);
    return null;
  }

  // Words that, when they come right before a single digit, mean the digit is a label
  // or identifier rather than a quantity ("Room 5", "Prop 4", "Aug. 5").
  const BEFORE_WORDS = new Set([
    'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june',
    'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov',
    'november', 'dec', 'december',
  ]);

  const AFTER_OK = new RegExp(
    '^\\s*(?:%|percent\\b|a\\.m\\.|p\\.m\\.|[ap]\\.?m\\b|\u00b0|degrees?\\b|cents?\\b|mph\\b|years?[- ]old\\b|yrs?\\b|acres?\\b|sq\\b|square\\b|(?:ft|feet|foot|inch|inches|lbs?|pounds?|oz|ounces?|miles?|mi|km|kg|cm|mm|gallons?|gal)\\b)',
    'i'
  );
  const RANGE_TIME = /^\s*(?:-|\u2013|to|and)\s*\d{1,2}(?::\d{2})?\s*(?:a\.m\.|p\.m\.)/i;

  // Address pieces. An address starts with a number of two or more digits.
  const ADDR_PRE =
    "\\b\\d{2,6}\\s+(?:(?:[NSEW]\\.?|North|South|East|West)\\s+)?(?:[A-Z0-9][\\w'\u2019.-]*\\s+){0,3}?";

  // ---------- default lists ----------

  const DEFAULT_TITLES = [
    'Vice Mayor', 'Mayor', 'Councilmember', 'Council Member', 'Councilwoman', 'Councilman',
    'Deputy City Manager', 'Assistant City Manager', 'City Manager', 'City Attorney',
    'City Clerk', 'City Treasurer', 'City Auditor', 'Police Chief', 'Fire Chief', 'Chief',
    'Director', 'Commissioner', 'Vice Chair', 'Chair', 'Chairman', 'Chairwoman', 'Judge',
    'Captain', 'Lieutenant', 'Sergeant', 'Governor', 'Senator', 'Representative',
    'Superintendent',
  ];

  const DEFAULT_PROPER_NOUNS = [
    'Scottsdale', 'Arizona', 'Phoenix', 'Tempe', 'Mesa', 'Maricopa', 'Paradise Valley',
    'Fountain Hills', 'Salt River', 'Pima', 'McDowell', 'Sonoran', 'Preserve', 'Old Town',
    'Civic Center', 'WestWorld', 'Taliesin', 'Camelback', 'Pinnacle Peak', 'Granite Reef',
    'Indian School', 'Indian Bend', 'Drinkwater', 'Library', 'Airport', 'City Council',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December', 'American', 'English', 'Spanish', 'Hispanic',
    'Black', 'Native', 'Veterans', 'Memorial', 'Independence', 'Thanksgiving', 'Christmas',
  ];

  const DEFAULT_NUMBER_EXCEPTIONS = [
    'Room', 'Suite', 'Ste', 'Page', 'Pg', 'Section', 'Sec', 'Step', 'Phase', 'Level', 'Highway',
    'Hwy', 'Route', 'Rt', 'Exit', 'District', 'Ward', 'Rule', 'Figure', 'Fig', 'Table', 'Item',
    'Part', 'Grade', 'Prop', 'Proposition', 'Question', 'Gate', 'Lane', 'Unit', 'Bldg',
    'Building', 'Terminal', 'No', 'Number', 'Ch', 'Chapter', 'Vol', 'Volume', 'Line', 'Track',
    'Channel', 'Zone', 'Class', 'Form', 'Tier', 'Bay', 'Apt', 'Apartment', 'Hole', 'Lot',
    'Dock', 'Court', 'Platform', 'Option', 'Plan', 'Area', 'Stage', 'Type', 'Group', 'Team',
    'Day', 'Week', 'Q', 'Quarter', 'Version', 'Ver', 'V', 'Rev', 'Series',
  ];

  // ---------- rules ----------

  const RULES = [
    // ===== Dates =====
    {
      id: 'date-month-abbrev',
      group: 'Dates',
      label: 'Abbreviate long months before a date',
      help: 'Abbreviate Jan., Feb., Aug., Sept., Oct., Nov. and Dec. when a day number follows.',
      example: 'Aug. 10, not August 10',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        return matches(/\b(January|February|August|September|October|November|December)(?=\s+\d{1,2}(?!\d))/, text).map((m) => ({
          start: m.index,
          end: m.index + m[1].length,
          message: `Abbreviate to "${ABBR[m[1]]}" when a date follows.`,
        }));
      },
    },
    {
      id: 'date-month-spell',
      group: 'Dates',
      label: 'Spell out short months',
      help: 'March, April, May, June and July are never abbreviated.',
      example: 'March 5, not Mar. 5',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        return matches(/\b(Mar|Apr|Jun|Jul)\.?(?=\s+\d{1,2}(?!\d))|\bMay\.(?=\s+\d{1,2}(?!\d))/, text).map((m) => {
          const word = m[1] || 'May';
          return {
            start: m.index,
            end: m.index + m[0].length,
            message: `Spell out "${FULL[word]}". Only Jan., Feb., Aug., Sept., Oct., Nov. and Dec. are abbreviated.`,
          };
        });
      },
    },
    {
      id: 'date-month-format',
      group: 'Dates',
      label: 'Month abbreviation format',
      help: 'Use the exact abbreviations with a period, such as Sept. (not Sep.) and Oct. (not Oct).',
      example: 'Sept. 4, not Sep. 4',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        const out = [];
        for (const m of matches(/\b(Jan|Feb|Aug|Sept?|Oct|Nov|Dec)\.?(?=\s+\d{1,2}(?!\d))/, text)) {
          const proper = PROPER_ABBR[m[1]];
          if (m[0] !== proper) {
            out.push({
              start: m.index,
              end: m.index + m[0].length,
              message: `Write the month as "${proper}".`,
            });
          }
        }
        return out;
      },
    },
    {
      id: 'date-ordinal',
      group: 'Dates',
      label: 'No ordinals on dates',
      help: 'Drop st, nd, rd and th after a day number.',
      example: 'Aug. 10, not Aug. 10th',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        const re = new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})(st|nd|rd|th)\b`, 'g');
        return matches(re, text).map((m) => {
          const len = m[1].length + m[2].length;
          return {
            start: m.index + m[0].length - len,
            end: m.index + m[0].length,
            message: `Drop the ordinal. Write "${m[1]}".`,
          };
        });
      },
    },
    {
      id: 'date-year',
      group: 'Dates',
      label: 'Leave out the current year',
      help: 'Do not add the year to a date that falls in the current year.',
      example: 'Oct. 12, not Oct. 12, 2026 (when it is 2026)',
      defaultSeverity: 'review',
      kind: 'text',
      check(text, ctx) {
        const re = new RegExp(String.raw`\b(${MONTH}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+)(\d{4})\b`, 'g');
        const out = [];
        for (const m of matches(re, text)) {
          if (Number(m[2]) === ctx.year) {
            out.push({
              start: m.index + m[1].length,
              end: m.index + m[0].length,
              message: `Leave out the year for dates in the current year (${ctx.year}).`,
            });
          }
        }
        return out;
      },
    },
    {
      id: 'date-order',
      group: 'Dates',
      label: 'Time, day, date order',
      help: 'List the time first, then the day, then the date. This one is a pattern guess, so it is set to review.',
      example: '11 a.m. - 2 p.m., Tuesday, Aug. 10',
      defaultSeverity: 'review',
      kind: 'text',
      check(text) {
        const dateThenTime = new RegExp(
          String.raw`\b${MONTH}\.?\s+\d{1,2}(?!\d)(?:st|nd|rd|th)?(?:,\s*\d{4})?(?:,\s*|\s+at\s+|\s+from\s+|\s+beginning at\s+|\s+starting at\s+|\s+)(?:\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]\b|noon\b|midnight\b)`,
          'g'
        );
        const dateThenDay = new RegExp(
          String.raw`\b${MONTH}\.?\s+\d{1,2}(?!\d)(?:st|nd|rd|th)?,?\s+(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b`,
          'g'
        );
        const message = 'Put the time first, then the day, then the date, as in "11 a.m. - 2 p.m., Tuesday, Aug. 10."';
        return [...matches(dateThenTime, text), ...matches(dateThenDay, text)]
          .map((m) => ({ start: m.index, end: m.index + m[0].length, message }))
          .sort((a, b) => a.start - b.start);
      },
    },

    // ===== Times =====
    {
      id: 'time-format',
      group: 'Times',
      label: 'Lowercase a.m. and p.m. with periods',
      help: 'Write a.m. and p.m. in lowercase with periods. No AM, PM, am or pm.',
      example: '9 a.m., not 9 AM',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        const out = [];
        for (const m of matches(/\b(\d{1,2}(?::\d{2})?)\s*([AaPp]\.?[Mm]\b\.?)/, text)) {
          if (m[2] !== 'a.m.' && m[2] !== 'p.m.') {
            const fixed = m[2].toLowerCase().startsWith('a') ? 'a.m.' : 'p.m.';
            out.push({
              start: m.index,
              end: m.index + m[0].length,
              message: `Write "${m[1]} ${fixed}" (lowercase, with periods).`,
            });
          }
        }
        return out;
      },
    },
    {
      id: 'time-colon-zero',
      group: 'Times',
      label: 'No :00 on the hour',
      help: 'Leave off the minutes when the time is on the hour.',
      example: '9 a.m., not 9:00 a.m.',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        return matches(/\b\d{1,2}:00(?=\s*[AaPp]\.?[Mm]\b)/, text).map((m) => ({
          start: m.index,
          end: m.index + m[0].length,
          message: `Drop ":00". Write "${m[0].slice(0, -3)}".`,
        }));
      },
    },
    {
      id: 'time-noon-midnight',
      group: 'Times',
      label: 'Use noon and midnight',
      help: 'Write noon and midnight instead of 12 p.m. and 12 a.m. Do not write "12 noon".',
      example: 'noon, not 12 p.m.',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        const out = [];
        for (const m of matches(/\b12(?::00)?\s*([AaPp])\.?[Mm]\b\.?/, text)) {
          const word = m[1].toLowerCase() === 'p' ? 'noon' : 'midnight';
          out.push({ start: m.index, end: m.index + m[0].length, message: `Write "${word}".` });
        }
        for (const m of matches(/\b12\s+(noon|midnight)\b/i, text)) {
          out.push({ start: m.index, end: m.index + m[0].length, message: `Write "${m[1].toLowerCase()}" without the 12.` });
        }
        return out.sort((a, b) => a.start - b.start);
      },
    },
    {
      id: 'time-repeat',
      group: 'Times',
      label: 'Do not repeat a.m. or p.m. in a range',
      help: 'When both ends of a range are morning or both are afternoon, say a.m. or p.m. once.',
      example: '9-10 a.m., not 9 a.m. - 10 a.m.',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        const re = /\b\d{1,2}(?::\d{2})?\s*([ap])\.?m\.?\s*(?:-|\u2013|\u2014|to|until)\s*\d{1,2}(?::\d{2})?\s*\1\.?m\b\.?/gi;
        return matches(re, text).map((m) => ({
          start: m.index,
          end: m.index + m[0].length,
          message: 'Don’t repeat a.m. or p.m. Use it once at the end of the range, as in "9-10 a.m."',
        }));
      },
    },

    // ===== Numbers =====
    {
      id: 'num-spell-small',
      group: 'Numbers',
      label: 'Spell out one through nine',
      help: 'Spell out single digits. Figures stay for times, dates, addresses, percentages, ages, money and measurements.',
      example: 'five cats, not 5 cats',
      defaultSeverity: 'review',
      kind: 'text',
      check(text, ctx) {
        const extra = ((ctx.settings && ctx.settings.numberExceptionWords) || []).map((w) => w.toLowerCase());
        const before = new Set([...BEFORE_WORDS, ...extra]);
        const out = [];
        for (const m of matches(/(?<![\w$#.,:\/+\u2013-])([1-9])(?![\w:\/%]|[.,]\d|-\d|\u2013\d)/, text)) {
          const start = m.index;
          const end = start + 1;
          const prev = text.slice(0, start).match(/([A-Za-z]+)\.?\s*$/);
          if (prev && before.has(prev[1].toLowerCase())) continue;
          const after = text.slice(end);
          if (AFTER_OK.test(after) || RANGE_TIME.test(after)) continue;
          out.push({ start, end, message: `Spell out numbers one through nine. Write "${NUMBER_WORDS[Number(m[1])]}".` });
        }
        return out;
      },
    },
    {
      id: 'num-use-numerals',
      group: 'Numbers',
      label: 'Use numerals for 10 and up',
      help: 'Write 10 and higher as figures. Spelled-out numbers at the start of a sentence are left alone.',
      example: '12 people, not twelve people',
      defaultSeverity: 'review',
      kind: 'text',
      check(text) {
        const re =
          /\b(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi;
        const out = [];
        for (const m of matches(re, text)) {
          const before = text.slice(0, m.index);
          if (before.trim() === '' || /[.!?:]["'\u201d\u2019)]*\s+$/.test(before)) continue;
          const n = spelledToNumber(m[0]);
          out.push({
            start: m.index,
            end: m.index + m[0].length,
            message: n ? `Use numerals for 10 and above. Write "${n}".` : 'Use numerals for 10 and above.',
          });
        }
        return out;
      },
    },

    // ===== Addresses =====
    {
      id: 'addr-direction',
      group: 'Addresses',
      label: 'Abbreviate directions in addresses',
      help: 'Use N., S., E. and W. in street addresses.',
      example: '7447 E. Indian School Road, not 7447 East Indian School Road',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        const out = [];
        for (const m of matches(/\b\d{2,6}\s+(North|South|East|West)\b(?=\s+[A-Z0-9])/, text)) {
          out.push({
            start: m.index + m[0].length - m[1].length,
            end: m.index + m[0].length,
            message: `Abbreviate to "${m[1][0]}." in an address.`,
          });
        }
        for (const m of matches(/\b\d{2,6}\s+([NSEW])(?![.\w])(?=\s+[A-Z0-9])/, text)) {
          out.push({
            start: m.index + m[0].length - 1,
            end: m.index + m[0].length,
            message: `Add a period. Write "${m[1]}."`,
          });
        }
        return out;
      },
    },
    {
      id: 'addr-street-type-abbrev',
      group: 'Addresses',
      label: 'Abbreviate Avenue, Boulevard and Street',
      help: 'With a street number, write Ave., Blvd. and St.',
      example: '3939 N. Drinkwater Blvd., not 3939 N. Drinkwater Boulevard',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        const re = new RegExp(ADDR_PRE + '(Avenue|Boulevard|Street)\\b', 'g');
        const map = { Avenue: 'Ave.', Boulevard: 'Blvd.', Street: 'St.' };
        return matches(re, text).map((m) => ({
          start: m.index + m[0].length - m[1].length,
          end: m.index + m[0].length,
          message: `Abbreviate to "${map[m[1]]}" in an address.`,
        }));
      },
    },
    {
      id: 'addr-street-type-period',
      group: 'Addresses',
      label: 'Periods on Ave., Blvd. and St.',
      help: 'Ave., Blvd. and St. take a period.',
      example: '123 Main St., not 123 Main St',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        const re = new RegExp(ADDR_PRE + '(Ave|Blvd|St)(?![\\w.])', 'g');
        return matches(re, text).map((m) => ({
          start: m.index + m[0].length - m[1].length,
          end: m.index + m[0].length,
          message: `Add a period. Write "${m[1]}."`,
        }));
      },
    },
    {
      id: 'addr-spell-rad',
      group: 'Addresses',
      label: 'Spell out Road, Alley and Drive',
      help: 'Remember RAD. Road, Alley and Drive are written out in addresses.',
      example: '7447 E. Indian School Road, not 7447 E. Indian School Rd.',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        const re = new RegExp(ADDR_PRE + '(Rd|Dr|Aly)\\b\\.?', 'g');
        const map = { Rd: 'Road', Dr: 'Drive', Aly: 'Alley' };
        return matches(re, text).map((m) => {
          const word = m[1];
          return {
            start: m.index + m[0].length - m[0].match(/(Rd|Dr|Aly)\.?$/)[0].length,
            end: m.index + m[0].length,
            message: `Spell out "${map[word]}" in an address.`,
          };
        });
      },
    },

    // ===== Website =====
    {
      id: 'web-protocol',
      group: 'Website',
      label: 'No https:// or http://',
      help: 'Leave the protocol off web addresses.',
      example: 'ScottsdaleAZ.gov, not https://ScottsdaleAZ.gov',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        return matches(/\bhttps?:\/\/[^\s<>"'\u201d\u2019)]+/i, text).map((m) => {
          const s = trimTrailingPunct(m[0]);
          return {
            start: m.index,
            end: m.index + s.length,
            message: 'Leave off "https://". Write the address without it.',
          };
        });
      },
    },
    {
      id: 'web-www',
      group: 'Website',
      label: 'No www.',
      help: 'Leave www. off web addresses.',
      example: 'ScottsdaleAZ.gov, not www.ScottsdaleAZ.gov',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        return matches(/(?<!\/\/)\bwww\.[^\s<>"'\u201d\u2019)]+/i, text).map((m) => {
          const s = trimTrailingPunct(m[0]);
          return { start: m.index, end: m.index + s.length, message: 'Leave off "www.".' };
        });
      },
    },
    {
      id: 'web-direct-url',
      group: 'Website',
      label: 'No direct URLs',
      help: 'Do not print a full page address. Point people to the site and a search term.',
      example: 'For more information, visit ScottsdaleAZ.gov and search "trash."',
      defaultSeverity: 'error',
      kind: 'text',
      check(text, ctx) {
        const site = (ctx.settings.allowedDomains && ctx.settings.allowedDomains[0]) || 'ScottsdaleAZ.gov';
        const re = /\b(?:[a-z0-9-]+\.)+(?:gov|org|com|net|edu|us|info|io)\/[^\s<>"'\u201d\u2019)]*/gi;
        const out = [];
        for (const m of matches(re, text)) {
          if (m.index >= 2 && text.slice(m.index - 2, m.index) === '//') continue;
          if (/^www\./i.test(m[0])) continue;
          const s = trimTrailingPunct(m[0]);
          out.push({
            start: m.index,
            end: m.index + s.length,
            message: `No direct URLs. Instead write "For more information, visit ${site} and search “insert term here.”"`,
          });
        }
        return out;
      },
    },
    {
      id: 'web-domain-case',
      group: 'Website',
      label: 'Website name spelling',
      help: 'ScottsdaleAZ.gov is the style for the website and email address. Other site names in settings are checked the same way.',
      example: 'ScottsdaleAZ.gov, not scottsdaleaz.gov',
      defaultSeverity: 'error',
      kind: 'text',
      check(text, ctx) {
        const out = [];
        for (const d of ctx.settings.allowedDomains || []) {
          const re = new RegExp('(?<![\\w.-])' + esc(d) + '(?![\\w-]|\\.\\w)', 'gi');
          for (const m of matches(re, text)) {
            if (m[0] !== d) {
              out.push({ start: m.index, end: m.index + m[0].length, message: `Write it as "${d}".` });
            }
          }
        }
        return out;
      },
    },

    // ===== Phone numbers =====
    {
      id: 'phone-format',
      group: 'Phone numbers',
      label: 'Hyphens only in phone numbers',
      help: 'Use hyphens only for phone numbers. No periods or parentheses. Spaces and slashes are flagged too.',
      example: '480-312-2321, not (480) 312-2321 or 480.312.2321',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        const re = /(?<![\d\w])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.\/-]?\d{3}[\s.-]?\d{4}(?![\d\w])/g;
        const out = [];
        for (const m of matches(re, text)) {
          if (!/\D/.test(m[0])) continue;
          if (/^(?:1-)?\d{3}-\d{3}-\d{4}$/.test(m[0])) continue;
          const d = m[0].replace(/\D/g, '').slice(-10);
          out.push({
            start: m.index,
            end: m.index + m[0].length,
            message: `Use hyphens only for phone numbers. Write "${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}".`,
          });
        }
        return out;
      },
    },

    // ===== Wording =====
    {
      id: 'wording-city-of-scottsdale',
      group: 'Wording',
      label: 'Avoid "City of Scottsdale"',
      help: 'Use just "Scottsdale" when you can. Some legal and formal uses need the full name, so this is set to review.',
      example: 'Scottsdale offers trash service',
      defaultSeverity: 'review',
      kind: 'text',
      check(text) {
        return matches(/\bcity of scottsdale\b/i, text).map((m) => ({
          start: m.index,
          end: m.index + m[0].length,
          message: 'Try to use just "Scottsdale" when possible.',
        }));
      },
    },
    {
      id: 'wording-double-space',
      group: 'Wording',
      label: 'One space after a period',
      help: 'No double spaces after a period. That was for the typewriter era, not computers.',
      example: 'One space. Not two.',
      defaultSeverity: 'error',
      kind: 'text',
      check(text) {
        return matches(/[.!?]["'\u201d\u2019)\]]*(?: {2,}| \u00a0|\u00a0 |\u00a0{2,})(?=\S)/, text).map((m) => ({
          start: m.index,
          end: m.index + m[0].length,
          message: 'No double spaces after a period. That was for the typewriter era, not computers.',
        }));
      },
    },
    {
      id: 'wording-oxford-comma',
      group: 'Wording',
      label: 'No comma before "and" in a list',
      help: 'Don’t use a comma before "and" when listing multiple items in sentences. This is a pattern guess, so it is set to review.',
      example: 'parks, trails and pools',
      defaultSeverity: 'review',
      kind: 'text',
      check(text) {
        const out = [];
        for (const m of matches(/,\s+and\s+/, text)) {
          let seg = text.slice(Math.max(0, m.index - 100), m.index);
          const brk = Math.max(seg.lastIndexOf('.'), seg.lastIndexOf(';'), seg.lastIndexOf(':'), seg.lastIndexOf('!'), seg.lastIndexOf('?'));
          seg = seg.slice(brk + 1);
          if (!seg.includes(',')) continue;
          const lastItem = seg.slice(seg.lastIndexOf(',') + 1).trim();
          const nextItem = text.slice(m.index + m[0].length).split(/[,.;:!?]/)[0].trim();
          const words = (s) => (s ? s.split(/\s+/).length : 0);
          if (words(lastItem) > 4 || words(nextItem) > 4) continue;
          out.push({
            start: m.index,
            end: m.index + m[0].length,
            message: 'Don’t use a comma before "and" when listing items.',
          });
        }
        return out;
      },
    },

    // ===== Headlines and titles =====
    {
      id: 'head-sentence-case',
      group: 'Headlines and titles',
      label: 'Headlines in sentence case',
      help: 'Capitalize only the first word and proper nouns in headings. The check cannot know every name, so it is set to review. Add names in settings to quiet it.',
      example: 'Water conservation program, not Water Conservation Program',
      defaultSeverity: 'review',
      kind: 'dom',
      check(ctx) {
        const st = ctx.settings;
        const known = new Set();
        for (const entry of [...(st.properNouns || []), ...(st.titles || [])]) {
          for (const w of String(entry).split(/\s+/)) if (w) known.add(w.toLowerCase());
        }
        const out = [];
        for (const el of ctx.els('h1,h2,h3,h4,h5,h6')) {
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          const words = text.split(' ').filter(Boolean);
          if (words.length < 3) continue;
          const letters = text.replace(/[^A-Za-z]/g, '');
          if (letters.length >= 8 && letters === letters.toUpperCase()) {
            out.push({
              el,
              snippet: trunc(text, 60),
              message: 'This heading is in all capital letters. Only the first word and proper nouns are capitalized in headlines.',
            });
            continue;
          }
          const rest = words.slice(1);
          const caps = rest.filter((w) => {
            const bare = w.replace(/^[^A-Za-z]+|[^A-Za-z'\u2019-]+$/g, '');
            return /^[A-Z][a-z'\u2019-]*$/.test(bare) && !known.has(bare.toLowerCase());
          });
          if (caps.length >= 2 && caps.length / rest.length >= 0.5) {
            out.push({
              el,
              snippet: trunc(text, 60),
              message: 'Only the first word and proper nouns are capitalized in headlines.',
            });
          }
        }
        return out;
      },
    },
    {
      id: 'title-before-name',
      group: 'Headlines and titles',
      label: 'Capitalize a title before a name',
      help: 'A title right before a name is capitalized.',
      example: 'Mayor Jane Smith',
      defaultSeverity: 'review',
      kind: 'text',
      check(text, ctx) {
        const titles = (ctx.settings.titles || []).filter((t) => /^[A-Za-z ]+$/.test(t));
        if (!titles.length) return [];
        const lower = titles.map((t) => t.toLowerCase());
        const re = new RegExp('\\b(' + alternation(lower) + ")\\s+(?=[A-Z][a-z'\u2019-]+)", 'g');
        return matches(re, text).map((m) => {
          const t = m[1];
          const cap = titles.find((x) => x.toLowerCase() === t) || t;
          return {
            start: m.index,
            end: m.index + t.length,
            message: `Capitalize titles before a name. Write "${cap}".`,
          };
        });
      },
    },
    {
      id: 'title-after-name',
      group: 'Headlines and titles',
      label: 'Lowercase a title after a name',
      help: 'A title that follows a name is lowercase.',
      example: 'Jane Smith, mayor',
      defaultSeverity: 'review',
      kind: 'text',
      check(text, ctx) {
        const titles = ctx.settings.titles || [];
        if (!titles.length) return [];
        const re = new RegExp(
          "\\b[A-Z][a-z'\u2019.-]+(?:\\s+[A-Z][a-z'\u2019.-]+){1,2},\\s+(?:the\\s+)?(" + alternation(titles) + ')\\b',
          'g'
        );
        return matches(re, text).map((m) => ({
          start: m.index + m[0].length - m[1].length,
          end: m.index + m[0].length,
          message: `Lowercase a title that follows a name. Write "${m[1].toLowerCase()}".`,
        }));
      },
    },
    {
      id: 'title-without-name',
      group: 'Headlines and titles',
      label: 'Lowercase a title with no name',
      help: 'A title used on its own, without a name, is lowercase. This one finds false positives, so it is set to review.',
      example: 'the mayor said',
      defaultSeverity: 'review',
      kind: 'text',
      check(text, ctx) {
        const titles = ctx.settings.titles || [];
        if (!titles.length || ctx.inHeading) return [];
        const re = new RegExp('\\b(' + alternation(titles) + ')\\b', 'g');
        const out = [];
        for (const m of matches(re, text)) {
          const before = text.slice(0, m.index);
          if (before.trim() === '') continue;
          if (/[.!?]["'\u201d\u2019)]*\s+$/.test(before)) continue;
          if (/[A-Z][a-z'\u2019.-]+,\s+(?:the\s+)?$/.test(before)) continue;
          const next = text.slice(m.index + m[0].length).match(/^\s+([A-Za-z.'\u2019-]+)/);
          if (next && /^[A-Z]/.test(next[1])) continue;
          out.push({
            start: m.index,
            end: m.index + m[0].length,
            message: `Lowercase a title used without a name. Write "${m[1].toLowerCase()}".`,
          });
        }
        return out;
      },
    },

    // ===== Inline CSS =====
    {
      id: 'css-style-attr',
      group: 'Inline CSS',
      label: 'style="" attributes',
      help: 'Flags any element with an inline style attribute.',
      example: '<p style="color:red">',
      defaultSeverity: 'error',
      kind: 'dom',
      check(ctx) {
        const out = [];
        for (const el of ctx.els('[style]')) {
          const v = el.getAttribute('style');
          if (!v || !v.trim()) continue;
          out.push({
            el,
            snippet: `<${el.tagName.toLowerCase()} style="${trunc(v, 60)}">`,
            message: 'Inline style attribute. Remove it and use the editor formatting or an approved site class.',
          });
        }
        return out;
      },
    },
    {
      id: 'css-style-tag',
      group: 'Inline CSS',
      label: '<style> blocks',
      help: 'Flags <style> tags in the content area. The highlight goes on the element that holds the tag.',
      example: '<style>p { color: red }</style>',
      defaultSeverity: 'error',
      kind: 'dom',
      check(ctx) {
        return ctx.els('style').map((el) => ({
          el: el.parentElement || el,
          snippet: `<style> ${trunc(el.textContent, 60)}`,
          message: 'A <style> block is in this content. Remove it.',
        }));
      },
    },
    {
      id: 'css-link-stylesheet',
      group: 'Inline CSS',
      label: 'Linked stylesheets in content',
      help: 'Flags <link rel="stylesheet"> tags in the content area.',
      example: '<link rel="stylesheet" href="...">',
      defaultSeverity: 'error',
      kind: 'dom',
      check(ctx) {
        return ctx.els('link[rel~="stylesheet" i]').map((el) => ({
          el: el.parentElement || el,
          snippet: `<link stylesheet> ${trunc(el.getAttribute('href') || '', 60)}`,
          message: 'A stylesheet is linked inside this content. Remove it.',
        }));
      },
    },
    {
      id: 'css-legacy-markup',
      group: 'Inline CSS',
      label: 'Old presentation markup',
      help: 'Flags <font>, <center>, <big>, <marquee> and the align, bgcolor, valign and face attributes.',
      example: '<font color="red">, <td align="center">',
      defaultSeverity: 'review',
      kind: 'dom',
      check(ctx) {
        const tags = new Set(['font', 'center', 'big', 'marquee', 'blink', 'basefont']);
        const attrs = ['align', 'bgcolor', 'valign', 'face'];
        const out = [];
        for (const el of ctx.els('font,center,big,marquee,blink,basefont,[align],[bgcolor],[valign],[face]')) {
          const reasons = [];
          const tag = el.tagName.toLowerCase();
          if (tags.has(tag)) reasons.push(`<${tag}>`);
          for (const a of attrs) if (el.hasAttribute(a)) reasons.push(`${a} attribute`);
          if (!reasons.length) continue;
          out.push({
            el,
            snippet: `<${tag}> ${reasons.join(', ')}`,
            message: `Old presentation markup (${reasons.join(', ')}). Use the editor's paragraph, heading and list styles.`,
          });
        }
        return out;
      },
    },
  ];

  // ---------- settings ----------

  function defaultSettings() {
    const rules = {};
    for (const r of RULES) rules[r.id] = r.defaultSeverity;
    return {
      rules,
      scopeSelector: 'main',
      ignoreSelectors: '',
      ignoredPhrases: [],
      allowedDomains: ['ScottsdaleAZ.gov', 'ScottsdaleLibrary.org'],
      properNouns: DEFAULT_PROPER_NOUNS.slice(),
      titles: DEFAULT_TITLES.slice(),
      numberExceptionWords: DEFAULT_NUMBER_EXCEPTIONS.slice(),
    };
  }

  const SEVERITIES = ['error', 'review', 'off'];

  function mergeSettings(saved) {
    const d = defaultSettings();
    if (!saved || typeof saved !== 'object') return d;
    const out = Object.assign({}, d);
    for (const key of Object.keys(d)) {
      if (key === 'rules') {
        const merged = Object.assign({}, d.rules);
        const sr = saved.rules && typeof saved.rules === 'object' ? saved.rules : {};
        for (const id of Object.keys(d.rules)) {
          if (SEVERITIES.includes(sr[id])) merged[id] = sr[id];
        }
        out.rules = merged;
      } else if (
        saved[key] !== undefined &&
        typeof saved[key] === typeof d[key] &&
        Array.isArray(saved[key]) === Array.isArray(d[key])
      ) {
        out[key] = saved[key];
      }
    }
    return out;
  }

  function severityOf(settings, rule) {
    const v = settings && settings.rules && settings.rules[rule.id];
    return SEVERITIES.includes(v) ? v : rule.defaultSeverity;
  }

  const RULES_BY_ID = {};
  for (const r of RULES) RULES_BY_ID[r.id] = r;

  return { GROUPS, RULES, RULES_BY_ID, SEVERITIES, defaultSettings, mergeSettings, severityOf };
});
