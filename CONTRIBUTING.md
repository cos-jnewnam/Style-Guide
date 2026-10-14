# Contributing

This is an internal City of Scottsdale tool. Changes go through a pull request to `main`.

## Ground rules

- Plain JavaScript. No build step, no framework, no TypeScript.
- Permissions stay at `activeTab`, `scripting` and `storage`. No host permissions, no remote code, no network requests.
- Rules follow the Scottsdale style guide in [docs/AP Quick Tips.pdf](docs/AP%20Quick%20Tips.pdf). Messages use the guide's wording where it exists.
- When you change a rule, change its test in the same commit.
- Say why in the pull request if you change a rule's default severity.
- In UI text, README text and code comments, don't use em dashes.

## Before you open a pull request

```
npm install
npm test
npx playwright install chromium
npm run test:browser
```

Both must pass. To check a change against live pages, run `node tools/scan-pages.js tools/sample-urls.txt` and compare the counts per rule.

## Releasing

1. Bump `version` in `extension/manifest.json` and `package.json`.
2. Commit, then tag with the same version, such as `git tag v0.2.0`.
3. Push the tag with `git push origin v0.2.0`.

GitHub Actions runs the tests and attaches `scottsdale-style-check.zip` to a new release. The download button on the install guide always points to the newest release.
