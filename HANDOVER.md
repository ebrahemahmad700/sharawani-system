# Testing guide — Rania Municipality document system

You are testing an unfinished system. This tells you how to get in, what each
room does, what is worth breaking, and what is already known to be missing so you
do not spend time reporting it.

## Get in

**https://sharawani01.vercel.app**

**Password for every account below: ask Ibrahim. It is kept out of the repo because the repo is public.**

Nothing to install. It works in any browser, on a phone too.

**Before anything else.** Every name, room, plot number and letter in this system
is invented. Please keep it that way. Do not type a real citizen's name, a real
plot number, or the text of a real letter into it, and do not paste anything from
it into a chat or an email. The system is being built for records that are
confidential, and the invented data exists so nobody has to touch the real thing
to try it.

---

## How a letter moves

This is the whole idea, and everything else follows from it.

A letter arrives at the front desk. The **registry** records it and it is given a
number it keeps forever. The registry sends it to a room, or to several rooms one
after another. Each room does its part and marks it done, and it moves on by
itself. When the work is finished the registry writes the reply, gives it an
outgoing number, and closes it.

At every moment the system knows which desk the paper is on. That is the point.

Two prefixes you will see. **ه** means incoming, **د** means outgoing. So
`ه/2026/25` is the twenty-fifth letter received this year. A third, **گ**, is a
delivery list, explained below.

---

## The paper and the screen are two different things

This is new, and it is the part most worth your attention.

The system used to record one arrival: somebody in the receiving room opened the
letter on screen. That is a useful fact and it is not the one the building cares
about. The registry sends a letter to Legal at ten in the morning, the screen says
Legal has it, and the folder is still in a tray by the photocopier at four in the
afternoon. Both statements were true and only one of them mattered.

So there are now two arrivals, recorded separately:

- **Opened on screen.** Somebody in the room looked at it.
- **Paper received.** Somebody in the room has the folder in their hand and said so.

Either can happen without the other, and the gap between them is the time the
paper spent in a corridor. A room's inbox now shows a **پەڕگە** column saying
whether the folder has actually turned up.

---

## The nine rooms

| Room | Number | What it is | Days allowed | Head | Deputy |
|---|---|---|---|---|---|
| ژووری هات و دەرچوو | — | Registry, the front desk | 1 | شیلان عومەر (`shilan`) | — |
| ژووری سەرۆکی شارەوانی | — | The mayor's office | 2 | ئارام حەمە (`aram`) | نەبەز تۆفیق (`nabaz`) |
| نەخشەی بنەڕەتی | 8 | Drawing archive | 3 | کاروان ئیبراهیم (`karwan`) | — |
| نەخشەی بنەڕەتی | 9 | Drawing archive | 3 | ژیان کەریم (`zhyan`) | — |
| گرێبەستە گشتییەکان | 14 | Public contracts | 5 | دلێر عەلی (`dler`) | ڕێبوار مستەفا (`rebwar`) |
| ژووری یاسا | — | Legal | 3 | هێمن ڕەشید (`hemin`) | ساکار ئەحمەد (`sakar`) |
| ژووری زەوی و زار | — | Land | 4 | هێرش قادر (`hersh`) | — |
| ژووری ژمێریاری | — | Accounts | 4 | سۆزان مەحمود (`sozan`) | — |
| ژووری کارگێڕی | — | Administration | 2 | بەفرین سەلام (`bafrin`) | شنە عەبدوڵا (`shne`) |

**Days allowed** is how long that room has before a letter counts as late. The
registry gets one day, contracts gets five, because a contract takes longer than
stamping a receipt.

**Deputy** matters. When a head is on approved leave, letters sent to that room
land on the deputy instead. Land and Accounts have no deputy, so a letter sent
there while the head is away simply waits. That is deliberate, not a bug.

---

## The sixteen accounts

| Username | Name | Role | Room |
|---|---|---|---|
| `aram` | ئارام حەمە | Mayor | Mayor's office |
| `nabaz` | نەبەز تۆفیق | Deputy mayor | Mayor's office |
| `shilan` | شیلان عومەر | Registry clerk | Registry |
| `ahang` | ئاھەنگ نەوزاد | Room clerk | Registry |
| `hemin` | هێمن ڕەشید | Room head | Legal |
| `sakar` | ساکار ئەحمەد | Room clerk | Legal |
| `dler` | دلێر عەلی | Room head | Contracts 14 |
| `rebwar` | ڕێبوار مستەفا | Room clerk | Contracts 14 |
| `hersh` | هێرش قادر | Room head | Land |
| `sozan` | سۆزان مەحمود | Room head | Accounts |
| `dana` | دانا فەرەج | Directorate head | Land |
| `bafrin` | بەفرین سەلام | Administration | Administration |
| `shne` | شنە عەبدوڵا | Room clerk | Administration |
| `karwan` | کاروان ئیبراهیم | Archive clerk | Base map 8 |
| `zhyan` | ژیان کەریم | Archive clerk | Base map 9 |
| `itadmin` | بەڕێوەبەری سیستەم | System administrator | none |

Use two browsers, or one ordinary window and one private window, so you can be
two people at once. That is where the interesting things happen.

---

## Who sees what

Not everyone sees the same screens, and that is the design rather than an
oversight.

| Screen | Who |
|---|---|
| Dashboard | Mayor and deputy only |
| Assistant | Mayor and deputy only |
| Registry | Registry, and anyone who registers a letter |
| Inbox | Everyone with a room |
| Barcode lookup | Everyone with a room. Not IT |
| Delivery lists | Everyone with a room except archive clerks. Not IT |
| Companies | Everyone with a room. Only the registry, room staff and the mayor's office may change anything |
| Transaction types | Registry and the mayor's office, and IT, who maintain the list |
| Drawing archive | Everyone except the registry, administration and IT. Only archive clerks, the mayor and the deputy may add or change |
| Forms | Everyone except archive clerks and IT |
| Scan tray | Everyone except administration and IT |
| Search box, top bar | Everyone with a room. Not IT |
| Sound switch | Everyone |
| Leave | Everyone. Only administration, the mayor and the deputy may approve |
| Users and rooms | IT only |
| Lock the system | Mayor only |
| Public tracking | Anybody at all, with no account |

**IT is the interesting one.** `itadmin` manages accounts and reads the activity
log, and cannot open a single letter, attachment, scan, delivery list or company
record. That is enforced by the database, not by hiding buttons. Try to get around
it.

---

## Fixed from the report of 13 September

Ten things were reported. Each is fixed, and each now has a test that fails if
it comes back. How to check each one yourself:

1. **Scrolling.** The mouse wheel and touchpad did nothing on any page; only
   dragging the scrollbar worked. Two lines of the stylesheet were stopping the
   scroll from reaching the page. Scroll any long list with the wheel. If a
   browser still does not scroll, press Ctrl+F5 once: it may be holding the old
   stylesheet.
