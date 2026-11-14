# Browser tests

A real Chrome, driven by [Playwright](https://playwright.dev), clicking through the
real screens. The HTTP tests in `../test/` say what the server sent; these say what
a person sees: whether the mouse wheel moves the page, whether a PDF is actually
drawn, what happens to Shilan's tab when Aram signs in in the next one.

## Run them

```
cd app/e2e
npm install                        # once
npx playwright test                # against the local stack on http://localhost:3111
npx playwright test --headed       # the same, with the browser visible
npx playwright show-report         # the last run, with a trace of anything that failed
```

Against another server, and its password:

```
BASE=https://sharawani01.vercel.app FIXTURE_PASSWORD=... npx playwright test tests/screens.spec.mjs
```

The installed Google Chrome is used, so nothing is downloaded. `PW_CHANNEL=msedge`
uses Edge instead.

## Before pointing them anywhere

`files.spec.mjs` and `letters.spec.mjs` **register letters and attach files**. Run
them against the local stack or the demo, never against the municipality's real
server. `screens.spec.mjs` and `people.spec.mjs` only sign in and look.

Playwright is pinned to 1.49 because this machine has Node 18. On Node 20 or later
it can be upgraded.

## The whole-system audit

A second set, in `audit/`, that looks for everything at once instead of holding one
report each. It does not stop at the first problem: it writes each one down and
carries on.

```
npx playwright test -c audit.config.mjs          # about 20 minutes, local stack only
node audit/summarise.mjs                         # the list, most serious first
```

| File | What it does |
|---|---|
| `audit/crawl.spec.mjs` | Signs in as all 15 fixture accounts and follows every link each can reach, on a laptop and a phone screen. Records refusals, script errors, slow pages, pages wider than a phone, raw values, mixed digits, unlabelled fields, and a screenshot of every kind of page. Only follows links; never sends a form. |
| `audit/j1-letters.spec.mjs` | A letter's whole life: registered, attached, noted, sent to the mayor, to legal, answered, closed, then looked for by everyone who should find it and two who should not. |
| `audit/j2-routing.spec.mjs` | Recall, return, a sequence of rooms, a room's own letter, a delivery list, the scan tray, the test scanner. |
| `audit/j3-records.spec.mjs` | The map archive, companies, templates, leave, kinds of transaction. |
| `audit/j4-people.spec.mjs` | New staff and forced password, closing an account, rooms, locking the system, sign-in and sign-out, live notifications, the log, a photo, a phone. |
| `audit/j5-access.spec.mjs` | Every person against every screen's address, compared with their menu. |

Everything lands in `audit-output/` (screenshots in `shots/` and `journeys/`),
which is not committed. **The journeys lock the system for a few seconds, add
staff, rooms and companies: never run them anywhere but the local stack.**

## What is here

| File | The report it holds |
|---|---|
| `screens.spec.mjs` | 1: the wheel scrolls; nothing is pushed off a phone screen |
| `files.spec.mjs` | 2: a chosen file can be removed; the wrong type is refused on choosing |
| `letters.spec.mjs` | 4, 5, 6, 8, 10: scanning, one kind of digit, the PDF drawn with ink, rooms starting letters, DWG from room 8 |
| `people.spec.mjs` | 7: two people at once, and a tab that stops when someone else signs in |
