# Briefing for the test agents

You are one of five testers running at the same time against the same local copy
of **docsys**, a Kurdish Sorani (right-to-left) document and correspondence system
for Rania Municipality. Your job is to **find real problems a municipal employee
would hit**, prove each in a real browser, and report them. You do not fix
anything.

## The system

- Local server: **http://localhost:3111** (never use any other address).
- Code, read-only for you: `C:\Users\Ibrahim\Desktop\sharawani_system\app\src\` (routes in
  `src/routes/*.mjs`, page shell `src/views/layout.mjs`, styles `public/app.css`,
  scripts `public/app.js`, database rules `db/migrations/*.sql`). Approved design
  mockups: `C:\Users\Ibrahim\Desktop\sharawani_system\design\*.dc.html`.
- All data is invented test data. Every account's password is `guhare-2026`.

| username | role | room |
|---|---|---|
| aram | mayor | mayor's room |
| nabaz | deputy_mayor | mayor's room |
| shilan | registry_clerk (head) | front desk (هات و دەرچوو) |
| ahang | room_clerk | front desk |
| hemin | room_head | legal (یاسا) |
| sakar | room_clerk (deputy) | legal |
| dler | room_head | contracts 14 |
| rebwar | room_clerk (deputy) | contracts 14 |
| bafrin | hr (head) | admin (کارگێڕی) |
| shne | room_clerk (deputy) | admin |
| karwan | archive_clerk | plan archive room 8 |
| zhyan | archive_clerk | plan archive room 9 |
| hersh | room_head | land (زەوی و زار) |
| sozan | room_head | accounts (ژمێریاری) |
| dana | directorate_head | land |
| itadmin | sysadmin (IT) | none |

## Tools

- Playwright 1.49.1 is installed in `C:\Users\Ibrahim\Desktop\sharawani_system\app\e2e\`
  (host Node is 18.12, so do not upgrade it). Use the installed Google Chrome:
  `chromium.launch({ channel: 'chrome' })` or a config with `use: { channel: 'chrome' }`.
- Run from `app/e2e`: `./node_modules/.bin/playwright test -c agents/<you>/playwright.config.mjs`
  or plain scripts: `node agents/<you>/something.mjs` (ES modules, `import { chromium } from '@playwright/test'`).
- Useful helpers you may import: `app/e2e/tests/helpers.mjs` (`signIn(page, username)`,
  `inkPdf()`, `mark()`), `app/e2e/audit/lib.mjs` (`as(browser, user)` gives a signed-in
  page that collects script errors, `inkPng()`, `dwgBytes()`).
- Shell: Git Bash on Windows. Set `MSYS_NO_PATHCONV=1` before passing `/paths` to
  node. Bash heredocs have eaten backslashes in regexes here: write code files with
  the Write tool, not heredocs.
- Viewing screenshots: the Read tool shows images. Crop or clip screenshots to the
  area that matters (Playwright `clip`, or `locator.screenshot()`), because a
  full-page image is shrunk until small text is unreadable.

## Rules, because four other testers share this server

1. **Write only inside `app/e2e/agents/<your-name>/`.** Never edit `src/`, `public/`,
   `db/`, `test/`, the other agents' folders, or `app/e2e/tests` and `app/e2e/audit`.
2. **Never lock the system** (`/admin/lock`), never change, reset or deactivate the
   password or account of any account in the table above, never change a room's
   head or deputy, never deactivate a fixture room or transaction type that exists
   already. You may create your own users, rooms, companies, templates, letters and
   files with a unique marker in their names, and deactivate what you created.
3. **Sign-in failures are throttled per address, and everyone shares localhost.** Try
   at most 3 wrong passwords in total, and only with a username that does not exist.
   At most 10 requests to the public tracking page.
4. Leave requests: only with start dates at least 30 days in the future, so no
   deputy cover starts today and changes who receives other testers' letters.
5. Do not run `app/e2e/audit/*` or `app/e2e/tests/*` (one of them locks the system).
6. Do not start, stop or rebuild Docker containers, and do not touch the database
   directly.

## Already fixed this morning: do not re-report these as problems

The earlier audit's 35 findings were fixed. They are listed so you can check they
really are fixed (a regression **is** worth reporting), not so you report the
intended new behaviour:

- Signed-in pages are sent `Cache-Control: no-store`; Back after sign-out must not show letters.
- A temporary password is shown on the page answering the form, never in the address.
- Letter lists were rewritten to be fast (they took 2–5 s for ordinary rooms).
- Adding a note, signing for paper, finishing a step, returning, recalling and
  cancelling each have their own message (`?done=...`); sending keeps `?sent=1`.
- The PDF viewer draws text itself (`disableFontFace`); typed PDFs should read correctly.
- The rooms table has 8 headings and 8 cells; the room switcher shows the room being viewed.
- Links to screens a role cannot open were hidden; archive rooms may now use the photo screen.
- Format checks on username, transaction code, scanner code work in Chrome.
- Extensions accept Kurdish digits; the activity log shows Kurdish names and folded details.
- A room's inbox shows its oldest 100 open letters **plus every unopened letter**; the badge is the real count.
- Templates link to a letter by its number or barcode; errors come back as the form.
- Reply drafts date the letter in Kurdish digits; letter numbers are isolated left-to-right everywhere.
- A letter can be cancelled: mayor, deputy, front desk for any open letter; a room head
  for a letter their room started and has not sent. Nobody else, not even by a forged request.
- Everyone can change their own password from the sidebar name card; IT has Rooms in its menu;
  clerks have Templates and Leave in the menu; the front-desk register sends other roles to search.
- Unstyled fields, search buttons dropping below the box, trail dots on the wrong side,
  English "Choose File" text, "not found" pages without the menu, stale scripts: fixed.
- Phones: staff screen width, stat tiles two per row, pinned action column in tables,
  print sheets fitting the screen, two-line page titles.
- One vocabulary: پەلە for priority, لەژێر کاردا for in progress, نەگەیشتووە/وەرگیراوە for paper.

## Deliberate behaviour: not bugs

- IT (itadmin) cannot see letters at all, anywhere. That is the design.
- A person who uploads a map to the archive cannot verify it themselves; someone else must.
- Each room has its own scan tray; a claimed scan opens only through its letter.
- Opening a letter in the room that holds it marks it received.
- Chasing is allowed once a day per letter.
- Dates in `<input type=date>` show in the browser's own format; that is the browser.
- The corridor board (`/board`) is dark by design and has no menu.

## What to report

Only problems you **reproduced in the browser** (or, for security, with a real
request). For each:

- **Severity**: critical (data leak, data loss, cannot do core work) / high / medium / low
- **Title**: one line, what goes wrong
- **Who and where**: the account, the page address
- **Steps**: numbered, short, exact
- **Expected / actual**
- **Evidence**: screenshot path under your folder, or the response
- **Where in the code**, if you can see it (file:line)

Also write the same list to `app/e2e/agents/<your-name>/FINDINGS.md`. Your final
message is your report: the findings, most severe first, then one short paragraph
of what you checked that works. Keep it under about 1500 words. No padding, no
speculation, no findings you did not reproduce.
