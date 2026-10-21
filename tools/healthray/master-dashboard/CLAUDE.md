# Master Dashboard — Overview, Content (+ Bulk by URLs), Menu Order, Links, Focus Keywords, Canonicals, Redirects, Find & Replace

One standalone PHP + vanilla-JS tool (no WordPress hooks, no build step) that
talks to one or more WordPress databases directly over `mysqli`. It replaces
three former sibling tools that duplicated most of their plumbing:

| Former tool | Became |
|---|---|
| `../datewise/` (Content, Redirects, Bulk URL Update tabs) | Content (Bulk is its **Bulk by URLs** panel) + Redirects |
| `../link-checker/` (Link & UTM Checker) | the **Links** tab (its Dates filter + site-wide Export) |
| `../post-content/` (Link Checker / fixer) | the **Links** tab (code still `fixer`, `#fixer`) |
| `../menu-order/` | the **Menu Order** tab |
| `../replace/` (Find & Replace) | the **Find & Replace** tab |
| `../focus-keyword/` (duplicate focus keywords; its login was not ported) | the **Focus Keywords** tab |

Old URLs of all of these 308-redirect to the matching tab (`/salvadore/.htaccess`).

Don't fork this per site: a new WordPress site is a new `$DATABASES` entry in
`../conn.php` + its `.env` vars, and it shows up in the Site dropdown.

## What was de-duplicated

- **DB config**: everything goes through `../conn.php` (credentials in `.env`).
  link-checker's own `conn.php` with hardcoded credentials is not used.
- **One bootstrap / one cookie**: `api/bootstrap.php` resolves the site from
  `?db=`, `$_POST['db']`, or the **`md_db`** cookie (default `landing`). Its own
  cookie on purpose, so switching here never affects `wp_options` etc. An
  unknown key is pinned to `$DEFAULT_DB` (conn.php would otherwise fall
  through to the shared `db` cookie).
- **The page pins its site; the cookie does not drive requests.** `initSite()`
  (`js/common.js`) reads the site once at load, and `api()` / `apiUrl()` send
  it as `?db=` on *every* call, including export links. Never call `fetch()`
  directly or build an `api/...` URL by hand: with two tabs open, switching
  site in one rewrites the cookie, and a cookie-driven save in the other tab
  would write that post's ID into the wrong site's database.
