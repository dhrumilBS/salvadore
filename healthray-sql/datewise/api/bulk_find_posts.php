<?php
require __DIR__ . '/bootstrap.php';
require_post_method();

/*
 * Bulk URL/slug search - the user pastes any mix of bare slugs, site-
 * relative paths, or full permalinks (comma- and/or newline-separated),
 * and this resolves each one to a real post the same way the Content tab
 * would show it, so the Bulk URL Update tab can offer a status change
 * across all of them in one step.
 */

$raw = (string) ($_POST['urls'] ?? '');
$parts = preg_split('/[\r\n,]+/', $raw) ?: [];

$inputs = []; // candidate slug => original pasted text (first occurrence wins)
foreach ($parts as $part) {
    $part = trim($part);
    if ($part === '') {
        continue;
    }
    $slug = dw_extract_slug_from_input($part);
    if ($slug === '' || isset($inputs[$slug])) {
        continue;
    }
    $inputs[$slug] = $part;
}

if (!$inputs) {
    json_out(false, 'No valid slugs/URLs found in the pasted input');
}

$candidates = array_keys($inputs);

$excluded = dw_excluded_post_types();
$exPh = implode(',', array_fill(0, count($excluded), '?'));
$inPh = implode(',', array_fill(0, count($candidates), '?'));

// Exact post_name match covers live/published posts. A trashed post's
// post_name carries a "__trashed" (or "__trashed-2", ...) suffix WordPress
// added on delete, so it also needs a LIKE match per candidate to still be
// found by the slug it was actually known by.
$conditions = ["post_name IN ($inPh)"];
$params = array_map(fn($c) => ['type' => 's', 'value' => $c], $candidates);
foreach ($candidates as $c) {
    $conditions[] = "post_name LIKE ? ESCAPE '\\\\'";
    $params[] = ['type' => 's', 'value' => dw_like_escape($c) . '\\_\\_trashed%'];
}

$sql = "SELECT ID AS id, post_type, post_title AS title, post_name AS slug,
        post_status AS status, post_date, post_parent
    FROM wp_posts
    WHERE post_type NOT IN ($exPh) AND (" . implode(' OR ', $conditions) . ')';

$stmt = $conn->prepare($sql);
$allParams = array_merge(
    array_map(fn($t) => ['type' => 's', 'value' => $t], $excluded),
    $params
);
dw_stmt_bind($stmt, $allParams);
$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$hydrated = dw_hydrate_batch($conn, $rows);

// Index by the cleaned slug (the same key candidates are matched on, for
// both live and trashed posts) so every input can report what matched it.
$bySlug = [];
foreach ($hydrated as $h) {
    $bySlug[$h['slug_clean']][] = $h;
}

$matched = [];
$unmatched = [];
foreach ($inputs as $slug => $original) {
    $hits = $bySlug[$slug] ?? [];
    if (!$hits) {
        $unmatched[] = $original;
        continue;
    }
    foreach ($hits as $h) {
        $h['matched_input'] = $original;
        $matched[] = $h;
    }
}

json_out(true, 'OK', [
    'matched'      => $matched,
    'unmatched'    => $unmatched,
    'total_input'  => count($inputs),
]);
