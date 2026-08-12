# Datewise — Content Export & Redirects Tool

## What this actually is

The original ask (kept below, under "Original spec") described a WordPress
**admin plugin** built with `WP_Query`, nonces, and capability checks. What
was actually built is different, on purpose: a **standalone PHP + vanilla-JS
tool**, served outside WordPress, that talks to one or more WP databases
directly over `mysqli`. It lives at
`/salvadore/healthray-sql/datewise/` alongside sibling tools in this repo
(`wp_options`, `lead`, `stateCity`, ...) and shares their DB connection
config (`/salvadore/healthray-sql/conn.php`).

Practically, that means:
- No WordPress hooks, no `WP_Query`, no wp-admin screen. It's a page you
  open directly in a browser.
- No nonce/capability checks - WordPress' auth model doesn't apply here.
  Whatever access control exists is at the web-server/network level, same
  as every other tool in this repo.
- No build step, no framework. `index.html` + `script.js` (plain
  `fetch`-based, two tabs) + `style.css`, backed by PHP endpoints under
  `api/`.
- Because it connects directly to the DB, it can (and does) point at
  **more than one WordPress site** - see below.

## Multi-site database switching

`/salvadore/healthray-sql/conn.php` defines every reachable database in a
`$DATABASES` array (currently `landing` = Healthray live, `botphonic` =
Botphonic live, `old` = a local Healthray snapshot).

- `api/bootstrap.php` resolves which one to use for the current request
  from (in order) `?db=`, `$_POST['db']`, or a **`dw_db` cookie** -
  defaulting to `landing`.
- This is deliberately its own cookie, separate from the `db` cookie the
  `wp_options` tool uses. Switching sites here can never affect that tool,
  or vice versa.
- `api/databases.php` lists the configured sites (key + label) and which
  one the current request resolved to.
- The header's **Site** dropdown (`#dbSelector` in `index.html`,
  `loadDatabaseSwitcher()`/`bindDatabaseSwitcher()` in `script.js`) reads
  that list, and on change sets the `dw_db` cookie + reloads the page.
  Every other feature (list/edit/export, Redirects tab) automatically
  follows the cookie without any extra plumbing.
- **To add a new site**: add an entry to `$DATABASES` in `conn.php` plus
  its env vars. It shows up in the Site dropdown with no other code
  changes.

## Feature: Content tab (Posts/Pages/custom post types)

- `api/list_posts.php` + `api/lib/query.php` do the listing: filter by
  post type / status / publish & modified date range / search (title,
  slug, content, Yoast meta title/description/focus keyword), sort, and
  paginate.
- **Filters that exist in the query layer but have no UI control yet**:
  author, category, tag (`dw_build_where()` in `query.php` already
  supports `author`/`category`/`tag` params - only `sort=author` is
  actually wired into the UI). Add the missing controls if a real need
  comes up; the backend is ready for them.
- **Yoast meta key gotcha**: this install's Yoast SEO stores meta under
  the `_yoast_wpseo_*` prefix, not the bare `_wpseo_*` prefix Yoast's own
  docs usually show. See `dw_needed_meta_keys()` in `api/lib/constants.php`.
- **Permalink reconstruction is per-site, not hardcoded.** Different
  WordPress installs really do use different permalink structures -
  Healthray uses `/%category%/%postname%/`, Botphonic uses the flat
  `/%postname%/`. `dw_permalink_structure()` reads each site's real
  `permalink_structure` option (`wp_options`), and `dw_build_post_path()`
  substitutes its tags (`%postname%`, `%category%`, `%post_id%`, date
  tags) instead of assuming one fixed shape. This only applies to the
  `post` post type - Pages and other hierarchical types always use their
  parent/slug chain, since WordPress' `permalink_structure` option never
  governs those. **If this ever looks wrong for a new site, check that
  site's actual `permalink_structure` value first** - don't assume the
  bug is in the reconstruction code.
- **Editable fields**: title, slug, status, publish date, meta title,
  meta description (`api/update_post.php`, one field per call).
