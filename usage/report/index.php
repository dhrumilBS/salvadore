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

    <main>
        <div class="filters">
            <label>Person <select id="fPerson"><option value="">Everyone</option></select></label>
            <label>Tool <select id="fTool"><option value="">All tools</option></select></label>
            <label>Network <select id="fNet">
                    <option value="">Anywhere</option>
                    <option>This PC</option>
                    <option>Office LAN</option>
                    <option>Internet</option>
                </select></label>
        </div>

        <section class="live-now">
            <h2><span class="dot"></span>Live now <span class="n" id="liveCount">0</span> <span class="hint">Tools open in a visible tab right now · updates by itself</span></h2>
            <div class="table-wrap"><table id="live"></table></div>
        </section>

        <div class="tiles" id="tiles"></div>

        <section>
            <h2>People <span class="hint">One row per browser (or IP before tracking) · click a name to rename</span></h2>
            <div class="table-wrap"><table id="people"></table></div>
        </section>

        <section>
            <h2>Tools</h2>
            <div class="table-wrap"><table id="tools"></table></div>
        </section>

        <section>
            <h2>Visits <span class="hint">One row per page opened (quick reloads merged), newest first</span></h2>
            <div class="table-wrap"><table id="sessions"></table></div>
            <button class="more" id="more" type="button" hidden>Show more</button>
        </section>

        <p class="foot" id="foot"></p>
    </main>
</body>

</html>