2. **Removing a chosen file.** Every file box now lists what you chose, with a
   **لابردن ✕** button on each. On the scan tray you can choose several pages and
   remove just one. A file of the wrong type, or too big, is refused the moment
   you choose it rather than after it has been sent.
3. **A DWG into ئەرشیفی نەخشە.** The form marked **بەش** (section) as optional
   and the database required it, so leaving it empty gave the generic error page.
   It is now marked required, and anything the form misses is said in a sentence.
   On this demo a single upload cannot be larger than **4 MB**; that is a limit of
   the hosting, not of the system, which takes 60 MB on the office server.
4. **Scanners.** A new **سکانەرەکان** screen (mayor, deputy, IT) adds network
   scanners: any scanner or printer that supports AirScan or Mopria, which is
   nearly every office model sold since about 2017. On a letter, on the scan tray
   and on the new-letter form there is now a **سکانکردن لە سکانەر** button: put
   the paper in, press it, and the pages arrive where you pressed. On the tray,
   **ناسینەوەی کتاب** reads the page and suggests which letter it belongs to, from
   the barcode or letter number printed on it. It only suggests; you confirm.
   This demo is on the internet and cannot reach a scanner in the building, so it
   has a **simulated scanner** that produces a test page. Add it from the scanners
   screen and try the whole flow.
5. **Mixed digits like 2٤0/4.** Plot numbers, shelves and folders are now kept in
   one kind of digit, as you type and when saved. A plain number uses 0-9, like
   letter numbers and barcodes. A code with Kurdish letters in it, like ب٣, keeps
   ٠-٩. Old entries typed mixed are shown unmixed.
6. **Opening attachments.** Every file on a letter now has **بینین** and
   **داگرتن** buttons and shows which room attached it. **بینین** draws the PDF
   inside the page, which works on a phone as well as at a desk; before, a phone
   downloaded the PDF somewhere nobody looks, or showed nothing. Beside it is the
   list of every file on the letter from every room.
7. **Two people at once.** On two computers, or two different browsers, this
   always worked, and it is now tested with both working in the same second. In
   **one** browser it cannot work on any website: all tabs share one sign-in, so
   signing in as Aram in a second tab turns Shilan's tab into Aram too. What was
   wrong is that this happened silently. Now the sign-in page says who is already
   signed in and offers to switch, and a tab left open as Shilan covers itself
   with a warning the moment somebody else signs in. **To test as two people on
   one computer, open the second person in a private window (Ctrl+Shift+N) or in
   a different browser.**
8. **Legal and contracts could not start a letter.** Only the mayor, the deputy
   and the registry were allowed to. Every room can now: **کتابی نوێ** in the
   menu. The letter takes the next number from the same register as the counter,
   so there is still one sequence with no gaps. It is visible to the whole room
   that started it, and waits in that room's inbox under «کتابە نوێیەکانی ئەم
   ژوورە کە هێشتا نەنێردراون» until somebody sends it.
9. **A scan from another room in room 9's tray.** The scan tray was shared by the
   whole building. Each room now has its own tray. The mayor and deputy can look
   into another room's tray on purpose, with the room chooser at the top. A scan
   that has been filed onto a letter can no longer be opened through its old tray
   address at all; it opens through the letter, under the letter's rules. This one
   was a confidentiality problem, not only an inconvenience.
10. **DWG on a letter from rooms 8 and 9.** Rooms 8 and 9 can now attach DWG and
    DXF to any letter they hold. Other rooms can download them but not attach
    them. A browser cannot draw a DWG, so **بینین** says so and offers the
    download.

---

## Fixed from the browser audit of 13 September

A real Chrome signed in as every account and went through every screen and every
job, on a laptop and a phone. It found 35 problems. All are fixed; the ones a
request can see are held by `app/test/audit.test.mjs`, and the audit itself can be
run again from `app/e2e` (see its README).

**The ones that mattered most**

- **Back after signing out showed the register.** Signing out and pressing the
  browser's Back button put every letter number and subject back on the screen.
  Pages are now marked so the browser does not keep them. Try it: sign out, press
  Back, and you get the sign-in page.
- **New temporary passwords were put in the address bar**, and so into the IT
  computer's history. They are now only on the page that answers the form.
- **Letter lists were slow for every ordinary room** (2 to 5 seconds, and getting
  slower with every letter). The permission check now runs once per screen instead
  of once per letter: the land room's sent list went from 2.2 seconds to 18
  milliseconds. Nobody sees anything they did not see before; that was checked for
  every account on every table.
- **Six actions said «کتاب نێردرا» (letter sent).** Adding a note, signing for the
  paper, finishing a step, returning, recalling and cancelling each say what they
  did now.
- **The PDF viewer dropped letters** from PDFs made on a computer ("Th s pagew as").
  Scans were never affected. Now fixed for both.
- **A busy room did not see new letters.** With more than a hundred open letters
  the inbox showed the oldest hundred. Every unopened letter is now always on the
  list, and the menu number is the real count. My day's "waiting on other rooms"
  had the same problem and is fixed the same way.
- **Anyone who could see a letter could cancel it** with a hand-made request; there
  was simply no button. Now there is a **هەڵوەشاندنەوەی کتاب** box at the bottom of
  a letter for the front desk, mayor and deputy, and for a room head on a letter
  their room started and has not yet sent. Nobody else, by any route.

**Also fixed**

- The rooms table's columns sat under the wrong headings.
- The room chooser at the top showed your own room instead of the room on screen.
- Buttons and links that led to "not allowed" are gone for the people they refused;
  the archive rooms may now use **وێنەگرتنی کتاب**.
- The username, transaction code and scanner code boxes check their format in
  Chrome and Edge again.
- Extensions typed in Kurdish digits (٢١٤) are accepted.
- The activity log and the dashboard feed speak Kurdish: no more `step.sent` or
  raw data; the details fold away under **وردەکاری**.
- Templates link to a letter by its number or barcode, not a number nobody can see.
- A reply's draft writes the date in Kurdish digits, like the printed header.
- Everyone can change their own password: **گۆڕینی وشەی نهێنی** under your name in
  the menu. IT has **ژوورەکان** in its menu. Clerks have templates and leave.
- About thirty boxes that had no styling (the whole company form among them), search
  buttons that fell under their box, the routing trail's dots on the wrong side, the
  browser's English "Choose File", and "not found" pages with no menu.
- On phones: the staff screen, the number tiles (two to a row now), table buttons
  kept in view at the edge, printed pages fitting the screen, page titles on two lines.
- One word for each thing: **پەلە** for priority, **لەژێر کاردا** for in progress,
  **نەگەیشتووە / وەرگیراوە** for the paper folder, **هەڵوەشێنراوە** for cancelled.
- A directorate head (**dana**) was added to the test accounts, because that role
  had never been tried.