- **Nothing auto-saves.** Editing a cell only stages the change locally
  (`dirtyFields` in `script.js`) - it's marked with an amber "dirty"
  outline and enables that row's **Save** button. A bulk "Save all
  changes" bar appears once more than one row is dirty. Both the per-row
  Save and the bulk Save trigger a `confirm()` dialog listing exactly
  what will change *before* anything is sent to `update_post.php`. This
  was an explicit product requirement ("ask first before running update
  query") - don't reintroduce save-on-blur/change without re-confirming
  that's actually wanted.
- **CSV export** (`api/export.php`) respects the current filters/sort/
  search, and has an opt-in live link-status filter that checks every
  surviving row's real permalink over HTTP before including it (slow by
  design - it's opt-in for exactly that reason). Excel/JSON export from
  the original spec was intentionally dropped; CSV covers every real
  requirement so far.

## Feature: Redirects tab

- Yoast SEO **Premium** stores its redirect rules in `wp_options` under
  `option_name = 'wpseo-premium-redirects-base'` as one serialized PHP
  array - there is no dedicated redirects table. `api/lib/redirects.php`
  loads and unserializes it (`dw_load_yoast_redirects()`).
- Each rule has a `format`: `plain` (a literal origin/destination path) or
  `regex` (a pattern). Regex rules are listed but their origin/destination
  are **never** resolved against real posts or flagged live/broken/missing
  - the UI shows a neutral "regex" note instead of guessing. Don't wire
  regex rows into the match-status filters without solving the much harder
  "does this real URL match this regex" problem first.
- **Matching** (`dw_resolve_paths_to_posts()`): for `plain` rules, each
  origin/destination path is resolved by looking up its last path segment
  as a post slug, then confirmed by reconstructing that candidate's real
  full permalink path (the *same* `dw_build_post_path()` / category /
  parent-path logic the Content tab uses) and comparing it exactly. This
  surfaces:
  - **Origin still live** - the old URL this redirect is supposedly
    retiring still resolves to a real published post (likely stale or
    conflicting).
  - **Destination missing** - the redirect's target doesn't match any
    known post (could be an intentional external URL, or genuinely
    broken).
  - **Healthy** - neither of the above.
- **Live link-status check target is the origin URL**, not the
  destination - an explicit choice, to verify the redirect rule is
  actually firing rather than to audit where it points.
- CSV export (`api/redirects_export.php`) mirrors the Content tab's
  export pattern exactly, including the same opt-in live-check-before-
  export filter (on the origin URL).

## Frontend structure (`script.js` / `index.html`)

- Two "views" toggled by the `#viewTabs` switcher: `#contentView` and
  `#redirectsView`. Each has its own filters/search panel, export button
  (folded into the filters toolbar, not a separate panel), and results
  table - same visual components (`.card-panel`, `.toolbar`, `.tab-group`)
  reused for both.
- No framework/bundler - state lives in plain objects (`state` for
  Content, `redirectsState` for Redirects), render/load/bind functions per
  feature.
- **Shared pieces, used by both tabs:**
  - `qs()` - querystring builder.
  - `escapeHtml()` / `truncate()`.
  - `createLinkStatusController()` - the *only* implementation of the
    live-check UI (single "Check" button + concurrent "Check all") and its
    cache. Content and Redirects each get their own instance
    (`postLinkStatus`, `redirectLinkStatus`) with separate caches, and
    Redirects namespaces its ids with an `"r"` prefix so a redirect id can
    never collide with a post id in the same cache/DOM lookup.
- **Manual-save/dirty-tracking** (`dirtyFields`, `markDirty()`,
  `applyDirtyOverlay()`, `persistFields()`, `saveRow()`,
  `saveAllDirty()`) is entirely client-side, in front of the always-simple
  per-field `update_post.php`. `applyDirtyOverlay()` re-stamps any pending
  edits after every table re-render, so switching pages/filters/sites
  never silently discards unsaved work - it just becomes invisible until
  that row is back on screen.

## Backend structure (`api/`)

| File | Responsibility |
|---|---|
| `bootstrap.php` | Every endpoint's entrypoint. Resolves the active site DB (see multi-site section), connects, loads `lib/constants.php` + `lib/query.php`, defines `json_out()` / `require_post_method()`. |
| `lib/constants.php` | Whitelists: excluded/default post types, Yoast meta keys, sort-column map. **Add new sortable columns or post-type exclusions here.** |
| `lib/query.php` | All Posts-table SQL: filter parsing (`dw_parse_input`), WHERE builder (`dw_build_where`), paginated fetch, batch hydration (`dw_hydrate_batch` - meta, categories, permalink), category/parent path walkers, permalink-structure-aware path building, slug sanitizer, postmeta upsert. |
| `lib/link_checker.php` | Concurrent (`curl_multi`) URL status checker (`dw_check_urls_concurrent`) + status-bucket matcher (`dw_link_status_matches`). Used only by the two export endpoints' opt-in live-check filter - **not** by the on-demand single "Check" button. |
| `lib/redirects.php` | Everything Redirects-tab-specific: load/parse the Yoast option, path-to-post resolver, shared filter/sort helpers. |
| `list_posts.php` | GET - paginated/filtered/sorted Content list. |
| `update_post.php` | POST - save one field on one post (see manual-save flow above). |
| `export.php` | GET - streamed CSV export for Content, batch-fetched (50k+ posts safe). |
| `filter_options.php` | GET - status dropdown options. |
| `check_url_status.php` | GET - one-off live HTTP status check for a single URL. Restricted to the current site's own host - not an open URL fetcher. |
| `redirects.php` | GET - paginated/filtered/sorted Redirects list. |
| `redirects_export.php` | GET - CSV export for Redirects. |
| `databases.php` | GET - which sites are configured + which one is currently active. |

## Known gaps (intentional, not oversights)

- Author/category/tag **filters** aren't in the UI yet (see Content tab
  section) - the query layer already supports them.
