# Rania Municipality Document System — Build Plan

**Project:** سیستەمی بەڕێوەبردنی دۆکیومێنتی شارەوانی ڕانیە
**Document version:** 1.0
**Date:** 2026-09-09
**Status:** Draft for review by the municipality

---

## 1. What this system is

Every official letter that reaches the municipality is registered as incoming (**هاتوو**), routed through the rooms that must act on it, answered, and finally registered as outgoing (**دەرچوو**) when the case closes. Today that happens on paper, in a register book, and letters get lost between rooms.

This system mirrors that journey digitally. It does not replace the paper letter. It tracks it, holds a scanned copy, records who had it and for how long, and makes any file findable again — both on screen and on the physical shelf.

**Non-goal:** this is not a paperless office project. Staff will keep printing, signing by hand, and stamping. The system's job is to know where every letter is and to make the archive searchable.

---

## 2. Open questions — resolve before writing code

These block design decisions. Each one changes the build.

| # | Question | Why it matters |
|---|---|---|
| Q1 | Exact list of rooms, with numbers and the name of each head | Drives the org table, the sidebar, the routing picker |
| Q2 | Are the 25–30 rooms flat, or grouped under directorates (بەڕێوەبەرایەتی)? | Decides whether the mayor's dashboard groups or lists, and whether directorate heads get their own overview |
| Q3 | Total staff count, and how many need a login | Sizes user administration, leave, and licensing |
| Q4 | The exact incoming/outgoing number format in the current paper register | The system must produce numbers the staff already recognise |
| Q5 | Average letters received per working day | Sizes storage and validates the dashboard figures |
| Q6 | How many drawings and files sit in rooms 8 and 9, and what the current shelf/folder scheme is | This is the largest single work item in the project |
| Q7 | The written leave policy: annual days, sick leave, approval chain | Cannot be guessed |
| Q8 | Existing IT: is there a server, a LAN across the building, scanners, and what OS are the PCs running? | Decides deployment and hardware budget |
| Q9 | Power reliability and whether there is a generator/UPS | Decides backup strategy and whether the app must survive hard shutdowns |
| Q10 | Who maintains the system after handover, and do they exist yet? | Decides how much of the stack must be boring and documented |
| Q11 | Is there a legal retention period for municipal correspondence? | Decides deletion policy — probably "never delete" |
| Q12 | Budget ceiling and any fixed deadline | Decides phasing |

**Action:** send Q1, Q4, Q6, Q7 to the municipality this week. They need no developer to answer and they are the long-lead items.

---

## 3. Users and permissions

### 3.1 Roles

| Role | Kurdish | Who |
|---|---|---|
| Mayor | سەرۆکی شارەوانی | One person. Full visibility, routes anything anywhere, reads the log, can lock the system |
| Deputy mayor | جێگری سەرۆک | Same as mayor except system lock. Prevents a single point of failure |
| Directorate head | بەڕێوەبەر | Sees every room under their directorate the way the mayor sees all rooms |
| Room head | بەرپرسی ژوور | Owns one room's inbox. Acts on letters and forwards them |
| Room clerk | کارمەندی ژوور | Same room, but cannot forward without the head's approval (configurable per room) |
| Registry clerk | کارمەندی هات و دەرچوو | Registers incoming, registers outgoing, closes cases. Cannot act on a letter's content |
| Archive clerk | کارمەندی ئەرشیف | Rooms 8 and 9. Uploads drawings, maintains physical location data |
| HR / administration | کارگێڕی | Templates and leave records |
| System administrator | بەڕێوەبەری سیستەم | IT. Creates users, resets passwords. **Cannot read letter contents** and cannot delete log entries |

### 3.2 Permission matrix

| Action | Mayor | Deputy | Dir. head | Room head | Room clerk | Registry | Archive | HR | IT |
|---|---|---|---|---|---|---|---|---|---|
| Register incoming | ✓ | ✓ | | | | ✓ | | | |
| Register outgoing / close | ✓ | ✓ | | | | ✓ | | | |
| Route to a single room | ✓ | ✓ | ✓ | ✓ | ○ | | | | |
| Route by sequence | ✓ | ✓ | ✓ | | | | | | |
| Create saved routes | ✓ | ✓ | | | | | | | |
| See own room's inbox | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| See any room's inbox | ✓ | ✓ | own dir. | | | | | | |
| Attach files | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Send externally (email/WhatsApp) | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ | | |
| Upload to drawing archive | ✓ | | | | | | ✓ | | |
| Edit physical location data | | | | | | | ✓ | | |
| Manage templates | ✓ | | | | | | | ✓ | |
| Approve leave | ✓ | ✓ | ✓ | | | | | ✓ | |
| Read activity log | ✓ | ✓ | own dir. | own room | | | | | ✓ |
| Lock the system | ✓ | | | | | | | | |
| Manage users | | | | | | | | | ✓ |
| Read letter contents | ✓ | ✓ | own dir. | own room | own room | ✓ | | | ✗ |

○ = configurable per room.

**Rule:** nobody, including IT, can delete or edit an activity log row. The log is append-only at the database level.

---

## 4. Data model

### 4.1 Organisation

```
directorate
  id                bigint pk
  name              text            -- بەڕێوەبەرایەتی خزمەتگوزاری
  code              text unique
  head_user_id      bigint fk -> user (nullable)
  sort_order        int

room
  id                bigint pk
  directorate_id    bigint fk -> directorate (nullable if flat)
  name              text            -- ژووری یاسا
  room_number       text            -- "8", "9", "14" (text, not int — some are "8/A")
  kind              enum            -- registry | office | archive | executive
  head_user_id      bigint fk -> user
  deputy_user_id    bigint fk -> user (nullable)   -- receives when head is on leave
  default_due_days  int default 3   -- SLA for this room
  is_active         bool
  sort_order        int

user
  id                bigint pk
  full_name         text
  username          text unique
  password_hash     text
  room_id           bigint fk -> room
  role              enum
  phone             text
  email             text
  must_change_password bool
  is_active         bool
  last_login_at     timestamptz
  created_at        timestamptz
```

### 4.2 The document