### The second round, the same day

Five testers then each took one part of the system — letters and routing,
security, desktop design, phones and accessibility, and the records side (archive,
companies, templates, leave, admin, the assistant). They found 87 more problems.
All are fixed except the three listed at the end.

**Letters and routing — the serious ones**

- **An old page could finish the wrong room's step.** Two tabs open, or two people
  in the same room pressing at once, and the second press finished *the next room's*
  step with its own note. Every letter form now carries the step it was drawn for;
  if the letter has moved since, the page says so and does nothing.
- **A room head who did not hold a letter could take it away**, even while their
  own room was still waiting its turn in a sequence. Only the room holding a letter
  can send it on; the mayor and deputy can still take any letter, and the room that
  had it is told. A room waiting its turn no longer sees the letter at all until its
  turn comes.
- **Closing a letter from its own page erased the saved reply**, and printed an
  official reply with a blank body. The close form is now filled with the draft,
  and an empty box never overwrites it.
- **Recalling after a room had passed a letter on gave the error page.** It now
  brings the letter back to the room that recalled it.
- **The sender could sign for their own delivery list**, and the receiving room
  could cancel it. Only the receiving room signs; only the sender cancels.
- Also: sending a letter to your own room, choosing «تر» on the photo screen, and a
  one-letter return reason each gave the error page; the barcode screen could not
  find ه/2026/79 by its full number, or a number typed with ە; dana's room overview
  showed busy rooms as empty; chasing gave no message and an ordinary note blocked
  it; My day listed letters on your own desk as waiting on others; rooms were not
  told when a letter they held was cancelled or closed; a cancelled letter still
  printed a receipt with a working PIN.

**Security** — no breach found. Four small things fixed: two forged requests gave
an error page instead of a refusal; IT could read staff *search words* in the log
(citizen names and plot numbers, which is the one way letter content reached IT —
the log now hides them from IT); template text is cleaned of scripts before printing.

**Records**

- **IT could switch off a room that still held letters**, which then vanished from
  every list. It is refused now, and so is switching off a room that still has staff.
- **"Merge into one PDF" in the scan tray shuffled the pages.** The order you chose
  is kept.
- **An archive record could never be corrected.** It can now be edited, given its
  PDF later, and withdrawn. The same file cannot be archived twice.
- **A template with a list field could never be filled in.** Lists take their
  choices; templates can be edited and retired; Kurdish digits work in number fields;
  `{{بەڕێوەبەر}}` with a field that does not exist is refused rather than printed.
- **The assistant** said «٢٠ کتاب» when the room had 143, sent company licence
  questions to the staff-leave list, and repeated one person seven times. Fixed.
- **Leave:** the same days could be requested twice and approvers could approve
  their own leave. Both refused. A leave can now be **cancelled** (هەڵوەشاندنەوە on
  its row), which also ends the deputy cover it started.
- **Every time on the server was UTC**, three hours behind Rania. All times are
  Baghdad time now.
- Also: company forms lost what was typed on a bad value; a transaction type's
  default room and due days did nothing; a refused file wiped the archive form;
  the tray could only attach to the 25 newest letters (it takes a number now);
  the log's paging repeated rows; a scanner address could point at the database;
  a hand-made link could show any text as an official message.

**Design, desktop** — a long file name squeezed every button in the tray to a sliver
and pushed archive columns off screen; Kurdish words were drawn in the code font with
their letters apart; phone numbers read backwards; the actions on a letter were a
screen and more below the trail, and are now right under it; priority showed nowhere
on a letter's page; Kurdish grammar («یاساە», «ئێستا لەمەوبەر», ترازوو for margin);
Latin digits among Kurdish ones; one word for file size (کیلۆبایت); the menu now has
the gold bar and badges from the approved design.

**Phones and accessibility** — a link to part of a page landed under the top bar;
titles were cut mid-word and letter numbers lost their year; table buttons were off
screen on a tablet; the menu drawer let the keyboard wander behind it; green text was
below the contrast standard; notification pop-ups covered buttons at the bottom of a
phone and could not be closed; there was no skip-to-content link.

### The design pass, the same evening

Three more reviews measured every component on every screen and found about fifty
kinds of "the same thing looks different here". The rules now written down in
`app/e2e/agents/DESIGN-RULES.md` pick one way for each, and every screen follows
them:

- **The sign-in page is the approved two-panel design**, and the citizen tracking
  page and the error pages use the same frame.
- **The inbox has tabs**: هەمووی, نوێ, لەژێر کاردا, دواکەوتوو, پەلە, each with its count.
- **The phone rules work.** They sat above the desktop rules in the stylesheet and
  lost to them, so on a phone cards, buttons and fields kept desktop sizes, and an
  iPhone zoomed in on every tapped field.
- **One height** for a field, a dropdown and a button in the same row, and for every
  control in the top bar; the top bar is one height on every page.
- **One way** to show a count beside a heading (a grey pill), a line under a heading,
  a second line in a table cell, an empty list, a "not found" page, a search box, an
  add-new form (at the top of the page, full width) and a switched-off row.
- **One button for each kind of action** (the list is at the top of the rules file),
  and one word for each action, state and column: «دواکەوتوو», «هەڵوەشێنراوە»,
  «پاشەکەوتکردن», «زیادکردن», «ئێستا لای», «کاغەز»…
- Every save, add and switch now says what happened; four did not say anything.
- Headings and dates no longer break in the middle of a word; long file names still
  wrap instead of widening the table.
- The four print sheets share one set of sizes and colours.
- Real bugs found on the way: switched-off transaction types did not look switched
  off; a licence expiring today said «بەسەرچووە»; every scan-tray upload said its
  pages had been merged.
- **Date boxes are the system's own.** The browser's date box wrote the day in the
  machine's order, «mm/dd/yyyy» on one desk and «dd/mm/yyyy» on the next. Every date
  field (leave «لە» and «تا», a company's licence expiry, a company file's expiry) is
  now ساڵ/مانگ/ڕۆژ in Kurdish digits, ٢٠٢٦/٠٩/١٣, the way dates are shown
  everywhere, with a calendar that starts the week on Saturday. Typing works too,
  in either kind of digit, and a date written the paper way round, ١٣/٩/٢٠٢٦, is
  understood. A day that does not exist is refused with the format to use, and
  leave's «تا» cannot be earlier than «لە».
- **The mayor's dashboard ends on one line.** The activity list was taller than the
  rooms and the assistant beside it and left an empty strip. It now takes the
  height of that side and scrolls inside itself, and a long list of rooms scrolls
  inside its own card, so neither side is left half empty. On a phone both are
  one column again, each its own length.

---

## Seven tools for the mayor

Built on the night of 13 September, after the mayor's office asked for them.

### The handwritten instruction — هامش

