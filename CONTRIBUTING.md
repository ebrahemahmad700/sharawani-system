# Working on this repo

This repo is public. Anyone can read it, so read the Data section before your
first commit.

## How a change reaches the demo site

The demo at https://sharawani01.vercel.app deploys from `main`
automatically:

- **Push to `main`**: the site updates a minute or two later. Whatever is on
  `main` is live, so run the tests first.
- **Push any other branch**: Vercel builds a separate preview link and posts it
  on the commit (and on the pull request, if you open one). Use this to try
  something out without touching the live site.

The demo login password isn't in the repo. Ask Ibrahim.

## Running it locally

See [app/README.md](app/README.md) ("Run it locally" and "Tests"), and the rules
at the end of that file.

## Database changes

Deploys don't run migrations, and the demo database credentials aren't in the
repo. If your change needs one:

- Add a new file in `app/db/migrations/`, numbered 10 above the current last one
  (e.g. `0600_your_change.sql`). Never edit a migration that's already in `main`.
- Send it to Ibrahim to apply to the demo database **before** you push the code
  that depends on it to `main`. Otherwise the live site breaks until it's applied.

## Data

The system holds municipal records that must not leave the municipality, and
this repo is public. So:

- Use invented names, letters and plot numbers in fixtures, tests and
  screenshots. Never use real ones.
- Never commit passwords, tokens, `.env` files, uploaded files or backups.
  `.gitignore` already leaves those out; keep it that way.
- Anything pushed stays in the history even after you delete it. If you push a
  secret by mistake, tell Ibrahim straight away so it can be changed.