```
document
  id                    bigint pk
  incoming_no           text unique     -- "ه‌/2026/4521"
  incoming_seq          int             -- 4521, for ordering and gap detection
  incoming_year         int
  incoming_date         date
  incoming_registered_by bigint fk -> user
  incoming_registered_at timestamptz

  outgoing_no           text unique null
  outgoing_seq          int null
  outgoing_year         int null
  outgoing_date         date null
  outgoing_registered_by bigint fk -> user null

  subject               text
  subject_search        text            -- normalized, indexed (see §6)
  doc_type              enum            -- citizen_request | company_request |
                                        -- gov_letter | internal | complaint |
                                        -- report | contract | leave_request | other
  sender_kind           enum            -- citizen | company | government | internal
  sender_name           text
  sender_contact        text null
  priority              enum            -- normal | urgent | very_urgent
  status                enum            -- draft | registered | in_flow | closed | cancelled

  current_room_id       bigint fk -> room null   -- denormalized; the "ئێستا لای" column
  current_step_id       bigint fk -> routing_step null

  plot_no               text null       -- "247/5"
  neighbourhood         text null       -- "سەرچنار"

  physical_shelf        text null       -- where the paper original lives
  physical_folder       text null
  physical_section      text null

  closed_at             timestamptz null
  created_at            timestamptz
  updated_at            timestamptz

  index on (current_room_id, status)
  index on (incoming_year, incoming_seq)
  gin index on subject_search
```

### 4.3 Routing — the engine

```
routing_step
  id                bigint pk
  document_id       bigint fk -> document
  seq_no            int             -- 1, 2, 3 ... position in the chain
  sequence_group_id uuid null       -- shared by all steps of one sequence send

  from_room_id      bigint fk -> room null   -- null for the first step
  to_room_id        bigint fk -> room
  assigned_by       bigint fk -> user
  assigned_to       bigint fk -> user null   -- resolved to head or deputy at receive time

  sent_at           timestamptz null
  received_at       timestamptz null
  completed_at      timestamptz null
  due_at            timestamptz null

  status            enum   -- waiting | active | done | skipped | returned | cancelled
  action_taken      enum null  -- opinion | approved | rejected | forwarded |
                               -- letter_attached | handwritten_reply | no_action
  note              text null      -- the mayor's instruction to this room
  reply_note        text null      -- what the room wrote back

  return_to_assigner bool default false  -- the "بگەڕێتەوە بۆ من" checkbox

  index on (to_room_id, status)
  index on (document_id, seq_no)
```

**How it works.** Sending to one room inserts one row with `status = active`. Sending by sequence inserts N rows in one transaction: the first `active`, the rest `waiting`. When a room completes its step, the system sets that row to `done` and promotes the next `waiting` row in the same `sequence_group_id` to `active`, updating `document.current_room_id`. If the last step has `return_to_assigner = true`, one more step is appended back to the assigner's room.

This single table produces the trail view, the inbox queries, the overdue report, and the elapsed-time figures. Nothing else needs to be stored.

### 4.4 Saved routes

```
route_template
  id            bigint pk
  name          text        -- "ڕێڕەوی مۆڵەتی بیناسازی"
  description   text
  created_by    bigint fk -> user
  is_active     bool

route_template_step
  id                    bigint pk
  route_template_id     bigint fk
  seq_no                int
  room_id               bigint fk -> room
  due_days              int
```

At 25–30 rooms this is the highest-value convenience feature in the system.

### 4.5 Files

```
attachment
  id                bigint pk
  document_id       bigint fk -> document
  routing_step_id   bigint fk -> routing_step null   -- which hop produced it
  kind              enum  -- original_scan | handwritten_reply | attached_letter |
                          -- drawing | supporting | outgoing_copy
  original_name     text
  stored_path       text      -- files/2026/09/<uuid>.pdf
  mime_type         text
  size_bytes        bigint
  page_count        int null
  sha256            text      -- integrity check and duplicate detection
  uploaded_by       bigint fk -> user
  uploaded_at       timestamptz
```

### 4.6 The drawing archive (rooms 8 and 9)

Separate from `attachment` on purpose: one drawing is referenced by many letters across many years.

```
archive_file
  id                bigint pk
  title             text          -- "پارچە ٢٤٧/٥ — نەخشەی ڕێکخستنی زەوی"
  title_search      text          -- normalized, indexed
  plot_no           text null
  block             text null
  neighbourhood     text null
  owner_names       text null     -- historic owners, searchable
  year              int null
  file_type         enum          -- dwg | dxf | pdf | jpg | tif
  original_name     text
  stored_path       text
  preview_path      text null     -- generated or manually uploaded PDF/PNG
  size_bytes        bigint
  sha256            text

  shelf             text          -- "C-12"      ← physical location
  folder_no         text          -- "47"
  section           text          -- "2"
  box_no            text null

  uploaded_by       bigint fk -> user
  uploaded_at       timestamptz
  verified_at       timestamptz null   -- a second person confirmed the index data

  gin index on title_search
  index on (plot_no)
  index on (shelf, folder_no)

document_archive_file          -- many to many
  document_id   bigint fk
  archive_file_id bigint fk
  linked_by     bigint fk -> user
  linked_at     timestamptz
```

### 4.7 Templates, leave, external sends, log

```
template
  id, name, description, room_id, body_html, field_schema jsonb,
  is_active, created_by, updated_at

template_fill
  id, template_id, document_id (nullable), filled_by, values jsonb,
  rendered_path, printed_at

leave_record
  id, user_id, leave_type (annual|sick|necessity|unpaid),
  start_date, end_date, working_days,
  status (requested|approved|rejected|cancelled),
  requested_at, approved_by, approved_at,
  document_id (the leave request letter), note

external_send
  id, document_id, channel (email|whatsapp|post|hand),
  recipient_name, recipient_address, subject, body,
  attachment_ids bigint[], sent_by, sent_at,
  status (queued|sent|failed|delivered), error_text,
  response_received_at, response_attachment_id

activity_log                    -- append only, no update, no delete
  id, occurred_at, user_id, room_id, document_id,
  action, detail jsonb, ip_address, user_agent
  index on (occurred_at desc)
  index on (document_id, occurred_at)
  index on (user_id, occurred_at)

system_setting
  key, value jsonb, updated_by, updated_at
  -- includes: system_locked, lock_message, lock_by, lock_at
```

