# Salvadore — internal tools

Internal tools for the Healthray, Botphonic and Bigscal WordPress sites. Served by XAMPP (PHP 8.2) from
`htdocs/salvadore`; open `http://<this-pc>/salvadore/` for the dashboard.

## Tools

| Tool | Folder | What it does |
|---|---|---|
| **Master Dashboard** | `tools/healthray/master-dashboard/` | Every WordPress task in one page: Overview, Content, Links & UTM, Link Fixer, Redirects, Bulk URL Update, Menu Order, Find & Replace, Focus Keywords. Ctrl+K post finder, unified History with undo. Multi-site. |
| **Template Pages** | `tools/healthray/template-pages/` | Pages per page template (HIMS, EMR, EHR, PMS, Lab…) with their city pages: live URL status, canonical, menu order, staged title / slug / status edits. Healthray Live only. |
| **Lead Report** | `tools/healthray/lead/` | Form submission report. |
| **WP Options Panel** | `tools/healthray/wp_options/` | Browse, edit and delete `wp_options` rows. Has its own login (see its README). |
| **Post Revisions** | `tools/healthray/version/` | List and clean up `wp_posts` revisions (keeps the latest 5 per post). |
| **Healthray File Browser** | `tools/healthray/` | Browse the PHP/HTML files of the tool folders (the file listing works on the office LAN only). |
| **Botphonic API** | `tools/botphonic/` | Endpoints for the Botphonic database. No page. |
| **Image Downloader** | `tools/image-downloader/` | Pull every image from a site into a local folder. LAN only. |
| **Bigscal Directory Viewer** | `tools/bigscal/` | Browse the Bigscal section folders. |
| **Blog Content Builder** | `tools/bigscal/box/` | Blog content builder (Google APIs). Needs `node server.js`. |
| **Browser Snippets** | `tools/browser-snippets/` | DevTools snippets: alt-text fixer, schema generator, link editor… |
| **Timestamp Converter** / **Phone Validator** | `tools/timestamp/`, `tools/phone-validator/` | Small standalone helpers. |

The dashboard (`index.php`) is generated from `registry.php` — that list is the source of truth.

## Layout

```
salvadore/
├── index.php          Dashboard: every tool as a card (read-only launcher)
├── registry.php       The list the dashboard shows — add new tools here
├── .htaccess          Security rules + redirects from old URLs
├── assets/
│   ├── home.css, home.js   Dashboard styles + search / filter / "Recently opened"
│   ├── icons/         One SVG per tool — its dashboard card icon and its favicon
│   └── brand/         Company logos and the site favicon
└── tools/
    ├── healthray/     WordPress tools (table above)
    │                  conn.php + .env = the database connection for all of them
    ├── botphonic/     Botphonic database API (own conn.php + .env)
    ├── bigscal/       Directory viewer + box/ (Node blog content builder)
    └── image-downloader/  browser-snippets/  timestamp/  phone-validator/
```

Bigger tools keep their own notes next to the code: `tools/healthray/master-dashboard/CLAUDE.md`,
`tools/healthray/lead/CLAUDE.md`, `tools/healthray/wp_options/README.md`.

## Setup on a new machine

1. **Database credentials** — copy each `.env.example` to `.env` in the same folder and fill it in:
   - `tools/healthray/.env` (Landing live, Botphonic, …)
   - `tools/botphonic/.env`
2. **PHP dependencies** — `composer install` in `tools/healthray/` and `tools/botphonic/`
   (installs `vendor/`, used for `.env` loading).
3. **Blog Content Builder only** — `npm install` in `tools/bigscal/box/`, put the Google
   service-account key next to `server.js` as `service-account.json`, then `node server.js`.
4. **WP Options Panel** — set your own password: `php tools/healthray/wp_options/api/_hash.php "new-password"`
   and paste the hash into `api/_config.php`.

`.env` files, service-account keys, `backups/` contents, `vendor/` and `node_modules/` are never
committed (see `.gitignore`).

## Rules

- **Never commit secrets.** Add new keys to the matching `.env.example` with an empty value.
- **Paths are relative to the file** (`__DIR__ . '/../conn.php'`), never
  `$_SERVER['DOCUMENT_ROOT'] . '/salvadore/...'`, so folders can move.
- **This server is reachable from the internet and most tools have no login.**
  `.htaccess` blocks `.env` / keys / SQL dumps for everyone and limits the dangerous
  endpoints (image downloader, file listing) to this PC and `192.168.x.x`. A new endpoint
  that writes files, runs code or fetches arbitrary URLs must be added to that LAN-only list.
- **Pin the database per request.** `conn.php` falls back to a `db` cookie shared by every tool,
  so a tool must say which site it reads *and* writes (Master Dashboard sends `?db=` on every call,
  Template Pages sets `$ACTIVE_DB` in its `api/bootstrap.php`). Never read from one site and save to another.
- **Writes need a same-origin header and a confirmation.** Master Dashboard requires
  `X-Master-Dashboard: 1`, Template Pages `X-Template-Pages: 1`; both show what will change and
  ask before saving. Nothing auto-saves.
- **CSV exports escape cells** starting with `= + - @` so they can't run as Excel formulas.

## Adding a tool

1. Put it under `tools/<name>/`.
2. Add an entry to `registry.php` — `name`, `path`, `tags`, `desc` (tooltip + search) and `icon`.
   Until you do, it still appears on the dashboard under **Unlisted**.
3. Icon: copy any file in `assets/icons/` (a 32×32 rounded square in the tool's accent colour with
   a white stroke icon), change the colour and paths, and use it as the tool's favicon too:
   `<link rel="icon" href="../../assets/icons/<name>.svg" type="image/svg+xml">`.

## Removing a tool

Delete its folder. The dashboard hides any registry entry whose path no longer exists, so nothing
shows up broken; remove the entry from `registry.php` when convenient. If people have the old URL
bookmarked, add a redirect in `.htaccess`.

## Old URLs

Everything moved in October 2026; the old addresses (`/salvadore/healthray-sql/…`, `/salvadore/img/…`, …)
permanently redirect (HTTP 308, POSTs kept) to the new ones — see the bottom of `.htaccess`.

| Old tool | Now |
|---|---|
| `post-content/` | Master Dashboard → **Link Fixer** tab |
| `menu-order/`, `replace/`, `focus-keyword/` | Master Dashboard → **Menu Order**, **Find & Replace**, **Focus Keywords** tabs |
| `stateCity/`, `template/` (Template Explorer), `stateCity/keyphrase.php` | **Template Pages** |
