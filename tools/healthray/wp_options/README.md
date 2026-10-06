# WP Options Panel

Secure admin panel for browsing, searching, editing and deleting rows in the
WordPress `wp_options` table, across every database declared in
`../conn.php` (`$DATABASES`).

## Structure

```
wp_options/
├── .htaccess            Clean URLs (/login → login.html, /api/x → api/x.php) + security headers
├── index.html           Dashboard (frontend only - no PHP in pages)
├── login.html           Sign-in page
├── assets/
│   ├── css/style.css
│   └── js/api.js        Fetch wrapper: CSRF header, JSON, 401 → redirect to /login
│       ├── login.js
│       └── app.js       Dashboard logic (search, sort, paginate, CRUD, modals, toasts)
└── api/                 PHP backend - JSON only
    ├── .htaccess        Blocks _internal files
    ├── _config.php      Admin credentials + session/lockout settings
    ├── _bootstrap.php   Session hardening, CSRF, auth, rate limiting
    ├── _db.php          Bridge to ../../conn.php ($DATABASES)
    ├── _hash.php        CLI: php api/_hash.php "new-password"
    ├── session.php      GET  auth status + CSRF token
    ├── login.php        POST sign in (rate-limited, 5 fails → 15 min lock)
    ├── logout.php       POST sign out
    ├── databases.php    GET  available databases
    ├── options.php      GET  paginated/sortable search
    ├── option.php       GET  single row, full value
    ├── save.php         POST create / update
    └── delete.php       POST delete by ids or by match
```

## URLs (no file extensions)

- `http://localhost/salvadore/healthray-sql/wp_options/` - dashboard
- `http://localhost/salvadore/healthray-sql/wp_options/login` - sign in
- Direct `.html`/`.php` GET requests are 301-redirected to the clean URL.

## Security

- Session cookie: `HttpOnly`, `SameSite=Strict`, path-scoped, id regenerated on login
- 30-minute inactivity timeout; CSRF token required on every state-changing request
- Login rate limiting per IP (5 failures → 15-minute lockout)
- All SQL through prepared statements with whitelisted column/sort names
- LIKE wildcards in user input are escaped; bulk delete requires typed confirmation
- `Options -Indexes -MultiViews`, CSP, `X-Frame-Options: DENY`, `nosniff` headers
- Internal PHP files (`_*.php`) are blocked from the web

## Changing the admin password

```
php api/_hash.php "your-new-password"
```

Paste the printed hash into `ADMIN_PASSWORD_HASH` in `api/_config.php`.

## Notes

- The old flat PHP panel (login.php, index.php, delete.php, …) was replaced;
  a backup copy sits in the Claude scratchpad `legacy-backup` folder.
- Requires Apache `mod_rewrite` (enabled by default in XAMPP) and
  `AllowOverride All` for the htdocs directory (XAMPP default).