### 4.8 Number issuing

Incoming and outgoing numbers must never be composed by the browser. Two clerks registering at the same second will otherwise produce the same number.

```
number_counter
  kind        enum ('incoming','outgoing')
  year        int
  next_value  int
  primary key (kind, year)
```

Issue inside the same transaction that inserts the document:

```sql
UPDATE number_counter
   SET next_value = next_value + 1
 WHERE kind = 'incoming' AND year = 2026
RETURNING next_value - 1;
```

Never reuse a number, even if the document is cancelled. Cancelled documents keep their number and show as cancelled. A gap in the register is a red flag that auditors look for.

---

## 5. Core workflows

### 5.1 Register incoming
1. Letter arrives at the registry room.
2. Clerk scans it. The scan lands in a watched folder.
3. Clerk opens the registration form. The next incoming number is shown, locked.
4. Clerk fills sender, subject, type, priority. Attaches the scan from the watched folder.
5. Clerk optionally records the physical shelf where the paper goes.
6. Save. Two options: **register only**, or **register and send**, which opens the routing dialog.
7. Log entry written.

### 5.2 Route to one room
1. Sender picks a room from the searchable picker.
2. Optional note and due days.
3. One `routing_step` created, `active`. `document.current_room_id` updated.
4. Target room's inbox count increases. Optional notification.

### 5.3 Route by sequence
1. Sender chooses **بە ڕیزبەندی**, then either picks a saved route or builds one.
2. Rooms are ordered by drag. Each gets its own due days.
3. Optional "return to me when finished".
4. All steps created in one transaction, first active.
5. As each room completes, the next activates automatically.

### 5.4 A room acts on a letter
1. Room head opens it from the inbox. `received_at` is stamped on first open.
2. Three ways to answer:
   - **Print, write by hand on the back, scan, attach** as `handwritten_reply`.
   - **Attach a new letter** written in the system or uploaded as `attached_letter`.
   - **Note only**, typed into `reply_note`.
3. Then either forward to the next room, or if this is the last step, mark ready for outgoing.
4. A room can also **return** a letter to whoever sent it, with a reason. This creates a `returned` step, not a deletion.

### 5.5 Close and register outgoing
1. Registry sees documents whose last step is done.
2. Clerk opens the outgoing form. Next outgoing number is issued.
3. Clerk picks which attachments go out, records the send channel, writes the reply summary.
4. Save closes the document, stamps `closed_at`, clears `current_room_id`.
5. The document is now findable in the archive but no longer in any inbox.

### 5.6 Archive search and retrieval
1. Search by plot number, owner name, neighbourhood, folder number, or free text.
2. Results show the file, its type, and **the shelf, folder and section where the paper lives**.
3. Actions: preview, download, print, attach to a document, send externally.

### 5.7 Deputy delegation
When a leave record becomes active for a room head, incoming steps for that room are assigned to the deputy automatically, and the inbox shows a banner saying who is covering. When the leave ends, assignment reverts. Without this, letters stop dead in an empty room, which is exactly how the paper system fails today.

---

## 6. Kurdish text handling

**This is the highest technical risk in the project.** If search does not work, the rooms 8 and 9 requirement fails, and that requirement is the reason the project exists.

Sorani written in Arabic script has heavy spelling variance. Staff type on mixed keyboards. The same word appears three ways in the same folder.

### 6.1 Normalisation table

Apply on write into `*_search` columns, and apply identically to every query string. Keep the original text untouched for display.

| Input | Fold to | Reason |
|---|---|---|
| `ي` U+064A | `ی` U+06CC | Arabic yeh from an Arabic keyboard |
| `ك` U+0643 | `ک` U+06A9 | Arabic kaf |
| `ه` U+0647 at word end | `ە` U+06D5 | the single most common Sorani error |
| `ه‌` U+0647 + ZWNJ | `ە` U+06D5 | older typing convention |
| `ة` U+0629 | `ە` U+06D5 | |
| `أ إ آ ٱ` | `ا` | hamza carriers |
| `ؤ` | `و` | |
| `ڕ` U+0695 | `ر` | people omit the ring |
| `ڵ` U+06B5 | `ل` | people omit the ring |
| `ۆ` U+06C6 | `و` | frequently confused |
| `ێ` U+06CE | `ی` | frequently confused |
| `٠١٢٣٤٥٦٧٨٩` | `0123456789` | Arabic-Indic digits |
| `۰۱۲۳۴۵۶۷۸۹` | `0123456789` | Extended Arabic-Indic |
| U+200C ZWNJ, U+200D ZWJ, U+FEFF | remove | invisible, breaks every match |
| U+0640 tatweel | remove | decorative stretching |
| U+064B–U+0652 harakat | remove | diacritics |
| Repeated whitespace | single space | |

Folding `ڕ ڵ ۆ ێ` is deliberate. It loses precision but catches how people actually type. Precision is recovered by ranking exact matches higher.

### 6.2 Search implementation
- PostgreSQL with the `pg_trgm` extension.
- A GIN trigram index on each `*_search` column.
- Query: normalise the input, then `similarity()` ranked, with an exact-prefix boost.
- Plot numbers get their own exact-match path: `247/5`, `247-5` and `٢٤٧/٥` must all find the same record.

### 6.3 Display
- Every page is `dir="rtl"`.
- Latin runs — filenames, usernames, file types — must be wrapped in `dir="ltr"` or they render scrambled.
- Fonts: **Noto Kufi Arabic** for headings, **Vazirmatn** for body. Both cover the Kurdish extended characters `ڕ ڵ ۆ ێ ە`. Bundle them locally; do not depend on a CDN, because the server is on a LAN.
- Digits: use Arabic-Indic in the interface. Store Western digits in the database.

### 6.4 Sorting
Kurdish alphabetical order is not the same as Unicode code point order. Use a Kurdish collation table for name lists, or accept code-point order in v1 and document it as a known limitation.

---

## 7. Architecture

### 7.1 Deployment

