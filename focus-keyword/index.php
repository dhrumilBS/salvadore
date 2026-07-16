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
                <div class="brand-icon">🔍</div>
                <div class="brand-text">
                    <h1>Keyword Finder</h1>
                    <span>Yoast SEO Audit</span>
                </div>
            </div>


            <div class="idl-body">
                <div class="card-head">
                    <h3 class="table-card-title">Post ID Lookup</h3>
                    <span class="idl-hint">Shows posts of any status — publish, draft or trash</span>
                </div>
                <div class="idl-input-row">
                    <textarea id="postIdsInput" class="idl-textarea"
                        placeholder="Enter post IDs, separated by commas, spaces or new lines&#10;e.g. 12, 45, 78"></textarea>
                    <div class="idl-actions">
                        <button class="btn btn-primary" id="loadByIds">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="8" />
                                <path d="m21 21-4.35-4.35" />
                            </svg>
                            Load Posts
                        </button>
                        <button class="btn" id="clearIds">Clear</button>
                    </div>
                </div>
                <div class="idl-meta" id="idlMeta"></div>
            </div>

            <!-- signed-in user + logout -->
            <div class="sidebar-user" style="margin-top: auto;">
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
                    Logout
                </a>
            </div>

            <!-- fetch perf at bottom -->
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
        </aside>

        <!-- MAIN -->
        <main class="main">

            <!-- HEADER -->
            <header class="page-header">
                <div>
                    <h2 class="page-title">Focus Keyword Dashboard</h2>
                    <p class="page-desc">Find posts sharing the same Yoast focus keyword.</p>
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
                            <option value>Select Post Status</option>
                            <option value="publish">Publish</option>
                            <option value="trash">Trash</option>
                            <option value="darft">Draft</option>
                        </select>
                    </div>

                    <div class="ctrl-group">
                        <span class="ctrl-label">Post Type</span>
                        <select id="posttype" class="styled">
                            <option value>Loading…</option>
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

                    <div class="export-wrap">
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
                        <div class="export-menu" id="exportMenu">
                            <div class="export-menu-header">Export options</div>
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
                        </div>
                    </div>
                </div>
            </header>

            <!-- STATS -->
            <div class="stats-row" id="statsRow">
                <div class="stat-card">
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
                </div>

                <div class="stat-card">
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
                </div>

                <div class="stat-card">
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
                </div>

                <div class="stat-card">
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
                </div>

                <div class="stat-card">
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
                </div>
            </div>

            <!-- POST ID LOOKUP CARD -->
            <div class="table-card" id="idLookupCard">
                <!-- BULK ACTION BAR -->
                <div class="bulk-bar" id="bulkBar" hidden>
                    <label class="bulk-check">
                        <input type="checkbox" id="idSelectAll"> Select all
                    </label>
                    <span class="bulk-count" id="bulkCount">0 selected</span>
                    <div class="bulk-spacer"></div>
                    <span class="ctrl-label">Set status</span>
                    <select id="bulkStatus" class="styled">
                        <option value="publish">Publish</option>
                        <option value="draft">Draft</option>
                        <option value="pending">Pending</option>
                        <option value="private">Private</option>
                        <option value="trash">Trash</option>
                    </select>
                    <button class="btn btn-primary" id="bulkApply">Update Selected</button>
                </div>

                <div class="table-wrap">
                    <table id="idTable" class="idl-table" style="width:100%">
                        <thead>
                            <tr>
                                <th style="width:40px"><input type="checkbox" id="idSelectAllHead"></th>
                                <th style="width:66px">ID</th>
                                <th>Post Title</th>
                                <th>Category</th>
                                <th style="width:120px">Status</th>
                                <th style="width:110px">Modified</th>
                                <th>Focus Keyword</th>
                                <th style="width:230px">Update Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr class="idl-empty">
                                <td colspan="8">Enter post IDs above and click <b>Load Posts</b>.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- TABLE CARD -->
            <div class="table-card">
                <div class="table-card-head">
                    <h3 class="table-card-title">Posts</h3>
                    <!-- ACTIVE KEYWORD FILTER CHIP -->
                    <div class="filter-chip" id="filterChip" hidden>
                        <span class="fc-label">Keyword</span>
                        <span class="fc-value" id="filterChipValue"></span>
                        <button class="fc-clear" id="filterChipClear" title="Clear keyword filter">✕</button>
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
                                <th style="width:46px">#</th>
                                <th style="width:66px">ID</th>
                                <th>Post Title</th>
                                <th>Post Name</th>
                                <th>Category</th>
                                <th style="width:110px">Status</th>
                                <th style="width:110px">Published</th>
                                <th style="width:110px">Last Modified</th>
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