On paper, the mayor writes on the letter itself: «بۆ یاسا، بە پەلە», a signature,
the date. Now the pen goes on the letter again, on a tablet, a phone or with a
mouse.

On a letter, the mayor, the deputy, a directorate head or a room head who may send
it sees **نووسینی هامش**. The page shows the letter's scan full width. Write on it
with a finger or a pen in blue, red, green or black, in three thicknesses, with
undo. Tick the rooms it should go to, in order, and optionally type a few words
(«بە پەلە») so a search can find the instruction later. Then press **مۆرکردن و
ناردن**.

The ink is laid onto that page of the scan, every other page kept, with a stamp in
the bottom-left corner: «هامشی سەرۆکی شارەوانی», the name, the date and the time.
The result is a new file on the letter, marked «هامشی دەستنووس», and the letter
is sent exactly as the ordinary send form would send it: to one room, or to
several one after the other.

With a pen on a tablet, the line gets thicker the harder you press, and once the
pen has touched the glass a resting palm is ignored.

The stamp is drawn by the browser, because only the browser writes Kurdish letters
joined correctly. The record of who wrote the instruction and when is the one the
server keeps in the activity log, in the same moment.

### Is this letter really ours — پشتڕاستکردنەوەی کتاب

Letterhead is a photocopier away. Every letter that leaves with an outgoing number
now carries a QR code and a ten-letter code, such as `X3LZ-H367-QG`, at the foot of
the printed reply.

Whoever is handed the letter (a bank, a court, another directorate) scans the QR
code or types the code at `/verify`, **with no account**. The page says what the
municipality's register holds for that code: the outgoing number, the date, who it
was sent to, and whether it has since been cancelled. If the paper says anything
different, the paper is forged.

It never shows what the letter says. Every check is logged, and an address that
keeps guessing is slowed down, like the tracking page. The code is also shown on
the letter's own page, under the outgoing number.

### Late letters climb — پلەکانی بەرزکردنەوە

A late letter used to be mentioned once, to its room, and then never again. Now
lateness climbs:

- **a day late:** the person holding it gets a reminder;
- **three days late:** the head of the room is told;
- **five days late:** the mayor and the deputy are told, and the letter is marked
  in red on the dashboard, with the name of the person holding it.

The mayor changes the three numbers on **جۆرەکانی مامەڵە**. Each transaction type
can have its own head and mayor numbers, next to its own deadline. Each step on the
ladder is announced once per letter, never twice.

### The weekly room report — ڕاپۆرتی هەفتانە

For each room, for one week from Saturday to Friday, compared with the week before:

- letters received;
- letters finished;
- the average days they took;
- how many finished late;
- how many were still open at the end of the week;
- how many of those were already late.

Green means better, red means worse. **چاپی ڕاپۆرت** prints one A4 page per room,
with the letters that were late and who finished how many, for the Saturday
meeting.

The mayor and the deputy see every room, a directorate head their directorate, and
a room head their own room. On Saturday morning each of them gets a bell saying
the week's report is ready.

### Security alerts — ئاگادارییە ئەمنییەکان

The activity log records everything. Now it also watches for the few patterns worth
telling the mayor about while they happen:

- somebody opens 50 letters or more in an hour;
- somebody signs in between ten at night and six in the morning;
- the IT account tries to open a letter or an attachment;
- somebody asks for ten refused letters in half an hour, which is what trying
  numbers looks like;
- a room downloads an attachment of a letter that is no longer in that room.

The mayor and the deputy are told through the bell and on the dashboard. The
**ئاگادارییە ئەمنییەکان** page lists each alert with the person, the time and how
many times it happened, and links to that person's rows in the log.

An alert is a pointer, not a verdict: the night sign-in may be the mayor's own
driver. Marking an alert seen is logged. If the same thing happens again afterwards,
the alert comes back.

The five thresholds can be changed on the same page. IT cannot see these alerts,
because one of the rules is about IT.

A refused letter is now written in the log as «داوای کتابێکی کرد کە ڕێگەی
پێنەدرا». It was not recorded at all before.

### The whole case — هەموو دۆسیەکە

A request, a complaint that it was never answered, the answer, a follow-up about the
answer: four letters and four pages. On any letter, **هەموو دۆسیەکە** now shows the
whole chain of letters linked by "follow-up of" on one line of time, year by year:

- when each letter arrived;
- every room it went to and what each room did;
- the handwritten instructions;
- the remarks;
- the answers and the cancellations;
- where it is now.

It shows only letters you may see.

### The map of plots — نەخشەی پارچەکان

The map of Rania, with streets, water and neighbourhood names from OpenStreetMap, is
**stored on the municipality's server**. Nothing is fetched from anywhere else while
it is in use, so the map works with the internet down and no outside service learns
which streets the municipality is looking at.

The cadastral maps are paper in the archive room, so a plot gets its place from the
people who know it. On a plot's file, press **دیاریکردن لەسەر نەخشە** and click the
spot. Optionally, trace the outline of the plot corner by corner. Each plot is
coloured by its letters:

| Colour | Means |
|---|---|
| Red | a letter about it is late |
| Amber | a letter about it is still open |
| Green | every letter about it has been answered |
| Blue | only drawings in the archive |

Clicking a plot opens its file. Under the map is the list of plots that have letters
but no place yet, busiest first, for a quiet afternoon.

The registry, the archive rooms, the heads and the mayor can place plots. The other
rooms can look.

## The marks on the scan

### مۆری هاتوو · مۆری دەرچوو — /attachments/:id/stamp

On paper the front desk stamps a letter the moment it arrives: a small box in a
corner, «هاتوو», and the number the letter has just been given. When the answer
leaves, the same box with «دەرچوو» and the outgoing number. The scan now carries
the same mark, and the clerk chooses where it sits, because on paper they do.

- **Where from**: a «مۆرکردن» button beside every scan on a letter, and a
  «مۆری هاتوو لێبدە» / «مۆری دەرچوو لێبدە» button under each side of the
  comparison screen.
- **The screen**: the page with the mark lying on it. Drag the mark anywhere (or
  move it with the arrow keys), choose بچووک / مامناوەند / گەورە, turn to another
  page of the scan, and press **مۆرکردن**.
- **What the mark says**: «هاتوو» with the incoming number, the registration date
  and the barcode — the number the applicant types into the tracking page, so the
  stamped paper carries everything needed to follow it. «دەرچوو» carries the
  outgoing number, its date and the verification code from migration 0540.
- **What it produces**: a new PDF of the whole scan with the mark drawn on that one
  page, filed as «سکانی کتابی ڕەسەن» for an arrival and «کۆپی دەرچوو» for a
  dispatch. The scan underneath is never altered — stamping twice makes two files
  and two rows in `document_stamp`.
- A dispatch mark is refused until the letter has an outgoing number: the mark
  carries that number, so there is nothing to stamp before the answer exists.
