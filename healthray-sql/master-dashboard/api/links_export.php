<?php
/**
 * GET api/links_export.php - Links & UTM tab's streamed CSV export,
 * respecting the same filters as links_list.php plus the client-side link
 * filters (utm_filter, domain) so "Export" matches whatever the table is
 * currently showing. Three modes:
 *   posts - one row per post (counts only)
 *   links - one row per extracted link
 *   utm   - one row per extracted link, UTM links only
 * `check=1` opts into a live HTTP status column - this re-checks every
 * exported link for real, so it's opt-in and much slower by design.
 * `sort`/`dir` follow the table's sort; `link_status` (ok|redirect|broken|
 * error) mirrors the table's live-result filter and needs `check=1`, since
 * the server has no other way to know a link's live status.
 */
require __DIR__ . '/bootstrap.php';

$f = dw_parse_input($_GET, dw_known_post_types($conn));

$mode = $_GET['mode'] ?? 'links';
if (!in_array($mode, ['posts', 'links', 'utm'], true)) {
    $mode = 'links';
}
$utmFilter    = $_GET['utm_filter'] ?? 'all'; // all | utm | clean | nolinks
$domainFilter = trim((string) ($_GET['domain'] ?? ''));
$doCheck      = !empty($_GET['check']);
$sort         = in_array($_GET['sort'] ?? '', ['post_date', 'title', 'link_count', 'id'], true) ? $_GET['sort'] : 'post_date';
$dir          = strtoupper((string) ($_GET['dir'] ?? 'DESC')) === 'ASC' ? 1 : -1;
$statusWanted = in_array($_GET['link_status'] ?? '', ['ok', 'redirect', 'broken', 'error'], true) ? $_GET['link_status'] : '';

$rows     = dw_fetch_posts_with_content($conn, $f, dw_links_row_cap());
$home     = dw_home_url($conn);
$homeHost = parse_url($home, PHP_URL_HOST);

// Extract once, then sort exactly like the on-screen table.
foreach ($rows as &$r) {
    $r['links'] = dw_extract_links($r['post_content'], $r['permalink'] ?: $home, $homeHost);
    unset($r['post_content']);
}
unset($r);
usort($rows, function ($a, $b) use ($sort, $dir) {
    [$av, $bv] = match ($sort) {
        'title'      => [mb_strtolower((string) $a['title']), mb_strtolower((string) $b['title'])],
        'link_count' => [count($a['links']), count($b['links'])],
        'id'         => [(int) $a['id'], (int) $b['id']],
        default      => [$a['publish_date'], $b['publish_date']],
    };
    return ($av <=> $bv) * $dir;
});

/** Does this post's link set pass the utm_filter / domain dropdown? */
function dw_post_passes_link_filters(array $links, $utmFilter, $domainFilter)
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
header('Content-Type: text/csv; charset=utf-8');
header("Content-Disposition: attachment; filename=\"links-{$mode}-{$stamp}.csv\"");

$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel doesn't mangle non-ASCII text

if ($mode === 'posts') {
    dw_csv_write($out, ['ID', 'Slug', 'Title', 'Permalink', 'Status', 'Published', 'Total Links', 'UTM Links']);
    foreach ($rows as $r) {
        $links = $r['links'];
        if (!dw_post_passes_link_filters($links, $utmFilter, $domainFilter)) {
            continue;
        }
        $scoped = $domainFilter !== ''
            ? array_values(array_filter($links, fn($l) => $l['domain'] === $domainFilter))
            : $links;
        $utmCount = count(array_filter($scoped, fn($l) => $l['is_utm']));
        dw_csv_write($out, [$r['id'], $r['slug'], $r['title'], $r['permalink'], $r['status'], $r['publish_date'], count($scoped), $utmCount]);
    }
    fclose($out);
    exit;
}

/* links / utm modes: one row per link. */
$linkRows = [];
foreach ($rows as $r) {
    $links = $r['links'];
    if (!dw_post_passes_link_filters($links, $utmFilter, $domainFilter)) {
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
    $uniqueUrls  = array_values(array_unique(array_map(fn($row) => $row['link']['url'], $linkRows)));
    [$pins]      = dw_check_plans($conn, $uniqueUrls);
    $statusByUrl = dw_check_urls_concurrent(array_keys($pins), 20, 6, $pins);

    if ($statusWanted !== '') {
        $linkRows = array_values(array_filter($linkRows, function ($row) use ($statusByUrl, $statusWanted) {
            $info = $statusByUrl[$row['link']['url']] ?? null;
            return $info !== null && dw_bucket_for_code($info['code']) === $statusWanted;
        }));
    }
}

$header = ['Post ID', 'Slug', 'Title', 'Permalink', 'Published', 'Link URL', 'Anchor Text', 'Domain', 'Internal/External', 'Has UTM', 'UTM Params'];
if ($doCheck) {
    $header[] = 'HTTP Status';
    $header[] = 'Redirect To';
}
dw_csv_write($out, $header);

foreach ($linkRows as $row) {
    $r = $row['post'];
    $l = $row['link'];
    $cells = [
        $r['id'], $r['slug'], $r['title'], $r['permalink'], $r['publish_date'],
        $l['url'], $l['anchor'], $l['domain'], $l['is_internal'] ? 'Internal' : 'External',
        $l['is_utm'] ? 'YES' : 'NO', implode(' | ', $l['utm_params']),
    ];
    if ($doCheck) {
        $info = $statusByUrl[$l['url']] ?? null;
        $cells[] = $info ? $info['code'] : '';
        $cells[] = $info['redirect_url'] ?? '';
    }
    dw_csv_write($out, $cells);
}
fclose($out);
