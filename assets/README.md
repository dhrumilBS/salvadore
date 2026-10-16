# assets/

Static files shared by the dashboard and the tools. Open `/salvadore/assets/` for a gallery of
everything here, with copy-URL and download buttons.

| Path | What | Rules |
|---|---|---|
| `brand/` | Company logos + the site favicon | Other sites may link to these (also via the old `/salvadore/company/` URL). **Never rename or delete a file**; replacing one in place is fine. `site-login-logo.svg` is an identical copy of `healthray-logo.svg`, kept because something may still load it by that name. |
| `icons/` | One SVG per tool — its dashboard card icon *and* its favicon | Named after the tool, referenced from `registry.php` (`icon` key) and the tool's `<link rel="icon">`. |
| `home.css`, `home.js` | Dashboard (`../index.php`) styles and behaviour; the Assets page reuses `home.css` | Loaded with `?v=<mtime>`, so edits show up without a hard refresh. |
| `index.php` | The Assets gallery | Read-only; lists the folders at request time. |
| `.htaccess` | Cache headers (CSS/JS 7 days, SVG 1 day) | |

## New tool icon

Copy any file in `icons/` and change two things:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#1865c9"/>                      <!-- the tool's accent colour -->
  <g transform="translate(5 5) scale(.9167)" fill="none" stroke="#fff"
     stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="…"/>                                                             <!-- a 24×24 stroke icon, e.g. from lucide.dev -->
  </g>
</svg>
```

Then add `'icon' => '<name>'` to the tool in `registry.php` and
`<link rel="icon" href="../../assets/icons/<name>.svg" type="image/svg+xml">` to its page.

## Optimising an SVG

Brand files were optimised with [svgo](https://github.com/svg/svgo) 3 at `floatPrecision: 3`
with `mergePaths` and `removeViewBox` turned off (merging paths changes edge anti-aliasing).
Compare a before/after render before replacing a logo.