- The comparison screen prefers a stamped copy for its side, which is what a
  person means by "what came in" and "what went out".
- Who: everybody who files paper — the registry, room staff, heads, the archive,
  the mayor's office. Not IT. Every mark is logged as `stamp.applied` with what it
  printed.

The browser draws the mark and the server lays it on the page with pdf-lib, the
same path the handwritten instruction takes, so a page stored sideways is turned
back correctly. The mark is measured as a fraction of the page, so where the clerk
put it on screen is where it lands in the file.

## What came in beside what went out

### بەراوردی هاتوو و دەرچوو — /documents/:id/compare

The question asked at the counter with a citizen standing there: is this paper the
answer to that request, and is it the paper this office sent? Two scans on one
screen, each with its own page buttons and its own zoom.

- **Right, هاتوو**: the first scan of the paper as it arrived, before any stamp or
  signature. Above it a band with the incoming number, the room that scanned it and
  the date.
- **Left, دەرچوو**: the last file filed as going out (kind «کۆپی دەرچوو», which is
  what ticks `is_outgoing`), signed and stamped. Under it a band with the outgoing
  number, the recipient and the letter's verification code.
- The bands are written by the screen from the register, not read off the paper.
  They start with «لە تۆماردا:» for exactly that reason. Nothing on this screen
  claims the paper carries a mark it may not carry.
- Under both, one line of time: registration, every room that finished with it,
  where it is now, and the dispatch.
- Either side can be switched to another file of the same letter. A file id from a
  different letter in the link is ignored; the page only ever offers files of the
  letter it is on.
- A side with nothing yet says which step is missing («هێشتا وەڵام نەنێردراوە»,
  «کۆپی مۆرکراوی کاغەز سکان نەکراوە») and offers the action that would fill it.

Reached from the attachments card on any letter that has a scan, and from a
«بەراورد» button on every row of the outgoing register. Opening it is logged as
`compare.viewed`; being refused is logged as `access.refused`, like the letter
itself.

There is no national-identity number anywhere on it. The register stores the
sender's name and, if they left one, a contact; the screen shows those, the plot
number and the barcode, and nothing more about the person.

## The new screens

### The plot file — فایلی پارچە

Type a plot number and get everything that ever touched that piece of land on one
page: every letter about it in date order, every drawing in the archive, every
company that appears on any of them, and a run down the side of what has happened
to it.

Type it any way you like. `247/5`, `٢٤٧/٥`, `247-5` and `247 / 5` are one piece of
land and open one file. You can also type a neighbourhood name and get the plots
in it.

The plot number on any letter is now a link to this page.

What the page shows is what **you** may see. A clerk in a room the letters never
reached opens the page and finds it empty, which is correct. IT cannot open it at
all, for the same reason IT cannot read a letter.

### Write the reply — نووسینی وەڵام

On any letter there is now a button to write the reply. It opens a page with the
opinions the rooms wrote down the side, and a draft already assembled from them,
so nothing is retyped from a printout.

The order is the office's order, not the computer's:

1. **Write it.** Saved on the letter. No number yet.
2. **Print it.** Municipal letterhead, signature line, a circle for the seal. It
   says plainly, twice, that it is a draft and has no number.
3. **Issue the number and close.** Only then does it get its outgoing number, and
   only the registry, the mayor or his deputy can do it.

That order matters because a number here is consumed for ever. Numbering a draft
the mayor then sends back for rewriting would leave a hole in the register that
nobody could explain to an auditor.

Once it has gone out the text is fixed. The paper the citizen is holding and the
copy in the system have to be the same thing.

A room head can draft the reply, because they know what it should say. Only the
registry can give it a number.

### This looks familiar

Citizens re-submit. They come back a month later with the same request because
nobody told them the first one was moving, or because the first copy was mislaid.
Today each attempt gets its own number and its own file, and two rooms end up
answering the same question differently.

Now, when you register a letter that resembles one already on file, the screen
stops and shows you what it found before a number is issued: the same plot, or a
similar subject from a similar sender within the last eighteen months. It tells
you which of those it matched on.

It is a warning and never a refusal. You get three ways forward and none of them
is "no":

- open the earlier letter and look
- register this one as a follow-on to that one, which links the two and still
  gives this one its own number
- press register again, which means "I looked, they are different"

If you have javascript, it also checks while you are still typing, so the warning
arrives while the citizen is still at the counter.

### My day — ڕۆژی من

One screen with the two halves of the question everyone asks at eight in the
morning.

**What is on my desk**: overdue first, then due today, then the rest, plus the
folders whose paper has not arrived yet.

**What I am waiting for**: the letters I sent to another room that have never come
back, how long ago I sent them, and whether the room has even opened them. This
half is new information. Those letters appear nowhere else in the system: they are
not on my desk, so they are not on my inbox, and the only way to find one has been
to remember it. It is exactly the letter a citizen is at the counter asking about.

Each of those rows has a button to chase it. Pressing it writes the request **on
the letter**, where the next person to open it will read it, and tells the room
holding it. It is not a ping that gets read once and forgotten, and it leaves a
record of who asked and when, which a room that is genuinely blocked can answer.

Once a day, per letter. A bell that cries wolf gets turned off, and the room being
chased four times before lunch is not the room that will answer faster.

Only the person who sent the letter, or somebody in the room that sent it, can
chase it. A head chasing for a clerk who is on leave is ordinary; everybody else
asking is not chasing, it is interfering.


### Barcode lookup — خوێندنەوەی بارکۆد

Every letter now carries an eleven-digit barcode, printed on its file sheet and
on the applicant's receipt. A cheap hand-held scanner is just a keyboard: it types
the digits it sees and presses Enter, so this screen is one box with the cursor
already in it.

You do not need a scanner to test it. Type the digits.

The last digit is a check digit, the same arithmetic as a bank card. Change one
digit of a real barcode and the screen tells you the barcode is wrong, rather than
telling you the letter does not exist. Those two messages must stay different.

The box also takes a document number typed by hand, `ه/2026/25`, for when the
label on a folder has torn.

### Delivery lists — لیستی گەیاندن

Twice a day somebody carries an armful of folders from one room to another and the
receiving room signs once for the lot. That is what a delivery list is: one sending
room, one receiving room, one named courier, and a list of letters. It gets its own
number, `گ/2026/17`.

Print it, put it on top of the folders, and it has three signature boxes. Receiving
it in the system stamps every folder on it as arrived, in one action.

The courier is typed in, not chosen from a list. The people who carry folders
between floors do not have accounts in this system, and inventing one for them
would put a name in the staff list that cannot sign in.

### Companies — کۆمپانیاکان

A register of the firms the municipality deals with, with the registration number
as the identity, because a name gets typed four different ways and a number does
not.

Each company shows every letter that concerns it, and holds its own files: the
licence, the tax clearance. The list leads with licences that are about to expire,
which is the question the contracts room actually opens this screen for.

