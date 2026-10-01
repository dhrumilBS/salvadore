# Master Dashboard — Content, Links & UTM, Redirects, Bulk URL Update

One standalone PHP + vanilla-JS tool (no WordPress hooks, no build step) that
talks to one or more WordPress databases directly over `mysqli`. It replaces
two former sibling tools that duplicated most of their plumbing:

| Former tool | Became |
|---|---|
| `../datewise/` (Content, Redirects, Bulk URL Update tabs) | same three tabs here |
| `../link-checker/` (Link & UTM Checker) | the **Links & UTM** tab |

Don't fork this per site: a new WordPress site is a new `$DATABASES` entry in
`../conn.php` + its `.env` vars, and it shows up in the Site dropdown.

## What was de-duplicated

- **DB config**: everything goes through `../conn.php` (credentials in `.env`).
  link-checker's own `conn.php` with hardcoded credentials is not used.
- **One bootstrap / one cookie**: `api/bootstrap.php` resolves the site from
  `?db=`, `$_POST['db']`, or the **`md_db`** cookie (default `landing`). Its own
  cookie on purpose, so switching here never affects `wp_options` etc.
- **One query layer** (`api/lib/query.php`): the Links tab uses the same
  `dw_parse_input()` / `dw_build_where()` / `dw_hydrate_batch()` as the Content
  tab, so Links rows get the **real permalink** (permalink-structure aware), not
  `guid`, and Links search also covers Yoast meta title/description/focus kw.
  `post_type=any` means "every real content type" (Links tab's All Types).
- **One live link checker** (`api/lib/link_checker.php`): single
  (`check_url_status.php`) + concurrent bulk (`check_links_bulk.php`, max 300
  URLs/call), plus the opt-in live-check filter used by all three CSV exports.
  `dw_url_checkable()` allows the site's own host **or** any public http(s)
  URL; private/loopback/reserved IPs are refused (SSRF guard - Links-tab URLs
  come from post content and can point anywhere).
- **Frontend**: `js/common.js` holds the shared helpers (qs/escape/toast/copy,
  `urlCellHtml`, theme, site switcher, filter options, trash->410 prompts) and
  the **`LinkStatus`** checker. Its cache is keyed **by URL**, shared across
  tabs: any element with `data-status-url` re-renders when that URL's result
  changes, and one delegated handler serves every Check/↻ button.

## Layout

```
index.html          one page, 4 views toggled by #viewTabs (hash: #content #links #redirects #bulk)
style.css           datewise base + Links-tab-only components (stat cards, modal, link cards, export menu)
js/common.js        shared helpers + LinkStatus
js/content.js       Content tab (staged edits, confirmed saves)
js/links.js         Links & UTM tab (client-side utm/domain/status filters, detail modal)
js/redirects.js     Redirects tab
js/bulk.js          Bulk URL Update tab
js/app.js           view switching, lazy loading, cross-tab staleness, init
api/                endpoints (below); api/lib/ shared PHP
backups/            Yoast redirect-option backups written before every redirect write (.htaccess denies web access)
```

Links-tab element IDs are `l`-prefixed (`lStatus`, `lTableBody`, ...) so they
never collide with the Content tab's.

## Rules that must survive changes

- **Nothing auto-saves.** Content edits stage locally (`contentDirty`), show an
  amber outline, and need Save + `confirm()` listing exactly what changes. Bulk
  status apply and every redirect write also `confirm()` first. Explicit
  product requirement - don't reintroduce save-on-change.
- **Trash -> 410 prompt** fires only when a save moves a post *into* `trash`
  (Content save or Bulk apply). It only adds/replaces a redirect, never removes.
- **Yoast meta keys** use the `_yoast_wpseo_*` prefix on these installs.
- **Permalinks** come from each site's real `permalink_structure` option
  (Healthray `/%category%/%postname%/`, Botphonic flat). Pages/CPTs use the
  parent/slug chain. Trashed slugs are cleaned of `__trashed` before building URLs.
- **Regex redirects** are listed but never matched against posts or live-checked.
- **Redirect live check targets the origin URL** (does the rule fire?).
- Links tab caps one load at `dw_links_row_cap()` (3000 posts) and shows a
  banner when capped.
- Cross-tab freshness: a write calls `onPostsChanged()` / `onRedirectsChanged()`
  (`js/app.js`), which reloads the visible affected tab or marks it stale.

## Endpoints (`api/`)

| File | Method | Purpose |
|---|---|---|
| `databases.php` | GET | configured sites + current |
| `filter_options.php` | GET | post types (with counts) + status map |
| `list_posts.php` | GET | Content list (paged server-side) |
| `update_post.php` | POST | save one field on one post |
| `export.php` | GET | Content CSV (batched, optional live-check filter) |
| `links_list.php` | GET | Links tab: posts + extracted links |
| `links_export.php` | GET | Links CSV (`mode=posts|links|utm`, `check=1`) |
| `check_url_status.php` | GET | live-check one URL |
| `check_links_bulk.php` | POST | live-check up to 300 URLs |
| `redirects.php` / `redirects_export.php` | GET | Yoast redirects list / CSV |
| `add_redirect.php` | POST | upsert one Yoast redirect (backup first) |
| `bulk_find_posts.php` | POST | resolve pasted slugs/URLs to posts |
| `bulk_update_status.php` | POST | one status for many post IDs |
| `_test_store.php` | CLI | redirect-store self test |

## Extension pointers

- New editable field: `renderCell()` + `FIELD_LABELS` (`js/content.js`) + a case in `update_post.php`.
- New export column: `$allColumns` in `export.php` + the key in `dw_hydrate_batch()`.
- New filter shared by Content + Links: `dw_parse_input()` / `dw_build_where()`, then a control + state key in each tab.
- Excluded post types / statuses / sort columns: `api/lib/constants.php`.