**On premises, inside the municipality building.** Not cloud. Land records and citizen data should not leave the building, and the internet connection is not reliable enough to hold the office hostage.

```
                    [ Municipality LAN ]
                            |
   +------------------------+------------------------+
   |                        |                        |
[ Staff PCs ]        [ Network scanners ]      [ App server ]
 browser only         scan-to-folder            - web app
                                                - PostgreSQL
                                                - file storage
                                                - watched scan folder
                                                on UPS
                            |
                    [ Backup drive + offsite encrypted copy ]
```

### 7.2 Stack recommendation

Choose boring technology. Someone in Rania has to maintain this after handover.

| Layer | Recommendation | Why |
|---|---|---|
| Database | PostgreSQL 16+ | `pg_trgm` for Kurdish search, proper transactions for number issuing, JSONB for the log |
| Backend | Whatever the team already knows well — .NET, Laravel, or Node with Express | These are form-and-table screens. Familiarity beats fashion |
| Frontend | Server-rendered pages with light JavaScript | Not a single-page app. Fewer moving parts, works on old PCs, survives refresh |
| Files | Plain filesystem, path `files/YYYY/MM/<uuid>.<ext>` | Never store binaries in the database |
| Auth | Local accounts, bcrypt or argon2, session cookies | No external identity provider on a LAN |
| Reports | Server-side PDF generation | Print is a first-class feature here |

### 7.3 File handling

**DWG cannot be displayed in a browser.** It is a closed binary format. Three options:

1. **Store and download only.** Cheapest. Staff open it in AutoCAD.
2. **Require a PDF alongside.** The uploader attaches both the DWG and a PDF export. Preview shows the PDF. Recommended for version one.
3. **Server-side conversion.** The free ODA File Converter handles DWG to DXF and PDF. Autodesk Platform Services does it in the cloud but costs money and needs internet.

Ship option 2. Revisit option 3 once the archive is populated.

### 7.4 Scanning workflow

This detail decides adoption more than any screen.

- One network scanner per floor, minimum. Set to scan-to-folder over SMB.
- The server watches those folders. New files appear in a tray in the interface, tagged with the scanner and timestamp.
- The clerk attaches from the tray in one click. No file browsing, no USB drives.
- Files older than 7 days in the tray are archived, not deleted.

If registering a letter takes four minutes of walking, staff will quietly go back to paper.

### 7.5 The system lock

The mayor asked to be able to shut the system down. What he needs is a **maintenance lock**, not a power off:

- Sets `system_locked = true` with a message.
- Every session except the mayor's is invalidated.
- Every login except the mayor's is refused, showing his message.
- The action is written to the log with who, when and why.
- Unlocking is one click.

A literal power-off leaves no audit trail and no clean way back in. Offer both if he insists, but default to the lock.

### 7.6 The assistant — a real bot, still free

The mayor asked for something he can talk to, not a menu of buttons. That is achievable, offline, and at no licence cost. The design that makes it both smart and trustworthy is **tool calling**.

#### How it works

The model never answers from its own knowledge. It reads the question, decides which database function to call, receives real rows back, and writes the reply from those rows only.

```
Mayor    "کتابی ٤٤٩٨ لای کێیە؟"
   |
Model    calls  find_document(number = "4498")
   |
System   returns { incoming_no:   "ه‌/٢٠٢٦/٤٤٩٨",
                   subject:       "گرێبەستی چاککردنەوەی ڕێگای بازاڕ",
                   current_room:  "ژووری یاسا",
                   holder:        "هێمن ڕەشید",
                   days_waiting:  3,
                   previous_room: "سەرۆکی شارەوانی" }
   |
Model    "کتابی ژ. ه‌/٢٠٢٦/٤٤٩٨ ئێستا لە ژووری یاسایە، لای هێمن ڕەشید،
          و ٣ ڕۆژە چاوەڕوانە."
   |
Mayor    "ئەوەی پێش ئەوە لای کێ بوو؟"        <- follow-up, no number given
   |
Model    calls  document_trail(number = "4498")   using conversation context
```

The model handles language. The database handles facts. That split is what makes it feel smart while making it structurally unable to invent a document number.

#### The tools

Eight functions cover almost everything the mayor described. Each takes typed arguments and returns rows.

| Function | Answers |
|---|---|
| `find_document(number)` | Where is letter N, and what is it about |
| `document_trail(number)` | Who has held it, for how long, and what they did |
| `list_room_queue(room, status?, priority?, older_than_days?)` | What is waiting in a room |
| `find_overdue(room?, min_days?)` | What is stuck, anywhere |
| `count_documents(from, to, direction, room?)` | Volume questions |
| `room_performance(period)` | Which rooms are slow |
| `search_archive(query, plot?, neighbourhood?, year?)` | Drawing lookups |
| `staff_on_leave(date)` | Who is away, and who is covering |

These are the same queries the reports in §9 need. Build the reports and you already have most of the bot.

#### Guard rails

Non-negotiable, and easy to get wrong:

1. **Read-only database user.** The bot's connection physically cannot write.
2. **No raw SQL from the model, ever.** It calls named functions with typed arguments. Nothing else reaches the database.
3. **Permission filtering lives in the function, not the prompt.** Every function takes the asking user's identity and returns only rows that user may see. The mayor sees all rooms; a room head sees his own. Never enforce this in a system prompt, because a system prompt can be talked around.
4. **Every answer cites document numbers,** and those come from rows, never from the model.
5. **No rows means no answer.** The bot says it found nothing. It never fills the gap.
6. **Every question and answer is written to the activity log.**

#### Three ways to run it

The tool-calling design above is identical in all three. What changes is where the model runs, what it costs, and how good the Kurdish is.

| | Local open model | Hosted open model | Hosted frontier |
|---|---|---|---|
| Example | Qwen 14B on your own card | Qwen 235B through a provider | Claude Sonnet 5 |
| Up-front | $1,000–2,500 | $0 | $0 |
| Monthly | $0 | ~$10–80 | ~$430 |
| Kurdish quality | Adequate | Good | Very good |
| Works without internet | Yes | No | No |
| Data leaves the building | Nothing | Questions and result rows | Questions and result rows |
| Operational burden | Real: serving, quantising, tuning | None | None |
| Ceiling | Fixed until you re-tune | Rises with the open models | Rises with the frontier |