### Transaction types — جۆرەکانی مامەڵە

The list the front desk picks from when registering a letter. The office can add
to it without a programmer. Every type names one of nine fixed classes underneath,
so a new type cannot escape the rules the system already knows.

Types can be switched off but never deleted, because old letters point at them.

### The applicant's receipt

Open any letter and press **پسوولەی داواکار**. Two formats on one page: a narrow
slip for a till-roll printer, which is what a counter has, and an A4 sheet that
doubles as a folder cover.

It carries the barcode and a six-digit PIN. Those two together are the whole of
the public tracking page. Reprinting does not change the PIN, deliberately: a lost
receipt is a daily event and the number the applicant is holding has to keep
working.

### Public tracking — بەدواداچوونی داواکاری

The first thing on the result is now where the paper is: «ئێستا لە ژووری یاسا»,
with the date it last moved. Before the first send it says it has not been sent to
a room yet, and after the answer it says the request is finished — the applicant's
question is "where is my paper", and a stage word alone did not answer it. The
room name has always come from `public_track()`, which names a room only while the
letter is genuinely with one; nothing new about the letter is published.

**https://sharawani01.vercel.app/track**

No account. The applicant types the barcode and the PIN from their receipt and
sees which stage their application has reached and which room has it.

This is the only screen an outsider can reach, so it is built the other way round
from every other one: instead of deciding what to hide, it decides what to show.
It can return a stage, a room name and three dates, and there is no input that
makes it return a subject, a name or a note.

### The top bar

**One search box for both kinds of lookup.** Type eleven digits and it goes to
the barcode screen. Type anything else, a name, a plot number, a document
number, and it searches. You do not have to know which you want before you
start typing.

**A room switcher, but only if you have more than one room.** It lists the rooms
you are already entitled to see, which for almost everybody is one, so the
control does not appear at all. The mayor, the deputy, a directorate head and
anyone currently covering another room while its head is on leave will see it.
It is not a way to become another room: the list comes from the same rule the
database enforces, so it can never offer a room the database would refuse.

**A bell, with a count on it.** It turns red the moment something reaches you
and the number on it is how many you have not read. Press it for the list.

**A sound switch.** A barcode reader beeps, and staff working through a pile of
folders go by the beep rather than by the screen. A scan makes one short high
tone, a failed scan two low ones, and receiving a delivery list three rising
ones. Turn it off with the speaker button and it stays off for that browser.

### Several pages, one document

The scan tray now takes a whole feeder pass at once. Select every page, leave the
box ticked, and they arrive as a single PDF in the order you picked them. Untick
it and they stay separate, for when you have scanned three unrelated letters.

TIF cannot be merged and says so rather than dropping the page.

### Contact details

Rooms and people can now carry an extension, a department and a floor, and IT
fills them in from the staff screens. They all start empty on purpose: the real
extension list has not been read off the wall by the switchboard yet, and a wrong
extension gets rung while a blank one gets asked about.

What is filled in appears on the card above your name at the bottom of the
sidebar.

### Is the file still the file

Every attachment shows the first twelve characters of its SHA-256, taken as the
bytes arrived, and a button that reads the stored file back and works the hash
out again. Press it and it tells you whether the file has changed since it was
attached.

This is worth a moment of your scepticism. The number is real: the nightly job
checks every file the same way, and the check will fail if a single bit changes,
without the file's size or type changing at all.

### Notes on a letter — تێبینییەکان

A remark that belongs to the letter rather than to one hand-off. "The applicant
phoned, he is out of the country until October." Anyone who can see the letter can
add one and everyone who can see the letter reads them.

They cannot be edited or deleted, by anybody, including IT. A note is a record of
what somebody knew at a time, and a record that can be tidied afterwards is not
one.

---

### Being told — ئاگادارکردنەوەکان

Until now the system told you nothing. A letter landed in your room and sat
there until somebody walked over and said so. Now it tells you, and it tells you
while you are looking at something else.

**What raises one.** A letter reaching your room, a letter coming back to you, a
letter you sent being finished, a letter taken back before you opened it, the
paper folder being signed for, a note written on a letter your room holds, a
delivery list on its way to you or signed for by the room you sent it to, a
leave request waiting for you and the answer to one you made, and being made
deputy of a room. Each morning at half past seven it also says which letters are
due tomorrow and which are late, once each and never twice.

**Who gets one.** A letter arrives at a room, not at a person, so everybody with
a hand in that room is told: whoever sits in it, its head, and anyone covering
it while the head is away. You are never told about your own action.

**It is your list and nobody else's.** Not the mayor's, not IT's. The rule is
one line in the database with no exception in it, and there is a test that signs
in as somebody else and tries to read your notifications.

**It carries no letter text.** The row says which letter, not what the letter
says. The subject you see on screen is fetched at the moment you look, under the
same permission that governs the letter itself, so if you stop being entitled to
a letter its subject stops appearing in your old notifications. The database
refuses to store a subject in a notification at all.

**Outside the browser.** On the notifications screen there is a button to turn
on notifications for the device you are holding. After that you are told when
the browser is shut. What is sent through Google or Apple is a doorbell with
nothing in it: no subject, no number, no name, not even which letter. Your
browser is woken, asks this server directly how many things are waiting, and
shows a count. Nothing about a Rania letter passes through anyone else's
service. That is the only arrangement compatible with the rule that this
correspondence does not leave the building.

On an iPhone the button only works once the system has been added to the home
screen. That is Apple's rule, not ours.

### The wall board — تابلۆی کار

A screen for the corridor outside the mayor's office. Open **تابلۆی کار** from
the menu, or go to `/board`, and press F11 for full screen. It shows the day's
four figures, a tile for each room with what it is holding and how late it is,
and a line for each thing that happens as it happens. Nobody signs in to it and
nobody clicks it; it updates itself and never reloads the page.

**Getting back out of it.** The board is a page of its own with no menu in it, so
when you open it from the menu on a phone the menu goes away. Signed in as the
mayor, the deputy or IT, you will find **گەڕانەوە** at the top of the board, which
returns you to your own first page. The corridor machine does not get that link:
it has no session, and a screen anybody walking past can touch should not offer a
way into the system.

**To leave it running without a password.** IT opens
`https://.../board?key=<the board key>` once on the machine driving the
television. That machine then keeps a cookie that opens the board and nothing
else. The key is in the deployment environment as `BOARD_TOKEN`.

**What it will not show, and this is the point.** No subject lines, no citizen
names, no senders, no staff names. A corridor screen is read by whoever walks
past, including the people whose letters are in the system. It shows room names,
counts and letter numbers, which say that the municipality is working without
saying what about. That is enforced in the database rather than in the page: the
board can reach exactly one function, and that function has no way to return a
subject. Try to get one out of it.

### Reading what is inside a scan

