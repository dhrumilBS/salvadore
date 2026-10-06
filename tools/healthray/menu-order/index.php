<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <title>Menu Order</title>
    <!-- Theme is shared with the Link Checker so both tools match -->
    <script>try { var t = localStorage.getItem('linkChecker.theme'); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; } catch (e) { }</script>
    <link rel="stylesheet" href="./style.css">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='2.6' stroke-linecap='round'%3E%3Cpath d='M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'/%3E%3C/svg%3E">
    <script src="./app.js" defer></script>
</head>

<body>

    <!-- ══ Header ═══════════════════════════════════════════ -->
    <header class="app-header">
        <div class="brand">
            <span class="brand-mark" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M8 6h13M8 12h13M8 18h13" />
                    <path d="M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
            </span>
            <div class="brand-text">
                <h1>Menu Order</h1>
                <span class="brand-sub">Page order, titles, slugs &amp; dates</span>
            </div>
        </div>

        <div class="header-meta">
            <label class="site-switch" title="Switch which site's database this tool reads and writes">
                <span class="site-dot" aria-hidden="true"></span>
                <select class="site-select" id="site-select" aria-label="Site"></select>
            </label>
            <a class="site-url" id="site-url" target="_blank" rel="noopener" title="Open the site"></a>
            <button class="hicon" id="btn-theme" aria-label="Switch theme"></button>
            <button class="hicon" id="btn-help" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
        </div>
    </header>

    <main class="container">

        <!-- ══ Toolbar ════════════════════════════════════════ -->
        <section class="panel toolbar" aria-label="Filters">
            <label class="select-wrap" title="Which content type to order">
                <span class="select-cap">Type</span>
                <select class="select" id="sel-type"></select>
            </label>

            <label class="select-wrap" id="parent-wrap" hidden title="Only show children of one parent — menu order is relative to siblings">
                <span class="select-cap">Parent</span>
                <select class="select" id="sel-parent"></select>
            </label>

            <div class="searchbox" id="searchbox">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7.5" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input type="text" id="inp-search" placeholder="Search title, slug or ID…" aria-label="Search" autocomplete="off" spellcheck="false">
                <button class="search-clear" id="btn-search-clear" title="Clear search (Esc)" aria-label="Clear search">×</button>
                <span class="kbd search-kbd" aria-hidden="true">/</span>
            </div>

            <label class="select-wrap" title="Sort the list">
                <span class="select-cap">Sort</span>
                <select class="select" id="sel-sort">
                    <option value="newest">Newest first</option>
                    <option value="order">Menu order</option>
                    <option value="title">Title A–Z</option>
                    <option value="date">Publish date</option>
                </select>
            </label>

            <div class="toolbar-end">
                <div class="seg" id="view-tabs" role="group" aria-label="Show">
                    <button class="seg-btn active" data-view="all">All <span class="fc" id="cnt-all">0</span></button>
                    <button class="seg-btn" data-view="ties" title="Pages whose menu order is shared with another page — their relative order falls back to title">Shared order <span class="fc fc-warn" id="cnt-ties">0</span></button>
                    <button class="seg-btn" data-view="changed">Unsaved <span class="fc fc-primary" id="cnt-changed">0</span></button>
                </div>
                <button class="btn btn-ghost" id="btn-renumber" title="Give the pages in view evenly spaced orders, in the order shown">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M4 6h2v6M4 12h4M17 4v16M13 16l4 4 4-4" />
                        <path d="M5 16.5a1.5 1.5 0 1 1 2.6 1L4 20h4" />
                    </svg>
                    Renumber
                </button>
            </div>
        </section>

        <div class="hintbar" id="hintbar"></div>

        <!-- ══ Table ══════════════════════════════════════════ -->
        <div class="table-wrap" id="table-wrap">
            <table>
                <colgroup>
                    <col class="col-handle">
                    <col class="col-order">
                    <col class="col-title">
                    <col class="col-slug">
                    <col class="col-date">
                    <col class="col-actions">
                </colgroup>
                <thead>
                    <tr>
                        <th aria-label="Reorder"></th>
                        <th>Order</th>
                        <th>Title</th>
                        <th>Slug <span class="th-sub">→ URL</span></th>
                        <th class="hide-mob">Published</th>
                        <th class="th-right">Actions</th>
                    </tr>
                </thead>
                <tbody id="tbody"></tbody>
            </table>
        </div>

        <footer class="panel footer-bar">
            <span class="footer-info" id="footer-info">—</span>
            <span class="footer-hint"><span class="kbd">Alt</span>+<span class="kbd">↑</span><span class="kbd">↓</span> move row · <span class="kbd">Ctrl</span>+<span class="kbd">S</span> save</span>
        </footer>
    </main>

    <!-- ══ Floating save bar ════════════════════════════════ -->
    <div class="save-bar" id="save-bar" role="region" aria-label="Unsaved changes">
        <span class="save-info"><span class="save-pill" id="save-count">0</span> <span id="save-label">unsaved changes</span></span>
        <button class="btn btn-sm btn-dark-ghost" id="btn-discard">Discard all</button>
        <button class="btn btn-sm btn-primary" id="btn-review">Review &amp; save</button>
    </div>

    <!-- ══ Review modal ═════════════════════════════════════ -->
    <div class="modal-overlay" id="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <div class="modal-box modal-wide">
            <div class="modal-head">
                <h3 id="review-title">Review changes</h3>
                <span class="modal-sub" id="review-sub"></span>
                <button class="modal-close" data-close title="Close (Esc)" aria-label="Close">×</button>
            </div>
            <div class="modal-scroll">
                <div class="review-warn" id="review-warn" hidden></div>
                <div class="review-list" id="review-list"></div>
            </div>
            <div class="modal-actions">
                <span class="db-hint" id="review-db"></span>
                <button class="btn btn-ghost" data-close>Keep editing</button>
                <button class="btn btn-primary" id="btn-save">Save changes</button>
            </div>
        </div>
    </div>

    <!-- ══ Renumber modal ═══════════════════════════════════ -->
    <div class="modal-overlay" id="renumber-modal" role="dialog" aria-modal="true" aria-labelledby="renumber-title">
        <div class="modal-box modal-narrow">
            <div class="modal-head">
                <h3 id="renumber-title">Renumber pages</h3>
                <button class="modal-close" data-close title="Close (Esc)" aria-label="Close">×</button>
            </div>
            <div class="modal-scroll">
                <p class="modal-text" id="renumber-text"></p>
                <div class="form-grid">
                    <label class="form-field">
                        <span>Start at</span>
                        <input type="number" class="input" id="rn-start" value="10" step="1">
                    </label>
                    <label class="form-field">
                        <span>Step</span>
                        <input type="number" class="input" id="rn-step" value="10" min="1" step="1">
                    </label>
                </div>
                <label class="form-check">
                    <input type="checkbox" id="rn-reverse">
                    <span>Count down instead of up (first row gets the highest number)</span>
                </label>
                <div class="rn-preview" id="rn-preview"></div>
            </div>
            <div class="modal-actions">
                <span class="kbd-hint">Nothing is saved until you review</span>
                <button class="btn btn-ghost" data-close>Cancel</button>
                <button class="btn btn-primary" id="btn-rn-apply">Apply</button>
            </div>
        </div>
    </div>

    <!-- ══ Shortcuts modal ══════════════════════════════════ -->
    <div class="modal-overlay" id="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <div class="modal-box modal-narrow">
            <div class="modal-head">
                <h3 id="help-title">How it works</h3>
                <button class="modal-close" data-close title="Close (Esc)" aria-label="Close">×</button>
            </div>
            <div class="modal-scroll">
                <ul class="help-list">
                    <li>Edit any field inline. Changed fields turn blue and nothing is written until you <strong>Review &amp; save</strong>.</li>
                    <li>Sort by <strong>Menu order</strong> to drag rows with the <span class="kbd">⋮⋮</span> handle. Only the rows that need a new number are changed.</li>
                    <li><strong>Shared order</strong> lists pages that have the same number as another page. WordPress then orders them by title.</li>
                    <li>If a page was edited in WordPress after you loaded it, the save is refused so nothing gets overwritten.</li>
                </ul>
                <div class="shortcut-list">
                    <div class="keys"><span class="kbd">/</span></div>
                    <div>Focus search</div>
                    <div class="keys"><span class="kbd">Alt</span>+<span class="kbd">↑</span> <span class="kbd">↓</span></div>
                    <div>Move the focused row up / down</div>
                    <div class="keys"><span class="kbd">Ctrl</span>+<span class="kbd">S</span></div>
                    <div>Review &amp; save</div>
                    <div class="keys"><span class="kbd">Esc</span></div>
                    <div>Clear search / close dialogs</div>
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-primary" data-close>Got it</button>
            </div>
        </div>
    </div>

    <div id="toast" aria-live="polite"></div>
</body>

</html>