- **One query layer** (`api/lib/query.php`): the Links tab uses the same
  `dw_parse_input()` / `dw_build_where()` / `dw_hydrate_batch()` as the Content
  tab, so Links rows get the **real permalink** (permalink-structure aware), not
  `guid`, and Links search also covers Yoast meta title/description/focus kw.
  `post_type=any` means "every real content type" (Links tab's All Types).
- **One live link checker** (`api/lib/link_checker.php`): single
  (`check_url_status.php`) + concurrent bulk (`check_links_bulk.php`, max 300
  URLs/call), plus the opt-in live-check filter used by all three CSV exports.
  `dw_check_plan()` allows the site's own host **or** a public http(s) URL,
  and returns a `CURLOPT_RESOLVE` pin. SSRF guard, fail-closed: only public IP
  literals or real DNS names whose *every* address is public; numeric/hex/short
  hosts (`2130706433`, `0x7f000001`, `127.1`) and `[::1]`-style IPv6 are refused;
  the vetted IP is pinned so curl can't re-resolve (DNS rebinding); redirects
  are never followed. Every caller must pass the pins (`dw_check_plans()`) to
  `dw_check_urls_concurrent()` / `dw_check_url_once()`.
  Load: max `DW_CHECK_PER_HOST` (3) requests per host per call, `DW_CHECK_TIMEOUT` 15s, timeouts get one
  more try at 1 per host. Cloudflare doesn't cache HEAD, so each check renders on the WP origin - 30 at
  once made healthray.com time out on good pages. Status 0 results carry `error_kind`
  (timeout/dns/connect/ssl/error, from curl errno); the badges label it via `noResponse()` (common.js).
- **Frontend**: `js/common.js` holds the shared helpers (qs/escape/toast/copy,
  `urlCellHtml`, theme, site switcher, filter options, trash->410 prompts) and
  the **`LinkStatus`** checker. Its cache is keyed **by URL**, shared across
  tabs: any element with `data-status-url` re-renders when that URL's result
  changes, and one delegated handler serves every Check/↻ button.

## Layout

```
index.html          one page, views toggled by a two-level nav: #navGroups (Overview / Content / Links / SEO /
                    Tools) above #viewTabs (each .view-tab has data-group; only the active group's tabs show,
                    the row hides for one-tab groups; a group click reopens its last tab, md.nav.last).
                    A new tab = a .view-tab with data-group + a VIEWS entry (hash: #overview #content #links #fixer
                    #redirects #menu #replace #keywords #canonical; retired #links / #bulk still work via
                    VIEW_ALIASES in app.js; Link Fixer keeps its filters after a "?": #fixer?page=2&status=error&find=...,
                    Find & Replace accepts #replace?find=...&replace=... and searches straight away)
style.css           base + shared components (stat cards, modals, export menu, dialogs, History drawer, nav,
                    pager); body.is-live-site = red top edge + "LIVE SITE" line in every write confirm
js/common.js        shared helpers, confirmDialog()/alertDialog(), toast(), LinkStatus
js/ui.js            shared list building blocks every tab uses: mdPager (pagination footer: "Showing a–b of N",
                    numbered pages, rows/page saved per tab), mdSelection (row selection + select-all state),
                    tableStateRow (loading/empty/error row), mdStore (all prefs: md.<key>, never throws)
js/content.js       Content tab (staged edits, confirmed saves)
js/fixer.js         Links tab (was Link Fixer + Links & UTM): check / edit / fix-redirect / unlink / find-replace links in
                    post_content + FAQ fields; Dates filter; site-wide CSV export (links_export.php)
js/history.js       unified History drawer (every write on this site, filters, diff, Undo, CSV) - see "Activity history"
js/redirects.js     Redirects tab (list + add/edit/duplicate/delete, selection bulk bar, import)
js/bulk.js          Bulk by URLs panel at the top of the Content tab (button, #bulk, g b): paste slugs/URLs -> status
js/menu-order.js    Menu Order tab (IIFE; mo- ids): inline edit order/title/slug/date, drag reorder, renumber, review & save
js/replace.js       Find & Replace tab (IIFE; fr- ids): literal text search over title/content/excerpt/Elementor/Yoast/meta,
                    JSON + serialized aware, backups + undo; its "Replace history" opens the shared History
                    drawer filtered to Find & Replace (openHistory({source:'replace'}))
js/keywords.js      Focus Keywords tab (IIFE; kw- ids, read-only): duplicate Yoast focus keywords, client-side table/CSV
js/canonical.js     Canonicals tab (IIFE; cn- ids, #canonical, g n): canonical URLs that redirect / are gone / name a
                    retired post; remove or "use redirect target", client-side filters + CSV
css/*.css           one stylesheet per tab, scoped to its view (css/links.css = the fx- Links tab, loaded
                    right after style.css; its fx-modal-* pieces are reused by the Redirects editor)
js/finder.js        Ctrl/Cmd+K palette + post drawer (read-only; finder_search.php / finder_post.php): search
                    posts by title/slug/ID/URL, jump to tabs, run actions. Gets every key first (onGlobalKey)
js/overview.js      Overview: header -> hero (Site health = checks passing + failing checks worst-first, built only from
                    numbers the cards below already show - healthChecks(); KPI tiles) -> titled sections on a 12-col grid
                    (.ov-span-4/6/8/12 in index.html, rows stretch to one height). Cards share cardHead() (icon tile, title,
                    CARD_SUBS subtitle). Search visibility bar colours (--vis-*, css/overview.css) passed the dataviz
                    palette validator for both themes - re-run it if you change them.
                    Each number deep-links into its tab pre-filtered (incl. Canonical URLs,
                    from canonical_report.php?summary=1). Search visibility card = every site side by side
                    (robots_summary.php); another site's number switches site, then opens (sessionStorage md.ov.pendingGo)
js/app.js           view switching, lazy loading, cross-tab staleness, global keyboard shortcuts, init
api/                endpoints (below); api/lib/ shared PHP (lib/link_editor.php = Link Fixer)
backups/            activity-<site>.jsonl (unified History log, lib/activity.php),
                    Yoast redirect-option backups (before every redirect write),
                    link-changes-<site>.jsonl (Link Fixer journal), replace-history-<site>.jsonl +
                    replace-op-<id>.json (Find & Replace journal + full before/after per op)
                    (.htaccess denies web access)
```

Links-tab element IDs are `l`-prefixed (`lStatus`, `lTableBody`, ...) and Link
Fixer IDs/classes `fx-`-prefixed, so they never collide with the Content tab's.

## Link Fixer (former `../post-content/`)

- **Writes match the raw `href`**, never the displayed `url`. Extraction
  (`dw_fx_extract_links()`) is regex-based on purpose so every link keeps the
  exact stored bytes (`&amp;`, relative paths) next to its decoded absolute
  `url` (used for display + live checks). Rewrites only touch `<a>` tags'
  `href` (never `data-href`); unlink keeps the inner HTML.
- **FAQ fields** = postmeta keys matching `DW_FX_FAQ_KEY_REGEX` that don't
  start with `_`; `dw_fx_is_faq_key()` guards every write - the client can't
  name an arbitrary meta key.
- New URLs must pass `dw_fx_valid_new_url()` (http(s)://, /, #, mailto:, tel:).
- **Every write is journaled** (`dw_fx_journal_append()`) with the field's full
  previous value. `dw_fx_undo()` restores it only while the field's sha1 still
  equals what that write produced - otherwise `conflict`, never a clobber. Each
  write is its own transaction with the row locked (`FOR UPDATE`).
- Site-wide find (`link=`) searches every spelling a URL can have in stored HTML
  (`dw_fx_needle_variants()`: as typed, `&amp;`, root-relative for own-site URLs).
- Check results come from the shared `LinkStatus` (persisted per site in
  sessionStorage for 30 min); HEAD answers 403/405/501 are re-checked with GET.

## Ported tabs (Menu Order, Find & Replace, Focus Keywords)

- Each is one IIFE exposing only `bind<Tab>Tab()`, `load<Tab>()`, `<prefix>HandleKey(e)`
  and `<prefix>HasUnsaved()` (+ `frReadHash()`); `VIEWS` in app.js routes to them.
  Their key handlers get every keydown while their tab is active (Menu Order's
  even before the confirm-dialog check, for Ctrl+S) and do their own typing checks.
- Unsaved work: `unsavedTabs()` (common.js) drives both the site-switch warning
  and the leave-page prompt - add a new tab with unsaved state to `UNSAVED_CHECKS`.
- **Menu Order save** (`menu_save.php`): all-or-nothing; every change must carry
  the row's `post_modified` (optimistic lock, checked inside the transaction).
- **Find & Replace**: literal matching only (no regex). The op backup and the
  history line are written *before* commit; undo restores a field only while it
  still equals what the replace wrote. It does not bump `post_modified` or clear
  Elementor's CSS cache (same as the original tool).
- **Focus Keywords** keeps the original tool's Yoast-indexable-first permalinks
  (`fk_*` in lib/focus_keyword.php), not `dw_hydrate_batch()`.
- Sites whose label contains "Live" get the LIVE flag; both production sites
  (`Landing - Live`, `Botphonic - Live` in ../conn.php) must keep that word.

## Activity history (unified History drawer)

- **Every write endpoint logs one entry after its commit** via
  `md_activity_log($ACTIVE_DB, [source, action, summary, post_ids?, changes?, ref?])`
  (`api/lib/activity.php`, `require_once`). It appends a JSON line to
  `backups/activity-<site>.jsonl` (flock; id/time/ip added; file rotated to
  `activity-<site>-<date>.jsonl` past 20 MB - rotated files are not listed). It never
  throws: a failed log returns null + `error_log()`, the write stands. Responses add `activity_id`.
- `changes`: `{kind:'post', post_id, field:<wp_posts column>, before, after}`,
  `{kind:'meta', post_id, key, before|null, after}`, `{kind:'redirect', origin, format?, before:{url,type}|null, after|null}`;
  `link`/`text` kinds are display-only (Link Fixer / Find & Replace, whose own journals do the undo -
  `ref: {journal:'fixer'|'replace', id, ids?}`). "Before" values are read under the same row lock as the write.
- Who logs: `update_post` (content), `bulk_update_status` (bulk, one entry), `add_redirect` / `redirect_save` (redirects, one entry per save),
  `menu_save` (menu, one entry per save), `replace_apply`/`replace_undo`, `fixer_write`/`fixer_undo`, `kw_save` (keywords),
  `canonical_fix` (canonical).
  A new write endpoint must log too.
- `activity_list.php` merges the older journals at read time (`fx-<id>` / `fr-<op>` entries) unless an activity
  entry already points at that journal line; undo state of journal-backed entries comes from the journal.
- `activity_undo.php` restores a value only while it still equals the logged `after` (per change, skipped
  ones reported), then logs an `undo` entry and appends an `undone` marker line. Menu undos bump
  `post_modified`; trash/untrash undos never touch 410 redirects; redirect undos go through
  `dw_redirect_restore()` (backup first). Replace/Fixer delegate to `fr_undo_op()` / `dw_fx_undo()`.
- `js/history.js` wraps `api()` so any POST response carrying `activity_id` refreshes the badge
  (writes of the last 24 h). `openHistory({source})` preselects a filter chip; the top-bar button and `h` open "All".
- Tests: define `MD_ACTIVITY_DIR` (or env var, CLI only) to point the log at a temp dir.

## Rules that must survive changes

- **List tabs use js/ui.js**: a paged table gets `mdPager` (no hand-built Prev/Next), state rows come
  from `tableStateRow()`, and prefs go through `mdStore` - never raw `localStorage` (only `theme`, which
  the inline `<head>` script reads before paint). Rows/page lives in the pager, not the filter panel.

- **Writes and outbound checks need `require_same_origin()`** (`bootstrap.php`;
  `require_post_method()` calls it). This tool has no login, so it's the only
  thing stopping another website open in the browser from POSTing a form here.
  It needs the `X-Master-Dashboard: 1` header that `api()` adds, plus a
  same-origin `Sec-Fetch-Site`/`Origin`. Any new POST endpoint must call
  `require_post_method()`.
- **CSV cells go through `dw_csv_write()`**, never `fputcsv()` directly: titles,
  anchors and meta come from post content, and a cell starting `= + - @` runs
  as a formula in Excel.
- **Stale responses**: list loaders use `latestOnly()` (aborts the previous
  request) so a slow older response can never overwrite a newer one.
- **Post types are per site**: Content tabs are built from `filter_options.php`,
  never hard-coded. Internal types go in `dw_excluded_post_types()`.
- **"Live" means published/private/scheduled** (`dw_live_statuses()`): a
  redirect origin matching a *trashed* post is a retired URL, not a conflict;
  a destination matching only a trashed post counts as missing.
- **`api/_test_store.php` is CLI-only** (404 over the web).

- **Nothing auto-saves.** Content edits stage locally (`contentDirty`), show an
  amber outline, and need Save + `confirmDialog()` listing exactly what changes.
  Bulk status apply, every redirect write and every Link Fixer write also go
  through `confirmDialog()` first (it names the site being written). Explicit
  product requirement - don't reintroduce save-on-change, and don't swap the
  dialog back to native `confirm()` (it truncates long change lists).
- **Trash -> 410 prompt** fires only when a save moves a post *into* `trash`
  (Content save or Bulk apply). It only adds/replaces a redirect, never removes.
  "Moved into trash" is decided by the server (`update_post.php` returns
  `previous`; `bulk_update_status.php` returns `newly_trashed`), not by a row
  on screen. Content "Save all" asks once for the whole batch. A 410 is removed
  from the Redirects tab (Delete) or by undoing it in History.
- **Redirects tab editing** (`redirect_save.php` -> `dw_redirect_apply()`): add / edit /
  duplicate / delete per row, bulk type / destination / delete on the selection, and
  Import (pasted `origin, destination, type` lines or an Export CSV). Every write is a
  dry run first (server validation + warnings), then `confirmDialog()`, then the save:
  one locked transaction, all-or-nothing, backup first. Edit/delete send the rule as
  loaded (`from`) and are refused if it changed since. An edit keeps the rule's position;
  renaming an origin logs two History changes (old removed, new added). Regex rules are
  editable too (pattern must compile); they are matched by exact pattern, plain rules by
  `dw_redirect_key()`.
- **Canonical check after retiring a URL**: `offerCanonicalCleanup(paths)` (common.js) runs after the
  trash -> 410 prompts (whatever the answer - a trashed canonical target 404s anyway) and after a Redirects-tab
  save that adds/edits a plain 301/302/307/410/451 rule. It asks `canonical_report.php?paths=` which posts use
  those URLs as `_yoast_wpseo_canonical` and offers (confirmDialog) to remove them. Matching lives in
  `lib/canonical.php` (`dw_canonical_audit()`): plain rules by `dw_redirect_key()`, regex rules too, 3xx chains
  followed (max 5 hops) for the suggested target; trashed posts' own canonicals are ignored, external
  (cross-domain) canonicals are out of scope. `canonical_fix.php` is all-or-nothing with an `expected` check,
  syncs `wp_yoast_indexable.canonical`, does not bump `post_modified`, logs source `canonical`
  (undo = the generic meta undo + indexable sync in `activity_undo.php`).
- **Yoast meta keys** use the `_yoast_wpseo_*` prefix on these installs.
- **Robots (Yoast "Advanced": noindex / nofollow)** are Content-tab fields `robots_index` (`''` = post type default,
  `index`, `noindex`) and `robots_follow` (`follow`, `nofollow`), stored as Yoast does (`DW_ROBOTS_META` in
  lib/query.php: `meta-robots-noindex` 1/2/no row, `meta-robots-nofollow` 1/no row). Every write and undo also
  syncs `wp_yoast_indexable.is_robots_noindex/_nofollow` (`dw_robots_sync_indexable()`) - Yoast's front end reads
  the indexable. The "Default (Yes/No)" label comes from `wpseo_titles` `noindex-<type>`. SEO filter `noindex` /
  `nofollow` = set on the post itself.
- **Permalinks** come from each site's real `permalink_structure` option
  (Healthray `/%category%/%postname%/`, Botphonic flat). Pages/CPTs use the
  parent/slug chain. Trashed slugs are cleaned of `__trashed` before building URLs.
- **Regex redirects** are listed but never matched against posts or live-checked.
- **Redirect live check targets the origin URL** (does the rule fire?).
- Links tab caps one load at `dw_links_row_cap()` (3000 posts) and shows a
  banner when capped.
- Cross-tab freshness: a write calls `onPostsChanged()` / `onLinksChanged()` /
  `onRedirectsChanged()` (`js/app.js`), which reloads the visible affected tab
  or marks it stale.

## Endpoints (`api/`)

| File | Method | Purpose |
|---|---|---|
| `databases.php` | GET | configured sites + current |
| `filter_options.php` | GET | post types (with counts) + status map |
| `category_counts.php` | GET | Content tab Category dropdown (Post tab only): post categories + posts per category in `status=`, `total` |
| `list_posts.php` | GET | Content list (paged server-side) |
| `update_post.php` | POST | save one field on one post |
| `export.php` | GET | Content CSV (batched, optional live-check filter) |
| `links_list.php` | GET | posts + extracted links (Overview link check) |
| `links_export.php` | GET | Links tab site-wide CSV (`mode=posts|links|utm`, `check=1`) |
| `check_url_status.php` | GET | live-check one URL |
| `check_links_bulk.php` | POST | live-check up to 300 URLs |
| `redirects.php` / `redirects_export.php` | GET | Yoast redirects list / CSV |
| `add_redirect.php` | POST | upsert one Yoast redirect (backup first) - trash -> 410 prompts |
| `redirect_save.php` | POST | Redirects tab: `ops` JSON `[{action:add|edit|delete, from?, origin, format, type, url}]` (max 1000), `dry_run=1` validates only, `replace=1` lets add overwrite. All-or-nothing; per-op `results` with errors/warnings |
| `bulk_find_posts.php` | POST | resolve pasted slugs/URLs to posts |
| `bulk_update_status.php` | POST | one status for many post IDs |
| `fixer_list.php` | GET | Link Fixer: one page of posts + every link (content + FAQ), `link=` site-wide find |
| `fixer_write.php` | POST | `op=replace|unlink`, `items=` JSON (max 1000) - each journaled |
| `fixer_history.php` | GET | this site's Link Fixer journal, newest first (legacy; History uses activity_list) |
| `activity_list.php` | GET | unified History: `source`, `q`, `limit`, `offset` -> entries, total, counts_by_source, recent_24h, admin_url |
| `activity_undo.php` | POST | undo one History entry (`id`; also `fx-`/`fr-` journal ids) - per-change, skipped if changed since |
| `fixer_undo.php` | POST | undo one journal entry (refused if the field changed since) |
| `menu_types.php` / `menu_list.php` | GET | Menu Order: post types / rows of one type (+ parents, site URL) |
| `menu_save.php` | POST | Menu Order: validate + save order/title/slug/date changes (JSON body) |
| `replace_site.php` | GET | Find & Replace: home URL, post types, scopes, statuses |
| `replace_search.php` | POST | Find & Replace: preview matches (read-only, max 1000 fields) |
| `replace_apply.php` / `replace_undo.php` | POST | Find & Replace: replace selected fields / undo one op |
| `replace_history.php` | GET | Find & Replace journal, newest first |
| `kw_options.php` / `kw_list.php` | GET | Focus Keywords: types + categories / rows with duplicate flags |
| `kw_save.php` | POST | Focus Keywords: save staged keyword edits (JSON `changes:[{post_id, focus_keyword, expected}]`, max 500). All-or-nothing; each row's stored `_yoast_wpseo_focuskw` must still equal `expected` (else 409 + per-row `conflict` errors). Empty = meta deleted; syncs `wp_yoast_indexable.primary_focus_keyword`, bumps `post_modified`. Edits in the tab stage inline and save only via the save bar's Review & save (`confirmDialog`) |
| `canonical_report.php` | GET/POST | Canonicals: posts whose canonical hits a 410 / 3xx rule / retired post (`paths=` restricts to those URLs, `unmatched=0`, `format=csv`, `summary=1` counts only) |
| `canonical_fix.php` | POST | `items` JSON `[{post_id, expected, canonical}]` (max 1000, `''` = remove). All-or-nothing, 409 on conflict |
| `robots_summary.php` | GET | Overview Search visibility: published posts per site (all `$DATABASES`, own connection each) by indexed / noindex on post / noindex by type default / nofollow, + `by_type` |
| `finder_search.php` / `finder_post.php` | GET | Ctrl+K palette: post search / one post's detail (read-only) |
| `_test_store.php` | CLI | redirect-store self test |

## Extension pointers

- New editable field: `renderCell()` + `FIELD_LABELS` (`js/content.js`) + a case in `update_post.php`.
- New export column: `$allColumns` in `export.php` + the key in `dw_hydrate_batch()`.
- New sortable column: a key in `dw_sort_columns()` (constants.php) + `SORT_BY_COLUMN` and the `#fSort` option (Content headers,
  dropdown and ↓/↑ button stay in sync via `syncSortControls()`). Link Status is live-only and never sorts.
- New filter shared by Content + Links: `dw_parse_input()` / `dw_build_where()`, then a control + state key in each tab.
- Excluded post types / statuses / sort columns: `api/lib/constants.php`.