Type a citizen's name or a plot number into the search box and letters come back
because those words are **printed inside an attached scan**, not because
somebody typed them into a field.

The reading is done by this server. No scan is sent anywhere to be read, which
is the only arrangement compatible with the rule that this correspondence does
not leave the building.

**It is honest about what it managed.** Beside each scan on the letter's page:

| Label | Means |
|---|---|
| خوێندرایەوە | read with good confidence; search it freely |
| بە دڵنیایی نەخوێندرایەوە | probably handwriting; searchable but the words may be wrong |
| بێ نووسین | a drawing or a photograph with no writing on it |
| nothing yet | the reader has not reached it; it runs every couple of minutes |

Press **دەق** to see exactly what was read and the confidence figure. Press
**خوێندنەوەی نووسین** to read one now instead of waiting.

Typed Kurdish and Arabic read well. Handwriting does not, and nothing will
change that. The system says which it is rather than presenting a guess as a
fact.

**Worth knowing about the letters.** The reader was given the Arabic *script*
model rather than the Arabic *language* model, because the language model has
never seen ژ, پ, چ, گ, ڕ or ێ and silently substitutes the nearest Arabic
letter. Even so it gets a letter wrong here and there, so the search matches
approximately as well as exactly. This is the part I most want you to test with
real typed letters.

### The QR code on the receipt

Every applicant's receipt now carries a QR code. The citizen photographs it with
their own phone, in the corridor, and the tracking page opens with their barcode
already filled in and their PIN already entered. No account, no app, no typing.

The PIN travels in the part of the address after the `#`, which a browser never
sends to a server. It is not in any access log and not in the referrer of
anything the phone opens next.

Two more QR codes, both internal:

- **On the folder cover**, one that opens the letter's own page. Photograph the
  folder in your hand and the record opens on your phone. Not signed in, you get
  the sign-in page and then the letter, so it grants nothing.
- **On a delivery list**, one that opens the list ready to be signed for, so the
  receiving clerk signs where the trolley is standing.

### Photographing a letter instead of typing it

At the counter, press **وێنەگرتنی کتاب** on the registration screen. Your phone
opens its back camera. Take a picture of the letter and the registration form
comes back with what could be made out already filled in: the sender's reference
number, the date, the subject after `م/`, the plot number, the neighbourhood,
and the letterhead as the sender.

**Every value is a suggestion and the screen says so.** Beside each one it shows
the line it was taken from, so you can confirm it at a glance rather than
rereading the whole letter. Correct anything wrong, then register. The
photograph attaches itself to the letter; you do not have to file it separately.

If you abandon the form, the photograph is in the scan tray rather than lost.

### On a phone

Every screen works on a phone now. The menu becomes a drawer behind the button
at the top right, the four number cards stack, and a wide register scrolls
sideways instead of squeezing eight columns into a thumb's width. Nothing is
hidden on the small screen that is visible on the large one: somebody at a
counter can answer any question they could answer at their desk.

**It can be installed.** Open it in Chrome on Android and the browser offers to
add it; on an iPhone, Share then Add to Home Screen. It then opens like an
application, full screen, with its own icon.

**What it does NOT do offline.** Almost nothing, deliberately. When the network
is gone it says so and shows you nothing. It could have kept the last pages you
looked at, and then a copy of the mayor's correspondence would be sitting on the
disk of whichever shared machine last opened it, readable with no password, for
as long as the browser felt like keeping it. This system is the record of what
the municipality has, and a stale copy of that record is worse than no copy.

---

## Walk through this first

Half an hour, and it exercises most of the system.

1. Sign in as `shilan`. Register an incoming letter. Note the number it gives you.
2. Press **پسوولەی داواکار** and print the receipt. Write down the barcode and
   the six-digit PIN.
3. Open **https://sharawani01.vercel.app/track** in a private window, with nobody
   signed in. Type that barcode and PIN. You should see a stage and nothing else.
4. Back as `shilan`, open **خوێندنەوەی بارکۆد** and type the barcode. It should
   find the same letter.
5. In a second window, sign in as `aram`. Open that letter and send it to Legal.
6. In a third window, sign in as `hemin` BEFORE step 5 and leave it on any
   screen. The bell should turn red within a second or two of the mayor sending
   it, without you touching anything, and a small card should appear in the
   corner.
7. As `hemin`, open the inbox. The letter is there and the **پەڕگە** column says
   the folder has not arrived.
8. As `shilan`, open **لیستی گەیاندن**. The folder is waiting to go to Legal. Tick
   it, name a courier, and create the list. Print it.
9. As `hemin`, open **لیستی گەیاندن** and receive it. The folder now counts as
   arrived.
10. As `hemin`, add a note to the letter, then mark the step complete.
11. As `aram`, open the letter and read the trail. Every hand it passed through,
    with times.
12. As `aram`, ask the assistant where that letter is, using just its number.
13. As `shilan`, register the outgoing reply and close the letter.
14. Attach a scan to the letter, then press **پشکنینی دەستکاری** beside it. It
    should say the file has not been altered.
15. As `itadmin`, try to open that same letter, its receipt, and the delivery
    list. You should get nothing. Open the bell as well: IT is told nothing
    about letters through it either.
16. On your phone, open the same address, sign in as `hemin`, and add it to the
    home screen. Then have somebody send a letter to Legal from a desk.

---

## What is worth attacking

**Kurdish text is where I most want your eye.** Search for a name using the wrong
letter forms: ي instead of ی, ك instead of ک, ة instead of ە. Search with
Arabic-Indic digits ٢٤٧ and with Latin 247. Type a plot number as `247/5`, as
`247-5`, and as `٢٤٧ / ٥`. All of these are supposed to find the same record. If
any does not, that is a real bug and worth reporting carefully.

**The letter check page (`/verify`).** Like the tracking page, it has no password.
Try to make it show anything beyond an outgoing number, a date and a recipient. Try
guessing codes and confirm you are slowed down. Photocopy a printed reply, change
the number on it, and see whether the check page makes the forgery obvious.

**The security alerts.** Open fifty letters in an hour, sign in at night, try a
letter's address as IT. The mayor should hear about each one. Try to find a way to
do any of them without an alert.

**The handwritten instruction.** Write one on a scan whose page is turned sideways,
and check the ink lands where you wrote it.

**The public tracking page.** This is the one I most want broken. Try a barcode
with a wrong PIN. Try a barcode that does not exist. Both must give exactly the
same answer, or the page tells an outsider which numbers are real. Try guessing
repeatedly and confirm it slows you down. Try to make it print anything about a
letter beyond a stage, a room and a date.

**The barcode check digit.** Take a real barcode and change one digit anywhere.
Take a real barcode and swap two neighbouring digits. Both should be refused as
malformed rather than looked up. If either one finds a different letter, that is
serious.

