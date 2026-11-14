# Design rules for docsys screens (13 September)

Three design reviews measured every screen and found the same kinds of thing done
differently from page to page. These rules pick **one** way for each. Apply them to
the files you own. The stylesheet `public/app.css` already has the classes below;
**do not edit `public/app.css`** (the lead owns it). If a rule needs CSS that does
not exist, say so in your final message instead.

## 1. Card structure

- **Heading row** (title plus a count, link or buttons):
  ```html
  <div class="card-head">
    <h2>کتابەکان <span class="pill muted">${num(n)}</span></h2>
    <div class="end"><a href="…">هەمووی ببینە</a> or <a class="btn small secondary" …></div>
  </div>
  ```
  A heading with nothing beside it is a plain `<h2>` (no inline style).
- **Count beside a heading**: always `<span class="pill muted">${num(n)}</span>` inside the h2.
  Never «(١)», «— ٥», an amber/gold pill, or the number written into the title text.
- **Line under a heading** explaining the card: `<p class="card-sub">…</p>`. No inline
  `margin-top:-6px` / `font-size:12.5px` versions.
- **Second, smaller line** inside a table cell or list line (the person under a room
  name, a year under a title, a note under a subject): `<span class="cell-sub">…</span>`
  (it is display:block). No inline `font-size:12px` / `12.5px` / `13px`.
- **Remove** `style="margin-top:0"` on h2 (redundant) and `style="margin:0"` on h2 when
  it sat in a hand-made heading row (use `.card-head`).
- **Never repeat the page title** as a card heading. If a page is one main card, the
  card has no h2 (the top bar names it), or a heading that names the section (e.g.
  «ئەنجامەکانی گەڕان»), never the same words as the title.
- **Attention card** (late letters): `class="card attention"` (no inline border colour,
  no inline h2 colour). **Warning card** (looks like an existing letter):
  `class="card caution"`.
- **Single-form screen** (photo registration, scan, template author/fill, assistant,
  scanner add): `class="card form"` (760px). Password page keeps `card narrow`.
- **Label/value tables**: `<div class="table-wrap kv"><table>` or `<table class="kv">`.
  No inline `th style="width:150px"` / `170px` / `120px`.
- `<p class="notice …">` → `<div class="notice …">`.

## 2. Buttons: which variant

