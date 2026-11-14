# The manual, and how to rebuild it

Two documents live here, both written in Kurdish Sorani for the people who use the
system rather than for whoever maintains it.

| File | What it is |
|---|---|
| `manual.html` → `Rania-system-manual.pdf` | The complete manual: every screen, every button, every rule. 60 pages. |
| `presenter-guide.html` → `Rania-system-guide.pdf` | The short guide for showing the system to a room: a 25-minute script with what to say. 12 pages. |

The PDFs sit in the project root, where people look for them.

## Rebuilding after a change to the system

1. **The pictures.** Start the stack (`docker compose up -d`), then from `app/e2e`:
   `node ../../docs/manual/take-screenshots.cjs ../../docs/manual <letter id>`
   It signs in as the role that owns each screen and photographs all 36 of them.
   Pick a letter that has scans, both marks and a trail, so the pictures show a
   full letter rather than an empty one.
2. **The words.** Edit `manual.html`. The appendix of logged actions is generated
   from `src/routes/dashboard.mjs`, so it never drifts; the rest is written by hand
   and has to be read against the application when screens change.
3. **The PDF.** `node render-pdf.cjs manual.html ../../Rania-system-manual.pdf`
   (Chrome does the rendering, because only a browser joins Kurdish letters
   correctly — the same reason the هامش stamp is drawn in the browser.)

The date on the cover and the line at the end both say when it was written. Change
them when you rebuild.