**The choice is not really three-way on quality.** Renting Qwen does not make Qwen better at Kurdish; quality is a property of the model, not the host. The meaningful split is: Qwen-class Kurdish, which you can have free on your own hardware, versus frontier Kurdish, which only comes hosted.

#### How to decide — measure, do not argue

This question is settled cheaply with evidence rather than opinion:

1. Write **50 real Kurdish questions with correct answers**, taken from what the mayor and room heads actually ask.
2. Run them through each candidate: local Qwen 14B, a hosted large Qwen, and a frontier model.
3. Have a Kurdish speaker grade the answers **blind**, not knowing which model produced which.
4. Pick the cheapest one that passes.

That costs a few dollars in API calls and half a day of someone's time, and it replaces an argument with a number. Do it in **phase 0** — it needs no working system, only the question list.

#### Option A — local open model

Covered in full below under "Which model", "Making the Kurdish good" and "Capacity, hardware and cost". Free forever, works offline, nothing leaves the building. The Kurdish is the weak point.

#### Option B — hosted open model (Qwen and similar)

Renting an open model is dramatically cheaper than a frontier API, and for a municipal budget that matters. Indicative third-party pricing — **verify current rates, these move constantly and vary by provider**:

| Model class | Indicative in / out per 1M | Monthly at our load |
|---|---|---|
| Qwen3 8B class | ~$0.04 / $0.10 | **~$10** |
| Qwen3 32B class | ~$0.10 / $0.30 | **~$28** |
| Qwen3 235B class | ~$0.35 / $0.40 | **~$80** |

Four things to weigh:

1. **Hosting Qwen does not improve Qwen's Kurdish.** Paying for a hosted 32B buys roughly what the graphics card buys for free, minus offline operation and minus data staying in the building. The genuine reason to rent instead of buy is access to the **very large models you cannot run on one consumer card**. A 235B-class Qwen writes noticeably better Kurdish than 14B, and $80 a month for that is a real bargain against $430.
2. **Know which provider you are actually talking to.** Aggregators route to whoever is cheapest that minute; quantisation, latency and quality vary between them, and some log prompts for training unless you opt out. For municipal data, read the retention policy of the **specific provider**, not the aggregator's.
3. **Data residency.** The first-party Qwen API is operated from China. For a government body that is a question to answer deliberately, exactly as the privacy section answers it for any hosted option.
4. **Small models are unreliable at tool calling.** Emitting valid JSON every time is what keeps the bot working at all. 32B and above is dependable; 7 to 8B is not. Do not buy the very cheapest tier for a tool-calling agent — a broken tool call is a broken answer.

##### The efficient hybrid

Most questions are one lookup and one sentence, which a small model handles fine. Route only ambiguous or multi-step questions to a better model. Ninety percent cheap, ten percent good, and the mayor meets the better model precisely on the questions that need it.

#### Option C — hosted frontier API

##### What actually crosses the wire

This matters more than people assume, and the tool-calling design changes the answer. The API receives:

- The question the user typed.
- The rows a function returned: document number, subject line, room name, holder name, dates.

It never receives scanned letters, attachments, PDF contents or identity documents. The exposure is **metadata, not correspondence**. Subject lines do carry citizen names and plot numbers, so this is not nothing, but it is a far smaller surface than "all municipal correspondence leaves the country". Zero-retention arrangements are available from providers for organisations that require them.

##### Cost, at the load in the capacity table

66,000 questions a month. Per question roughly 3,000 input tokens, of which about 2,000 is the fixed system prompt and tool schemas, and 400 output tokens.

**Prompt caching is the whole game here.** That 2,000-token prefix is byte-identical on every single call. Cached, it is read at about a tenth of the input price.

| Model | Model ID | Input / Output per 1M | Monthly, cached |
|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | $5 / $25 | **~$1,080** |
| Claude Sonnet 5 | `claude-sonnet-5` | $2 / $10 | **~$430** |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | **~$240** |

Without caching those become roughly $1,650, $660 and $330. The cache is worth having.

##### The caching trap that would cost you silently

The minimum cacheable prefix is model-dependent, and it is **not** smaller on cheaper models:

| Model | Minimum prefix to cache |
|---|---|
| Claude Opus 5 | 512 tokens |
| Claude Sonnet 5 | 1,024 tokens |
| Claude Haiku 4.5 | 4,096 tokens |

A 2,000-token system prompt caches on Opus 5 and Sonnet 5. On **Haiku 4.5 it silently does not cache at all** — no error, no warning, just a bill about 40% higher than expected.

The fix is a happy one. Pad the Haiku system prompt past 4,096 tokens with **more hand-written Kurdish answer examples**. That crosses the caching threshold and improves the Kurdish at the same time. Two problems, one edit.

##### Caching rules to follow

1. **Freeze the system prompt.** Never interpolate today's date, the user's name or a request ID into it. Anything at the front of the prefix invalidates everything after it on every single call. Put dynamic context in the messages instead.
2. **Serialise tool definitions deterministically,** sorted by name. Tools render at position zero; reordering them invalidates the whole cache.
3. **Use the five-minute cache lifetime.** Office-hours traffic keeps it warm continuously, and a read refreshes the timer for free.
4. **Verify with `cache_read_input_tokens` in the response.** If it is zero across repeated questions, something in the prefix is changing. This failure is silent: requests still succeed, the bill is just higher.

##### Recommendation

**Claude Sonnet 5 is the sweet spot** at roughly $430 a month: excellent Kurdish, strong tool calling, and a large context window. Claude Opus 5 is the better model and the right choice if quality outweighs cost. Claude Haiku 4.5 at roughly $240 is genuinely viable here, because the database does the reasoning and the model mostly has to phrase an answer.

A routing split is the efficient middle: send routine lookups to Haiku and anything ambiguous or multi-step to Sonnet. That lands near $300 a month at close to Sonnet quality.

##### The two real drawbacks