**The rules that should never bend.** A document number must never be reused, even
after cancelling. A room cannot complete a step it does not hold. A closed letter
cannot be routed. A folder cannot be on two open delivery lists at once. A
delivery list already signed for cannot be cancelled. Try each.

**Files.** Attach a scan to a letter. Rename a PDF to `.dwg` and upload it: it
should be stored as a PDF, because the type is decided by looking at the bytes.
Try an `.exe` renamed to `.pdf`: refused. Upload something with a Kurdish
filename and check the name survives intact. Try the same on a company file.

**The wall board.** Open it, then have somebody register a letter from another
window. The count should move and a line should appear within a second or two,
with no reloading. Then try to make it show a subject line, a sender or anybody's
name. It should not be possible from the screen, from `/board/data`, or from the
live stream behind it.

**Reading scans.** Attach a clear scan of a typed Kurdish letter, press
**خوێندنەوەی نووسین**, then press **دەق** and compare what it read against the
paper. Then search for a word that is only inside that scan and nowhere in the
subject. This is the feature I am least sure of for Kurdish and the one where
your eye is worth most.

**The QR codes.** Print a receipt and scan the code with your own phone. It
should open the tracking page and show the stage without you typing anything.
Print a folder cover and scan that one: it should open the letter, after signing
in. Try scanning somebody else's receipt code while signed in as nobody.

**The camera.** Photograph a real typed letter at the counter and see how much of
the form fills itself. Tell me which fields it gets right and which it gets
wrong; the markers it looks for are ژمارە, بەروار, بابەت, م/, پارچە and گەڕەک,
plus their Arabic twins.

**The bell.** Sign in as `hemin` in one window and `sozan` in another, leaving
both on any screen. Send a letter to Legal from a third. Only `hemin`'s bell
should move. Then take the number out of `hemin`'s notification link and put it
in `sozan`'s address bar: it should behave as though it does not exist, because
to `sozan` it does not. Sign in as `itadmin` and confirm the bell stays empty
whatever happens to letters.

**The bell and the leaving of it.** Complete a letter you were sent. The person
who sent it should be told and you should not be told about your own action.
Ask the mayor to take a letter back before you open it; your room should be told
it has gone rather than watching it silently vanish from the queue.

**Leave cover.** As `hemin`, request leave. As `bafrin`, approve it. Now send a
letter to Legal and confirm it lands on `sakar` instead.

**Forms.** As `bafrin`, open Forms, fill in the leave request, and print it. Check
the Kurdish reads properly and the values land in the right places.

**The scan tray.** Upload a scan there, then attach it to a letter from the tray
rather than from the letter's own page.

**Sign-in.** Type a wrong password five times for one account. You should be
slowed down and told to wait. Then confirm another account still signs in
normally.

**The merge.** Upload three pages to the scan tray with the box ticked and check
you get one PDF with three pages in the right order. A merge that drops the
middle page still opens perfectly, so open it and count.

**The search box.** Type a barcode and confirm you land on the barcode screen.
Type a name and confirm you land on search. Try a barcode with a digit changed.

**The room switcher.** As `hemin`, who has one room, confirm there is no
switcher. Then try adding `?room=` and another room's number to the address bar
and confirm you still see your own room.

**Printing.** Print a file sheet, a receipt in both formats, and a delivery list.
Check the Kurdish shapes correctly and nothing runs off the page. If you have a
scanner, check that the printed barcode actually reads.

**The plot file.** Register two letters about the same plot, writing the number a
different way each time: `247/5` then `٢٤٧/٥`. Both must appear on one file. Then
sign in as a clerk from a room neither letter ever reached and open the same
plot: the page should open and be empty. If you can see a subject there that your
room never handled, that is serious and worth reporting immediately.

**The duplicate warning, in both directions.** Register the same request twice
and check it stops you. Then check the ways past it all work: opening the earlier
letter, linking the new one as a follow-on, and simply pressing register again.
Then try to make it get in the way: register twenty genuinely different letters
in a row and see how often it interrupts for no reason. A check that cries wolf
is worse than no check, and that is the failure I most want to hear about.

**The reply, and the number.** Write a reply and print it before issuing the
number: the paper must say it is a draft. Now count the outgoing numbers before
and after. Printing a draft five times must consume nothing. Then issue the
number and try to edit the reply: refused. Try to issue a second number for the
same letter: refused. If you can make the printed copy and the stored copy say
different things, that is the most serious thing in this list.

**Chasing.** Send a letter to another room, then chase it and confirm the room is
told and the request appears on the letter. Chase it again the same day: refused.
Then sign in as somebody who did not send it, including the mayor, and try to
chase it by any route you can find. Only the sender or their room should be able
to. Note that hiding the button is not the check; try posting at it directly if
you know how.

---

## Already known, please do not report

- **Uploads say "not scanned".** Virus scanning needs a program that cannot run on
  this kind of hosting. It works on the office server version. The label is
  honest rather than a bug.
- **The scan tray has no watched folder here,** only the upload form, for the same
  reason. On the office server the scanner drops a file and it appears by itself.
- **The only scanner here is the simulated one.** The demo is on the internet and
  a real scanner is inside the building. **ناسینەوەی کتاب** also needs the text
  reader, which this hosting cannot run, so on the demo it always says it found
  nothing.
- **Uploads over 4 MB fail here.** A hosting limit. The office server takes 60 MB.
- **Two people in one browser window share one sign-in.** Use a private window or
  a second browser for the second person. See item 7 above.
- **DWG drawings need a PDF uploaded alongside.** There is no automatic conversion
  and this is a deliberate decision, not an omission: automatic conversion of plot
  drawings goes wrong in ways nobody notices.
- **No email or WhatsApp sending.** The queue exists, no transport is connected.
- **Directorate views** are a redirect, pending a decision about whether rooms sit
  flat or under directorates.
- **Only nine rooms exist.** The real list of 25 to 30 is not written down yet.
- **The document number format is assumed.** ه and د with a yearly reset. The real
  format has not been read off the paper register yet.
- **A few cancelled letters and two closed companies** are visible with the word
  تاقیکردنەوە in them. Those are mine, from testing the deployment.
- **Every extension and department is blank.** Deliberate, see above.
- **The first seven numbers are used and cancelled.** They are mine, from
  testing the deployment, so the first letter you register will be ه/2026/8. A
  cancelled number is never reused, which is the rule working rather than a
  problem.

---

## Reporting what you find

Tell me four things: which username you were signed in as, what you clicked, what
you expected, and what actually happened.

For a Kurdish text problem, paste the exact text you typed, but only if it is
invented text.

If a page shows an error, tell me the time it happened and roughly what you were
doing. The system records everything and it can be traced from that.

---

## One note on the password

Everyone shares one password here because it is test data on a test system. The
real system gives each person their own temporary password which must be changed
the first time they sign in. Do not read anything into the shared one.
