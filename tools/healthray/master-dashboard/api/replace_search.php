<?php
/**
 * POST api/replace_search.php?db= - find matches and preview the replacement. Read-only.
 * JSON body: {find, replace, case, word, skipTags, scopes[], statuses[], types[], ids}
 * POST (not GET) because the find/replace text can be long; it still goes
 * through require_post_method() like every other POST endpoint.
 */
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/lib/find_replace.php';
require_post_method();

$o = fr_options(fr_body());
$started = microtime(true);

try {
    [$rows, $hitLimit] = fr_candidates($conn, $o, FR_MAX_FIELDS);

    $fields = [];
    $totalMatches = 0;
    foreach ($rows as $r) {
        $res = fr_apply($r['value'], $o, true);
        if (!$res['count']) {
            continue; // LIKE is only a pre-filter - case, whole word and HTML tags are decided here
        }
        $totalMatches += $res['count'];
        $fields[] = [
            'kind'     => $r['kind'],
            'id'       => $r['id'],
            'post_id'  => $r['post_id'],
            'field'    => $r['field'],
            'scope'    => fr_row_scope($r),
            'format'   => $res['format'],
            'count'    => $res['count'],
            'snippets' => $res['snippets'],
            'blocked'  => $res['blocked'],
        ];
    }
    // Truncated when PHP found more than the cap OR any SQL pre-filter hit its row LIMIT
    // (then rows beyond it were never looked at, even if few of the fetched ones matched).
    $truncated = $hitLimit || count($fields) > FR_MAX_FIELDS;
    $fields = array_slice($fields, 0, FR_MAX_FIELDS);
    if ($truncated) {
        $totalMatches = array_sum(array_column($fields, 'count'));
    }
    $posts = fr_posts_info($conn, array_column($fields, 'post_id'));
    $home = fr_home_url($conn);
} catch (Throwable $e) {
    json_out(false, 'Search failed: ' . $e->getMessage());
}

json_out(true, 'ok', [
    'fields'    => $fields,
    'posts'     => (object) $posts,
    'matches'   => $totalMatches,
    'truncated' => $truncated,
    'limit'     => FR_MAX_FIELDS,
    'home'      => $home,
    'site'      => $ACTIVE_DB,
    'ms'        => (int) ((microtime(true) - $started) * 1000),
]);
