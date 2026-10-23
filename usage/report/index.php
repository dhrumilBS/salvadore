<?php
/*
 * Tool usage report: who used which tool, when, from where and for how long.
 * Data: data.php (read-only). Behaviour: report.js. This PC only.
 */
require dirname(__DIR__) . '/lib.php';
usage_require_this_pc();
$v = fn($f) => $f . '?v=' . (@filemtime(__DIR__ . '/' . $f) ?: 0);
?>
<!doctype html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <meta name="robots" content="noindex">
    <title>Tool Usage</title>
    <script>try { var t = localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); document.documentElement.setAttribute('data-theme', t); } catch (e) { }</script>
    <link rel="icon" href="../../assets/icons/usage-report.svg" type="image/svg+xml">
    <link rel="stylesheet" href="<?= $v('report.css') ?>">
    <script src="<?= $v('report.js') ?>" defer></script>
</head>

<body>
    <header class="top">
        <a class="back" href="../../" title="Back to the dashboard">←</a>
        <div>
            <h1>Tool Usage</h1>
            <small>Only opens on this PC · log is append-only and signed</small>
        </div>
        <span class="pill" id="integrity">Checking log…</span>
        <div class="top-end">
            <span class="status" id="status" role="status" aria-live="polite"><i></i><span>Connecting…</span></span>
            <div class="seg" id="range" role="group" aria-label="Date range">
                <button type="button" data-range="today" class="active">Today</button>
                <button type="button" data-range="7">7 days</button>
                <button type="button" data-range="30">30 days</button>
                <button type="button" data-range="90">90 days</button>
                <button type="button" data-range="all">All</button>
            </div>
            <button class="icon-btn" id="theme" type="button" aria-label="Toggle light/dark theme" title="Toggle light/dark theme">◐</button>
        </div>
    </header>

    <main id="main">
        <div class="filters">
            <label>Person <select id="fPerson"><option value="">Everyone</option></select></label>
            <label>Tool <select id="fTool"><option value="">All tools</option></select></label>
            <label>Network <select id="fNet">
                    <option value="">Anywhere</option>
                    <option>This PC</option>
                    <option>Office LAN</option>
                    <option>Internet</option>
                </select></label>
            <button class="ghost" id="clear" type="button" hidden>✕ Clear filters</button>
        </div>

        <section class="live-now">
            <h2><span class="dot"></span>Live now <span class="n" id="liveCount">0</span> <span class="hint">Tools open in a visible tab right now · updates by itself</span></h2>
            <div class="live-grid" id="live"></div>
        </section>

        <div class="tiles" id="tiles"></div>

        <div class="charts">
            <section class="card wide">
                <header class="card-head">
                    <div>
                        <h3 id="activityTitle">Activity</h3>
                        <small id="activitySub"></small>
                    </div>
                    <div class="seg small" id="metric" role="group" aria-label="Chart measure">
                        <button type="button" data-metric="active" class="active">Active time</button>
                        <button type="button" data-metric="visits">Visits</button>
                        <button type="button" data-metric="people">People</button>
                    </div>
                </header>
                <div class="chart" id="activity"></div>
            </section>
            <section class="card">
                <header class="card-head">
                    <div>
                        <h3>Top tools</h3>
                        <small id="toolSub">Click a tool to filter by it</small>
                    </div>
                </header>
                <div id="toolChart" class="bars"></div>
            </section>
            <section class="card full">
                <header class="card-head">
                    <div>
                        <h3>When tools are used</h3>
                        <small id="heatSub">By weekday and hour</small>
                    </div>
                    <div class="legend-ramp" aria-hidden="true"><span>Less</span><i></i><span>More</span></div>
                </header>
                <div id="heatmap" class="heatmap"></div>
            </section>
        </div>

        <section class="card tables">
            <header class="card-head">
                <div class="tabs" id="tabs" role="tablist">
                    <button type="button" role="tab" data-tab="people" class="active">People <span class="n" id="nPeople">0</span></button>
                    <button type="button" role="tab" data-tab="tools">Tools <span class="n" id="nTools">0</span></button>
                    <button type="button" role="tab" data-tab="visits">Visits <span class="n" id="nVisits">0</span></button>
                </div>
                <div class="head-end">
                    <small class="hint" id="tabHint">One row per browser · click a name to rename</small>
                    <button class="ghost" id="csv" type="button" title="Download the visits in this view as a CSV file">⤓ Export CSV</button>
                </div>
            </header>
            <div class="table-wrap" data-panel="people"><table id="people"></table></div>
            <div class="table-wrap" data-panel="tools" hidden><table id="tools"></table></div>
            <div data-panel="visits" hidden>
                <div class="table-wrap"><table id="sessions"></table></div>
                <button class="more" id="more" type="button" hidden>Show more</button>
            </div>
        </section>

        <p class="foot" id="foot"></p>
    </main>
    <div class="tip" id="tip" role="tooltip" hidden></div>
</body>

</html>
