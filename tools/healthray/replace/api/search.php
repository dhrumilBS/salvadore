<?php
/**
 * POST api/search.php - find matches and preview the replacement. Read-only.
 * Body: {db, find, replace, case, word, skipTags, scopes[], statuses[], types[], ids}
 */
require __DIR__ . '/lib.php';

$o = fr_options(fr_body());
$started = microtime(true);
$rows = fr_candidates($conn, $o, FR_MAX_FIELDS);

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
        'scope'    => $r['kind'] === 'post' ? ['post_title' => 'title', 'post_content' => 'content', 'post_excerpt' => 'excerpt'][$r['field']] : fr_meta_scope($r['field']),
        'format'   => $res['format'],
        'count'    => $res['count'],
        'snippets' => $res['snippets'],
        'blocked'  => $res['blocked'],
    ];
}
$truncated = count($fields) > FR_MAX_FIELDS;
$fields = array_slice($fields, 0, FR_MAX_FIELDS);

json_out(true, 'ok', [
    'fields'    => $fields,
    'posts'     => (object) fr_posts_info($conn, array_column($fields, 'post_id')),
    'matches'   => $totalMatches,
    'truncated' => $truncated,
    'limit'     => FR_MAX_FIELDS,
    'home'      => fr_home_url($conn),
    'ms'        => (int) ((microtime(true) - $started) * 1000),
]);
