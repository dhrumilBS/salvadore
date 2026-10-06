# Salvadore — internal tools

Internal tools for the Healthray, Botphonic and Bigscal WordPress sites, plus
demos and templates. Served by XAMPP from `htdocs/salvadore`; open
`http://<this-pc>/salvadore/` for the dashboard.

## Layout

```
salvadore/
├── index.php          Dashboard: every tool as a card (read-only launcher)
├── registry.php       The list the dashboard shows — add new tools here
├── .htaccess          Security rules + redirects from the old (pre-Oct 2026) URLs
├── tools/             Real work tools
│   ├── healthray/     WordPress tools: master-dashboard, lead, menu-order,
│   │                  focus-keyword, wp_options, stateCity, template, version, …
│   │                  conn.php + .env = the database connection for all of them
│   ├── botphonic/     Botphonic database API (no page)
│   ├── bigscal/       Directory viewer + box/ (Node blog content builder)
│   ├── redirection/  image-downloader/  browser-snippets/
│   └── timestamp/  phone-validator/
├── playground/        Demos and experiments (bingo, canvas, code-editor, …)
├── templates/         HTML templates and their assets (bringer, arrigo)
├── assets/brand/      Company logos and favicon
└── _archive/          Retired code kept for reference — blocked from the web
```

## Setup on a new machine

1. **Database credentials** — for each `.env.example`, copy it to `.env` in the
   same folder and fill it in:
   - `tools/healthray/.env` (Landing live, Old local, Botphonic)
   - `tools/healthray/focus-keyword/.env` (its own login + databases)
   - `tools/botphonic/.env`
2. **PHP dependencies** — `composer install` in `tools/healthray/` and
   `tools/botphonic/` (installs `vendor/`, used for `.env` loading).
3. **Box Generator only** — `npm install` in `tools/bigscal/box/`, put the Google
   service-account key next to `server.js` as `service-account.json`, then
   `node server.js`.

`.env` files, service-account keys, `vendor/` and `node_modules/` are never
committed (see `.gitignore`).

## Rules

- **Never commit secrets.** Add new keys to the matching `.env.example` with an
  empty value.
- **Paths are relative to the file** (`__DIR__ . '/../conn.php'`), never
  `$_SERVER['DOCUMENT_ROOT'] . '/salvadore/...'`, so folders can move.
- **This server is reachable from the internet and most tools have no login.**
  `.htaccess` blocks `.env`/keys/SQL dumps for everyone and limits the
  dangerous endpoints (code runner, image downloader, folder delete) to this PC
  and `192.168.x.x`. A new endpoint that writes files, runs code or fetches
  arbitrary URLs must be added to that LAN-only list.
- Database tools that write ask for confirmation first; Master Dashboard also
  requires its own `X-Master-Dashboard` header on every write.

## Adding a tool

Put it under `tools/` (real tools), `playground/` (demos) or `templates/`, then
add an entry to `registry.php`. Until you do, it still appears on the dashboard
under **Unlisted**.

## Old URLs

Everything moved in October 2026; the old addresses (`/salvadore/healthray-sql/…`,
`/salvadore/img/…`, `/salvadore/box2/…`, …) permanently redirect (HTTP 308, POSTs
kept) to the new ones — see the bottom of `.htaccess`. `post-content/` was merged
into Master Dashboard's **Link Fixer** tab.