- **It stops when the internet stops.** Rania's connection is not guaranteed, and a bot the mayor relies on that dies with the link is worse than no bot. Keep the rules-and-SQL fast path as an offline fallback, so questions still get answered when the line is down.
- **It is a recurring bill.** Sonnet 5 costs roughly $5,200 a year, against a one-time $1,000 to $2,500 for the local hardware. The API buys quality, not savings.

#### Detail for the local option
#### Which model

Tool calling needs a model that reliably emits structured JSON. That rules out the smallest ones.

| Model | Licence | Tool calling | Sorani |
|---|---|---|---|
| **Qwen 3 14B**, or Qwen 2.5 14B Instruct | Apache 2.0 | Strong | Best of the open family for Arabic script |
| Qwen 3 32B | Apache 2.0 | Strongest | Noticeably better Kurdish, needs more VRAM |
| Gemma 3 12B | Google open licence | Adequate | Reasonable |
| Mistral Small 3 | Apache 2.0 | Strong | Weak Kurdish |
| Aya, Aya Expanse | **Non-commercial** | — | Avoid. Do not make the municipality answer a licence question |

Start with **Qwen 3 14B quantised to 4-bit**, served by Ollama. Move up to 32B if the Kurdish reads badly and the hardware allows.

#### Making the Kurdish good

This is where the effort actually goes. Three free techniques, and they compound:

1. **Few-shot the system prompt.** Put twenty correct, hand-written Kurdish answer sentences in the prompt. Open models write far better Sorani when they have real examples to pattern-match against. This is the cheapest win by a wide margin.
2. **Template the skeleton, let the model fill it.** Give each tool a Kurdish answer template. The model adapts it rather than composing from nothing.
3. **Fine-tune later, also free.** After a few months, collect several hundred real question-and-answer pairs from the log, correct the Kurdish by hand, and LoRA fine-tune Qwen with Unsloth on the same graphics card. No cloud, no cost, and it is the biggest single quality jump available.

#### Capacity, hardware and cost

"Five to six hours of use per person per day" is the wrong unit, and it is worth correcting before anyone buys hardware. Nobody generates text for five hours. They leave a chat panel open and ask a handful of questions. What sizes the machine is **questions per day**, and **how many arrive in the same second**.

##### Load estimate

| | |
|---|---|
| Staff with a login | ~150 |
| Staff who actually use the bot | ~100 |
| Questions per person per working day, heavy use | 30 |
| **Questions per day** | **~3,000** |
| Average across an eight-hour day | one every ten seconds |
| Realistic peak, first hour of the morning | one to two per second |

##### Tokens per question

| Part | Tokens |
|---|---|
| System prompt: tool schemas plus Kurdish examples | ~2,000, cacheable |
| Conversation history | ~500 |
| The question itself | ~50 |
| Tool call the model emits | ~80 |
| Rows returned by the database | ~400 |
| The Kurdish answer | ~300 |
| **Per question** | **~3,000 in, ~400 out** |

Kurdish in Arabic script tokenises poorly, roughly two to three tokens per word against about 1.3 for English. The figures above already allow for that.

##### What that means for hardware

Three thousand questions at 400 output tokens each is 1.2 million output tokens a day. A used RTX 3090 running Qwen 14B at 4-bit, served with vLLM, produces roughly 400 to 800 tokens a second across batched users. The entire day's work is therefore **thirty to fifty minutes of actual GPU time, spread across eight hours**.

One card covers the whole municipality. The bot sits idle around 85% of the time even under heavy use. Adding more users barely moves the hardware requirement. What moves it is how many people press send at the same moment.

##### Sizing

| Staff using the bot | Questions/day | Card | Model |
|---|---|---|---|
| Up to 30 | ~900 | Used RTX 3060, 12 GB | Qwen 14B, 4-bit |
| 30 to 100 | ~3,000 | RTX 4060 Ti 16 GB, or used 3090 | Qwen 14B, 4-bit |
| 100 to 200 | ~6,000 | Used RTX 3090, 24 GB | Qwen 14B, or 32B for better Kurdish |
| Best possible Kurdish | any | Two used 3090s, or one 48 GB card | Qwen 32B at higher precision |

CPU-only is possible and free, but produces three to six words per second. One person will tolerate it. A building will not.

##### Serve with vLLM, not Ollama, above about ten users

Ollama is excellent for development and for a handful of people, but it does not batch concurrent requests well. **vLLM** is equally free and delivers roughly five to ten times the throughput on the same card. Develop on Ollama, deploy on vLLM.

At peak, twenty simultaneous questions on one 3090 means the last person waits eight to fifteen seconds. That is acceptable provided the interface shows a visible thinking state. Silence is what makes people think it is broken.

##### Cost

Indicative USD. Obtain local quotes: prices in Iraq carry import margin, and graphics card prices move constantly.

| Item | One-time | Recurring |
|---|---|---|
| Used RTX 3060, 12 GB | $200–300 | — |
| Used RTX 3090, 24 GB | $700–1,100 | — |
| The rest of the server, if not already budgeted | $800–1,500 | — |
| Larger power supply and cooling | $100–200 | — |
| Ollama, vLLM, Qwen weights, Unsloth | $0 | $0 |
| Electricity, ~350 W under load at ~15% duty | — | a few dollars a month |

**One purchase of roughly $1,000 to $2,500** buys a machine that runs both the application and the bot. After that, effectively nothing.

##### The cloud comparison

The same load through a paid API is about **198 million input and 26 million output tokens a month**.

| Tier | Rough monthly cost |
|---|---|
| Claude Haiku 4.5, cached | ~$240 |
| Claude Sonnet 5, cached | ~$430 |
| Claude Opus 5, cached | ~$1,080 |

Prompt caching would cut the input side substantially, since the 2,000-token system prompt repeats on every call. Even so, this is a bill that arrives every month forever, and every question sends municipal correspondence outside the country. The graphics card pays for itself inside a year and then costs nothing.


#### The fallback layer

Keep a rules-and-SQL matcher, but as a **fast path and a safety net**, not as the product:

- The handful of most common questions skip the model entirely and answer instantly.
- If the graphics card, the model or the server is down, the bot degrades to templated answers instead of breaking.

#### Effort, honestly

