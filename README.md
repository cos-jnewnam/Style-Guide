# Scottsdale Style Check

A Chrome and Edge extension for content authors. Open a page, click the toolbar button, and it highlights anything that breaks the [Scottsdale style guide](docs/AP%20Quick%20Tips.pdf), including inline CSS. Nothing leaves the browser.

## Install

**Content authors** should follow the [install guide](https://cos-jnewnam.github.io/Style-Guide/). The steps below are the short version.

You need Chrome or Edge. Both load it the same way.

1. Download [scottsdale-style-check.zip](https://github.com/cos-jnewnam/Style-Guide/releases/latest/download/scottsdale-style-check.zip) and unzip it. Or clone this repo.
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and pick the `scottsdale-style-check` folder from the zip, or the `extension` folder if you cloned the repo.
5. Pin the extension from the puzzle-piece menu so the button stays visible.

To update, unzip the new release over the old folder, or pull the latest code. Then click the reload arrow on the extension card.

## Use

1. Open the page you want to check. Use the live page, a preview, or the page after you save it. The Sitefinity editing screen itself is not checked.
2. Click the toolbar button, or press Alt+Shift+S.
3. Problems are highlighted on the page and listed in a panel on the right.

How to read it:

- A **solid red underline** or outline is an **error**.
- A **dotted or dashed amber** underline or outline is a **review**. These are pattern guesses that need a person to decide.
- Hover over a highlight to see what is wrong.
- Select an item in the list to scroll to it. Previous and Next step through the page in order.
- The red and amber buttons at the top of the panel show or hide each kind.
- **Ignore** drops one item until the next scan.
- **Copy report** puts a plain-text list on your clipboard to send to an author.
- Click the toolbar button again, or Close, to clear everything. The page goes back exactly as it was.

The toolbar badge shows how many items were found. It is red when there are errors, amber when there are only reviews, and green with OK when the page is clean.

## What it checks

Every rule can be set to Error, Review or Off in settings. Use the Settings button in the panel to open them over the page, or right-click the extension and choose Options.

| Group | Rules |
| --- | --- |
| Dates | Abbreviate Jan., Feb., Aug., Sept., Oct., Nov., Dec. before a day. Spell out March through July. Month abbreviation format. No ordinals. Leave out the current year in a sentence (a standalone date like "Release Date: Oct. 12, 2026" can keep it). Time, day, date order. |
| Times | Lowercase a.m. and p.m. with periods. No :00. Noon and midnight. No repeated a.m. or p.m. in a range. |
| Numbers | Spell out one through nine. A digit after its spelled-out word, as in five (5), and digits with a unit of time, as in 6 hours, are fine. Use numerals for 10 and up. |
| Addresses | N., S., E., W. Ave., Blvd., St. with periods. Road, Alley and Drive spelled out. |
| Website | No https:// or www. No direct URLs. Site names spelled exactly, such as ScottsdaleAZ.gov. |
| Phone numbers | Hyphens only. |
| Wording | Avoid "City of Scottsdale". One space after a period. No comma before "and" in a list. |
| Headlines and titles | Sentence case headings. Page titles (`h1`) and card titles that link to another page are skipped. Capitalize a title before a name. Lowercase a title after a name or with no name. |
| Inline CSS | Off by default. Turn them on in settings to flag `style=""` attributes, `<style>` blocks, linked stylesheets inside the content and old `<font>`, `<center>`, `align` and `bgcolor` markup. |

## Settings

- **Content area.** Only text inside this selector is checked. The default is `main`. If nothing matches, the whole page is checked and the panel says so.
- **Skip these areas.** Selectors for widgets that add their own inline styles or text. The default list covers Sitefinity template parts on both sites, such as news and event listings, "Last Updated" dates, breadcrumbs and the holiday schedule.
- **Ignored phrases.** Text that should never be flagged.
- **Allow Title Case in H1, H2 and H3.** On by default, so those headings can use Title Case or sentence case. Turn it off to require sentence case in every heading. H4 to H6 always need sentence case, and all-caps headings are always flagged.
- **Website names.** The exact spelling for each site name. The first one is used in the "no direct URLs" message.
- **Job titles, proper nouns, number words.** Lists that cut down false positives for the title, headline and number rules. A name with more than one word, like Culture Pass, only counts when the whole name appears.
- **Export and import.** Save your settings as a JSON file and share it with another department.

Settings sync through your browser profile.

## Known limits

- Each match has to sit inside one run of text. If someone formats part of a time in a different tag, such as `9 <strong>a.m.</strong>`, it is not caught.
- The review rules guess. Sentence-case headings cannot know every name, the title rules cannot tell a title from a similar word, and the list comma rule cannot tell a list from a long clause. Use the proper noun and title lists, and Ignore, to calm them down.
- Single digits are skipped after words like Room, Step, Prop and a month. Add more words under settings if you find others.
- Numeric dates such as 10/12/2026 are not checked.
- Hidden content, like a collapsed accordion, is checked. The highlight is there but you have to open the section to see it.
- `style` attributes added to the page by a script after load are caught only if they exist when you click the button.
- Browser pages (`chrome://`, `edge://`) and the extension store block extensions. The button shows a red `!` there.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Lets the extension run on the tab you clicked it on, and nothing else. |
| `scripting` | Injects the checker into that tab. |
| `storage` | Saves your settings. |

There are no host permissions, no remote code and no network requests.

## Development

```
npm install
npm test
```

The tests cover each rule with passing and failing text, and run the scanner and panel in jsdom to check highlighting, cleanup and the settings. To rebuild the icons, run `python3 tools/make-icons.py`.

`npm run test:browser` loads the unpacked extension in Playwright's Chromium and drives the panel, badge and settings page. Run `npx playwright install chromium` once first. Set `HEADED=1` to watch it.

```
extension/
  manifest.json     Manifest V3
  background.js     toolbar click, badge
  rules.js          every rule and the default settings
  content.js        scanner, highlighter, results panel
  content.css       page highlights
  options.*         settings page
tests/              rule, scanner and browser tests
tools/              icon script, live page scan
docs/               the style guide PDF
```

To add a rule, add an object to the `RULES` array in `rules.js`. A text rule gets the text of one node and returns match positions. A DOM rule gets the content area and returns elements. The settings page and the panel pick it up with no other changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the ground rules and how to cut a release.

## License

[MIT](LICENSE)
