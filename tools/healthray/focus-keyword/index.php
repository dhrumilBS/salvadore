<?php
require_once __DIR__ . '/auth.php';
fk_require_login();
?>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Keyword Duplicate Finder</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.datatables.net/1.13.8/css/jquery.dataTables.min.css">
    <script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
    <script src="https://cdn.datatables.net/1.13.8/js/jquery.dataTables.min.js"></script>
    <link rel="stylesheet" href="./style.css">
    <script>
        /* Apply the saved theme before first paint to avoid a flash. */
        (function () {
            try {
                var t = localStorage.getItem("fk-theme");
                if (!t) t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                document.documentElement.setAttribute("data-theme", t);
            } catch (e) { }
        })();
    </script>
</head>

<body>

    <!-- LOADING OVERLAY -->
    <div id="loadingOverlay">
        <div class="spinner"></div>
        <div class="loading-text" id="loadingText">Loading posts…</div>
    </div>

    <div class="app">

        <!-- SIDEBAR -->
        <aside class="sidebar">
            <div class="sidebar-brand">
                <div class="brand-icon">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-4.4-4.4" />
                    </svg>
                </div>
                <div class="brand-text">
                    <h1>Keyword Finder</h1>
                    <span>Yoast SEO Audit</span>
                </div>
            </div>

            <!-- SITE CONTEXT -->
            <div class="site-badge" id="siteBadge" title="URLs on this page belong to this site">
                <span class="sb-dot"></span>
                <span class="sb-host" id="siteHost">—</span>
            </div>

            <!-- QUICK NAV -->
            <nav class="sidebar-nav">
                <a class="nav-item" href="#postsCard" id="navPosts">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span>All posts</span>
                </a>
                <a class="nav-item" href="#" id="navDuplicates">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Duplicates only</span>
                </a>
            </nav>

            <!-- DUPLICATE COLOUR LEGEND -->
            <div class="sidebar-legend">
                <div class="legend-title">Duplicate groups</div>
                <div class="legend-item"><span class="legend-dot" style="background:#22a06b"></span> Group 1</div>
                <div class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span> Group 2</div>
                <div class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span> Group 3</div>
                <div class="legend-item"><span class="legend-dot" style="background:#8b5cf6"></span> Group 4</div>
                <div class="legend-hint">Rows sharing a focus keyword get the same tint.</div>
            </div>

            <div class="sidebar-foot">
                <!-- THEME -->
                <button class="theme-toggle" id="themeToggle" type="button" title="Toggle dark mode">
                    <svg class="ic-sun" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <circle cx="12" cy="12" r="4" />
                        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
                    </svg>
                    <svg class="ic-moon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" />
                    </svg>
                    <span class="tt-label">Theme</span>
                </button>

                <!-- fetch perf -->
                <div class="perf-meter" id="perfMeter" title="Time to fetch the last result set">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                    </svg>
                    <div class="perf-text">
                        <span class="perf-main" id="perfTotal">—</span>
                        <span class="perf-sub" id="perfServer"></span>
                    </div>
                </div>

                <!-- signed-in user + logout -->
                <div class="sidebar-user">
                    <div class="su-meta">
                        <span class="su-label">Signed in as</span>
                        <span class="su-name"><?= htmlspecialchars(fk_current_user(), ENT_QUOTES) ?></span>
                    </div>
                    <a class="su-logout" href="./logout.php" title="Sign out">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </a>
                </div>
            </div>
        </aside>

        <!-- MAIN -->
        <main class="main">

            <!-- HEADER -->
            <header class="page-header">
                <div>
                    <h2 class="page-title">Focus Keyword Dashboard</h2>
                    <p class="page-desc">Find posts sharing the same Yoast focus keyword. <kbd>/</kbd> to search, <kbd>Esc</kbd> to clear.</p>
                </div>

                <div class="header-controls">
                    <div class="ctrl-group">
                        <span class="ctrl-label">Database</span>
                        <select id="db-select" class="styled" onchange="changeDb(this.value)">
                            <option value="healthray">Healthray</option>
                            <option value="botphonic">Botphonic</option>
                            <option value="local">Local</option>
                        </select>
                    </div>

                    <div class="ctrl-group">
                        <span class="ctrl-label">Post Status</span>
                        <select id="poststatus" class="styled">
                            <option value="publish">Publish</option>
                            <option value="draft">Draft</option>
                            <option value="pending">Pending</option>
                            <option value="private">Private</option>
                            <option value="trash">Trash</option>
                            <option value="any">Any status</option>
                        </select>
                    </div>

                    <div class="ctrl-group">
                        <span class="ctrl-label">Post Type</span>
                        <select id="posttype" class="styled">
                            <option value="post">Loading…</option>
                        </select>
                    </div>

                    <button class="btn btn-refresh" id="refreshTable" title="Reload data">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                        </svg>
                        Refresh
                    </button>

                    <label class="toggle-pill" id="dupToggle">
                        <input type="checkbox" id="onlyDup">
                        <div class="toggle-track">
                            <div class="toggle-thumb"></div>
                        </div>
                        <span class="toggle-label">Duplicates only</span>
                    </label>

                    <!-- COLUMN VISIBILITY -->
                    <div class="menu-wrap">
                        <button class="btn" id="colsBtn" title="Show or hide columns">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <path d="M9 3v18M15 3v18" />
                            </svg>
                            Columns
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                                <path d="m6 9 6 6 6-6" />
                            </svg>
                        </button>
                        <div class="drop-menu" id="colsMenu">
                            <div class="drop-menu-header">Visible columns</div>
                            <div id="colsList"></div>
                        </div>
                    </div>

                    <div class="menu-wrap">
                        <button class="btn btn-primary" id="exportBtn">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Export
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                                <path d="m6 9 6 6 6-6" />
                            </svg>
                        </button>
                        <div class="drop-menu export-menu" id="exportMenu">
                            <div class="drop-menu-header">Export options</div>
                            <div class="export-item" id="exportCSV">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                    <rect x="3" y="3" width="18" height="18" rx="2" />
                                    <path d="M3 9h18M3 15h18M9 3v18" />
                                </svg>
                                Visible rows
                                <span class="ei-badge">CSV</span>
                            </div>
                            <div class="export-item" id="exportOnlyDup">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                    <circle cx="12" cy="12" r="9" />
                                    <path d="M12 8v4l3 3" />
                                </svg>
                                Duplicates only
                                <span class="ei-badge">CSV</span>
                            </div>
                            <div class="export-item" id="exportGrouped">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                    <rect x="2" y="7" width="20" height="14" rx="2" />
                                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                                </svg>
                                Grouped duplicates
                                <span class="ei-badge">CSV</span>
                            </div>
                            <div class="drop-menu-header">Clipboard &amp; handoff</div>
                            <div class="export-item" id="copyUrls">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
                                    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
                                </svg>
                                Copy visible URLs
                                <span class="ei-badge">TXT</span>
                            </div>
                            <div class="export-item" id="copyIds">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                    <rect x="9" y="9" width="12" height="12" rx="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                                Copy visible IDs
                                <span class="ei-badge">TXT</span>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <!-- STATS -->
            <div class="stats-row" id="statsRow">
                <button class="stat-card" data-stat="all" title="Clear all filters">
                    <div class="stat-top">
                        <div class="stat-icon blue">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                            </svg>
                        </div>
                        <div class="stat-label">Total Posts</div>
                    </div>
                    <div class="stat-val" id="statTotal">—</div>
                    <div class="stat-sub">in selected type</div>
                </button>

                <button class="stat-card" data-stat="with" title="Show only posts that have a focus keyword">
                    <div class="stat-top">
                        <div class="stat-icon green">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 6 9 17l-5-5" />
                            </svg>
                        </div>
                        <div class="stat-label">With Keyword</div>
                    </div>
                    <div class="stat-val" id="statWithKw">—</div>
                    <div class="stat-sub">have focus keyword set</div>
                </button>

                <button class="stat-card" data-stat="dup" title="Show only duplicate-keyword posts">
                    <div class="stat-top">
                        <div class="stat-icon orange">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                        </div>
                        <div class="stat-label">Duplicates</div>
                    </div>
                    <div class="stat-val" id="statDup">—</div>
                    <div class="stat-sub">posts with duplicate KW</div>
                </button>

                <button class="stat-card" data-stat="uniq" title="Open the conflicting keyword list">
                    <div class="stat-top">
                        <div class="stat-icon red">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                                <line x1="12" y1="9" x2="12" y2="13" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                        </div>
                        <div class="stat-label">Unique Dup KWs</div>
                    </div>
                    <div class="stat-val" id="statUniqKw">—</div>
                    <div class="stat-sub">distinct conflicting terms</div>
                </button>

                <button class="stat-card" data-stat="without" title="Show only posts missing a focus keyword">
                    <div class="stat-top">
                        <div class="stat-icon gray">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                            </svg>
                        </div>
                        <div class="stat-label">Missing Keyword</div>
                    </div>
                    <div class="stat-val" id="statNoKw">—</div>
                    <div class="stat-sub">no focus keyword set</div>
                </button>
            </div>

            <!-- CONFLICTING KEYWORDS PANEL -->
            <div class="table-card kw-panel" id="kwPanel" hidden>
                <div class="table-card-head">
                    <h3 class="table-card-title">Conflicting keywords</h3>
                    <span class="idl-hint" id="kwPanelHint"></span>
                    <button class="btn btn-icon" id="kwPanelClose" title="Hide panel" style="margin-left:auto">✕</button>
                </div>
                <div class="kw-panel-body" id="kwPanelBody"></div>
            </div>

            <!-- TABLE CARD -->
            <div class="table-card" id="postsCard">
                <div class="table-card-head">
                    <h3 class="table-card-title">Posts</h3>

                    <!-- ACTIVE FILTER CHIPS -->
                    <div class="chip-row">
                        <div class="filter-chip" id="filterChip" hidden>
                            <span class="fc-label">Category</span>
                            <span class="fc-value" id="filterChipValue"></span>
                            <button class="fc-clear" id="filterChipClear" title="Clear category filter">✕</button>
                        </div>
                        <div class="filter-chip chip-kw" id="kwChip" hidden>
                            <span class="fc-label">Keyword</span>
                            <span class="fc-value" id="kwChipValue"></span>
                            <button class="fc-clear" id="kwChipClear" title="Clear keyword filter">✕</button>
                        </div>
                        <div class="filter-chip chip-presence" id="presenceChip" hidden>
                            <span class="fc-label">Keyword</span>
                            <span class="fc-value" id="presenceChipValue"></span>
                            <button class="fc-clear" id="presenceChipClear" title="Clear filter">✕</button>
                        </div>
                    </div>

                    <div class="ctrl-group" style="margin-left: auto;">
                        <span class="ctrl-label">Categories</span>
                        <select id="postcat" class="styled">
                            <option value="">Select Categories</option>
                        </select>
                    </div>
                </div>
                <div class="table-wrap">
                    <table id="postTable" style="width:100%">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>ID</th>
                                <th>Original URL</th>
                                <th>Post Name</th>
                                <th>Category</th>
                                <th>Status</th>
                                <th>Published</th>
                                <th>Last Modified</th>
                                <th>Focus Keyword</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>

        </main>
    </div>

    <!-- TOAST CONTAINER -->
    <div id="toast-container"></div>

    <script src="./script.js"></script>
</body>

</html>