The tool-calling bot is roughly **five to seven weeks**, against two to three for rules alone, and it needs the hardware above. In exchange the mayor gets follow-up questions, vague questions, combined conditions and a genuine conversation. That is what he asked for.

#### What not to do — free cloud tiers

Google AI Studio, Groq and others offer generous free tiers. Avoid them here, and the reason is not price:

- Every question would send municipal correspondence to a third-party server outside Iraq.
- Free tiers carry rate limits, change without notice, and can be withdrawn entirely.
- A system the mayor depends on should not rest on someone else's promotional pricing.

#### One reframe still worth making

Much of what people expect from a bot here is really good search. The trigram search in §6 costs nothing and answers "everything about plot 247/5" better than any language model would. Build the search well first, and the bot has less work left to do.

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Any inbox or search screen renders in under 2 seconds on a 5-year-old office PC |
| Archive search | Results in under 3 seconds across the full drawing archive |
| Concurrency | 50 simultaneous users without degradation |
| Availability | Office hours. Planned maintenance outside them |
| Backup | Nightly full database dump plus incremental file sync to an external drive. Weekly encrypted copy taken off site |
| Restore | A documented restore drill performed before go-live and every six months after |
| Retention | Nothing is ever hard-deleted. Cancellation and archival are status changes |
| Audit | Every read of a document's contents is logged, not only every write |
| Passwords | Minimum length enforced, forced change on first login, no shared accounts |
| Sessions | Idle timeout, and a visible list of active sessions for the administrator |
| Data at rest | Full disk encryption on the server |
| Uploads | Type whitelist, size cap, virus scan on arrival, and the stored path must never be derived from the user-supplied filename |

---

## 9. Screens

Nine screens are already designed and approved. The canvas is the visual reference for build.

| # | Screen | Status |
|---|---|---|
| 1 | Login | Designed |
| 2 | Mayor's dashboard | Designed — **needs rework for 25–30 rooms** |
| 3 | Registry: incoming | Designed |
| 4 | Room inbox | Designed |
| 5 | Document detail and trail | Designed |
| 6 | Send by sequence | Designed — **needs a searchable room picker** |
| 7 | Drawing archive search | Designed |
| 8 | Administration: templates and leave | Designed |
| 9 | Outgoing and close | Designed |

Still to design:

| # | Screen | Notes |
|---|---|---|
| 10 | Directorate head overview | Only if the answer to Q2 is "hierarchical" |
| 11 | User and room administration | IT-facing, can be plain |
| 12 | Activity log browser with filters | Mayor-facing, needs care |
| 13 | Reports: volume, overdue, per-room throughput | |
| 14 | Template fill and print view | |
| 15 | Saved route management | |
| 16 | Scan tray | |
| 17 | System lock screen | |
| 18 | Search results across everything | |

---

## 10. Phases

Assumes one backend developer, one frontend developer, and a part-time lead. Municipality staff supply data entry. Adjust the week counts to your actual team.

### Phase 0 — Discovery (2 weeks)
**Goal:** answer the twelve open questions and freeze scope.

- Interview the mayor, the registry clerk, and three room heads.
- Sit in the registry room for a full day and count letters.
- Photograph the current register book pages.
- Walk rooms 8 and 9. Count shelves, folders and estimate file volume.
- Collect twenty real letters covering the common types.
- Collect every blank form the office photocopies.
- Audit the network, PCs, scanners and power.

**Exit criteria:** all twelve questions answered in writing, room list frozen, form inventory complete.

### Phase 1 — Registry and routing (6–8 weeks)
**Goal:** replace the paper register. This is where all the value is.

Build:
- Users, rooms, directorates, roles, login, system lock
- Incoming registration with atomic numbering
- Attachment upload and the scan tray
- Routing to one room
- Routing by sequence, with saved routes
- Room inbox with filters and tabs
- Document detail with the full trail
- Handwritten reply loop: print, scan, attach
- Outgoing registration and case closing
- Activity log, append-only, with the mayor's view
- Mayor's dashboard, exception-first, grouped by directorate
- Print views for the register book and any document

**Exit criteria:** a letter can be registered, routed through three rooms, answered by hand, and closed, entirely in the system. The printed register page matches the paper book format.

### Phase 2 — Drawing archive (4–6 weeks of development, running alongside a much longer data-entry track)
**Goal:** make rooms 8 and 9 searchable.

Build:
- Archive upload with plot, neighbourhood, year and physical location fields
- Kurdish-normalised search with trigram ranking
- Bulk upload for the digitisation team
- Preview for PDF and images, download for DWG
- Attach an archive file to a document
- Duplicate detection by checksum
- A verification queue so a second person confirms each index record

**Exit criteria:** any drawing can be found by plot number, owner name or neighbourhood in under three seconds, and the result tells you which shelf the paper is on.

### Phase 3 — Templates and leave (3–4 weeks)
Build:
- Template editor and field schema
- Fill, preview, print, and optionally attach to a document
- Leave request, approval chain, expiry warnings
- Deputy delegation wired to leave records
- The administration room screen

**Exit criteria:** the six most-used paper forms are in the system, and a leave request flows from request to approval to automatic deputy handover.

### Phase 4 — External sending, reports and the assistant (6–8 weeks)
Build:
- Email sending with attachments
- WhatsApp handoff, see the warning in §11
- Inbound response capture, linking a reply back to its document
- Reports: monthly volume, overdue by room, throughput per room, average close time
- The tool-calling assistant on a local model, with the rules fast path behind it

**Exit criteria:** the mayor can ask in his own words, ask a follow-up without repeating the number, and get an answer that cites the document it came from.

### Phase 5 — Hardening and handover (3 weeks)
- Load testing at 50 concurrent users
- Full backup and restore drill
- Security review: permissions, uploads, session handling
- Administrator documentation in Kurdish
- User training material and short videos
- Two weeks of hypercare after go-live

---

## 11. The digitisation track

**This runs from day one, in parallel with all development, and it is the long pole of the project.**

The archive in rooms 8 and 9 does not digitise itself. Someone has to open every folder, scan or photograph every drawing, and type in the plot number, neighbourhood and shelf position.

### Throughput maths
Work this out with real numbers once Q6 is answered. The shape of the calculation:

