<?php
/**
 * GET api/robots_summary.php - Overview "Search visibility" card. Read-only.
 *
 * For EVERY configured site (not just ?db=), counts published posts of the real
 * content types by their effective Yoast "Advanced" robots settings:
 *   indexed          shows in search results (set to Yes, or the type's default is Yes)
 *   noindex_post     set to No on the post itself (the Content tab's seo=noindex filter)
 *   noindex_default  left on Default, and the type's default is No (wpseo_titles noindex-<type>)
 *   nofollow         "Follow links" set to No
 * Each site gets its own connection; one that can't be reached reports `error`
 * instead of failing the others.
 */
require __DIR__ . '/bootstrap.php';

/** Like conn.php's db_connect(), but returns null instead of die() so one dead site doesn't hide the others. */
function rs_connect(array $cfg)
{
    $isLocal = in_array($cfg['host'], ['127.0.0.1', 'localhost', '::1'], true);
    $c = mysqli_init();
    $c->options(MYSQLI_OPT_CONNECT_TIMEOUT, 8);
    if (!@$c->real_connect($cfg['host'], $cfg['user'], $cfg['pass'], $cfg['name'], $cfg['port'], null, $isLocal ? 0 : MYSQLI_CLIENT_COMPRESS)) {
        return null;
    }
    $c->set_charset('utf8mb4');
    return $c;
}

function rs_site_summary(mysqli $c)
{
    $excluded = implode(',', array_map(fn($t) => "'" . $c->real_escape_string($t) . "'", dw_excluded_post_types()));
    $ni = $c->real_escape_string(DW_ROBOTS_META['robots_index']);
    $nf = $c->real_escape_string(DW_ROBOTS_META['robots_follow']);
    $res = $c->query("SELECT p.post_type,
            MAX(CASE WHEN m.meta_key = '$ni' THEN TRIM(m.meta_value) END) AS ni,
            MAX(CASE WHEN m.meta_key = '$nf' THEN TRIM(m.meta_value) END) AS nf
        FROM wp_posts p
        LEFT JOIN wp_postmeta m ON m.post_id = p.ID AND m.meta_key IN ('$ni', '$nf')
        WHERE p.post_status = 'publish' AND p.post_type NOT IN ($excluded)
        GROUP BY p.ID, p.post_type");
    if (!$res) {
        throw new RuntimeException($c->error);
    }
    $defaults = dw_yoast_noindex_defaults($c);

    $zero = ['published' => 0, 'indexed' => 0, 'noindex_post' => 0, 'noindex_default' => 0, 'nofollow' => 0];
    $totals = $zero;
    $byType = [];
    while ($r = $res->fetch_assoc()) {
        $t = $r['post_type'];
        $byType[$t] ??= $zero + ['default_noindex' => !empty($defaults[$t])];
        $index = dw_robots_field_value('robots_index', $r['ni']);
        $bucket = $index === 'noindex' ? 'noindex_post'
            : ($index === '' && !empty($defaults[$t]) ? 'noindex_default' : 'indexed');
        foreach (['published', $bucket] as $k) {
            $byType[$t][$k]++;
            $totals[$k]++;
        }
        if (dw_robots_field_value('robots_follow', $r['nf']) === 'nofollow') {
            $byType[$t]['nofollow']++;
            $totals['nofollow']++;
        }
    }
    uasort($byType, fn($a, $b) => $b['published'] <=> $a['published']);
    return $totals + ['by_type' => $byType];
}

$sites = [];
foreach ($DATABASES as $key => $cfg) {
    $label = (string) ($cfg['label'] ?? $key);
    $site = ['key' => $key, 'label' => $label, 'live' => (bool) preg_match('/\blive\b/i', $label), 'current' => $key === $ACTIVE_DB];
    $c = $key === $ACTIVE_DB ? $conn : rs_connect($cfg);
    if (!$c) {
        $sites[] = $site + ['error' => 'Could not connect'];
        continue;
    }
    try {
        $sites[] = $site + rs_site_summary($c);
    } catch (Throwable $e) {
        error_log("robots_summary.php ($key): " . $e->getMessage());
        $sites[] = $site + ['error' => 'Could not count'];
    }
    // Connections stay open until the request ends: dw_yoast_noindex_defaults() caches by connection object id,
    // and closing one would let the next connection reuse that id.
}

json_out(true, 'Search visibility loaded', ['sites' => $sites]);
