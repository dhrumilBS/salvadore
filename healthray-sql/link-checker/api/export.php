<?php
/**
 * GET api/export.php — streamed CSV export, respecting the same filters as
 * list_posts.php (post_type/status/search/date range) plus the client-side
 * link filters (utm_filter, domain) so "Export" matches whatever the table
 * is currently showing. Three modes:
 *   posts — one row per post (counts only)
 *   links — one row per extracted link
 *   utm   — one row per extracted link, UTM links only
 * `check=1` opts into a live HTTP status column — this re-checks every
 * exported link for real, so it's opt-in and much slower by design.
 */
require __DIR__ . '/bootstrap.php';

$knownPostTypes = array_column(lc_known_post_types($conn, $prefix), 'type');
$f = lc_parse_input($_GET, $knownPostTypes);

$mode = $_GET['mode'] ?? 'links';
if (!in_array($mode, ['posts', 'links', 'utm'], true)) {
    $mode = 'links';
}
$utmFilter = $_GET['utm_filter'] ?? 'all'; // all | utm | clean | nolinks
$domainFilter = trim((string) ($_GET['domain'] ?? ''));
$doCheck = !empty($_GET['check']);

$cap = lc_row_cap();
$raw = lc_fetch_posts_raw($conn, $prefix, $f, $cap);
$home     = lc_home_url($conn, $prefix);
$homeHost = parse_url($home, PHP_URL_HOST);

/** Does this post's link set pass the utm_filter / domain dropdown? */
function lc_post_passes_filters(array $links, $utmFilter, $domainFilter)
{
    if ($domainFilter !== '') {
        $links = array_values(array_filter($links, fn($l) => $l['domain'] === $domainFilter));
    }
    if ($utmFilter === 'utm') {
        return (bool) array_filter($links, fn($l) => $l['is_utm']);
    }
    if ($utmFilter === 'clean') {
        return $links && !array_filter($links, fn($l) => $l['is_utm']);
    }
    if ($utmFilter === 'nolinks') {
        return !$links;
    }
    return true;
}

$stamp = date('Y-m-d_His');
$filename = "link-checker-{$mode}-{$stamp}.csv";
header('Content-Type: text/csv; charset=utf-8');
header("Content-Disposition: attachment; filename=\"{$filename}\"");

$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel doesn't mangle non-ASCII text

if ($mode === 'posts') {
    fputcsv($out, ['ID', 'Slug', 'Title', 'Status', 'Published', 'Total Links', 'UTM Links']);
    foreach ($raw as $r) {
        $links = lc_extract_links($r['post_content'], $r['guid'] ?: $home, $homeHost);
        if (!lc_post_passes_filters($links, $utmFilter, $domainFilter)) {
            continue;
        }
        $scoped = $domainFilter !== ''
            ? array_values(array_filter($links, fn($l) => $l['domain'] === $domainFilter))
            : $links;
        $utmCount = count(array_filter($scoped, fn($l) => $l['is_utm']));
        fputcsv($out, [$r['ID'], $r['post_name'], $r['post_title'], $r['post_status'], $r['post_date'], count($scoped), $utmCount]);
    }
    fclose($out);
    exit;
}

/* links / utm modes: one row per link. */
$linkRows = [];
foreach ($raw as $r) {
    $links = lc_extract_links($r['post_content'], $r['guid'] ?: $home, $homeHost);
    if (!lc_post_passes_filters($links, $utmFilter, $domainFilter)) {
        continue;
    }
    foreach ($links as $l) {
        if ($mode === 'utm' && !$l['is_utm']) {
            continue;
        }
        if ($domainFilter !== '' && $l['domain'] !== $domainFilter) {
            continue;
        }
        $linkRows[] = ['post' => $r, 'link' => $l];
    }
}

$statusByUrl = [];
if ($doCheck && $linkRows) {
    set_time_limit(0); // a full live-checked export can legitimately take minutes
    $uniqueUrls = array_values(array_unique(array_map(fn($row) => $row['link']['url'], $linkRows)));
    $safeUrls   = array_values(array_filter($uniqueUrls, 'lc_is_safe_url'));
    $statusByUrl = lc_check_urls_concurrent($safeUrls, 20, 6);
}

$header = ['Post ID', 'Slug', 'Title', 'Published', 'Link URL', 'Anchor Text', 'Domain', 'Internal/External', 'Has UTM', 'UTM Params'];
if ($doCheck) {
    $header[] = 'HTTP Status';
    $header[] = 'Redirect To';
}
fputcsv($out, $header);

foreach ($linkRows as $row) {
    $r = $row['post'];
    $l = $row['link'];
    $cells = [
        $r['ID'], $r['post_name'], $r['post_title'], $r['post_date'],
        $l['url'], $l['anchor'], $l['domain'], $l['is_internal'] ? 'Internal' : 'External',
        $l['is_utm'] ? 'YES' : 'NO', implode(' | ', $l['utm_params']),
    ];
    if ($doCheck) {
        $info = $statusByUrl[$l['url']] ?? null;
        $cells[] = $info ? $info['code'] : '';
        $cells[] = $info['redirect_url'] ?? '';
    }
    fputcsv($out, $cells);
}
fclose($out);