- No Excel/JSON export - CSV only, by design (see `export.php`'s own
  comment).
- Regex-format redirects are listed but never evaluated for live/broken
  status.
- No WordPress-style auth/capability layer - this isn't a WP admin page.

## Extension pointers

- **New editable field**: add a case in `editableInput()`/`renderCell()`
  (`script.js`) + a case in `update_post.php`'s field switch + an entry in
  `FIELD_LABELS` (`script.js`, for the confirm-dialog copy).
- **New export column**: add to `$allColumns` in `export.php` (or the
  fixed column list in `redirects_export.php`) + the corresponding row key
  in `dw_hydrate_batch()` (or `redirects.php`'s row shaping).
- **New Content filter**: add parsing in `dw_parse_input()` /
  `dw_build_where()` (`query.php`) + a control in `index.html` + a
  `state` key + its fetch param wiring in `bindFilters()` (`script.js`).
- **New site**: add to `$DATABASES` in
  `/salvadore/healthray-sql/conn.php` + its env vars - appears in the Site
  dropdown automatically.

---

## Original spec

The section below is the original ask this tool grew out of - a WordPress
admin-plugin version of the same idea (`WP_Query`, nonces, capability
checks, Excel/JSON export). Kept for context on *why* certain fields/SEO
keys/filters exist, even though the actual implementation took the
standalone-tool path described above instead.

# Task: WordPress Content Export Tool

## Objective

Create a WordPress admin tool that exports all published content (Posts and Pages) along with all important editable fields and SEO metadata.

The tool should allow filtering, sorting, searching, and exporting data to CSV or Excel.

---

# Content Types

Include:

- Posts
- Pages

(Optional)
- Support Custom Post Types through a filter.

---

# Include Only

```
post_status = publish
```

---

# Retrieve the Following Fields

## Basic Information

- ID
- Post Type
- Title
- Slug
- Permalink
- Status
- Author
- Author Name
- Publish Date
- Modified Date
- Post Order (menu_order)
- Parent Page
- Parent ID
- Template
- Featured Image URL
- Featured Image ID
- Comment Status
- Ping Status
- Password Protected
- Sticky Post
- GUID

---

## SEO

Retrieve from Yoast SEO (fallback if empty).

- Meta Title
- Meta Description
- Focus Keyword
- Canonical URL
- Robots Index
- Robots Follow
- Open Graph Title
- Open Graph Description
- Open Graph Image
- Twitter Title
- Twitter Description

Meta Keys

```
_wpseo_title
_wpseo_metadesc
_wpseo_focuskw
_wpseo_canonical
_wpseo_meta-robots-noindex
_wpseo_meta-robots-nofollow
_wpseo_opengraph-title
_wpseo_opengraph-description
_wpseo_opengraph-image
_wpseo_twitter-title
_wpseo_twitter-description
```

---

## Content

Export

- Post Content
- Excerpt
- Word Count
- Reading Time
- Content Length

---

## Categories

For Posts

Return

- Category IDs
- Category Names
- Category Slugs

---

## Tags

Return

- Tag IDs
- Tag Names
- Tag Slugs

---

## Page Information

If Page

Return

- Parent Page
- Page Template
- Menu Order

---

## Featured Image

Return

- Attachment ID
- Image URL
- Alt Text

---

## Custom Fields

Return ALL custom fields.

```
get_post_meta($post_id)
```

Do not exclude unknown meta keys.

---

## Taxonomies

Return all assigned taxonomies.

Dynamic.

---

## Editable Fields

Export every editable field available from the WordPress editor.

Including

- Title
- Slug
- Content
- Excerpt
- Status
- Publish Date
- Modified Date
- Menu Order
- Parent
- Template
- Featured Image
- Categories
- Tags
- Custom Fields
- SEO Fields

---

# Sorting

Default

```
Publish Date DESC
```

Allow sorting by

- Publish Date
- Modified Date
- Title
- Menu Order
- Author
- Post Type

---

# Filters

Provide filters for

- Post Type
- Author
- Status
- Category
- Tag
- Publish Date Range
- Modified Date Range

---

# Search

Search by

- Title
- Slug
- Content
- Meta Title
- Meta Description
- Focus Keyword

---

# Export

Support

- CSV
- Excel (.xlsx)
- JSON

Export should respect

- Current filters
- Current sorting
- Current search

---

# CSV Columns

Export every retrieved field.

One row per post.

---

# Excel

Create

- Auto-sized columns
- Bold header
- Freeze first row
- UTF-8
- Proper date formatting

---

# JSON

Return structured JSON.

Example

```json
{
  "id": 15,
  "post_type": "page",
  "title": "About Us",
  "slug": "about-us",
  "permalink": "https://example.com/about-us/",
  "publish_date": "2025-05-12",
  "modified_date": "2025-06-10",
  "menu_order": 0,
  "meta_title": "...",
  "meta_description": "...",
  "focus_keyword": "...",
  "categories": [],
  "tags": [],
  "featured_image": "...",
  "template": "default",
  "custom_fields": {}
}
```

---

# Performance

Must support

- 50,000+ posts

Requirements

- Pagination
- Lazy loading
- Batch processing
- Memory efficient queries

Avoid loading everything into memory.

---

# WordPress APIs

Prefer

```
WP_Query
```

Use

```
get_post_meta()

get_the_terms()

get_permalink()

get_the_post_thumbnail_url()

get_page_template_slug()

get_userdata()

get_post_field()

wp_get_post_categories()

wp_get_post_tags()
```

Avoid direct SQL unless absolutely necessary.

---

# UI

Create an Admin page.

Features

- Data Table
- Pagination
- Search
- Filters
- Sort
- Export CSV
- Export Excel
- Export JSON

---

# Code Quality

- OOP
- Secure
- Nonce validation
- Capability checks
- Prepared statements where needed
- AJAX for loading/export
- Follow WordPress Coding Standards
- Compatible with latest WordPress version

---

# Deliverables

Implement:

- Admin page
- AJAX endpoints
- Export handlers (CSV, XLSX, JSON)
- Data retrieval service
- Helper functions
- Clean reusable classes