```
files ÷ (files indexed per person-hour × hours per day × people) = working days
```

Large-format drawings are slow. A realistic rate is 15 to 30 files per person-hour including indexing, and lower for fragile old paper. A ten-thousand-file archive with two people working full time is measured in months, not weeks.

### What is needed
- A large-format scanner, or a copy stand with a good camera for oversized sheets
- Two to three dedicated staff, not people doing this "when free"
- A frozen naming convention agreed before the first file is scanned
- A daily target and a visible progress board
- Quality control: a second person verifies a sample of every day's work
- Start with the plots most often requested, not with folder 1. Value arrives sooner

### Naming convention
Agree this in week one and never change it:

```
<plot>_<neighbourhood>_<type>_<year>.<ext>
247-5_sarchnar_tanzimi_2019.dwg
```

The filename is a convenience. The database record is the truth. But a consistent filename makes recovery possible if the database is ever lost.

---

## 12. Rollout

1. **Pilot with three rooms** for four weeks: the registry, legal, and one busy room. Small enough to fix problems, real enough to prove the flow.
2. **Run in parallel with paper.** Every letter is registered in both the book and the system. This is deliberately doubled work and it must be time-boxed to four weeks, or people will never let go of the book.
3. **Compare the two registers weekly.** Any divergence is a bug or a training gap.
4. **Cut over** only when a full week shows no divergence.
5. **Expand room by room**, not all at once. Each room gets a one-hour session and a printed one-page guide in Kurdish.

### Training
- Registry clerks need the most: two half-day sessions.
- Room heads need thirty minutes: open, print, reply, forward.
- The mayor needs fifteen minutes and a printed card.
- Record short screen videos in Kurdish. People rewatch those; they do not reread manuals.

---

## 13. Risks

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Kurdish search does not match how people type | Project fails its main purpose | High if unaddressed | Implement §6 normalisation in phase 1, not phase 2. Test with real staff typing real queries |
| Archive digitisation is under-resourced | Phase 2 delivers an empty search box | High | Fund and staff it from day one. Track daily throughput publicly |
| Scanning is inconvenient | Staff revert to paper | Medium | Network scanners with scan-to-folder and the scan tray. Measure registration time |
| Power cuts corrupt data | Data loss | Medium | UPS on the server, database write-ahead logging, nightly verified backups |
| Room list changes mid-build | Rework | Medium | Rooms are data, not code. Never hardcode a room |
| No maintainer after handover | System decays | Medium | Boring stack, Kurdish documentation, train two municipality IT staff during phase 5 |
| Mayor's dashboard unusable at 30 rooms | The sponsor stops using it | Medium | Exception-first design, agreed with him before build |
| Scope creep into a full ERP | Never ships | High | Anything about payroll, accounting, tax or citizen self-service is out of scope. Write it down |
| WhatsApp API approval delays | Phase 4 slips | Medium | Ship the link-based handoff first, see §14 |

---

## 14. Things that will surprise you

- **WhatsApp cannot send arbitrary files** without a Meta business account, a verified number, and pre-approved message templates. Version one should open WhatsApp with the recipient and text prefilled and let the staff member attach the file. Full API integration is a phase 4 decision, not an assumption.
- **Email from an on-premises server** often lands in spam. Use the municipality's existing mail provider over SMTP rather than sending directly.
- **Numbers must never be reused,** even for cancelled letters. Auditors look for gaps.
- **Old drawings are physically fragile.** Budget for handling care, not just scanning speed.
- **The register book is a legal record** in many jurisdictions. Confirm with the municipality's legal room whether the paper book must continue in parallel permanently. This changes the rollout plan.

---

## 15. Definition of done

The project is complete when all of the following are true:

- [ ] A letter registered in the system can be traced from arrival to closing without opening the paper book
- [ ] The mayor can see which rooms are overdue in one screen, without scrolling
- [ ] A drawing can be found by plot number and the result names its shelf and folder
- [ ] A room head on leave has their letters received by their deputy automatically
- [ ] The six most-used forms print correctly from the system
- [ ] A restore from backup has been performed successfully in front of the municipality's IT staff
- [ ] Two municipality staff can create users, reset passwords and take a backup unaided
- [ ] Administrator and user documentation exists in Kurdish
- [ ] Four consecutive weeks have passed with no divergence between the system and any paper record still kept

---

## 16. Budget categories

Prices are not estimated here; obtain local quotes. The categories to budget for:

**Hardware**
- Application server with UPS
- Backup drives, on site and off site
- Network scanners, one per floor
- A large-format scanner or copy stand for the drawing archive
- Network upgrades if the LAN does not reach every room
- A graphics card for the assistant: used RTX 3060 12 GB at minimum, used RTX 3090 24 GB for the best Kurdish. One card serves the whole building, see §7.6

**Software**
- Every recommended component is open source, the assistant included. Budget zero for licences unless the team chooses a commercial stack.

**People**
- Development team for the phase durations above
- Two to three digitisation staff for the length of the archive track
- Training delivery
- A support retainer for the first year

**Contingency**
- The archive track is the least predictable item. Carry contingency against it specifically.

---

## Appendix A — Glossary

| Kurdish | English |
|---|---|
| کتاب | official letter |
| دۆکیومێنت | document |
| هاتوو | incoming |
| دەرچوو | outgoing |
| ژوور | room, office |
| بەڕێوەبەرایەتی | directorate |
| ڕیزبەندی | sequence routing |
| هاوپێچ | attachment |
| بیروڕا | opinion |
| مۆڵەت | leave, or permit depending on context |
| مۆڵەتی بیناسازی | building permit |
| پارچە | land plot |
| گەڕەک | neighbourhood |
| نەخشەی بنەڕەتی | master plan |
| گرێبەست | contract |
| زەوی و زار | land and property |
| ژمێریار | accounts |
| کارگێڕی | administration |
| تۆماری چالاکی | activity log |
| ڕەفە | shelf |
| فۆڵدەر | folder |
| دۆسیە | case file |

## Appendix B — Reference

- Approved UI design canvas: https://claude.ai/code/artifact/e79aee3b-ff63-4be9-bb23-2534bb0e78cb
- Design source files: `design/*.dc.html`