| Where | Class |
|---|---|
| The main action of a form or card (save, register, search, add, send) | `btn` |
| Other actions beside it (print, open, back, cancel a form) | `btn secondary` |
| **Any** button inside a table row or a list line | `btn small` (+ `secondary` unless it is that row's main action) |
| Deactivate / cancel / remove, shown openly | `btn danger-outline` (`small` in a row) |
| Only the final confirm inside a folded `details.danger-zone` | `btn danger` |
| Activate again | `btn small secondary` |

Inbox «کردنەوە» in each row → `btn small secondary`.

## 3. Words: one for each thing

**Actions**
- Save changes: «پاشەکەوتکردن» (not «پاشەکەوت», «پاشەکەوتکردنی زانیارییەکان»).
- Create a simple item (user, room, type, company file): «زیادکردن». Scanner keeps «زیادکردن و تاقیکردنەوە».
- Register a record (letter, archive map): «تۆمارکردن».
- Cancel a form / go back without saving: «پاشگەزبوونەوە». Leave a page: «گەڕانەوە».
- Deactivate «ناچالاککردن», activate «چالاککردن».
- Print the letter sheet: «چاپی پەڕەی کتاب». Receipt: «چاپی پسوولە». Reply: «چاپی وەڵام» (one button, not two).
- Open a letter: «کردنەوە». Search: «گەڕان». Filter the log: «گەڕان» too.
- Scan: «سکانکردن لە سکانەر».
- New letter button everywhere: «کتابی نوێ»; the page it opens is titled «تۆمارکردنی کتابی نوێ».

**Success messages** (`?ok` / `?saved` notices)
- created «زیادکرا.», saved «پاشەکەوتکرا.», registered «تۆمارکرا.»
- deactivated «ناچالاککرا.», activated «چالاککرایەوە.»
- approved «پەسەندکرا.», rejected «ڕەتکرایەوە.», cancelled «هەڵوەشێنرایەوە.», withdrawn «کشێنرایەوە.»
- chase: «داواکاری بەدواداچوونەکەت نووسرا.» (same sentence on my-day and the letter page)
- paper received: «وەرگرتنی پەڕگەی کاغەزی تۆمارکرا.» (same on /barcode and the letter page)
- Every create/save/toggle must show one (company create, template create, scanner toggle had none).
- A generic «تۆمارکرا.» for approve/reject/cancel is wrong: say which.

**States** (word and pill colour)
| State | Word | Pill |
|---|---|---|
| overdue | «دواکەوتوو» (never «دواکەوتووە») | danger |
| cancelled (letter, manifest, leave) | «هەڵوەشێنراوە» (never «هەڵوەشێنراوەتەوە») | danger (leave: muted is fine) |
| inbox step not yet opened | «نوێ» | info |
| inbox step opened | «لەژێر کاردا» | warn |
| verified / not verified | «پشتڕاستکراوە» ok / «پشتڕاست نەکراوەتەوە» warn | |
| room head away with no deputy | «جێگری نییە» | |
| days until a date | «${num(n)} ڕۆژ ماوە»; 0 → «ئەمڕۆ کۆتایی دێت»; past → «بەسەرچووە» | |
| normal priority | shown nowhere (only پەلە / زۆر پەلە get a pill) | |
| a letter's status anywhere | `statusPill()` from `routes/registry.mjs`, never plain text | |

**Column headings**
- Letter number: «ژمارە». A count of letters: «کتاب».
- Where the letter is now: «ئێستا لای». (Where the paper is: «کاغەزەکە لای».)
- Paper column: «کاغەز». Label in a details table: «پەڕگەی کاغەزی».
- Time since sent: «ماوە». A date column: «بەروار». «کات» only for a time of day.
- Default days: «ماوە (ڕۆژ)» everywhere.

**Spelling**: «دوایین» (not دواین), «فۆڕم» (not فۆرم), «پیتی ئینگلیزی» (not پیتی لاتینی),
assistant placeholder «پرسیارەکەت لێرە بنووسە».

## 4. Lists, empty and not found

- Nothing to show: `<div class="empty">هیچ X نییە.</div>` inside the card the list
  would be in. After a search: «هیچ X نەدۆزرایەوە.». In a card that has other content
  too (a letter's notes/attachments/trail): `<div class="empty compact">`. Never
  `<p class="muted">`, never a red error notice for "no results", never just «هیچ.».
- A record that does not exist: `return notFound(req, res, 'ئەم … نەدۆزرایەوە.')` from
  `../lib/respond.mjs`. Never a hand-built 404 page and never `next()` to fall through.
- In a list of letters **the subject is the link** (not the number). The number is
  `<td class="mono">${ltr(no)}</td>`.
- Identifiers (letter, plot, shelf, manifest numbers, barcodes) are Latin in `ltr()` with
  `mono`. Examples in hints are Latin too («247/5»). Everything else uses `num()`.
- Switched-off rows: `<tr class="inactive">` (not `style="opacity:…"`, never an escaped style string).

## 5. Forms

- **Search / lookup**: one row, no label, primary button, hint under it:
  ```html
  <form method="get" action="…" class="row" role="search">
    <input type="search" name="q" aria-label="…" placeholder="…" value="…">
    <button class="btn" type="submit">گەڕان</button>
  </form>
  <div class="hint">…</div>
  ```
- **Fields side by side**: `<div class="grid cols-2|cols-3|cols-4">` with `.field`
  children. Not `.row` (it squeezes fields to 150–200px). A field must not sit alone in
  a row with empty cells: choose the column count that the fields fill.
- **Inline "add new" forms** (users, rooms, transaction types, scanners, leave request):
  one card **at the top of the page, full width**, heading «X نوێ», fields in a grid,
  button «زیادکردن» (leave: «ناردنی داواکاری»). The list card comes **below**. No side
  column next to a long list, no form at the bottom under hundreds of rows.
- **Records with their own "new" page** (companies, templates, archive): the «X نوێ»
  button is the page's top-bar action (`actions:` in `page({...})`), not in a card header.
- **Edit a record** that has an edit page (company, template): top-bar action
  `<a class="btn secondary" href="…/edit">دەستکاریکردن</a>`.
- Every required field's label has `class="required"`.
- **A date** is always `${dateInput({ id, value, required, after })}` from
  `src/lib/html.mjs`, never `<input type="date">` (the browser writes that in the
  machine's own order, «mm/dd/yyyy» or «dd/mm/yyyy»). It shows ساڵ/مانگ/ڕۆژ as
  ٢٠٢٦/٠٩/١٣ with a calendar from `public/app.js`. The route reads it with
  `readDay()` (`''` empty, `null` not a day: refuse with `DAY_FORMAT`). `after` names
  the field it cannot be earlier than.
- Remove inline `style="gap:6px"` on `.row` and `style="align-items:start"` on grids
  (the stylesheet now aligns grids of fields to the top).

## 6. Print sheets

All sheets use the same values: sizes in **pt**; title 17pt; body 11.5pt; rule under
the letterhead `2px solid #0E3A28`; muted text `#555`; table heading background
`#f6f5f0`; the gold seal circle beside the title.

## 7. Do not break

- Keep every `id`, `name`, form `action` and `method` exactly as they are: tests and
  scripts depend on them. Keep `data-*` attributes.
- Keep the Content Security Policy rules: no inline `onclick`, no inline `<script>`.
- Use the existing helpers (`html`, `raw`, `num`, `ltr`, `date`, `time`, `ago`, `elapsed`).
- Bash heredocs eat backslashes here: edit with the Edit tool.
- After editing, run `node --check` on each file you changed.
